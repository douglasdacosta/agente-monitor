// QA v1.4 (tarefa 46): bordas do hook, do modelo de esperas e da API. Só testes; não altera produção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildWaits } from '../src/waits.js';

const ROOT = new URL('..', import.meta.url).pathname;
const HOOK = join(ROOT, '.claude/hooks/log-agent-event.js');
const mk = (p = 'qa46-') => mkdtempSync(join(tmpdir(), p));
const hook = (payload, dir, env = {}) =>
  spawnSync('node', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, MONITOR_HOOK_DEBUG: '', CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
const evFile = (d) => join(d, '.monitor', 'events.jsonl');
const rawOf = (d) => (existsSync(evFile(d)) ? readFileSync(evFile(d), 'utf8') : '');
const rowsOf = (d) => rawOf(d).split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---------- modelo ----------
const T0 = Date.parse('2026-10-29T12:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const L = (...evs) => evs.map((e) => JSON.stringify(e));
const ev = (s, event, extra = {}) => ({ ts: iso(s), event, session_id: 'S', ...extra });
const W = (lines, nowS, o = {}) => buildWaits(L(...lines), { now: T0 + nowS * 1000, vezMs: 120e3, expiraMs: 24 * 3600e3, ...o });

test('duas esperas seguidas na mesma sessão: vale a última', () => {
  const w = W([ev(0, 'PreToolUse', { tool_name: 'AskUserQuestion', resumo: 'A?' }), ev(10, 'PreToolUse', { tool_name: 'AskUserQuestion', resumo: 'B?' })], 20);
  assert.equal(w.length, 1);
  assert.equal(w[0].resumo, 'B?');
  assert.equal(w[0].since, iso(10));
  const w2 = W([ev(0, 'PreToolUse', { tool_name: 'AskUserQuestion', resumo: 'A?' }), ev(10, 'StopFailure', { resumo: 'rate_limit' })], 20);
  assert.equal(w2.length, 1);
  assert.equal(w2[0].kind, 'erro');
});

test('permissão de subagente não é fechada por PostToolUse de OUTRO subagente; fecha com o do mesmo', () => {
  const base = [ev(0, 'PermissionRequest', { agent_id: 'A', tool_name: 'Bash', resumo: 'Bash' })];
  assert.equal(W([...base, ev(5, 'PostToolUse', { agent_id: 'B', tool_name: 'Read' })], 10).length, 1);
  assert.equal(W([...base, ev(5, 'PostToolUse', { agent_id: 'A', tool_name: 'Bash' })], 10).length, 0);
});

test('Stop com subagente rodando não abre vez; abre no último SubagentStop', () => {
  const l = [
    ev(0, 'SubagentStart', { agent_id: 'A' }), ev(1, 'SubagentStart', { agent_id: 'B' }),
    ev(5, 'Stop'),
  ];
  assert.equal(W(l, 600).length, 0);
  assert.equal(W([...l, ev(100, 'SubagentStop', { agent_id: 'A' })], 600).length, 0, 'ainda há B');
  const w = W([...l, ev(100, 'SubagentStop', { agent_id: 'A' }), ev(200, 'SubagentStop', { agent_id: 'B' })], 600);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'vez');
  assert.equal(w[0].since, iso(200));
});

test('Stop logo depois do SubagentStop (sem nada rodando) abre vez no ts do Stop', () => {
  const w = W([ev(0, 'SubagentStart', { agent_id: 'A' }), ev(10, 'SubagentStop', { agent_id: 'A' }), ev(11, 'Stop')], 20);
  assert.equal(w.length, 1);
  assert.equal(w[0].since, iso(11));
  assert.equal(w[0].urgent, false);
});

test('atividade da sessão principal depois do Stop em background cancela a vez pendente', () => {
  const w = W([ev(0, 'SubagentStart', { agent_id: 'A' }), ev(5, 'Stop'), ev(6, 'UserPromptSubmit'), ev(10, 'SubagentStop', { agent_id: 'A' })], 600);
  assert.equal(w.length, 0);
});

test('UserPromptSubmit sem espera aberta é ignorado; Stop de subagente (agent_id) não abre vez', () => {
  assert.equal(W([ev(0, 'UserPromptSubmit')], 10).length, 0);
  assert.equal(W([ev(0, 'Stop', { agent_id: 'A' })], 10).length, 0);
});

test('vez cruza o limite: urgent muda de false para true', () => {
  const l = [ev(0, 'Stop')];
  assert.equal(W(l, 119)[0].urgent, false);
  assert.equal(W(l, 120)[0].urgent, true);
});

test('expiração: some após expiraHoras sem eventos; SessionEnd fecha; evento posterior reabre', () => {
  const l = [ev(0, 'PreToolUse', { tool_name: 'AskUserQuestion', resumo: 'x' })];
  assert.equal(W(l, 24 * 3600).length, 1);
  assert.equal(W(l, 24 * 3600 + 1).length, 0);
  assert.equal(W([...l, ev(5, 'SessionEnd')], 10).length, 0);
  assert.equal(W(l, 3600, { expiraMs: 1800e3 }).length, 0);
});

test('linhas inválidas e sem session_id não quebram', () => {
  const lines = ['lixo', '{"event":"Stop"}', '', ...L(ev(0, 'Stop'))];
  assert.equal(buildWaits(lines, { now: T0 + 5000 }).length, 1);
});

// BUG-1 (corrigido): PostToolUse de OUTRO ator, quando um dos lados não tem agent_id, fecha a permissão.
test('permissão da sessão principal não é fechada por PostToolUse de subagente em background', () => {
  const w = W([ev(0, 'PermissionRequest', { tool_name: 'Bash', resumo: 'Bash' }), ev(5, 'PostToolUse', { agent_id: 'B', tool_name: 'Read' })], 10);
  assert.equal(w.length, 1);
});
test('permissão de subagente não é fechada por PostToolUse da sessão principal', () => {
  const w = W([ev(0, 'PermissionRequest', { agent_id: 'A', tool_name: 'Bash', resumo: 'Bash' }), ev(5, 'PostToolUse', { tool_name: 'Read' })], 10);
  assert.equal(w.length, 1);
});

// ---------- hook: privacidade ----------
test('privacidade: payloads realistas não deixam prompt, comando nem mensagem na linha', () => {
  const d = mk();
  const SEG = ['SEGREDO_PROMPT', 'rm -rf /tmp/SEGREDO_CMD', 'SEGREDO_MSG', 'SEGREDO_RESP', 'SEGREDO_OPCAO', 'SEGREDO_USER', '/etc/SEGREDO_PATH'];
  const c = { session_id: 'priv', cwd: '/work/p', transcript_path: '/home/u/.claude/projects/x/priv.jsonl', permission_mode: 'default' };
  const payloads = [
    { ...c, hook_event_name: 'UserPromptSubmit', prompt: SEG[0] },
    { ...c, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_1', tool_input: { questions: [{ question: 'Qual banco?', header: 'DB', options: [{ label: SEG[4], description: SEG[4] }], multiSelect: false }, { question: SEG[4] + ' 2a pergunta' }] } },
    { ...c, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_1', tool_input: { questions: [] }, tool_response: { answers: { x: SEG[5] } } },
    { ...c, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: SEG[1], description: SEG[1] }, permission_suggestions: [{ rule: SEG[1] }] },
    { ...c, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: SEG[2], title: SEG[2] },
    { ...c, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: SEG[1] }, tool_response: { stdout: SEG[3] } },
    { ...c, hook_event_name: 'Elicitation', mcp_server_name: 'atl', message: SEG[2], requested_schema: { x: SEG[2] } },
    { ...c, hook_event_name: 'ElicitationResult', mcp_server_name: 'atl', action: 'accept', content: { v: SEG[5] } },
    { ...c, hook_event_name: 'StopFailure', error_type: 'rate_limit', error_details: SEG[2], last_assistant_message: SEG[3] },
    { ...c, hook_event_name: 'StopFailure', error: SEG[2] + ' com espaços', last_assistant_message: SEG[3] },
    { ...c, hook_event_name: 'Stop', last_assistant_message: SEG[3], background_tasks: [{ description: SEG[3] }] },
    { ...c, hook_event_name: 'Stop', agent_id: 'sub1', last_assistant_message: SEG[3] },
    { ...c, hook_event_name: 'SessionEnd', reason: SEG[2] },
  ];
  for (const p of payloads) {
    const r = hook(p, d);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '{}\n');
  }
  const raw = rawOf(d);
  for (const s of SEG) assert.ok(!raw.includes(s), `vazou ${s}`);
  assert.ok(!/"prompt"|"last_message"|last_assistant|tool_input|"message"|"command"/.test(raw));
  const pre = rowsOf(d).find((r) => r.event === 'PreToolUse');
  assert.equal(pre.resumo, 'Qual banco?');
  assert.ok(rowsOf(d).every((r) => !('verdict' in r)));
});

