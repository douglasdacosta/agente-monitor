// v1.5 (tarefa 51 / B10): soma R35, normalização e validação de caminho.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTokenAcc, feedTokenLine, tokenResult, normalizeTokens, transcriptPathFor,
  isAgentTranscriptPath, sessionTokens,
} from '../src/tokens.js';
import hook from '../.claude/hooks/log-agent-event.js';

const asst = (id, usage, model = 'claude-opus-5-5', extra = {}) =>
  JSON.stringify({ type: 'assistant', message: { id, model, usage, ...extra } });
const sum = (lines) => {
  const acc = createTokenAcc();
  for (const l of lines) feedTokenLine(acc, l);
  return tokenResult(acc);
};
const U = (i, cc, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: o });

test('3 linhas com o mesmo id contam uma vez; a última vence', () => {
  const r = sum([asst('m1', U(1, 2, 3, 6)), asst('m1', U(1, 2, 3, 100)), asst('m1', U(1, 2, 3, 235))]);
  assert.deepEqual(r, { input: 1, cache_creation: 2, cache_read: 3, output: 235, messages: 1, models: ['claude-opus-5-5'] });
});

test('iterations[] e outros campos aninhados não entram na soma', () => {
  const u = { ...U(5, 10, 20, 7), iterations: [U(5, 10, 20, 7)], cache_creation: { ephemeral_5m_input_tokens: 10 } };
  const r = sum([asst('m1', u)]);
  assert.equal(r.input + r.cache_creation + r.cache_read + r.output, 42);
});

test('ignora user, sem usage, JSON quebrado; campo inválido conta 0; linha sem id soma sozinha', () => {
  const r = sum([
    JSON.stringify({ type: 'user', message: { usage: U(9, 9, 9, 9) } }),
    JSON.stringify({ type: 'assistant', message: { id: 'x' } }),
    '{quebrado',
    '',
    asst('m1', { input_tokens: 4, output_tokens: -3, cache_read_input_tokens: 1.5, cache_creation_input_tokens: '7' }),
    JSON.stringify({ type: 'assistant', message: { usage: U(1, 0, 0, 1) } }),
    JSON.stringify({ type: 'assistant', message: { usage: U(1, 0, 0, 1) } }),
  ]);
  assert.equal(r.messages, 3);
  assert.equal(r.input, 6);
  assert.equal(r.output, 2);
  assert.equal(r.cache_creation + r.cache_read, 0);
});

test('só linhas user -> null', () => {
  assert.equal(sum([JSON.stringify({ type: 'user', message: { content: 'oi' } })]), null);
});

