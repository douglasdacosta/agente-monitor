// QA v1.3: python do Orca nao e disparado a cada request; hook grava transcript_path/orca_session_id e sai {}/0;
// titulo com HTML so aparece escapado no JSON (o front usa esc()/textContent). Tudo em pasta temporaria.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const PY = spawnSync('sh', ['-c', 'command -v python3']).stdout.toString().trim();
const tmp = () => mkdtempSync(join(tmpdir(), 'qa13-'));

test('refresh repetido da API nao dispara python a cada request', { skip: !PY && 'sem python3' }, async () => {
  const home = tmp();
  const orca = join(home, '.config', 'orca');
  mkdirSync(orca, { recursive: true });
  spawnSync(PY, ['-I', '-c', `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.execute('create table agent_session_records(session_id text, record_json text)')
c.execute('insert into agent_session_records values(?,?)',('o1',json.dumps({'conversationName':'<img src=x onerror=alert(1)> Nome','providerHandleChain':[{'handle':{'provider':'claude','sessionId':'S1'}}]})))
c.commit()`, join(orca, 'agent-session-journal.db')]);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const log = join(home, 'calls.log');
  writeFileSync(join(bin, 'python3'), `#!/bin/sh\necho x >> "${log}"\nexec "${PY}" "$@"\n`);
  chmodSync(join(bin, 'python3'), 0o755);
  const proj = join(home, 'proj', '.monitor');
  mkdirSync(proj, { recursive: true });
  const file = join(proj, 'events.jsonl');
  const b = { ts: new Date().toISOString(), session_id: 'S1', agent_id: 'a', agent_type: 'qa' };
  writeFileSync(file, [{ ...b, event: 'SubagentStart' }, { ...b, event: 'SubagentStop' }].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  const app = createApp({ file, homeDir: home, pollMs: 100 });
  try {
    const port = await app.listen(0);
    let title;
    for (let i = 0; i < 30; i++) {
      title = (await (await fetch(`http://127.0.0.1:${port}/api/sessions`)).json()).sessions[0].title;
      await fetch(`http://127.0.0.1:${port}/api/flow`);
    }
    assert.equal(title, '<img src=x onerror=alert(1)> Nome'); // dado cru no JSON; o front escapa
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  } finally {
    process.env.PATH = old;
    await app.close();
    rmSync(home, { recursive: true });
  }
});

test('hook grava transcript_path e orca_session_id e responde {} com exit 0; sem eles, nao grava as chaves', () => {
  const dir = tmp();
  const hook = new URL('../.claude/hooks/log-agent-event.js', import.meta.url).pathname;
  const run = (payload, env) => spawnSync('node', [hook], {
    cwd: dir, input: payload, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, ...env },
  });
  const p = { hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', agent_type: 'qa', transcript_path: '/x/s.jsonl' };
  let r = run(JSON.stringify(p), { ORCA_AGENT_SESSION_ID: 'claude_1' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  r = run(JSON.stringify({ ...p, transcript_path: undefined }), {});
  assert.equal(r.status, 0);
  r = run('lixo {{{', {});
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  const f = join(dir, '.monitor', 'events.jsonl');
  assert.ok(existsSync(f));
  const ev = readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(ev[0].transcript_path, '/x/s.jsonl');
  assert.equal(ev[0].orca_session_id, 'claude_1');
  assert.ok(!('transcript_path' in ev[1]) && !('orca_session_id' in ev[1]));
  rmSync(dir, { recursive: true });
});