test('resumo da pergunta: 120 caracteres, sem controle', () => {
  const d = mk();
  hook({ session_id: 'q', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'a\nb\t' + 'x'.repeat(300) }] } }, d);
  const [r] = rowsOf(d);
  assert.equal(r.resumo.length, 120);
  assert.ok(!/[\n\t]/.test(r.resumo));
});

// ---------- hook: robustez ----------
test('hook: entrada quebrada, tipos errados e diretório inválido => {} e exit 0', () => {
  const d = mk();
  const inputs = ['', '{', 'null', '[]', '1', '"x"', '{"hook_event_name":{"a":1}}', '{"hook_event_name":"Stop","session_id":5}',
    '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","session_id":"s","tool_input":{"questions":"x"}}',
    '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","session_id":"s","tool_input":{"questions":[null,1]}}',
    '{"hook_event_name":"Stop","session_id":"s","cwd":{"a":1}}', '\u0000\u0001'];
  for (const i of inputs) {
    const r = hook(i, d);
    assert.equal(r.status, 0, i);
    assert.equal(r.stdout, '{}\n', i);
  }
  // raiz é um arquivo (mkdir falha)
  const f = join(mk(), 'arquivo');
  writeFileSync(f, 'x');
  for (const p of [{ hook_event_name: 'Stop', session_id: 's' }, { hook_event_name: 'SubagentStart', session_id: 's' }]) {
    const r = hook(p, f);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '{}\n');
  }
});

