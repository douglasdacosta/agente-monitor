// Casos de borda adicionais do QA (tarefa 8): R1-R8 além das fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, buildExecutions, extractVerdict } from '../src/model.js';
import { buildEdges } from '../src/edges.js';

const S = 'sess-qa';
const L = (...evs) => evs.map((e) => JSON.stringify({ session_id: S, ...e }));
const pre = (ts, agent_type, description, extra = {}) => ({ ts, event: 'PreToolUse', agent_type, description, ...extra });
const start = (ts, agent_id, agent_type, extra = {}) => ({ ts, event: 'SubagentStart', agent_id, agent_type, ...extra });
const stop = (ts, agent_id, agent_type, last_message, extra = {}) => ({ ts, event: 'SubagentStop', agent_id, agent_type, last_message, ...extra });
const pairs = (edges) => edges.map((e) => `${e.from}>${e.to}:${e.type}`).sort();
const T = (s) => `2026-10-29T10:00:${String(s).padStart(2, '0')}.000Z`;

test('sessão só com PreToolUse: sem execuções, mas a sessão existe e não quebra', () => {
  const m = buildModel(L(pre(T(0), 'qa', 'x'), pre(T(1), 'developer', 'y')));
  assert.equal(m.executions.length, 0);
  assert.equal(m.sessions.length, 1);
  assert.equal(m.sessions[0].executions, 0);
  const { nodes, edges } = buildEdges(m.executions);
  assert.deepEqual([nodes, edges], [[], []]);
});

test('R2: janela de 5s é inclusiva em 5000ms e exclusiva acima', () => {
  const ok = buildExecutions(L(pre('2026-10-29T10:00:00.000Z', 'qa', 'ok'), start('2026-10-29T10:00:05.000Z', 'a', 'general-purpose')));
  assert.equal(ok[0].role, 'qa');
  const late = buildExecutions(L(pre('2026-10-29T10:00:00.000Z', 'qa', 'late'), start('2026-10-29T10:00:05.001Z', 'a', 'general-purpose')));
  assert.equal(late[0].role, 'outro');
});

test('R2: PreToolUse posterior ao Start nunca casa', () => {
  const ex = buildExecutions(L(start(T(0), 'a', 'general-purpose'), pre(T(1), 'qa', 'depois')));
  assert.equal(ex[0].role, 'outro');
});

test('R2: dois Starts paralelos, FIFO atribui na ordem dos PreToolUse', () => {
  const ex = buildExecutions(
    L(pre(T(0), 'designer', 'D'), pre(T(0), 'developer', 'V'), start(T(1), 'a', 'general-purpose'), start(T(1), 'b', 'general-purpose')),
  );
  const by = Object.fromEntries(ex.map((e) => [e.id, e]));
  assert.equal(by.a.role, 'designer');
  assert.equal(by.b.role, 'developer');
});

test('R3: agent_type do time no Start vence o PreToolUse', () => {
  const ex = buildExecutions(L(pre(T(0), 'designer', 'rótulo'), start(T(1), 'a', 'qa')));
  assert.equal(ex[0].role, 'qa');
  assert.equal(ex[0].label, 'rótulo');
});

test('R3: sem PreToolUse o label cai para agent_type', () => {
  const ex = buildExecutions(L(start(T(1), 'a', 'Explore')));
  assert.equal(ex[0].role, 'outro');
  assert.equal(ex[0].label, 'Explore');
});

test('R4: regex tolera negrito, caixa e espaços; ignora texto sem "Resultado:"', () => {
  assert.equal(extractVerdict('## Resultado: **REPROVADO**'), 'REPROVADO');
  assert.equal(extractVerdict('resultado:   aprovado'), 'APROVADO');
  assert.equal(extractVerdict('Resultado: PENDENTE'), null);
  assert.equal(extractVerdict('foi APROVADO pelo QA'), null);
  assert.equal(extractVerdict(undefined), null);
});

