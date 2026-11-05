// v1.5 (tarefa 51 / B10): hook grava `tokens` no SubagentStop (R36), limites e privacidade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('../.claude/hooks/log-agent-event.js', import.meta.url).pathname;
const U = (i, cc, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: o });
const asst = (id, usage, model = 'claude-opus-5-5', text = 'x') =>
  JSON.stringify({ type: 'assistant', message: { id, model, usage, content: [{ type: 'text', text }] } });

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'v15h-'));
  const proj = mkdtempSync(join(tmpdir(), 'v15p-'));
  const sdir = join(home, '.claude', 'projects', 'p', 'sess', 'subagents');
  mkdirSync(sdir, { recursive: true });
  return { home, proj, sdir, transcript: join(home, '.claude', 'projects', 'p', 'sess.jsonl') };
}
function run(payload, { home, proj }, env = {}) {
  const t = Date.now();
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', MONITOR_HOOK_DEBUG: '', CLAUDE_PROJECT_DIR: proj, ...env },
    encoding: 'utf8',
  });
  return { ...r, ms: Date.now() - t };
}
const last = (proj) => {
  const l = readFileSync(join(proj, '.monitor', 'events.jsonl'), 'utf8').trim().split('\n');
  return { raw: l.at(-1), obj: JSON.parse(l.at(-1)) };
};
const stop = (extra) => ({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1', agent_type: 'qa', ...extra });

test('usa agent_transcript_path e grava só números e modelos (nenhum texto da transcrição)', () => {
  const c = setup();
  const f = join(c.sdir, 'agent-a1.jsonl');
  writeFileSync(f, [
    asst('m1', U(1, 10, 100, 5), 'claude-opus-5-5', 'SEGREDO-TEXTO-123'),
    asst('m1', U(1, 10, 100, 50), 'claude-opus-5-5', 'SEGREDO-TEXTO-123'),
    asst('m2', U(2, 0, 0, 7), 'claude-sonnet-5-5'),
    JSON.stringify({ type: 'user', message: { content: 'SEGREDO-USER-456' } }),
  ].join('\n') + '\n');
  const r = run(stop({ agent_transcript_path: f }), c);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  const { raw, obj } = last(c.proj);
  assert.deepEqual(obj.tokens, { input: 3, cache_creation: 10, cache_read: 100, output: 57, messages: 2, models: ['claude-opus-5-5', 'claude-sonnet-5-5'] });
  assert.ok(!raw.includes('SEGREDO'));
});

test('sem agent_transcript_path: usa o caminho derivado de transcript_path', () => {
  const c = setup();
  writeFileSync(join(c.sdir, 'agent-a1.jsonl'), asst('m1', U(1, 2, 3, 4)) + '\n');
  const r = run(stop({ transcript_path: c.transcript }), c);
  assert.equal(r.status, 0);
  assert.equal(last(c.proj).obj.tokens.output, 4);
});

test('transcrição ausente, ilegível ou vazia: sem campo, código 0 e {}', () => {
  const c = setup();
  let r = run(stop({ agent_transcript_path: join(c.sdir, 'agent-a1.jsonl') }), c);
  assert.equal(r.status, 0); assert.equal(r.stdout.trim(), '{}');
  assert.equal('tokens' in last(c.proj).obj, false);
  const f = join(c.sdir, 'agent-a1.jsonl');
  writeFileSync(f, asst('m1', U(1, 2, 3, 4)) + '\n');
  chmodSync(f, 0o000);
  r = run(stop({ agent_transcript_path: f }), c);
  chmodSync(f, 0o644);
  assert.equal(r.status, 0);
  if (process.getuid && process.getuid() !== 0) assert.equal('tokens' in last(c.proj).obj, false);
  writeFileSync(f, JSON.stringify({ type: 'user', message: {} }) + '\n');
  run(stop({ agent_transcript_path: f }), c);
  assert.equal('tokens' in last(c.proj).obj, false);
});

test('caminho fora de ~/.claude/projects, ou de outro agente: não lê', () => {
  const c = setup();
  const outside = join(mkdtempSync(join(tmpdir(), 'v15o-')), 'subagents');
  mkdirSync(outside);
  writeFileSync(join(outside, 'agent-a1.jsonl'), asst('m1', U(1, 2, 3, 4)) + '\n');
  writeFileSync(join(c.sdir, 'agent-outro.jsonl'), asst('m1', U(1, 2, 3, 4)) + '\n');
  for (const p of ['/etc/passwd', join(outside, 'agent-a1.jsonl'), join(c.sdir, 'agent-outro.jsonl')]) {
    const r = run(stop({ agent_transcript_path: p }), c);
    assert.equal(r.status, 0); assert.equal(r.stdout.trim(), '{}');
    assert.equal('tokens' in last(c.proj).obj, false, p);
  }
});

test('só o SubagentStop lê a transcrição', () => {
  const c = setup();
  const f = join(c.sdir, 'agent-a1.jsonl');
  writeFileSync(f, asst('m1', U(1, 2, 3, 4)) + '\n');
  run({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a1', agent_transcript_path: f }, c);
  assert.equal('tokens' in last(c.proj).obj, false);
});

test('20 MB sintéticos (90% linhas user grandes): campo presente e processo < 3 s', () => {
  const c = setup();
  const f = join(c.sdir, 'agent-a1.jsonl');
  const big = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(100000) } }) + '\n';
  const parts = [];
  let size = 0;
  let i = 0;
  while (size < 20 * 1024 * 1024) {
    const l = i++ % 10 === 9 ? asst('m' + i, U(1, 2, 3, 4)) + '\n' : big;
    parts.push(l);
    size += l.length;
  }
  writeFileSync(f, parts.join(''));
  const r = run(stop({ agent_transcript_path: f }), c);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  assert.ok(last(c.proj).obj.tokens.messages > 0);
  assert.ok(r.ms < 3000, `levou ${r.ms} ms`);
});

test('contrato com payload inválido: código 0, {} e sem tokens', () => {
  const c = setup();
  const r = run({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 5, agent_transcript_path: 7 }, c);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  assert.equal('tokens' in last(c.proj).obj, false);
  assert.ok(existsSync(join(c.proj, '.monitor', 'events.jsonl')));
});