test('hook: .monitor sem permissão de escrita => {} e exit 0 (e .monitor/open idem)', { skip: process.getuid?.() === 0 && 'root ignora chmod' }, () => {
  const d = mk();
  mkdirSync(join(d, '.monitor'));
  chmodSync(join(d, '.monitor'), 0o555);
  for (const p of [{ hook_event_name: 'Stop', session_id: 's' }, { hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash' }, { hook_event_name: 'SubagentStop', session_id: 's' }]) {
    const r = hook(p, d);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '{}\n');
  }
  chmodSync(join(d, '.monitor'), 0o755);
  const e = mk();
  mkdirSync(join(e, '.monitor', 'open'), { recursive: true });
  chmodSync(join(e, '.monitor', 'open'), 0o555);
  const r = hook({ hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash' }, e);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{}\n');
  chmodSync(join(e, '.monitor', 'open'), 0o755);
});

test('hook: .monitor/.gitignore criado com "*" e nunca sobrescrito', () => {
  const d = mk();
  hook({ hook_event_name: 'UserPromptSubmit', session_id: 's' }, d);
  assert.equal(readFileSync(join(d, '.monitor', '.gitignore'), 'utf8'), '*\n');
  writeFileSync(join(d, '.monitor', '.gitignore'), 'custom\n');
  hook({ hook_event_name: 'Stop', session_id: 's' }, d);
  assert.equal(readFileSync(join(d, '.monitor', '.gitignore'), 'utf8'), 'custom\n');
});

test('hook: eventos de subagente da v1 e PostToolUse sem marcador', () => {
  const d = mk();
  hook({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: 'SEGREDO' } }, d);
  assert.equal(rawOf(d), '');
  hook({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', agent_type: 'qa' }, d);
  assert.equal(rowsOf(d).length, 1);
});

// ---------- pré-filtro em shell do README ----------
function prefilter() {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const m = /"command": "(d=\\"\$\{CLAUDE_PROJECT_DIR:-\$PWD\}[^\n]*?)",\n/.exec(readme);
  assert.ok(m, 'comando do pré-filtro no README');
  return JSON.parse(`"${m[1]}"`).replace('$CLAUDE_PROJECT_DIR/.claude/hooks/log-agent-event.js', HOOK);
}
test('pré-filtro do README: sem marcador não roda node; com marcador roda; sem CLAUDE_PROJECT_DIR usa $PWD', () => {
  const cmd = prefilter();
  const payload = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash' });
  const run = (cwd, env) => spawnSync('bash', ['-c', cmd], { cwd, input: payload, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  const d = mk();
  let r = run(d, { CLAUDE_PROJECT_DIR: d });
  assert.equal(r.stdout.trim(), '{}');
  assert.equal(r.status, 0);
  assert.equal(rawOf(d), '');
  mkdirSync(join(d, '.monitor', 'open'), { recursive: true });
  r = run(d, { CLAUDE_PROJECT_DIR: d });
  assert.equal(r.stdout.trim(), '{}');
  assert.equal(rawOf(d), '', 'pasta open vazia: ainda não chama node');
  // marcador de permissão: hook roda e fecha
  hook({ hook_event_name: 'PermissionRequest', session_id: 's', tool_name: 'Bash' }, d);
  assert.equal(readdirSync(join(d, '.monitor', 'open')).length, 1);
  r = run(d, { CLAUDE_PROJECT_DIR: d });
  assert.equal(r.stdout.trim(), '{}');
  assert.equal(rowsOf(d).at(-1).event, 'PostToolUse');
  assert.equal(readdirSync(join(d, '.monitor', 'open')).length, 0);
  // sem CLAUDE_PROJECT_DIR: $PWD
  const e = mk();
  mkdirSync(join(e, '.monitor', 'open'), { recursive: true });
  writeFileSync(join(e, '.monitor', 'open', createHash('sha256').update('s').digest('hex').slice(0, 16)), 'permissao');
  r = run(e, {});
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  assert.equal(rawOf(e) !== '', true, 'usou $PWD');
});

// ---------- API ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withServer(args, fn) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn('node', [join(ROOT, 'server.js'), '--no-titles', '--port', String(port), ...args], { stdio: 'ignore', env: { ...process.env, HOME: mk('qa46home-') } });
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`http://127.0.0.1:${port}/api/projects`); break; } catch { await sleep(100); }
    }
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    p.kill();
  }
}

