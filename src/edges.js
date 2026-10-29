// Execuções -> arestas (R5 a R7). Módulo puro. Receba as execuções de UMA sessão.

import { EMPTY_TEAM } from './team.js';
import { isValidator } from './roles.js';

const cfgNivel = (team, role) => {
  const c = Object.hasOwn(team.config.papeis, role) ? team.config.papeis[role] : null;
  return c && typeof c.nivel === 'number' ? c.nivel : null;
};

// R15 + R15.1. Ordem: (1) origem com verdict REPROVADO (o model garante verdict null para não validador);
// (2) os dois com `nivel` na config: compara; (3) destino validador: avanço; (4) nível de estreia.
function edgeType(from, to, levels, team) {
  if (from.role === 'outro' || to.role === 'outro') return 'avanço';
  if (from.verdict === 'REPROVADO') return 'retorno';
  const nf = cfgNivel(team, from.role);
  const nt = cfgNivel(team, to.role);
  if (nf !== null && nt !== null) return nt < nf ? 'retorno' : 'avanço';
  if (isValidator(to.role, team)) return 'avanço';
  return levels[to.role] < levels[from.role] ? 'retorno' : 'avanço';
}

/** R15: nível = rank denso do lote em que o papel estreia (todas as execuções, sem `outro`). */
function computeLevels(executions, batchOf) {
  const debut = new Map();
  for (const ex of executions) {
    if (ex.role === 'outro') continue;
    const b = batchOf.get(ex.id);
    if (!debut.has(ex.role) || b < debut.get(ex.role)) debut.set(ex.role, b);
  }
  const rank = new Map([...new Set(debut.values())].sort((a, b) => a - b).map((b, i) => [b, i + 1]));
  const levels = {};
  for (const [role, b] of debut) levels[role] = rank.get(b);
  return levels;
}

/** R5: lotes de disparo. Retorna {batchOf: Map(id->n base 1), preds: Map(id->Set(id))}. */
function computeBatches(executions) {
  const evs = [];
  for (const ex of executions) {
    const st = Date.parse(ex.start_ts);
    evs.push({ id: ex.id, kind: 'start', t: st, k: 1 });
    if (ex.stop_ts) {
      const sp = Math.max(Date.parse(ex.stop_ts), st);
      // Stop empatado com o Start da mesma execução vem depois dele; nos demais empates, Stop antes de Start.
      evs.push({ id: ex.id, kind: 'stop', t: sp, k: sp === st ? 2 : 0 });
    }
  }
  evs.sort((a, b) => a.t - b.t || a.k - b.k);

  const batchOf = new Map();
  const preds = new Map();
  let n = 0;
  let pending = [];
  let lastWasStart = false;
  let current = null;
  for (const e of evs) {
    if (e.kind === 'start') {
      if (!lastWasStart) {
        n += 1;
        current = new Set(pending);
        pending = [];
      }
      batchOf.set(e.id, n);
      preds.set(e.id, current);
      lastWasStart = true;
    } else {
      pending.push(e.id);
      lastWasStart = false;
    }
  }
  return { batchOf, preds };
}

/**
 * @param {Execution[]} executions execuções de uma sessão (ver model.js)
 * @param {{hideOthers?: boolean, team?: Team}} [opts]
 * @returns {{nodes: (Execution & {batch:number})[], edges: {from:string,to:string,type:'avanço'|'retorno'}[],
 *            levels: Record<string, number>}}
 *   nodes: execuções visíveis com `batch` (coluna, base 1, densa), na ordem de start_ts.
 *   edges: de id -> id; com hideOthers, nós `outro` somem e predecessores ligam aos sucessores.
 */
export function buildEdges(executions, { hideOthers = false, team = EMPTY_TEAM } = {}) {
  const { batchOf, preds } = computeBatches(executions);
  const levels = computeLevels(executions, batchOf);
  const byId = new Map(executions.map((e) => [e.id, e]));

  let pairs = [];
  for (const ex of executions) for (const p of preds.get(ex.id) ?? []) pairs.push([p, ex.id]);

  let visible = executions;
  if (hideOthers) {
    for (const h of executions.filter((e) => e.role === 'outro')) {
      const ins = pairs.filter(([, to]) => to === h.id).map(([f]) => f);
      const outs = pairs.filter(([from]) => from === h.id).map(([, t]) => t);
      pairs = pairs.filter(([f, t]) => f !== h.id && t !== h.id);
      for (const i of ins) for (const o of outs) pairs.push([i, o]);
    }
    visible = executions.filter((e) => e.role !== 'outro');
  }

  const seen = new Set();
  const edges = [];
  for (const [from, to] of pairs) {
    const key = from + '\u0000' + to;
    if (seen.has(key) || from === to) continue;
    seen.add(key);
    edges.push({ from, to, type: edgeType(byId.get(from), byId.get(to), levels, team) });
  }

  const used = [...new Set(visible.map((e) => batchOf.get(e.id)))].sort((a, b) => a - b);
  const dense = new Map(used.map((b, i) => [b, i + 1]));
  const nodes = visible.map((e) => ({ ...e, batch: dense.get(batchOf.get(e.id)) }));
  return { nodes, edges, levels };
}
