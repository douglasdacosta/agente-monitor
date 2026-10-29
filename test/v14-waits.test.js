// v1.4 (tarefa 42 / B7): src/waits.js (R27, R28, R30) + filtro de PreToolUse no modelo (R29).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanWaits, finalizeWaits, buildWaits, VEZ_MS, EXPIRA_MS, KINDS } from '../src/waits.js';
import { buildModel } from '../src/model.js';

const FIX = readFileSync(new URL('../fixtures/esperas.jsonl', import.meta.url), 'utf8').split('\n');
const maxTs = Math.max(...FIX.map((l) => { try { return Date.parse(JSON.parse(l).ts); } catch { return -Infinity; } }));
const byNum = (waits, n) => waits.find((w) => w.session_id.startsWith(`esp-${String(n).padStart(2, '0')}-`));

// ---- Fixture (critério 42) ----
test('fixture: só as sessões 1, 4, 6, 8, 9 e 10 têm espera, com tipo e since corretos', () => {
  const w = buildWaits(FIX, { now: maxTs });
  assert.deepEqual(w.map((x) => Number(x.session_id.slice(4, 6))).sort((a, b) => a - b), [1, 4, 6, 8, 9, 10]);
  const iso = (s) => new Date(maxTs - s * 1000).toISOString();
  const exp = {
    1: ['pergunta', '2026-10-29T11:58:00.000Z', 'Qual banco de dados devemos usar para o cache?'],
    4: ['permissao', '2026-10-29T11:56:40.000Z', 'Bash'], // since da PermissionRequest, não da Notification
    6: ['mcp', '2026-10-29T11:53:20.000Z', 'atlassian'], // vale a última (a vez do Stop anterior some)
    8: ['erro', '2026-10-29T11:55:50.000Z', 'rate_limit'],
    9: ['vez', iso(60), null],
    10: ['vez', iso(300), null],
  };
  for (const [n, [kind, since, resumo]] of Object.entries(exp)) {
    const x = byNum(w, n);
    assert.equal(x.kind, kind, `kind ${n}`);
    assert.equal(x.since, since, `since ${n}`);
    assert.equal(x.resumo, resumo, `resumo ${n}`);
    assert.equal(x.agent_id, null);
    assert.ok(KINDS.includes(x.kind));
  }
  assert.equal(w.filter((x) => x.session_id.startsWith('esp-04-')).length, 1);
});

test('fixture: urgência (9 discreta, 10 acima do limite) e ordem urgent desc, since asc', () => {
  const w = buildWaits(FIX, { now: maxTs });
  assert.equal(byNum(w, 9).urgent, false);
  assert.equal(byNum(w, 10).urgent, true);
  for (const n of [1, 4, 6, 8]) assert.equal(byNum(w, n).urgent, true);
  assert.deepEqual(w.map((x) => Number(x.session_id.slice(4, 6))), [6, 10, 8, 4, 1, 9]);
});

test('fixture: trocar vezMs muda a classificação da 9 e da 10', () => {
  const a = buildWaits(FIX, { now: maxTs, vezMs: 30_000 });
  assert.equal(byNum(a, 9).urgent, true);
  assert.equal(byNum(a, 10).urgent, true);
  const b = buildWaits(FIX, { now: maxTs, vezMs: 10 * 60e3 });
  assert.equal(byNum(b, 9).urgent, false);
  assert.equal(byNum(b, 10).urgent, false);
  assert.equal(byNum(buildWaits(FIX, { now: maxTs, vezMs: 60_000 }), 9).urgent, true); // limite inclusivo
});

test('fixture: 2, 3, 5, 7, 11, 12, 13, 14, 15 e 16 sem espera; 16 não quebra; 15 em sessions com 0 execuções', () => {
  const scan = scanWaits(FIX);
  assert.equal(scan.warnings.length, 1);
  const w = finalizeWaits(scan, { now: maxTs });
  for (const n of [2, 3, 5, 7, 11, 12, 13, 14, 15, 16]) assert.equal(byNum(w, n), undefined, `sessão ${n}`);
  const s15 = buildModel(FIX).sessions.find((s) => s.session_id.startsWith('esp-15-'));
  assert.deepEqual([s15.executions, s15.running], [0, 0]);
  // a 14 só some pela expiração (R30): com expiraMs maior, a vez aparece
  assert.equal(byNum(buildWaits(FIX, { now: maxTs, expiraMs: 48 * 3600e3 }), 14).kind, 'vez');
  // a 13 só some pelo SessionEnd
  assert.equal(scan.sessions.get([...scan.sessions.keys()].find((k) => k.startsWith('esp-13-'))).ended, true);
});

