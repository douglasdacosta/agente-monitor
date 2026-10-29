// Descoberta do time (R13, R14 parte de dados, R16 parte de detecção, R18). Faz I/O, mas recebe todos os
// diretórios por parâmetro: nunca lê o `~` por conta própria. Nunca lança.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_AGENT_BYTES = 256 * 1024;
export const MAX_CONFIG_BYTES = 64 * 1024;
const DESCRIPTION_MAX = 300;
const MODEL_MAX = 40;
const NOME_MAX = 40;
const SIGLA_MAX = 3; // spec 7.3: 4+ grafemas usa os 3 primeiros e avisa
const VALIDATOR_RE = /Resultado:\s*\**\s*APROVADO\s*\|\s*REPROVADO/i;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const HEX3_RE = /^#[0-9A-Fa-f]{3}$/; // spec 7.6 aceita #RGB; vira #RRGGBB
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Tipos nativos (R14): sempre `outro`. Reexportado por roles.js. */
export const NATIVE_TYPES = Object.freeze([
  'general-purpose',
  'Explore',
  'Plan',
  'statusline-setup',
  'output-style-setup',
  'claude',
  'outro',
]);

const graphemes = (s) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

/** Estrutura vazia para quem não tem time (model/edges/roles). */
export const EMPTY_TEAM = Object.freeze({
  defs: new Map(),
  config: Object.freeze({ papeis: Object.freeze({}), nativos: Object.freeze([]) }),
  warnings: Object.freeze([]),
});

/** Pasta pai de `.monitor/`, ou null. */
export function projectDirOf(eventsFile) {
  if (typeof eventsFile !== 'string' || !eventsFile) return null;
  const dir = path.dirname(path.resolve(eventsFile));
  if (path.basename(dir) !== '.monitor') return null;
  return path.dirname(dir);
}

function scalar(raw) {
  let v = raw.trim();
  if (v === '' || /^[|>][+-]?$/.test(v)) return null;
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) v = v.slice(1, -1);
  return v;
}

/** Frontmatter mínimo (ver contrato). Retorna null se não houver. */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return null;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  if (lines[0].trimEnd() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') { end = i; break; }
  }
  if (end < 0) return null;
  const out = {};
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(lines[i]); // coluna 0; indentadas não casam
    if (!m) continue;
    const key = m[1];
    if (key !== 'name' && key !== 'description' && key !== 'model') continue;
    out[key] = scalar(m[2]);
  }
  out.body = lines.slice(end + 1).join('\n');
  return out;
}

// ---- cache por arquivo (mtimeMs:size): o stat roda sempre, o parse só quando o arquivo muda ----
const cache = new Map(); // caminho -> { key, value }
function cached(file, st, compute) {
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.value;
  const value = compute();
  cache.set(file, { key, value });
  return value;
}

const cut = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);

/** Lê as definições de uma pasta de agentes. Retorna {defs: Map, warnings}. */
function readAgents(dir, origem) {
  const defs = new Map();
  const warnings = [];
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return { defs, warnings };
  }
  for (const file of names) {
    const full = path.join(dir, file);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      warnings.push(`agentes: ${origem}/${file} ignorado: ilegível`);
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_AGENT_BYTES) {
      warnings.push(`agentes: ${origem}/${file} ignorado: maior que 256 KB`);
      continue;
    }
    const r = cached(`${full}\0${origem}`, st, () => {
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        return { warn: 'ilegível' };
      }
      const fm = parseFrontmatter(text);
      if (!fm) return { warn: 'sem frontmatter' };
      const name = (fm.name && fm.name.trim()) || file.slice(0, -3);
      return {
        def: {
          name,
          description: cut(fm.description, DESCRIPTION_MAX),
          model: cut(fm.model, MODEL_MAX),
          validador: VALIDATOR_RE.test(fm.body),
          origem,
        },
      };
    });
    if (r.warn) warnings.push(`agentes: ${origem}/${file} ignorado: ${r.warn}`);
    else if (!defs.has(r.def.name)) defs.set(r.def.name, { ...r.def });
  }
  return { defs, warnings };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Valida uma config já parseada. Retorna {papeis, nativos} só com campos válidos; avisos em `warn`. */