test('R4: campo verdict gravado pelo hook vence o last_message', () => {
  const ex = buildExecutions(L(start(T(0), 'a', 'qa'), stop(T(1), 'a', 'qa', 'Resultado: APROVADO', { verdict: 'REPROVADO' })));
  assert.equal(ex[0].verdict, 'REPROVADO');
});

test('R4: verdict inválido no campo é descartado (null), não propagado', () => {
  const ex = buildExecutions(L(start(T(0), 'a', 'qa'), stop(T(1), 'a', 'qa', 'sem resultado', { verdict: 'TALVEZ' })));
  assert.equal(ex[0].verdict, null);
});

test('R1: Stop repetido não sobrescreve o primeiro; Start duplicado vale o primeiro', () => {
  const ex = buildExecutions(
    L(start(T(0), 'a', 'qa'), start(T(2), 'a', 'qa'), stop(T(5), 'a', 'qa', 'primeiro'), stop(T(9), 'a', 'qa', 'segundo')),
  );
  assert.equal(ex.length, 1);
  assert.equal(ex[0].duration_ms, 5000);
  assert.equal(ex[0].last_message, 'primeiro');
});

test('R1/R8: Stop com ts anterior ao Start não gera duração negativa', () => {
  const ex = buildExecutions(L(start(T(10), 'a', 'qa'), stop(T(5), 'a', 'qa', 'x')));
  assert.ok(ex.length <= 1);
  if (ex.length) assert.ok(ex[0].duration_ms === null || ex[0].duration_ms >= 0);
});

test('R8: linha sem event, sem ts, ts inválido, array/primitivo JSON: ignoradas com aviso', () => {
  const lines = [
    '{"ts":"2026-10-29T10:00:00Z"}',
    '{"event":"SubagentStart","agent_id":"x"}',
    '{"ts":"nao-e-data","event":"SubagentStart","agent_id":"y","agent_type":"qa"}',
    '[1,2,3]',
    '42',
    'null',
    '',
    ...L(start(T(0), 'ok', 'qa')),
  ];
  const m = buildModel(lines);
  assert.deepEqual(m.executions.map((e) => e.id), ['ok']);
  assert.ok(m.warnings.length >= 4, `avisos: ${m.warnings.length}`);
});

test('R5: paralelos com Stops intercalados: Start tardio abre novo lote com apenas quem terminou antes', () => {
  // A e B juntos; A termina; C começa (pred = A); B termina; D começa (pred = B e C se C terminou antes)
  const ex = buildExecutions(
    L(
      start(T(0), 'A', 'designer'), start(T(0), 'B', 'developer'),
      stop(T(10), 'A', 'designer', 'a'),
      start(T(11), 'C', 'qa'),
      stop(T(20), 'B', 'developer', 'b'),
      stop(T(21), 'C', 'qa', 'c'),
      start(T(22), 'D', 'developer'),
    ),
  );
  const { nodes, edges } = buildEdges(ex);
  assert.deepEqual(pairs(edges), ['A>C:avanço', 'B>D:avanço', 'C>D:retorno'].sort());
  const b = Object.fromEntries(nodes.map((n) => [n.id, n.batch]));
  assert.deepEqual(b, { A: 1, B: 1, C: 2, D: 3 });
});

test('R5: um único agente sem Stop: 1 nó, sem arestas; todos running', () => {
  const { nodes, edges } = buildEdges(buildExecutions(L(start(T(0), 'a', 'qa'))));
  assert.equal(nodes.length, 1);
  assert.equal(edges.length, 0);
});

test('R5: Starts em sequência sem Stop (A, B, C separados no tempo) formam um único lote', () => {
  const { nodes, edges } = buildEdges(buildExecutions(L(start(T(0), 'A', 'designer'), start(T(5), 'B', 'developer'), start(T(9), 'C', 'qa'))));
  assert.deepEqual(nodes.map((n) => n.batch), [1, 1, 1]);
  assert.equal(edges.length, 0);
});

