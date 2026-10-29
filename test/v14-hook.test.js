// v1.4 (tarefa 40 / B5): hook, ramo "espera" (R26), marcador .monitor/open/ (39b), privacidade e robustez.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const HOOK = new URL('../.claude/hooks/log-agent-event.js', import.meta.url).pathname;
const markerOf = (sid) => createHash('sha256').update(sid).digest('hex').slice(0, 16);

const mk = () => mkdtempSync(join(tmpdir(), 'hook14-'));
function run(payload, dir, env = {}) {
  return spawnSync('node', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, MONITOR_HOOK_DEBUG: '', CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
}
const fileOf = (dir) => join(dir, '.monitor', 'events.jsonl');
const raw = (dir) => (existsSync(fileOf(dir)) ? readFileSync(fileOf(dir), 'utf8') : '');
const rows = (dir) => raw(dir).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const markers = (dir) => {
  try { return readdirSync(join(dir, '.monitor', 'open')); } catch { return []; }
};
const ok = (r) => { assert.equal(r.status, 0); assert.equal(r.stdout, '{}\n'); };
const S = 's-1';
const base = { session_id: S, cwd: '/work/proj', transcript_path: '/home/u/.claude/projects/x/s-1.jsonl' };

test('(a) cada evento da R26 grava só os campos permitidos', () => {
  const cases = [
    [{ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_1', tool_input: { questions: [{ question: 'Qual banco?', header: 'DB' }] } }, { tool_name: 'AskUserQuestion', tool_use_id: 'toolu_1', resumo: 'Qual banco?' }],
    [{ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf /x' } }, { tool_name: 'Bash', resumo: 'Bash' }],
    [{ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'SEGREDO_MSG' }, { resumo: 'permission_prompt' }],
    [{ hook_event_name: 'Elicitation', mcp_server_name: 'atlassian', message: 'SEGREDO_MSG' }, { resumo: 'atlassian' }],
    [{ hook_event_name: 'ElicitationResult', mcp_server_name: 'atlassian', action: 'accept' }, { resumo: 'atlassian' }],
    [{ hook_event_name: 'StopFailure', error_type: 'rate_limit', error: 'SEGREDO_MSG longo' }, { resumo: 'rate_limit' }],
    [{ hook_event_name: 'UserPromptSubmit', prompt: 'SEGREDO_PROMPT' }, {}],
    [{ hook_event_name: 'Stop', last_assistant_message: 'SEGREDO_RESPOSTA', stop_hook_active: false }, {}],
    [{ hook_event_name: 'SessionEnd', reason: 'logout' }, {}],
  ];
  const allowed = new Set(['ts', 'event', 'session_id', 'cwd', 'transcript_path', 'orca_session_id', 'agent_id', 'tool_name', 'tool_use_id', 'resumo']);
  for (const [p, extra] of cases) {
    const dir = mk();
    ok(run({ ...base, agent_id: undefined, ...p }, dir, { ORCA_AGENT_SESSION_ID: 'orca-9' }));
    const [r] = rows(dir);
    assert.equal(r.event, p.hook_event_name);
    assert.equal(r.session_id, S);
    assert.equal(r.cwd, base.cwd);
    assert.equal(r.transcript_path, base.transcript_path);
    assert.equal(r.orca_session_id, 'orca-9');
    for (const k of Object.keys(r)) assert.ok(allowed.has(k), `${p.hook_event_name}: campo ${k}`);
    for (const [k, v] of Object.entries(extra)) assert.equal(r[k], v, `${p.hook_event_name}.${k}`);
    assert.ok(!Number.isNaN(Date.parse(r.ts)));
  }
});

test('agent_id (permissão de subagente) é gravado', () => {
  const dir = mk();
  ok(run({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Edit', agent_id: 'ag-1', agent_type: 'dev' }, dir));
  const [r] = rows(dir);
  assert.equal(r.agent_id, 'ag-1');
  assert.ok(!('agent_type' in r));
});

test('(b) a pergunta é cortada em 120 caracteres, sem controles; header é o fallback', () => {
  const dir = mk();
  run({ ...base, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'a\nb\t' + 'x'.repeat(300) }] } }, dir);
  const [r] = rows(dir);
  assert.equal(r.resumo.length, 120);
  assert.ok(!/[\u0000-\u001f]/.test(r.resumo));
  const d2 = mk();
  run({ ...base, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ header: 'Banco', options: [] }] } }, d2);
  assert.equal(rows(d2)[0].resumo, 'Banco');
  const d3 = mk();
  run({ ...base, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: 'lixo' }, d3);
  assert.ok(!('resumo' in rows(d3)[0]));
});

test('(c) privacidade: valores-sentinela nunca aparecem na linha gravada', () => {
  const sentinels = ['SEGREDO_PROMPT', 'rm -rf /x', 'SEGREDO_MSG', 'SEGREDO_RESPOSTA', 'SEGREDO_RESP_USER', '/etc/passwd'];
  const dir = mk();
  const evs = [
    { hook_event_name: 'UserPromptSubmit', prompt: 'SEGREDO_PROMPT' },
    { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf /x', file_path: '/etc/passwd' }, permission_suggestions: [{ x: 'SEGREDO_MSG' }] },
    { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'SEGREDO_MSG', title: 'SEGREDO_MSG' },
    { hook_event_name: 'Elicitation', mcp_server_name: 'srv', message: 'SEGREDO_MSG', requested_schema: { a: 'SEGREDO_MSG' } },
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /x' }, tool_response: { stdout: 'SEGREDO_RESP_USER' } },
    { hook_event_name: 'StopFailure', error: 'SEGREDO_MSG', error_details: 'SEGREDO_MSG', last_assistant_message: 'SEGREDO_RESPOSTA' },
    { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_1', tool_input: { questions: [{ question: 'ok?', options: [{ label: 'SEGREDO_RESP_USER' }] }] } },
    { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_1', tool_response: { answers: 'SEGREDO_RESP_USER' } },
    { hook_event_name: 'Stop', last_assistant_message: 'SEGREDO_RESPOSTA', background_tasks: [{ description: 'SEGREDO_MSG' }] },
  ];
  for (const e of evs) ok(run({ ...base, ...e }, dir));
  const txt = raw(dir);
  assert.ok(txt.length > 0);
  for (const s of sentinels) assert.ok(!txt.includes(s), `vazou: ${s}`);
  assert.ok(!/"(prompt|tool_input|tool_response|message|last_assistant_message|error_details|permission_mode)"/.test(txt));
  assert.equal(rows(dir).find((r) => r.event === 'StopFailure').resumo, 'erro'); // mensagem nunca vira resumo
});

test('StopFailure: resumo só aceita ^[a-z_]{1,40}$; error_type tem prioridade', () => {
  const t = (p) => { const d = mk(); run({ ...base, hook_event_name: 'StopFailure', ...p }, d); return rows(d)[0].resumo; };
  assert.equal(t({ error_type: 'server_error', error: 'x_y' }), 'server_error');
  assert.equal(t({ error: 'billing_error' }), 'billing_error');
  assert.equal(t({ error: 'Rate limit exceeded' }), 'erro');
  assert.equal(t({ error_type: 'x'.repeat(41) }), 'erro');
  assert.equal(t({ error_type: 5 }), 'erro');
});

test('(d) marcador: PostToolUse sem marcador não grava nada (só {})', () => {
  const dir = mk();
  ok(run({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't' }, dir));
  ok(run({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 't' }, dir));
  assert.equal(raw(dir), '');
  assert.ok(!existsSync(join(dir, '.monitor')));
});

test('(d) pergunta: cria marcador; Post Bash não grava; Post AskUserQuestion grava e apaga', () => {
  const dir = mk();
  run({ ...base, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'q', tool_input: { questions: [{ question: 'x?' }] } }, dir);
  assert.deepEqual(markers(dir), [markerOf(S)]);
  assert.equal(readFileSync(join(dir, '.monitor', 'open', markerOf(S)), 'utf8'), 'pergunta');
  ok(run({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b' }, dir));
  assert.equal(rows(dir).length, 1);
  assert.deepEqual(markers(dir), [markerOf(S)]);
  ok(run({ ...base, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'q' }, dir));
  assert.deepEqual(rows(dir).map((r) => r.event), ['PreToolUse', 'PostToolUse']);
  assert.deepEqual(markers(dir), []);
});

test('(d) permissão: PermissionRequest e Notification criam marcador; qualquer Post grava e apaga; pergunta não é sobrescrita', () => {
  const dir = mk();
  run({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, dir);
  assert.equal(readFileSync(join(dir, '.monitor', 'open', markerOf(S)), 'utf8'), 'permissao');
  run({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'b' }, dir);
  assert.deepEqual(markers(dir), []);
  assert.deepEqual(rows(dir).map((r) => r.event), ['PermissionRequest', 'PostToolUseFailure']);

  const d2 = mk();
  run({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' }, d2);
  assert.equal(readFileSync(join(d2, '.monitor', 'open', markerOf(S)), 'utf8'), 'permissao');
  run({ ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' }, d2); // grava, sem marcador novo
  assert.equal(markers(d2).length, 1);

  const d3 = mk();
  run({ ...base, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'x?' }] } }, d3);
  run({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' }, d3);
  assert.equal(readFileSync(join(d3, '.monitor', 'open', markerOf(S)), 'utf8'), 'pergunta');
});

test('(d) UserPromptSubmit, Stop, StopFailure e SessionEnd gravam e apagam o marcador; marcadores são por sessão', () => {
  for (const ev of ['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']) {
    const dir = mk();
    run({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, dir);
    run({ ...base, session_id: 'outra', hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, dir);
    assert.equal(markers(dir).length, 2);
    ok(run({ ...base, hook_event_name: ev }, dir));
    assert.deepEqual(markers(dir), [markerOf('outra')], ev);
    assert.equal(rows(dir).at(-1).event, ev);
  }
});

test('Stop com agent_id (não é a sessão principal) não grava; sem agent_id grava', () => {
  const dir = mk();
  ok(run({ ...base, hook_event_name: 'Stop', agent_id: 'ag', last_assistant_message: 'x' }, dir));
  assert.equal(raw(dir), '');
  ok(run({ ...base, hook_event_name: 'Stop' }, dir));
  assert.equal(rows(dir).length, 1);
});

test('.monitor/.gitignore é criado com "*" e não é sobrescrito', () => {
  const dir = mk();
  run({ ...base, hook_event_name: 'Stop' }, dir);
  const gi = join(dir, '.monitor', '.gitignore');
  assert.equal(readFileSync(gi, 'utf8'), '*\n');
  const d2 = mk();
  mkdirSync(join(d2, '.monitor'));
  run({ ...base, hook_event_name: 'Stop' }, d2);
  assert.equal(readFileSync(join(d2, '.monitor', '.gitignore'), 'utf8'), '*\n');
});

test('(e) robustez: stdin vazio, JSON quebrado, tipos errados e .monitor sem permissão terminam em 0 e {}', () => {
  const dir = mk();
  ok(run('', dir));
  ok(run('{quebrado', dir));
  ok(run('null', dir));
  ok(run('[1,2]', dir));
  ok(run({ hook_event_name: 'Stop', session_id: 5 }, dir));
  ok(run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', session_id: S, tool_input: { questions: 'x' } }, dir));
  ok(run({ hook_event_name: 'Notification', session_id: S, notification_type: { a: 1 } }, dir));
  ok(run({ hook_event_name: 'Elicitation', session_id: S, mcp_server_name: 7, cwd: 3, transcript_path: [], agent_id: {} }, dir));
  ok(run({ hook_event_name: 'StopFailure', session_id: S, error_type: {}, error: [] }, dir));
  const ro = mk();
  mkdirSync(join(ro, '.monitor'));
  chmodSync(join(ro, '.monitor'), 0o500);
  try {
    ok(run({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, ro));
    ok(run({ ...base, hook_event_name: 'Stop' }, ro));
  } finally {
    chmodSync(join(ro, '.monitor'), 0o700);
  }
});

test('(f) tempo: mediana de 5 execuções < 200 ms', () => {
  const dir = mk();
  const ts = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    run({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'x' }, dir);
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ts.sort((a, b) => a - b);
  assert.ok(ts[2] < 200, `mediana ${ts[2].toFixed(0)} ms`);
});

test('(g) PermissionRequest não imprime nada além de {} (sem decisão de permissão)', () => {
  const dir = mk();
  const r = run({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }, dir);
  assert.equal(r.stdout, '{}\n');
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
});

test('(h) eventos de subagente da v1 seguem o ramo antigo (sem .gitignore, sem marcador)', () => {
  const dir = mk();
  ok(run({ hook_event_name: 'SubagentStart', session_id: S, agent_id: 'a', agent_type: 'qa' }, dir));
  ok(run({ hook_event_name: 'SubagentStop', session_id: S, agent_id: 'a', last_assistant_message: 'Resultado: APROVADO' }, dir));
  ok(run({ hook_event_name: 'PreToolUse', session_id: S, tool_name: 'Agent', tool_use_id: 't', tool_input: { subagent_type: 'qa', description: 'd' } }, dir));
  const r = rows(dir);
  assert.equal(r[1].verdict, 'APROVADO');
  assert.equal(r[1].last_message, 'Resultado: APROVADO');
  assert.equal(r[2].description, 'd');
  assert.ok(!existsSync(join(dir, '.monitor', 'open')));
  assert.ok(!existsSync(join(dir, '.monitor', '.gitignore')));
});

// ---- Pré-filtro em shell (tecnico.md 39e): só chama node se houver marcador ----
const FILTER = 'd="${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open"; if [ -n "$(ls -A "$d" 2>/dev/null)" ]; then node "$HOOK"; else echo \'{}\'; fi';
const sh = (payload, dir, env = {}) =>
  spawnSync('sh', ['-c', FILTER], { input: JSON.stringify(payload), encoding: 'utf8', cwd: dir, env: { ...process.env, HOOK, CLAUDE_PROJECT_DIR: dir, ...env } });

test('pré-filtro: sem marcador imprime {} e não grava; com marcador chama o hook; sem CLAUDE_PROJECT_DIR usa $PWD', () => {
  const dir = mk();
  let r = sh({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, dir);
  assert.equal(r.stdout, '{}\n');
  assert.equal(r.status, 0);
  assert.equal(raw(dir), '');
  run({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, dir);
  r = sh({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b' }, dir);
  assert.equal(r.stdout, '{}\n');
  assert.deepEqual(rows(dir).map((x) => x.event), ['PermissionRequest', 'PostToolUse']);
  assert.deepEqual(markers(dir), []);
  // $PWD como raiz quando CLAUDE_PROJECT_DIR não existe
  const d2 = mk();
  const here = { ...base, cwd: d2 }; // sem a variável, o hook usa o cwd do payload (= $PWD do filtro)
  run({ ...here, hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, d2);
  r = sh({ ...here, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, d2, { CLAUDE_PROJECT_DIR: '' });
  assert.deepEqual(rows(d2).map((x) => x.event), ['PermissionRequest', 'PostToolUse']);
});

test('o README e o tecnico.md usam o mesmo pré-filtro do hook', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open'));
  const tec = readFileSync(new URL('../docs/tecnico.md', import.meta.url), 'utf8');
  assert.ok(tec.includes('${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open'));
});