function validateConfig(raw, label, warn) {
  const out = { papeis: {}, nativos: [] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warn(`config: ${label}: esperado um objeto JSON`);
    return out;
  }
  if (raw.papeis !== undefined) {
    if (raw.papeis === null || typeof raw.papeis !== 'object' || Array.isArray(raw.papeis)) {
      warn(`config: ${label}: papeis ignorado: esperado objeto`);
    } else {
      for (const name of Object.keys(raw.papeis)) {
        if (UNSAFE_KEYS.has(name)) {
          warn(`config: ${label}: papeis.${name} ignorado: nome reservado`);
          continue;
        }
        const p = raw.papeis[name];
        if (p === null || typeof p !== 'object' || Array.isArray(p)) {
          warn(`config: ${label}: papeis.${name} ignorado: esperado objeto`);
          continue;
        }
        const r = {};
        const bad = (campo, esperado) => warn(`config: ${label}: papeis.${name}.${campo} ignorado: esperado ${esperado}`);
        if (p.nome !== undefined) {
          if (typeof p.nome === 'string' && p.nome.trim().length >= 1 && p.nome.length <= NOME_MAX) r.nome = p.nome.trim();
          else bad('nome', `texto de 1 a ${NOME_MAX} caracteres`);
        }
        if (p.sigla !== undefined) {
          const s = typeof p.sigla === 'string' ? p.sigla.trim() : '';
          const g = s ? graphemes(s) : [];
          if (g.length > SIGLA_MAX) {
            r.sigla = g.slice(0, SIGLA_MAX).join('');
            warn(`config: ${label}: papel "${name}": sigla "${s}" tem mais de ${SIGLA_MAX} caracteres; usando "${r.sigla}"`);
          } else if (g.length >= 1) r.sigla = s;
          else bad('sigla', `texto de 1 a ${SIGLA_MAX} caracteres`);
        }
        if (p.cor !== undefined) {
          if (typeof p.cor === 'string' && HEX_RE.test(p.cor)) r.cor = p.cor;
          else if (typeof p.cor === 'string' && HEX3_RE.test(p.cor)) r.cor = '#' + [...p.cor.slice(1)].map((c) => c + c).join('');
          else bad('cor', '#RRGGBB');
        }
        for (const campo of ['ordem', 'nivel']) {
          if (p[campo] === undefined) continue;
          if (isNum(p[campo])) r[campo] = p[campo];
          else bad(campo, 'número');
        }
        if (p.validador !== undefined) {
          if (typeof p.validador === 'boolean') r.validador = p.validador;
          else bad('validador', 'true ou false');
        }
        out.papeis[name] = r;
      }
    }
  }
  if (raw.nativos !== undefined) {
    if (!Array.isArray(raw.nativos)) {
      warn(`config: ${label}: nativos ignorado: esperado lista de textos`);
    } else {
      const ok = raw.nativos.filter((n) => typeof n === 'string' && n.trim() !== '').map((n) => n.trim());
      if (ok.length !== raw.nativos.length) warn(`config: ${label}: nativos: itens que não são texto foram ignorados`);
      out.nativos = ok;
    }
  }
  return out;
}

/** Lê e valida uma config. `label` aparece nos avisos (ex.: "projeto monitor.json"). Retorna {papeis, nativos}|null. */
function readConfig(file, label, warnings, silentMissing) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (err) {
    if (!(silentMissing && err && err.code === 'ENOENT')) warnings.push(`config: ${label}: ilegível`);
    return null;
  }
  if (!st.isFile()) return null;
  if (st.size > MAX_CONFIG_BYTES) {
    warnings.push(`config: ${label}: ignorado: maior que 64 KB`);
    return null;
  }
  const r = cached(`${file}\0${label}`, st, () => {
    const warns = [];
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return { warns: [`config: ${label}: ilegível`], cfg: null };
    }
    let json;
    try {
      json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      return { warns: [`config: ${label}: JSON inválido`], cfg: null };
    }
    const cfg = validateConfig(json, label, (w) => warns.push(w));
    return { warns, cfg };
  });
  warnings.push(...r.warns);
  return r.cfg;
}

/**
 * Nunca lança. Lê só `<projectDir>/.claude/agents/*.md`, `<homeDir>/.claude/agents/*.md`,
 * `<dir>/.claude/monitor.json` e `configPath`. projectDir/homeDir/configPath null = não lê.
 */
export function discoverTeam({ projectDir = null, homeDir = null, configPath = null } = {}) {
  const warnings = [];
  const defs = new Map();
  const papeis = {};
  const nativos = [];
  try {
    // Definições: o projeto vence o global para o mesmo `name`.
    const sources = [];
    if (projectDir) sources.push([path.join(projectDir, '.claude'), 'projeto']);
    if (homeDir) sources.push([path.join(homeDir, '.claude'), 'global']);
    for (const [base, origem] of sources) {
      const r = readAgents(path.join(base, 'agents'), origem);
      warnings.push(...r.warnings);
      for (const [name, d] of r.defs) if (!defs.has(name)) defs.set(name, d);
    }
    // Config: global -> projeto -> --config, campo a campo; `nativos` é a união.
    const cfgSources = [];
    if (homeDir) cfgSources.push([path.join(homeDir, '.claude', 'monitor.json'), 'global monitor.json', true]);
    if (projectDir) cfgSources.push([path.join(projectDir, '.claude', 'monitor.json'), 'projeto monitor.json', true]);
    if (configPath) cfgSources.push([configPath, `--config ${path.basename(configPath)}`, false]);
    for (const [file, label, silent] of cfgSources) {
      const c = readConfig(file, label, warnings, silent);
      if (!c) continue;
      for (const name of Object.keys(c.papeis)) {
        papeis[name] = { ...(Object.hasOwn(papeis, name) ? papeis[name] : {}), ...c.papeis[name] };
      }
      for (const n of c.nativos) if (!nativos.includes(n)) nativos.push(n);
    }
    // Nativos (e `outro`) não podem ser reestilizados (spec 7.6): a chave é descartada com aviso.
    for (const name of Object.keys(papeis)) {
      if (NATIVE_TYPES.includes(name) || name.includes(':') || nativos.includes(name)) {
        delete papeis[name];
        warnings.push(`config: papeis.${name} ignorado: tipo nativo não pode ser reestilizado`);
      }
    }
  } catch (err) {
    warnings.push(`agentes: descoberta do time falhou: ${err && err.message ? err.message : 'erro'}`);
  }
  return { defs, config: { papeis, nativos }, warnings };
}
