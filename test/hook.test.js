import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('../.claude/hooks/log-agent-event.js', import.meta.url).pathname;

function run(payload, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-'));
  const r = spawnSync('node', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, MONITOR_HOOK_DEBUG: '', CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
  const file = join(dir, '.monitor', 'events.jsonl');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { r, lines, dir };
}

test('(a) grava tool_use_id quando presente; ausente não vira chave', () => {
  const { lines } = run({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', agent_type: 'qa', tool_use_id: 'toolu_1' });
  assert.equal(lines[0].tool_use_id, 'toolu_1');
  const o = run({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a' }).lines[0];
  assert.ok(!('tool_use_id' in o));
});

test('(b) grava agent_transcript_path no Stop', () => {
  const { lines } = run({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a', agent_transcript_path: '/tmp/t.jsonl' });
  assert.equal(lines[0].agent_transcript_path, '/tmp/t.jsonl');
});

test('(c) verdict sobre a mensagem completa, antes do corte de 500', () => {
  const msg = 'x'.repeat(800) + '\n## Resultado: **REPROVADO**\n';
  const { lines } = run({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a', last_assistant_message: msg });
  assert.equal(lines[0].verdict, 'REPROVADO');
  assert.equal(lines[0].last_message.length, 500);
  const ok = run({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a', last_assistant_message: 'Resultado: aprovado' });
  assert.equal(ok.lines[0].verdict, 'APROVADO');
  const none = run({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a', last_assistant_message: 'nada' });
  assert.ok(!('verdict' in none.lines[0]));
});

test('(d) MONITOR_HOOK_DEBUG=1 grava raw_keys; sem ele não grava', () => {
  const p = { hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', extra: 1 };
  assert.deepEqual(run(p, { MONITOR_HOOK_DEBUG: '1' }).lines[0].raw_keys, Object.keys(p));
  assert.ok(!('raw_keys' in run(p).lines[0]));
});

test('(e) sempre imprime {} e sai 0, mesmo com stdin inválido ou vazio', () => {
  for (const input of ['', 'não é json', 'null', '[]', '{"hook_event_name":1}']) {
    const { r } = run(input);
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout.trim(), '{}', input);
  }
});

test('(e) sai 0 e imprime {} se não consegue gravar', () => {
  const { r } = run({ hook_event_name: 'SubagentStart' }, { CLAUDE_PROJECT_DIR: new URL('../package.json', import.meta.url).pathname });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
});

test('PreToolUse usa tool_input.subagent_type/description/model', () => {
  const { lines } = run({ hook_event_name: 'PreToolUse', session_id: 's', tool_use_id: 't', tool_input: { subagent_type: 'designer', description: 'D', model: 'opus' } });
  assert.deepEqual([lines[0].agent_type, lines[0].description, lines[0].model], ['designer', 'D', 'opus']);
});

test('grava transcript_path e orca_session_id quando existem; ausentes não viram chave', () => {
  const a = run(
    { hook_event_name: 'SubagentStart', session_id: 's', transcript_path: '/tmp/s.jsonl' },
    { ORCA_AGENT_SESSION_ID: 'claude_abc_123' },
  ).lines[0];
  assert.equal(a.transcript_path, '/tmp/s.jsonl');
  assert.equal(a.orca_session_id, 'claude_abc_123');
  const b = run({ hook_event_name: 'SubagentStart', session_id: 's' }, { ORCA_AGENT_SESSION_ID: '' }).lines[0];
  assert.ok(!('transcript_path' in b));
  assert.ok(!('orca_session_id' in b));
});

test('transcript_path não string é ignorado sem quebrar', () => {
  const { r, lines } = run({ hook_event_name: 'SubagentStart', session_id: 's', transcript_path: 5 });
  assert.equal(r.status, 0);
  assert.ok(!('transcript_path' in lines[0]));
});
