// v1.5 (tarefa 55, QA): bordas independentes de R35 a R37 e privacidade. Só diretórios temporários.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server.js';
import { createTokenAcc, feedTokenLine, tokenResult, normalizeTokens, transcriptPathFor } from '../src/tokens.js';
import { createTranscriptReader } from '../src/transcripts.js';

const HOOK = new URL('../.claude/hooks/log-agent-event.js', import.meta.url).pathname;
const FIXTURE = new URL('../fixtures/tokens.jsonl', import.meta.url).pathname;
const mk = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v15qa-')));
const A = (id, usage, extra = {}) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage, ...extra } });
const sum = (lines) => { const a = createTokenAcc(); for (const l of lines) feedTokenLine(a, l); return tokenResult(a); };

test('R35: so linhas user -> null', () => {
  assert.equal(sum([JSON.stringify({ type: 'user', message: { content: 'oi', usage: { input_tokens: 9 } } })]), null);
});
test('R35: usage sem cache_creation_input_tokens conta 0 e nao quebra', () => {
  const r = sum([A('m', { input_tokens: 3, output_tokens: 4 })]);
  assert.deepEqual([r.input, r.cache_creation, r.cache_read, r.output], [3, 0, 0, 4]);
});
test('R35: message.id repetido, vale a ultima linha (output cresce)', () => {
  const r = sum([A('m', { input_tokens: 1, output_tokens: 6 }), A('m', { input_tokens: 1, output_tokens: 235 }), A('n', { input_tokens: 2, output_tokens: 1 })]);
  assert.equal(r.output, 236); assert.equal(r.messages, 2);
});
test('R35: iterations[] e campos aninhados sao ignorados', () => {
  const u = { input_tokens: 5, output_tokens: 7, iterations: [{ input_tokens: 5, output_tokens: 7 }], cache_creation: { ephemeral_5m_input_tokens: 99 } };
  const r = sum([A('m', u)]);
  assert.deepEqual([r.input, r.output, r.cache_creation], [5, 7, 0]);
});
test('R35: valores negativos, fracionados, string e NaN contam 0; __proto__ como id', () => {
  const r = sum([A('__proto__', { input_tokens: -5, output_tokens: 1.5, cache_read_input_tokens: '9' })]);
  assert.equal(r.input + r.output + r.cache_read, 0); assert.equal(r.messages, 1);
});
test('modelos: nome malicioso e descartado; normalizeTokens do disco tambem', () => {
  const r = sum([A('m', { input_tokens: 1 }, { model: '<img src=x onerror=1>' }), A('n', { input_tokens: 1 }, { model: 'claude-x' })]);
  assert.deepEqual(r.models, ['claude-x']);
  const n = normalizeTokens({ input: 1, cache_creation: 0, cache_read: 0, output: 0, messages: 1, models: ['<b>x</b>', 'ok-1', 'ok-1'] });
  assert.deepEqual(n.models, ['ok-1']);
  assert.equal(normalizeTokens({ input: 1, cache_creation: 0, cache_read: 0, output: 0, messages: 1 }), null);
});
test('caminho derivado: subagente dentro de subagente usa a pasta irma', () => {
  assert.equal(transcriptPathFor({ transcript_path: '/h/p/s/subagents/agent-pai.jsonl', agent_id: 'fil' }), '/h/p/s/subagents/agent-fil.jsonl');
  assert.equal(transcriptPathFor({ transcript_path: '/h/p/s.jsonl', agent_id: '../x' }), null);
});

function hookRun(home, proj, payload) {
  return spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CLAUDE_PROJECT_DIR: proj } });
}
const lastEv = (proj) => JSON.parse(fs.readFileSync(path.join(proj, '.monitor', 'events.jsonl'), 'utf8').trim().split('\n').at(-1));