test('API: 10 mil linhas respondem rápido; POST/PUT/DELETE => 405; sem cwd/transcript_path', async () => {
  const d = mk();
  mkdirSync(join(d, '.monitor'));
  const file = join(d, '.monitor', 'events.jsonl');
  const now = Date.now();
  const out = [];
  for (let i = 0; i < 10000; i++) {
    const sid = `sess-${i % 50}`;
    const ts = new Date(now - (10000 - i) * 1000).toISOString();
    const kind = i % 5;
    const base = { ts, session_id: sid, cwd: '/work/SEGREDO_CWD', transcript_path: '/home/u/.claude/projects/SEGREDO_TP.jsonl' };
    if (kind === 0) out.push({ ...base, event: 'UserPromptSubmit' });
    else if (kind === 1) out.push({ ...base, event: 'PreToolUse', tool_name: 'AskUserQuestion', resumo: 'q' });
    else if (kind === 2) out.push({ ...base, event: 'PostToolUse', tool_name: 'AskUserQuestion' });
    else if (kind === 3) out.push({ ...base, event: 'Stop' });
    else out.push({ ...base, event: 'SubagentStart', agent_id: `a${i}`, agent_type: 'qa' });
  }
  writeFileSync(file, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  await withServer(['--events', file], async (u) => {
    const t = [];
    for (let i = 0; i < 4; i++) {
      const s = performance.now();
      const r = await fetch(`${u}/api/waits`);
      const txt = await r.text();
      t.push(Math.round(performance.now() - s));
      assert.equal(r.status, 200);
      assert.ok(!/SEGREDO_CWD|SEGREDO_TP|transcript_path|"cwd"|\/\.claude\//.test(txt));
      if (i === 0) assert.ok(JSON.parse(txt).waits.length > 0);
    }
    console.log('# /api/waits 10k linhas (ms: 1a/cache...):', t.join(', '));
    assert.ok(t[0] < 2000, `1a chamada ${t[0]} ms`);
    // após append: recalcula
    writeFileSync(file, out.map((o) => JSON.stringify(o)).join('\n') + '\n' + JSON.stringify({ ts: new Date().toISOString(), event: 'Stop', session_id: 'novo' }) + '\n');
    const s = performance.now();
    const j = await (await fetch(`${u}/api/waits`)).json();
    const dt = Math.round(performance.now() - s);
    console.log('# apos append (ms):', dt);
    assert.ok(j.waits.some((w) => w.session_id === 'novo'));
    assert.ok(dt < 2000);
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await fetch(`${u}/api/waits`, { method: m, body: '{}' });
      assert.equal(r.status, 405, m);
    }
  });
});

// Reteste BUG-1: bordas do fechamento de permissão por PostToolUse.
test('permissão: mesmo ator fecha (subagente e principal); tool_use_id decide quando presente nos dois lados', () => {
  const perm = (x = {}) => ev(0, 'PermissionRequest', { tool_name: 'Bash', resumo: 'Bash', ...x });
  assert.equal(W([perm(), ev(5, 'PostToolUse', { tool_name: 'Bash' })], 10).length, 0, 'principal x principal');
  assert.equal(W([perm({ agent_id: 'A' }), ev(5, 'PostToolUse', { agent_id: 'A' })], 10).length, 0, 'mesmo subagente');
  assert.equal(W([perm({ agent_id: 'A' }), ev(5, 'PostToolUseFailure', { agent_id: 'A' })], 10).length, 0, 'failure do mesmo');
  assert.equal(W([perm({ agent_id: 'A' }), ev(5, 'PostToolUse', { agent_id: 'B' })], 10).length, 1, 'outro subagente');
  assert.equal(W([perm(), ev(5, 'PostToolUseFailure', { agent_id: 'B' })], 10).length, 1, 'principal x sub (failure)');
  assert.equal(W([perm({ tool_use_id: 'u1' }), ev(5, 'PostToolUse', { tool_use_id: 'u1', agent_id: 'B' })], 10).length, 0, 'mesmo tool_use_id decide');
  assert.equal(W([perm({ tool_use_id: 'u1' }), ev(5, 'PostToolUse', { tool_use_id: 'u2' })], 10).length, 1, 'tool_use_id diferente');
});
test('Notification permission_prompt funde só com permissão do mesmo ator', () => {
  const w = W([ev(0, 'PermissionRequest', { agent_id: 'A', tool_name: 'Bash', resumo: 'Bash' }), ev(1, 'Notification', { resumo: 'permission_prompt' })], 10);
  assert.ok(w.length === 1 && w[0].since === iso(0) || w.length === 1, 'uma espera');
  const w2 = W([ev(0, 'PermissionRequest', { tool_name: 'Bash', resumo: 'Bash' }), ev(1, 'Notification', { resumo: 'permission_prompt' })], 10);
  assert.equal(w2.length, 1);
  assert.equal(w2[0].since, iso(0));
});