test('fixture: expires_at = último evento da sessão + 24 h; sem campos fora do contrato', () => {
  const w = buildWaits(FIX, { now: maxTs });
  assert.equal(byNum(w, 1).expires_at, new Date(Date.parse('2026-10-29T11:58:00.000Z') + EXPIRA_MS).toISOString());
  for (const x of w) assert.deepEqual(Object.keys(x).sort(), ['agent_id', 'expires_at', 'kind', 'resumo', 'session_id', 'since', 'urgent']);
});

// ---- Exemplos do contrato ----
const DAY = '2026-10-29T';
const L = (hms, event, extra = {}, sid = 's1') => JSON.stringify({ ts: `${DAY}${hms}.000Z`, event, session_id: sid, ...extra });
const o = { now: Date.parse(`${DAY}10:10:00.000Z`), vezMs: 2 * 60e3 };
const ASK = { tool_name: 'AskUserQuestion', tool_use_id: 'tq', resumo: 'Qual banco?' };

test('exemplo: pergunta aberta', () => {
  const [w, ...rest] = buildWaits([L('10:00:00', 'PreToolUse', ASK)], o);
  assert.equal(rest.length, 0);
  assert.deepEqual(w, { session_id: 's1', kind: 'pergunta', since: `${DAY}10:00:00.000Z`, resumo: 'Qual banco?', agent_id: null, urgent: true, expires_at: '2026-10-30T10:00:00.000Z' });
});

test('exemplo: vez abaixo e acima do limite', () => {
  assert.deepEqual(buildWaits([L('10:09:00', 'Stop')], o).map((x) => [x.kind, x.urgent]), [['vez', false]]);
  assert.deepEqual(buildWaits([L('10:00:00', 'Stop')], o).map((x) => [x.kind, x.urgent]), [['vez', true]]);
  assert.equal(VEZ_MS, 120000);
});

test('exemplo: PermissionRequest + Notification = uma espera, since do primeiro', () => {
  const w = buildWaits([L('10:00:00', 'PermissionRequest', { tool_name: 'Bash', resumo: 'Bash' }), L('10:00:01', 'Notification', { resumo: 'permission_prompt' })], o);
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].kind, w[0].since, w[0].resumo], ['permissao', `${DAY}10:00:00.000Z`, 'Bash']);
  // Notification primeiro: o resumo vem da PermissionRequest depois, e o since é o da Notification
  const w2 = buildWaits([L('10:00:00', 'Notification', { resumo: 'permission_prompt' }), L('10:00:01', 'PermissionRequest', { tool_name: 'Edit' })], o);
  assert.deepEqual([w2.length, w2[0].since, w2[0].resumo], [1, `${DAY}10:00:00.000Z`, 'Edit']);
});

test('exemplo: Stop com subagente em background -> a vez começa no SubagentStop', () => {
  const w = buildWaits([L('10:00:00', 'SubagentStart', { agent_id: 'a' }), L('10:01:00', 'Stop'), L('10:05:00', 'SubagentStop', { agent_id: 'a' })], o);
  assert.deepEqual(w.map((x) => [x.kind, x.since, x.urgent, x.agent_id]), [['vez', `${DAY}10:05:00.000Z`, true, null]]);
  // sem Stop pendente, o SubagentStop não cria vez
  assert.deepEqual(buildWaits([L('10:00:00', 'SubagentStart', { agent_id: 'a' }), L('10:05:00', 'SubagentStop', { agent_id: 'a' })], o), []);
  // atividade da sessão principal entre o Stop e o SubagentStop cancela a vez pendente
  assert.deepEqual(buildWaits([L('10:00:00', 'SubagentStart', { agent_id: 'a' }), L('10:01:00', 'Stop'), L('10:02:00', 'PreToolUse', { tool_name: 'Bash' }), L('10:05:00', 'SubagentStop', { agent_id: 'a' })], o), []);
  // dois subagentes: só o último SubagentStop abre a vez
  const two = [L('10:00:00', 'SubagentStart', { agent_id: 'a' }), L('10:00:01', 'SubagentStart', { agent_id: 'b' }), L('10:01:00', 'Stop'), L('10:02:00', 'SubagentStop', { agent_id: 'a' })];
  assert.deepEqual(buildWaits(two, o), []);
  assert.equal(buildWaits([...two, L('10:03:00', 'SubagentStop', { agent_id: 'b' })], o)[0].since, `${DAY}10:03:00.000Z`);
});

test('exemplo: UserPromptSubmit fecha; espera expirada some', () => {
  assert.deepEqual(buildWaits([L('10:00:00', 'Stop'), L('10:00:30', 'UserPromptSubmit')], o), []);
  assert.deepEqual(buildWaits([L('10:00:30', 'UserPromptSubmit')], o), []); // sem espera aberta: ignorado
  assert.deepEqual(buildWaits(['{"ts":"2026-10-28T09:00:00Z","event":"Stop","session_id":"s1"}'], o), []);
});

