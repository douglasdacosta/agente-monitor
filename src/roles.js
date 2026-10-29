// Regras puras dos papéis do time (R14, R16, R17, R19). Sem lista de papéis do time: o time é o que aparece nos
// eventos. Só a lista de nativos e o fallback `qa` da R16.3 têm nome literal.
import { EMPTY_TEAM, NATIVE_TYPES } from './team.js';
import { colorFor, fromHex } from './palette.js';

export { NATIVE_TYPES };

const own = (obj, k) => (Object.hasOwn(obj, k) ? obj[k] : undefined);
const cfgOf = (team, role) => own(team.config.papeis, role) ?? {};
const SPLIT_RE = /[-_\s]+/;
const words = (name) => String(name).split(SPLIT_RE).filter(Boolean);
const graphemes = (s) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

/** R14: tipo do time = string não vazia, não nativa, sem ':' (plugin) e fora de `nativos` da config. */
export function isTeamType(agentType, team = EMPTY_TEAM) {
  if (typeof agentType !== 'string' || agentType.trim() === '') return false;
  if (NATIVE_TYPES.includes(agentType) || agentType.includes(':')) return false;
  return !team.config.nativos.includes(agentType);
}

/** R16: config > definição > `role === 'qa'`. */
export function isValidator(role, team = EMPTY_TEAM) {
  const c = cfgOf(team, role);
  if (typeof c.validador === 'boolean') return c.validador;
  const def = team.defs.get(role);
  if (def) return def.validador === true;
  return role === 'qa';
}

/** R17 nome: palavras por `-`, `_` e espaço; inicial maiúscula; palavras de até 2 letras todas em maiúsculas. */
export function humanize(name) {
  const w = words(name).map((p) => {
    const g = graphemes(p);
    return g.length <= 2 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
  });
  return w.length ? w.join(' ') : String(name);
}

/** R17 sigla: iniciais das 2 primeiras palavras; uma palavra só = 2 primeiras letras (grafemas). */
export function monogram(name) {
  const w = words(name);
  if (!w.length) return '';
  const first = (s) => graphemes(s)[0];
  const out = w.length >= 2 ? first(w[0]) + first(w[1]) : graphemes(w[0]).slice(0, 2).join('');
  return out.toUpperCase();
}

const ts = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Infinity : t;
};

/**
 * R19: papéis com execução na sessão (sem `outro`), já com a apresentação pronta.
 * @param {Execution[]} executions TODAS as execuções da sessão (antes do hideOthers)
 * @param {Record<string, number>} levels níveis de buildEdges
 * @param {Team} team
 * @param {string[]} [warnings] recebe os avisos de cor (contraste ajustado)
 * Ordem: `ordem` da config (null por último), nível, 1º start_ts, name.
 */
export function describeRoles(executions, levels = {}, team = EMPTY_TEAM, warnings = []) {
  const first = new Map();
  for (const ex of executions) {
    if (ex.role === 'outro') continue;
    const t = ts(ex.start_ts);
    if (!first.has(ex.role) || t < first.get(ex.role)) first.set(ex.role, t);
  }
  const roles = [];
  for (const [name, t0] of first) {
    const c = cfgOf(team, name);
    const def = team.defs.get(name) ?? null;
    let color = null;
    if (c.cor !== undefined) {
      color = fromHex(c.cor);
      if (color?.ajuste) {
        const a = color.ajuste;
        warnings.push(
          `config: papel "${name}": cor ${a.de} tem contraste ${String(a.ratio.toFixed(1)).replace('.', ',')}:1; ajustada para ${a.para}`,
        );
      }
    }
    const { cor, tint, rgb } = color ?? colorFor(name);
    roles.push({
      name,
      nome: c.nome ?? humanize(name),
      sigla: c.sigla ?? monogram(name),
      cor,
      tint,
      rgb,
      nivel: own(levels, name) ?? null,
      nivelConfig: c.nivel ?? null,
      ordem: c.ordem ?? null,
      validador: isValidator(name, team),
      origem: def ? def.origem : 'inferido',
      description: def?.description ?? null,
      model: def?.model ?? null,
      _t: t0,
    });
  }
  const inf = (v) => (v === null ? Infinity : v);
  roles.sort(
    (a, b) =>
      inf(a.ordem) - inf(b.ordem) ||
      inf(a.nivel) - inf(b.nivel) ||
      a._t - b._t ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  // inf(a)-inf(b) com dois Infinity dá NaN (falsy): cai para o próximo critério, como esperado.
  for (const r of roles) delete r._t;
  return roles;
}
