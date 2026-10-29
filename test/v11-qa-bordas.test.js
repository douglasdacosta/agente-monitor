// QA v1.1 (tarefa 16): casos de borda de R3.1, R6.1, R9, R11 e hideOthers com papéis novos.
// Ajustado na v1.2 (R14/R15, lista 20e do docs/tecnico.md): ver os comentários `v1.2` abaixo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/model.js';
import { buildEdges } from '../src/edges.js';
import { EMPTY_TEAM } from '../src/team.js';

const S = 'sess-qa-v11';
const T = (s) => new Date(Date.UTC(2026, 9, 29, 9, 0, 0) + s * 1000).toISOString();
const line = (o) => JSON.stringify({ session_id: S, ...o });
const start = (id, type, s) => line({ ts: T(s), event: 'SubagentStart', agent_id: id, agent_type: type });
const stop = (id, type, s, extra = {}) => line({ ts: T(s), event: 'SubagentStop', agent_id: id, agent_type: type, last_message: 'ok', ...extra });
const build = (lines, opts) => {
  const { executions } = buildModel(lines);
  return buildEdges(executions, opts);
};
const type = (r, from, to) => r.edges.find((e) => e.from === from && e.to === to)?.type;
const vezes = (nodes) => {
  const c = {};
  return Object.fromEntries([...nodes].sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts)).map((n) => [n.id, (c[n.role] = (c[n.role] || 0) + 1)]));
};

test('borda: developer e dev-backend no mesmo lote não geram retorno entre si e contam separado (R9)', () => {
  const r = build([
    start('pm', 'project-manager', 0), stop('pm', 'project-manager', 10),
    start('d1', 'developer', 20), start('b1', 'dev-backend', 20.1), start('f1', 'dev-frontend', 20.2),
    stop('d1', 'developer', 60), stop('b1', 'dev-backend', 61), stop('f1', 'dev-frontend', 62),
    start('d2', 'developer', 70), start('b2', 'dev-backend', 70.1),
    stop('d2', 'developer', 90), stop('b2', 'dev-backend', 91),
  ]);
  const roles = Object.fromEntries(r.nodes.map((n) => [n.id, n.role]));
  assert.deepEqual(roles, { pm: 'project-manager', d1: 'developer', b1: 'dev-backend', f1: 'dev-frontend', d2: 'developer', b2: 'dev-backend' });
  // Mesmo lote: nenhuma aresta entre eles.
  for (const [a, b] of [['d1', 'b1'], ['b1', 'd1'], ['d1', 'f1'], ['b1', 'f1']]) assert.equal(type(r, a, b), undefined);
  // Lote seguinte: todas as arestas entre nível 4 são avanço.
  for (const a of ['d1', 'b1', 'f1']) for (const b of ['d2', 'b2']) assert.equal(type(r, a, b), 'avanço', `${a}->${b}`);
  assert.equal(r.edges.filter((e) => e.type === 'retorno').length, 0);
  assert.deepEqual(vezes(r.nodes), { pm: 1, d1: 1, b1: 1, f1: 1, d2: 2, b2: 2 });
});

test('borda: QA REPROVADO -> só dev-backend; dev-frontend mais tarde: só a 1ª aresta é retorno', () => {
  const r = build([
    start('qa', 'qa', 0), stop('qa', 'qa', 30, { verdict: 'REPROVADO' }),
    start('be', 'dev-backend', 40), stop('be', 'dev-backend', 60),
    start('fe', 'dev-frontend', 70), stop('fe', 'dev-frontend', 90),
  ]);
  assert.equal(type(r, 'qa', 'be'), 'retorno');
  assert.equal(type(r, 'be', 'fe'), 'avanço'); // mesmo nível: limitação conhecida (R5/R6.1)
  assert.equal(type(r, 'qa', 'fe'), undefined);
  assert.equal(r.edges.filter((e) => e.type === 'retorno').length, 1);
});

test('borda: hideOthers com um outro entre QA REPROVADO e os dois devs religa as duas arestas como retorno', () => {
  const lines = [
    start('qa', 'qa', 0), stop('qa', 'qa', 30, { verdict: 'REPROVADO' }),
    start('x', 'Explore', 40), stop('x', 'Explore', 50), // v1.2 (R14): era security-reviewer, que agora é papel do time
    start('be', 'dev-backend', 60), start('fe', 'dev-frontend', 60.1),
    stop('be', 'dev-backend', 90), stop('fe', 'dev-frontend', 91),
  ];
  const com = build(lines);
  assert.equal(com.nodes.find((n) => n.id === 'x').role, 'outro');
  assert.equal(type(com, 'qa', 'x'), 'avanço');
  assert.equal(type(com, 'x', 'be'), 'avanço');
  const sem = build(lines, { hideOthers: true });
  assert.deepEqual(sem.nodes.map((n) => n.id), ['qa', 'be', 'fe']);
  assert.equal(type(sem, 'qa', 'be'), 'retorno');
  assert.equal(type(sem, 'qa', 'fe'), 'retorno');
  assert.equal(sem.edges.length, 2);
  assert.deepEqual([...new Set(sem.nodes.map((n) => n.batch))].sort(), [1, 2]); // colunas densas
});

