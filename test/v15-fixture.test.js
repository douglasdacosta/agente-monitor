// v1.5 (tarefa 52a / B11): fixtures/tokens.jsonl bate com a tabela do contrato.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTokens } from '../src/tokens.js';

const rows = readFileSync(new URL('../fixtures/tokens.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('fixture: tokens por agente e totais por sessão', () => {
  const by = {};
  for (const r of rows) if (r.event === 'SubagentStop') (by[r.session_id] ||= []).push(r);
  const sum = (sid) => by[sid].reduce((a, r) => {
    const t = normalizeTokens(r.tokens);
    if (!t) return { ...a, sem: a.sem + 1 };
    return { ...a, count: a.count + t.input + t.cache_creation + t.output, total: a.total + t.input + t.cache_creation + t.cache_read + t.output };
  }, { count: 0, total: 0, sem: 0 });
  assert.deepEqual(sum('sess-tokens-0001'), { count: 2318219, total: 8283219, sem: 1 });
  assert.deepEqual(sum('sess-tokens-0002'), { count: 999, total: 999, sem: 0 });
  assert.deepEqual(sum('sess-tokens-0003'), { count: 14000, total: 44500, sem: 0 });
});

test('fixture: B tem uma execução running; todas as linhas são JSON com ts e session_id', () => {
  const starts = rows.filter((r) => r.session_id === 'sess-tokens-0002' && r.event === 'SubagentStart');
  const stops = rows.filter((r) => r.session_id === 'sess-tokens-0002' && r.event === 'SubagentStop');
  assert.equal(starts.length - stops.length, 1);
  for (const r of rows) assert.ok(r.ts && r.session_id);
});