test('hook: ultima linha sem \\n conta; 2 subagentes em paralelo somam cada um a propria transcricao', () => {
  const home = mk(), proj = mk();
  const sd = path.join(home, '.claude', 'projects', 'p', 's', 'subagents');
  fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, 'agent-a1.jsonl'), A('m1', { input_tokens: 1, output_tokens: 10 }) + '\n' + A('m2', { input_tokens: 2, output_tokens: 20 }));
  fs.writeFileSync(path.join(sd, 'agent-a2.jsonl'), A('m1', { input_tokens: 100, output_tokens: 1000 }) + '\n');
  const tp = path.join(home, '.claude', 'projects', 'p', 's.jsonl');
  for (const id of ['a1', 'a2']) {
    const r = hookRun(home, proj, { hook_event_name: 'SubagentStop', session_id: 's', agent_id: id, agent_type: 'qa', transcript_path: tp });
    assert.equal(r.status, 0); assert.equal(r.stdout.trim(), '{}');
  }
  const lines = fs.readFileSync(path.join(proj, '.monitor', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual([lines[0].tokens.input, lines[0].tokens.output, lines[0].tokens.messages], [3, 30, 2]);
  assert.deepEqual([lines[1].tokens.input, lines[1].tokens.output], [100, 1000]);
});
test('hook: agent_transcript_path fora de ~/.claude/projects e symlink que escapa -> sem tokens, saida 0', () => {
  const home = mk(), proj = mk(), out = mk();
  const sd = path.join(home, '.claude', 'projects', 'p', 's', 'subagents');
  fs.mkdirSync(sd, { recursive: true });
  const outside = path.join(out, 'subagents'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'agent-a1.jsonl'), A('m', { input_tokens: 7 }) + '\n');
  let r = hookRun(home, proj, { hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1', agent_transcript_path: path.join(outside, 'agent-a1.jsonl') });
  assert.equal(r.status, 0); assert.equal('tokens' in lastEv(proj), false);
  fs.symlinkSync(path.join(outside, 'agent-a1.jsonl'), path.join(sd, 'agent-a1.jsonl'));
  r = hookRun(home, proj, { hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1', agent_transcript_path: path.join(sd, 'agent-a1.jsonl') });
  assert.equal(r.status, 0); assert.equal('tokens' in lastEv(proj), false);
});
test('hook: agent_id com ../ nao le arquivo', () => {
  const home = mk(), proj = mk();
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'p', 's', 'subagents'), { recursive: true });
  const r = hookRun(home, proj, { hook_event_name: 'SubagentStop', session_id: 's', agent_id: '../x', transcript_path: path.join(home, '.claude/projects/p/s.jsonl') });
  assert.equal(r.status, 0); assert.equal('tokens' in lastEv(proj), false);
});

test('leitor do servidor: linha parcial entre leituras nao conta duas vezes; UTF-8 partido entre blocos', () => {
  const home = mk();
  const sd = path.join(home, '.claude', 'projects', 'p', 's', 'subagents'); fs.mkdirSync(sd, { recursive: true });
  const f = path.join(sd, 'agent-z.jsonl');
  const reader = createTranscriptReader({ projectsRoot: path.join(home, '.claude', 'projects'), chunkBytes: 7 });
  const l1 = A('m1', { input_tokens: 1, output_tokens: 1 }, { content: [{ type: 'text', text: 'ação ✓ 日本語' }] });
  const l2 = A('m2', { input_tokens: 2, output_tokens: 2 });
  fs.writeFileSync(f, l1 + '\n' + l2.slice(0, 20));
  let r; for (let i = 0; i < 400; i++) r = reader.read(f, 'z');
  assert.equal(r.messages, 1);
  fs.appendFileSync(f, l2.slice(20));
  for (let i = 0; i < 400; i++) r = reader.read(f, 'z');
  assert.equal(r.messages, 2); assert.equal(r.input, 3);
  fs.appendFileSync(f, '\n');
  for (let i = 0; i < 400; i++) r = reader.read(f, 'z');
  assert.equal(r.messages, 2); assert.equal(r.input, 3);
});

async function flowOf(opts, events) {
  const app = createApp({ pollMs: 100, ...opts });
  const port = await app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/flow`);
    const txt = await r.text();
    const ss = await (await fetch(`http://127.0.0.1:${port}/api/sessions`)).text();
    return { txt, ss, opens: app._opens() };
  } finally { await app.close(); }
}
test('servidor: caminho de evento fora da raiz nao e lido; sem caminho no JSON; transcricao valida e lida', async () => {
  const home = mk(), out = mk();
  const sd = path.join(home, '.claude', 'projects', 'p', 's', 'subagents'); fs.mkdirSync(sd, { recursive: true });
  const od = path.join(out, 'subagents'); fs.mkdirSync(od);
  fs.writeFileSync(path.join(od, 'agent-bad.jsonl'), A('m', { input_tokens: 777 }) + '\n');
  fs.writeFileSync(path.join(sd, 'agent-ok.jsonl'), A('m', { input_tokens: 5, output_tokens: 5 }) + '\n');
  const ts = new Date().toISOString();
  const ev = (o) => JSON.stringify({ ts, session_id: 's', ...o }) + '\n';
  const ef = path.join(mk(), 'events.jsonl');
  fs.writeFileSync(ef, ev({ event: 'UserPromptSubmit' }) +
    ev({ event: 'SubagentStart', agent_id: 'bad', agent_type: 'qa', tool_use_id: 't1' }) +
    ev({ event: 'SubagentStop', agent_id: 'bad', agent_type: 'qa', agent_transcript_path: path.join(od, 'agent-bad.jsonl') }) +
    ev({ event: 'SubagentStart', agent_id: 'ok', agent_type: 'qa', tool_use_id: 't2', transcript_path: path.join(home, '.claude/projects/p/s.jsonl') }));
  const { txt, ss } = await flowOf({ file: ef, homeDir: home });
  const j = JSON.parse(txt);
  const bad = j.executions.find((e) => e.id === 'bad'), ok = j.executions.find((e) => e.id === 'ok');
  assert.equal(bad.tokens, null);
  assert.equal(ok.tokens.count, 10); assert.equal(ok.tokens.source, 'transcript');
  assert.equal(j.session.tokens.without_data, 1);
  for (const body of [txt, ss]) assert.ok(!/agent-(bad|ok)\.jsonl|\.claude\/projects|transcript_path/.test(body), 'caminho vazou');
});
test('servidor --fixture: nenhum arquivo de transcricao aberto, homeDir ignorado', async () => {
  const r = await flowOf({ fixture: FIXTURE, homeDir: os.homedir() });
  assert.equal(r.opens, 0);
  assert.ok(!/transcript/.test(r.txt));
});