test('models: ordem da 1ª aparição, sem repetição, sem <synthetic>, sem espaço/controle', () => {
  const r = sum([
    asst('a', U(1, 0, 0, 1), 'claude-opus-5-5'),
    asst('b', U(1, 0, 0, 1), '<synthetic>'),
    asst('c', U(1, 0, 0, 1), 'claude-sonnet-5-5'),
    asst('d', U(1, 0, 0, 1), 'com espaco'),
    asst('e', U(1, 0, 0, 1), 'x\u0007y'),
    asst('f', U(1, 0, 0, 1), 'claude-opus-5-5'),
    asst('g', U(1, 0, 0, 1), 42),
  ]);
  assert.deepEqual(r.models, ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.equal(r.messages, 7);
});

test('normalizeTokens aceita o formato válido e rejeita lixo', () => {
  const ok = { input: 1, cache_creation: 2, cache_read: 3, output: 4, messages: 5, models: ['claude-opus-5-5', 'a b', '<synthetic>'] };
  assert.deepEqual(normalizeTokens(ok), { input: 1, cache_creation: 2, cache_read: 3, output: 4, messages: 5, models: ['claude-opus-5-5'] });
  for (const bad of [null, undefined, 'x', [], { ...ok, input: -1 }, { ...ok, output: 1.5 }, { ...ok, output: '4' },
    { ...ok, output: NaN }, { ...ok, messages: undefined }, { ...ok, models: 'claude' }, { ...ok, models: undefined }]) {
    assert.equal(normalizeTokens(bad), null);
  }
});

test('transcriptPathFor: 3 casos do contrato', () => {
  assert.equal(transcriptPathFor({ agent_transcript_path: '/a/b.jsonl', transcript_path: '/x.jsonl', agent_id: 'z' }), '/a/b.jsonl');
  assert.equal(transcriptPathFor({ transcript_path: '/p/proj/sess.jsonl', agent_id: 'ag1' }), '/p/proj/sess/subagents/agent-ag1.jsonl');
  assert.equal(transcriptPathFor({ transcript_path: '/p/proj/sess/subagents/agent-pai.jsonl', agent_id: 'ag1' }), '/p/proj/sess/subagents/agent-ag1.jsonl');
  assert.equal(transcriptPathFor({ transcript_path: '/p/proj/sess.txt', agent_id: 'ag1' }), null);
  assert.equal(transcriptPathFor({ transcript_path: '/p/s.jsonl', agent_id: '../x' }), null);
  assert.equal(transcriptPathFor({}), null);
});

test('isAgentTranscriptPath: raiz, basename, pasta-mãe, .., symlink', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'v15t-'));
  const root = join(tmp, 'projects');
  const sub = join(root, 'p', 's', 'subagents');
  mkdirSync(sub, { recursive: true });
  const f = join(sub, 'agent-a1.jsonl');
  writeFileSync(f, '');
  assert.equal(isAgentTranscriptPath(f, 'a1', root), true);
  assert.equal(isAgentTranscriptPath(f, 'a2', root), false);                       // basename de outro id
  assert.equal(isAgentTranscriptPath(join(sub, '..', 'subagents', 'agent-a1.jsonl'), 'a1', root), true); // resolvido, ainda dentro
  assert.equal(isAgentTranscriptPath(join(root, 'p', 's', 'subagents', '..', '..', '..', '..', 'x', 'subagents', 'agent-a1.jsonl'), 'a1', root), false);
  const outro = join(root, 'p', 's', 'other');
  mkdirSync(outro);
  writeFileSync(join(outro, 'agent-a1.jsonl'), '');
  assert.equal(isAgentTranscriptPath(join(outro, 'agent-a1.jsonl'), 'a1', root), false); // pasta-mãe errada
  // symlink para fora da raiz
  const fora = join(tmp, 'fora', 'subagents');
  mkdirSync(fora, { recursive: true });
  writeFileSync(join(fora, 'agent-a3.jsonl'), '');
  symlinkSync(join(fora, 'agent-a3.jsonl'), join(sub, 'agent-a3.jsonl'));
  assert.equal(isAgentTranscriptPath(join(sub, 'agent-a3.jsonl'), 'a3', root), false);
  assert.equal(isAgentTranscriptPath(join(fora, 'agent-a3.jsonl'), 'a3', root), false);
  assert.equal(isAgentTranscriptPath('relativo/agent-a1.jsonl', 'a1', root), false);
  assert.equal(isAgentTranscriptPath(join(sub, 'agent-nao.jsonl'), 'nao', root), false);  // inexistente
  assert.equal(isAgentTranscriptPath(f, '../a1', root), false);
  assert.equal(isAgentTranscriptPath('/etc/passwd', 'passwd', root), false);
});

test('readTranscriptTokens: UTF-8 partido na fronteira de bloco, última linha sem \\n, limites', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'v15t-'));
  const f = join(tmp, 'agent-x.jsonl');
  // enche o 1º bloco de 1 MiB de modo que um caractere de 3 bytes cruze a fronteira
  const pad = (n) => JSON.stringify({ type: 'user', message: { content: 'é€'.repeat(n) } });
  let body = '';
  for (let k = 0; k < 4; k++) body += pad(100000 + k) + '\n'; // ~0,5 MB cada, cruza vários blocos
  body += asst('m1', U(1, 2, 3, 4)) + '\n' + asst('m2', U(1, 1, 1, 1));  // última sem \n
  writeFileSync(f, body);
  const r = hook.readTranscriptTokens(f);
  assert.deepEqual([r.input, r.cache_creation, r.cache_read, r.output, r.messages], [2, 3, 4, 5, 2]);
  assert.equal(hook.readTranscriptTokens(f, { maxBytes: 100 }), null);
  assert.equal(hook.readTranscriptTokens(f, { deadline: Date.now() - 1 }), null);
  assert.equal(hook.readTranscriptTokens(join(tmp, 'nao-existe.jsonl')), null);
  assert.equal(hook.readTranscriptTokens(tmp), null);
});

test('sessionTokens: soma, parcial, modelos por start_ts e null sem dados', () => {
  const k = (count, total, models) => ({ count, total, input: 1, cache_creation: 2, cache_read: 3, output: 4, models });
  const r = sessionTokens([
    { start_ts: '2026-11-05T10:02:00Z', tokens: k(10, 15, ['b']) },
    { start_ts: '2026-11-05T10:00:00Z', tokens: k(5, 8, ['a', 'b']) },
    { start_ts: '2026-11-05T10:03:00Z', tokens: null },
  ]);
  assert.equal(r.count, 15);
  assert.equal(r.total, 23);
  assert.deepEqual(r.models, ['a', 'b']);
  assert.deepEqual([r.executions, r.with_data, r.without_data], [3, 2, 1]);
  assert.equal(sessionTokens([{ tokens: null }]), null);
  assert.equal(sessionTokens([]), null);
});

test('o hook só faz require de fs, path, os, crypto; importar não executa o hook', () => {
  const src = readFileSync(new URL('../.claude/hooks/log-agent-event.js', import.meta.url), 'utf8');
  const mods = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(mods)].sort(), ['crypto', 'fs', 'os', 'path']);
});