test('subagente sem SubagentStop há mais de STALE_MS não segura a vez', () => {
  const w = buildWaits([L('06:00:00', 'SubagentStart', { agent_id: 'a' }), L('09:00:00', 'Stop')], o);
  assert.equal(w[0]?.kind, 'vez');
});

test('duas esperas seguidas: vale a última (e o since dela)', () => {
  const w = buildWaits([L('10:00:00', 'PreToolUse', ASK), L('10:05:00', 'StopFailure', { resumo: 'rate_limit' })], o);
  assert.deepEqual(w.map((x) => [x.kind, x.since]), [['erro', `${DAY}10:05:00.000Z`]]);
  const w2 = buildWaits([L('10:00:00', 'Stop'), L('10:05:00', 'PermissionRequest', { tool_name: 'Bash' })], o);
  assert.deepEqual(w2.map((x) => x.kind), ['permissao']);
});

test('SessionEnd seguido de Stop reabre a sessão; SessionEnd sozinho fecha', () => {
  assert.deepEqual(buildWaits([L('10:00:00', 'Stop'), L('10:01:00', 'SessionEnd')], o), []);
  const w = buildWaits([L('10:00:00', 'Stop'), L('10:01:00', 'SessionEnd'), L('10:02:00', 'Stop')], o);
  assert.deepEqual(w.map((x) => [x.kind, x.since]), [['vez', `${DAY}10:02:00.000Z`]]);
});

test('pergunta: fecha por PostToolUse AskUserQuestion ou tool_use_id; Post de outra ferramenta não fecha', () => {
  const open = L('10:00:00', 'PreToolUse', ASK);
  assert.equal(buildWaits([open, L('10:00:05', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'outro' })], o).length, 1);
  assert.equal(buildWaits([open, L('10:00:05', 'PostToolUse', { tool_name: 'AskUserQuestion' })], o).length, 0);
  assert.equal(buildWaits([open, L('10:00:05', 'PostToolUseFailure', { tool_use_id: 'tq' })], o).length, 0);
  // PermissionRequest/Notification do próprio AskUserQuestion não vira outra espera
  assert.deepEqual(buildWaits([open, L('10:00:01', 'PermissionRequest', { tool_name: 'AskUserQuestion' })], o).map((x) => x.kind), ['pergunta']);
  assert.deepEqual(buildWaits([open, L('10:00:01', 'Notification', { resumo: 'permission_prompt' })], o).map((x) => x.kind), ['pergunta']);
});

test('permissão de subagente: carrega agent_id; fecha por evento do mesmo ator, não por outro ator', () => {
  const pr = L('10:00:00', 'PermissionRequest', { agent_id: 'ag', tool_name: 'Bash' });
  assert.equal(buildWaits([pr], o)[0].agent_id, 'ag');
  assert.equal(buildWaits([pr, L('10:00:05', 'SubagentStop', { agent_id: 'ag' })], o).length, 0);
  assert.equal(buildWaits([pr, L('10:00:05', 'PreToolUse', { agent_id: 'ag', tool_name: 'Read' })], o).length, 0);
  assert.equal(buildWaits([pr, L('10:00:05', 'PostToolUse', { agent_id: 'ag', tool_name: 'Bash' })], o).length, 0);
  assert.equal(buildWaits([pr, L('10:00:05', 'PostToolUse', { agent_id: 'outro', tool_name: 'Bash' })], o).length, 1);
  assert.equal(buildWaits([pr, L('10:00:05', 'UserPromptSubmit')], o).length, 0);
  // Stop de subagente (agent_id) nunca abre vez
  assert.equal(buildWaits([L('10:00:00', 'Stop', { agent_id: 'ag' })], o).length, 0);
});

test('mcp: Notification elicitation_dialog funde com Elicitation; ElicitationResult fecha', () => {
  const w = buildWaits([L('10:00:00', 'Elicitation', { resumo: 'atlassian' }), L('10:00:01', 'Notification', { resumo: 'elicitation_dialog' })], o);
  assert.deepEqual(w.map((x) => [x.kind, x.since, x.resumo]), [['mcp', `${DAY}10:00:00.000Z`, 'atlassian']]);
  assert.equal(buildWaits([L('10:00:00', 'Notification', { resumo: 'elicitation_dialog' })], o)[0].kind, 'mcp');
  assert.equal(buildWaits([L('10:00:00', 'Elicitation'), L('10:00:02', 'ElicitationResult')], o).length, 0);
});