test('R5: Start e Stop com o mesmo ts: Stop de outro agente conta antes do Start', () => {
  const ex = buildExecutions(L(start(T(0), 'A', 'project-manager'), stop(T(5), 'A', 'project-manager', 'x'), start(T(5), 'B', 'designer')));
  const { edges } = buildEdges(ex);
  assert.deepEqual(pairs(edges), ['A>B:avanço']);
});

test('R6: QA REPROVADO -> outro é avanço; outro -> developer nunca retorna', () => {
  const ex = buildExecutions(
    L(
      start(T(0), 'Q', 'qa'), stop(T(1), 'Q', 'qa', '## Resultado: REPROVADO'),
      start(T(2), 'X', 'Explore'), stop(T(3), 'X', 'Explore', 'x'),
      start(T(4), 'D', 'developer'),
    ),
  );
  assert.deepEqual(pairs(buildEdges(ex).edges), ['Q>X:avanço', 'X>D:avanço']);
});

test('R6: QA APROVADO -> QA (mesma ordem) é avanço', () => {
  const ex = buildExecutions(L(start(T(0), 'Q1', 'qa'), stop(T(1), 'Q1', 'qa', '## Resultado: APROVADO'), start(T(2), 'Q2', 'qa')));
  assert.deepEqual(pairs(buildEdges(ex).edges), ['Q1>Q2:avanço']);
});

test('R7: hideOthers com todos os nós "outro": sem nós nem arestas', () => {
  const ex = buildExecutions(L(start(T(0), 'X', 'Explore'), stop(T(1), 'X', 'Explore', 'x'), start(T(2), 'Y', 'Plan')));
  const r = buildEdges(ex, { hideOthers: true });
  assert.deepEqual([r.nodes.length, r.edges.length], [0, 0]);
});

test('R7: hideOthers entre QA REPROVADO e Developer: aresta religada vira retorno', () => {
  const ex = buildExecutions(
    L(
      start(T(0), 'Q', 'qa'), stop(T(1), 'Q', 'qa', '## Resultado: REPROVADO'),
      start(T(2), 'X', 'Explore'), stop(T(3), 'X', 'Explore', 'x'),
      start(T(4), 'D', 'developer'),
    ),
  );
  const r = buildEdges(ex, { hideOthers: true });
  assert.deepEqual(pairs(r.edges), ['Q>D:retorno']);
  assert.deepEqual(r.nodes.map((n) => n.batch), [1, 2]);
});

test('R7: hideOthers não muta as execuções de entrada e é idempotente', () => {
  const ex = buildExecutions(L(start(T(0), 'X', 'Explore'), stop(T(1), 'X', 'Explore', 'x'), start(T(2), 'D', 'developer')));
  const snap = JSON.stringify(ex);
  const a = buildEdges(ex, { hideOthers: true });
  const b = buildEdges(ex, { hideOthers: true });
  assert.equal(JSON.stringify(ex), snap);
  assert.deepEqual(a, b);
});

test('sessões: evento sem session_id forma sessão própria sem misturar com as demais', () => {
  const lines = [
    JSON.stringify({ ts: T(0), event: 'SubagentStart', agent_id: 'n', agent_type: 'qa' }),
    ...L(start(T(1), 'm', 'qa')),
  ];
  const m = buildModel(lines);
  assert.equal(m.sessions.length, 2);
});

test('mesmo agent_id em sessões diferentes não se cruza', () => {
  const lines = [
    JSON.stringify({ session_id: 'A', ts: T(0), event: 'SubagentStart', agent_id: 'same', agent_type: 'qa' }),
    JSON.stringify({ session_id: 'B', ts: T(1), event: 'SubagentStart', agent_id: 'same', agent_type: 'developer' }),
    JSON.stringify({ session_id: 'B', ts: T(5), event: 'SubagentStop', agent_id: 'same', agent_type: 'developer', last_message: 'x' }),
  ];
  const ex = buildExecutions(lines);
  const a = ex.find((e) => e.session_id === 'A');
  const b = ex.find((e) => e.session_id === 'B');
  assert.equal(a.status, 'running');
  assert.equal(b.status, 'done');
});
