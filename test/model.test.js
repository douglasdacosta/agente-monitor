import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutions, buildModel, extractVerdict } from '../src/model.js';
import { parseLines } from '../src/parse.js';
import { fixture } from './_helpers.js';

const byId = (xs) => Object.fromEntries(xs.map((x) => [x.id, x]));

test('cenario-usuario: 6 execuções, todas done, ordenadas por start', () => {
  const ex = buildExecutions(fixture('cenario-usuario'));
  assert.deepEqual(ex.map((e) => e.id), ['a-pm', 'a-dev', 'a-des', 'a-qa1', 'a-dev2', 'a-qa2']);
  assert.ok(ex.every((e) => e.status === 'done' && e.stop_ts && e.duration_ms > 0));
});

test('papel correto quando o Start é general-purpose (via PreToolUse, FIFO)', () => {
  const ex = byId(buildExecutions(fixture('cenario-usuario')));
  assert.equal(ex['a-pm'].role, 'project-manager');
  assert.equal(ex['a-pm'].label, 'PM planeja painel de fluxo');
  assert.equal(ex['a-pm'].duration_ms, 89900);
});

test('correlação por tool_use_id mesmo com Starts em ordem inversa', () => {
  const ex = byId(buildExecutions(fixture('cenario-usuario')));
  assert.equal(ex['a-dev'].role, 'developer');
  assert.equal(ex['a-dev'].label, 'Dev: hook, fixtures, regras');
  assert.equal(ex['a-des'].role, 'designer');
  assert.equal(ex['a-des'].label, 'Designer especifica tela do fluxo');
});

test('FIFO: sem tool_use_id casa o PreToolUse mais antigo dentro de 5s', () => {
  const lines = [
    { ts: '2026-01-01T00:00:00.000Z', event: 'PreToolUse', session_id: 's', agent_type: 'designer', description: 'D' },
    { ts: '2026-01-01T00:00:00.500Z', event: 'PreToolUse', session_id: 's', agent_type: 'developer', description: 'V' },
    { ts: '2026-01-01T00:00:01.000Z', event: 'SubagentStart', session_id: 's', agent_id: '1', agent_type: 'general-purpose' },
    { ts: '2026-01-01T00:00:01.100Z', event: 'SubagentStart', session_id: 's', agent_id: '2', agent_type: 'general-purpose' },
  ].map((o) => JSON.stringify(o));
  const ex = byId(buildExecutions(lines));
  assert.equal(ex['1'].role, 'designer');
  assert.equal(ex['2'].role, 'developer');
});

test('PreToolUse mais antigo que 5s não casa e é descartado', () => {
  const ex = buildExecutions(fixture('edge-cases')).filter((e) => e.session_id === 'sess-edge-A');
  assert.ok(!ex.some((e) => e.label === 'PreToolUse sem Start (negado)'));
  assert.equal(byId(ex)['a-exp'].label, 'Explora o repositório');
});

test('agente fora do time vira role outro', () => {
  const ex = byId(buildExecutions(fixture('edge-cases')));
  assert.equal(ex['a-exp'].role, 'outro');
  assert.equal(ex['a-exp'].status, 'done');
});

test('running: sem Stop fica running, sem stop_ts e sem duration_ms', () => {
  const ex = byId(buildExecutions(fixture('edge-cases')));
  assert.equal(ex['a-dev-run'].status, 'running');
  assert.equal(ex['a-dev-run'].stop_ts, null);
  assert.equal(ex['a-dev-run'].duration_ms, null);
  assert.equal(ex['a-dev-run'].role, 'developer');
  const live = buildExecutions(fixture('ao-vivo'));
  assert.equal(live.at(-1).id, 'l-qa');
  assert.equal(live.at(-1).status, 'running');
});

test('Stop órfão é ignorado', () => {
  const ex = buildExecutions(fixture('edge-cases'));
  assert.ok(!ex.some((e) => e.id === 'a-fantasma'));
});

test('veredito: campo verdict e regex no last_message (fallback)', () => {
  const ex = byId(buildExecutions(fixture('cenario-usuario')));
  assert.equal(ex['a-qa1'].verdict, 'REPROVADO'); // campo do hook
  assert.equal(ex['a-qa2'].verdict, 'APROVADO'); // regex no last_message
  assert.equal(ex['a-dev'].verdict, null);
  assert.equal(extractVerdict('## Resultado: **reprovado**'), 'REPROVADO');
  assert.equal(extractVerdict('Resultado:   APROVADO'), 'APROVADO');
  assert.equal(extractVerdict('sem nada'), null);
  assert.equal(extractVerdict(undefined), null);
});

test('linhas inválidas são ignoradas com aviso, sem quebrar', () => {
  const { events, warnings } = parseLines(fixture('edge-cases'));
  assert.equal(warnings.length, 3); // não-JSON, sem event, sem ts
  assert.ok(warnings.every((w) => /^linha \d+:/.test(w)));
  assert.equal(events.length, 10);
  const m = buildModel(fixture('edge-cases'));
  assert.equal(m.warnings.length, 3);
  assert.ok(!m.executions.some((e) => e.id === 'a-sem-ts'));
});

test('separação por sessão e ordenação das sessões pelo evento mais recente', () => {
  const m = buildModel(fixture('edge-cases'));
  assert.deepEqual(m.sessions.map((s) => s.session_id), ['sess-edge-B', 'sess-edge-A']);
  assert.equal(m.sessions[1].running, 1);
  assert.equal(m.sessions[0].executions, 1);
  const des = m.executions.find((e) => e.id === 'b-des');
  assert.equal(des.session_id, 'sess-edge-B');
  assert.equal(des.role, 'designer');
});

test('entrada vazia ou lixo', () => {
  assert.deepEqual(buildModel('').executions, []);
  assert.deepEqual(buildModel(undefined).sessions, []);
  assert.equal(buildModel(['{}', '[]', '1']).warnings.length, 3);
});

test('verdict só vale para role qa (Developer citando "Resultado: APROVADO" fica null)', () => {
  const L = [
    JSON.stringify({ ts: '2026-01-01T00:00:00Z', event: 'SubagentStart', session_id: 's', agent_id: 'd', agent_type: 'developer' }),
    JSON.stringify({ ts: '2026-01-01T00:00:01Z', event: 'SubagentStop', session_id: 's', agent_id: 'd', agent_type: 'developer', last_message: 'Resultado: APROVADO', verdict: 'APROVADO' }),
    JSON.stringify({ ts: '2026-01-01T00:00:02Z', event: 'SubagentStart', session_id: 's', agent_id: 'q', agent_type: 'qa' }),
    JSON.stringify({ ts: '2026-01-01T00:00:03Z', event: 'SubagentStop', session_id: 's', agent_id: 'q', agent_type: 'qa', last_message: 'Resultado: APROVADO' }),
  ];
  const ex = Object.fromEntries(buildExecutions(L).map((e) => [e.id, e]));
  assert.equal(ex.d.verdict, null);
  assert.equal(ex.q.verdict, 'APROVADO');
});
