// Invólucro ESM sobre a implementação única da R35 (dentro do hook, que continua um arquivo único).
import { createRequire } from 'node:module';

const hook = createRequire(import.meta.url)('../.claude/hooks/log-agent-event.js');

export const {
  normalizeTokens, transcriptPathFor, isAgentTranscriptPath,
  createTokenAcc, feedTokenLine, tokenResult, TOKENS_MAX_BYTES,
} = hook;

/**
 * Total da sessão sobre as execuções já enriquecidas (cada `tokens` = {count,total,input,cache_creation,cache_read,output,models}|null).
 * Devolve null se nenhuma execução tem dados.
 */
export function sessionTokens(executions) {
  const list = Array.isArray(executions) ? executions : [];
  const t = { count: 0, total: 0, input: 0, cache_creation: 0, cache_read: 0, output: 0, models: [],
    executions: list.length, with_data: 0, without_data: 0 };
  const ordered = list.map((e, i) => [e, i]).sort((a, b) => {
    const x = String(a[0].start_ts || ''), y = String(b[0].start_ts || '');
    return x < y ? -1 : x > y ? 1 : a[1] - b[1];
  });
  for (const [e] of ordered) {
    const k = e && e.tokens;
    if (!k) { t.without_data++; continue; }
    t.with_data++;
    for (const f of ['count', 'total', 'input', 'cache_creation', 'cache_read', 'output']) t[f] += k[f] || 0;
    for (const m of k.models || []) if (!t.models.includes(m)) t.models.push(m);
  }
  return t.with_data === 0 ? null : t;
}
