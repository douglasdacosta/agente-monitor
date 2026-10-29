// Config `alertas` (R32) de monitor.json: { "vezMinutos": 2, "expiraHoras": 24, "som": false }.
// Separado de team.js (cujo validateConfig ignora chaves desconhecidas). Nunca lança; só lê arquivos.
import fs from 'node:fs';
import path from 'node:path';
import { MAX_CONFIG_BYTES } from './team.js';

export const ALERT_DEFAULTS = Object.freeze({ vezMinutos: 2, expiraHoras: 24, som: false });

const isPos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Campos válidos de `raw` (undefined = ausente, sem aviso); inválido -> aviso e campo omitido (vale o padrão). */
function validFields(raw, label, warn) {
  const out = {};
  if (raw === undefined) return out;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warn(`config: ${label}: alertas ignorado: esperado objeto`);
    return out;
  }
  for (const k of ['vezMinutos', 'expiraHoras']) {
    if (raw[k] === undefined) continue;
    if (isPos(raw[k])) out[k] = raw[k];
    else warn(`config: ${label}: alertas.${k} ignorado: esperado número maior que 0; usando ${ALERT_DEFAULTS[k]}`);
  }
  if (raw.som !== undefined) {
    if (typeof raw.som === 'boolean') out.som = raw.som;
    else warn(`config: ${label}: alertas.som ignorado: esperado true ou false; usando ${ALERT_DEFAULTS.som}`);
  }
  return out;
}

/** Puro. `raw` = valor de `alertas`. Inválido -> aviso (via `warn`) e padrão, campo a campo. */
export function parseAlertas(raw, label = 'monitor.json', warn = () => {}) {
  return { ...ALERT_DEFAULTS, ...validFields(raw, label, warn) };
}

function readFile(file, label, silentMissing, warnings) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (err) {
    if (!(silentMissing && err && err.code === 'ENOENT')) warnings.push(`config: ${label}: ilegível`);
    return undefined;
  }
  if (!st.isFile()) return undefined;
  if (st.size > MAX_CONFIG_BYTES) {
    warnings.push(`config: ${label}: ignorado: maior que 64 KB`);
    return undefined;
  }
  try {
    const text = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return json && typeof json === 'object' && !Array.isArray(json) ? json.alertas : undefined;
  } catch {
    warnings.push(`config: ${label}: JSON inválido`);
    return undefined;
  }
}

/**
 * Lê `alertas` de <homeDir>/.claude/monitor.json -> <projectDir>/.claude/monitor.json -> configPath.
 * Campo a campo, o último vence. Ausência é silenciosa (exceto `configPath`). Avisos sem caminho absoluto.
 * @returns {{alertas: {vezMinutos:number, expiraHoras:number, som:boolean}, warnings: string[]}}
 */
export function readAlertConfig({ homeDir = null, projectDir = null, configPath = null } = {}) {
  const warnings = [];
  let alertas = { ...ALERT_DEFAULTS };
  try {
    const sources = [];
    if (homeDir) sources.push([path.join(homeDir, '.claude', 'monitor.json'), 'global monitor.json', true]);
    if (projectDir) sources.push([path.join(projectDir, '.claude', 'monitor.json'), 'projeto monitor.json', true]);
    if (configPath) sources.push([configPath, `--config ${path.basename(configPath)}`, false]);
    for (const [file, label, silent] of sources) {
      const raw = readFile(file, label, silent, warnings);
      alertas = { ...alertas, ...validFields(raw, label, (w) => warnings.push(w)) };
    }
  } catch (err) {
    warnings.push(`config: alertas: leitura falhou`);
  }
  return { alertas, warnings };
}