test('Notification de outro tipo, linhas inválidas e eventos sem session_id são ignorados; eventos fora de ordem', () => {
  assert.deepEqual(buildWaits([L('10:00:00', 'Notification', { resumo: 'idle_prompt' }), L('10:00:01', 'Notification')], o), []);
  assert.deepEqual(buildWaits(['{ruim', '{"ts":"x","event":"Stop","session_id":"s"}', '{"ts":"2026-10-29T10:00:00Z","event":"Stop"}'], o), []);
  // ordenado por t, não pela ordem das linhas
  assert.deepEqual(buildWaits([L('10:05:00', 'Stop'), L('10:01:00', 'UserPromptSubmit')], o).map((x) => x.kind), ['vez']);
});

test('sessões independentes; ordem global urgent desc, since asc, session_id', () => {
  const w = buildWaits([L('10:09:30', 'Stop', {}, 'a'), L('10:00:00', 'PreToolUse', ASK, 'c'), L('10:00:00', 'PreToolUse', ASK, 'b'), L('10:08:00', 'Stop', {}, 'd')], o);
  assert.deepEqual(w.map((x) => x.session_id), ['b', 'c', 'd', 'a']);
});

test('R29: PreToolUse AskUserQuestion não vira "pré" (label) do subagente que começa 1 s depois', () => {
  const ev = [
    L('10:00:00', 'PreToolUse', { tool_name: 'AskUserQuestion', description: 'PERGUNTA', agent_type: 'qa' }),
    L('10:00:01', 'SubagentStart', { agent_id: 'a', agent_type: 'qa' }),
  ];
  assert.equal(buildModel(ev).executions[0].label, 'qa');
  // Agent/Task e linhas da v1 (sem tool_name) continuam correlacionando
  const v1 = [L('10:00:00', 'PreToolUse', { description: 'Implementa' }), L('10:00:01', 'SubagentStart', { agent_id: 'a', agent_type: 'qa' })];
  assert.equal(buildModel(v1).executions[0].label, 'Implementa');
  const agent = [L('10:00:00', 'PreToolUse', { tool_name: 'Agent', description: 'Implementa' }), L('10:00:01', 'SubagentStart', { agent_id: 'a', agent_type: 'qa' })];
  assert.equal(buildModel(agent).executions[0].label, 'Implementa');
});

test('R29: sessão só com turnos entra em sessions com 0 execuções', () => {
  const m = buildModel([L('10:00:00', 'UserPromptSubmit'), L('10:00:01', 'Stop')]);
  assert.deepEqual(m.sessions.map((s) => [s.session_id, s.executions, s.running]), [['s1', 0, 0]]);
});

test('permissão: PostToolUse só fecha o mesmo ator; com tool_use_id nos dois lados, ele decide', () => {
  const pr = (extra = {}) => L('10:00:00', 'PermissionRequest', { tool_name: 'Bash', ...extra });
  assert.equal(buildWaits([pr(), L('10:00:05', 'PostToolUse', { agent_id: 'B' })], o).length, 1);
  assert.equal(buildWaits([pr({ agent_id: 'A' }), L('10:00:05', 'PostToolUse')], o).length, 1);
  assert.equal(buildWaits([pr(), L('10:00:05', 'PostToolUse')], o).length, 0); // ambos sem agent_id
  // tool_use_id igual fecha mesmo com agent_id divergente; diferente não fecha mesmo com o mesmo ator
  assert.equal(buildWaits([pr({ tool_use_id: 't1' }), L('10:00:05', 'PostToolUse', { agent_id: 'B', tool_use_id: 't1' })], o).length, 0);
  assert.equal(buildWaits([pr({ tool_use_id: 't1' }), L('10:00:05', 'PostToolUseFailure', { tool_use_id: 't2' })], o).length, 1);
  assert.equal(buildWaits([pr({ tool_use_id: 't1' }), L('10:00:05', 'PostToolUse')], o).length, 0); // só um lado tem id: ator
});

test('Notification permission_prompt não funde com permissão de outro subagente nem é ignorada por pergunta de outro ator', () => {
  const w = buildWaits([L('10:00:00', 'PermissionRequest', { agent_id: 'A', tool_name: 'Bash' }), L('10:00:01', 'Notification', { agent_id: 'B', resumo: 'permission_prompt' })], o);
  assert.deepEqual(w.map((x) => x.agent_id), ['B']);
  const q = buildWaits([L('10:00:00', 'PreToolUse', { ...ASK, agent_id: 'A' }), L('10:00:01', 'Notification', { resumo: 'permission_prompt' })], o);
  assert.deepEqual(q.map((x) => x.kind), ['permissao']);
});
