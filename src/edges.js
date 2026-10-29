// Execuções -> arestas (R5 a R7). Módulo puro. Receba as execuções de UMA sessão.

import { ROLE_LEVEL } from './roles.js';

export const ROLE_ORDER = ROLE_LEVEL;

function edgeType(from, to) {
  if (from.role === 'outro' || to.role === 'outro') return 'avanço';
  if (from.role === 'qa' && from.verdict === 'REPROVADO') return 'retorno';
  if (ROLE_ORDER[to.role] < ROLE_ORDER[from.role]) return 'retorno';
  return 'avanço';
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
 * @param {{hideOthers?: boolean}} [opts]
 * @returns {{nodes: (Execution & {batch:number})[], edges: {from:string,to:string,type:'avanço'|'retorno'}[]}}
 *   nodes: execuções visíveis com `batch` (coluna, base 1, densa), na ordem de start_ts.
 *   edges: de id -> id; com hideOthers, nós `outro` somem e predecessores ligam aos sucessores.
 */
export function buildEdges(executions, { hideOthers = false } = {}) {
  const { batchOf, preds } = computeBatches(executions);
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
    edges.push({ from, to, type: edgeType(byId.get(from), byId.get(to)) });
  }

  const used = [...new Set(visible.map((e) => batchOf.get(e.id)))].sort((a, b) => a - b);
  const dense = new Map(used.map((b, i) => [b, i + 1]));
  const nodes = visible.map((e) => ({ ...e, batch: dense.get(batchOf.get(e.id)) }));
  return { nodes, edges };
}