// v1.2 (R15): o nível é o lote de estreia. Versão (a): o designer estreia ANTES do tech-lead, então
// tech-lead -> designer volta a ser retorno pelo nível dinâmico. As demais asserções ficam iguais.
test('borda: nível por estreia (R15) com tech-lead (dev -> tech-lead e qa APROVADO -> tech-lead são retorno; tech-lead -> designer também)', () => {
  const r = build([
    start('de0', 'designer', 0), stop('de0', 'designer', 10),
    start('tl', 'tech-lead', 20), stop('tl', 'tech-lead', 30),
    start('be', 'dev-backend', 40), stop('be', 'dev-backend', 50),
    start('tl2', 'tech-lead', 60), stop('tl2', 'tech-lead', 70),
    start('de', 'designer', 80), stop('de', 'designer', 90),
    start('fe', 'developer', 100), stop('fe', 'developer', 110),
    start('qa', 'qa', 120), stop('qa', 'qa', 130, { verdict: 'APROVADO' }),
    start('tl3', 'tech-lead', 140), stop('tl3', 'tech-lead', 150),
  ]);
  assert.equal(type(r, 'tl', 'be'), 'avanço');
  assert.equal(type(r, 'be', 'tl2'), 'retorno');
  assert.equal(type(r, 'tl2', 'de'), 'retorno');
  assert.equal(type(r, 'de', 'fe'), 'avanço');
  assert.equal(type(r, 'qa', 'tl3'), 'retorno');
});

// Versão (b): o cenário ORIGINAL (o designer estreia depois do tech-lead; pela R15 a seta tl2 -> de seria avanço)
// com `nivel` na config, que reproduz a R6.1 e devolve o retorno.
test('borda: cenário original com nivel na config reproduz a R6.1 (tech-lead -> designer é retorno)', () => {
  const nivel = { 'project-manager': 1, designer: 2, 'tech-lead': 3, 'dev-backend': 4, 'dev-frontend': 4, developer: 4, qa: 5 };
  const papeis = Object.fromEntries(Object.entries(nivel).map(([k, v]) => [k, { nivel: v }]));
  const team = { ...EMPTY_TEAM, config: { papeis, nativos: [] } };
  const lines = [
    start('tl', 'tech-lead', 0), stop('tl', 'tech-lead', 10),
    start('be', 'dev-backend', 20), stop('be', 'dev-backend', 30),
    start('tl2', 'tech-lead', 40), stop('tl2', 'tech-lead', 50),
    start('de', 'designer', 60), stop('de', 'designer', 70),
    start('fe', 'developer', 80), stop('fe', 'developer', 90),
    start('qa', 'qa', 100), stop('qa', 'qa', 110, { verdict: 'APROVADO' }),
    start('tl3', 'tech-lead', 120), stop('tl3', 'tech-lead', 130),
  ];
  const sem = build(lines); // sem a config: avanço (designer estreou depois)
  assert.equal(type(sem, 'tl2', 'de'), 'avanço');
  const r = build(lines, { team });
  assert.equal(type(r, 'tl', 'be'), 'avanço');
  assert.equal(type(r, 'be', 'tl2'), 'retorno');
  assert.equal(type(r, 'tl2', 'de'), 'retorno');
  assert.equal(type(r, 'de', 'fe'), 'avanço');
  assert.equal(type(r, 'qa', 'tl3'), 'retorno');
});

test('borda: variação de nome (frontend-dev) é um papel do time próprio e conta separado na "Nª vez" (R9, R14)', () => {
  const { executions } = buildModel([
    start('a', 'dev-frontend', 0), stop('a', 'dev-frontend', 5),
    start('b', 'frontend-dev', 10), stop('b', 'frontend-dev', 15), // v1.2 (R14): variação de nome é um papel do time próprio
    start('c', 'dev-frontend', 20), stop('c', 'dev-frontend', 25),
  ]);
  assert.deepEqual(executions.map((e) => e.role), ['dev-frontend', 'frontend-dev', 'dev-frontend']);
  assert.deepEqual(vezes(executions), { a: 1, b: 1, c: 2 });
});
