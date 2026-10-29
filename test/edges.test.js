import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutions } from '../src/model.js';
import { buildEdges } from '../src/edges.js';
import { fixture } from './_helpers.js';

const pairs = (edges) => edges.map((e) => `${e.from}>${e.to}:${e.type}`).sort();

test('cenario-usuario: arestas exatas e retorno QA1->Dev2', () => {
  const { edges } = buildEdges(buildExecutions(fixture('cenario-usuario')));
  assert.deepEqual(pairs(edges), [
    'a-dev2>a-qa2:avanço',
    'a-dev>a-qa1:avanço',
    'a-des>a-qa1:avanço',
    'a-pm>a-dev:avanço',
    'a-pm>a-des:avanço',
    'a-qa1>a-dev2:retorno',
  ].sort());
});

test('cenario-usuario: lotes => 6 nós em 5 colunas', () => {
  const { nodes } = buildEdges(buildExecutions(fixture('cenario-usuario')));
  const b = Object.fromEntries(nodes.map((n) => [n.id, n.batch]));
  assert.deepEqual(b, { 'a-pm': 1, 'a-dev': 2, 'a-des': 2, 'a-qa1': 3, 'a-dev2': 4, 'a-qa2': 5 });
});

test('retorno por ordem de papel mesmo sem veredito (Dev -> PM)', () => {
  const mk = (id, role, s, e) => ({ id, role, verdict: null, start_ts: s, stop_ts: e, status: 'done' });
  const { edges } = buildEdges([
    mk('d', 'developer', '2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'),
    mk('p', 'project-manager', '2026-01-01T00:00:11Z', '2026-01-01T00:00:20Z'),
  ]);
  assert.deepEqual(pairs(edges), ['d>p:retorno']);
});

test('QA APROVADO seguido de Developer é retorno pela ordem; QA REPROVADO -> QA é retorno', () => {
  const mk = (id, role, verdict, s, e) => ({ id, role, verdict, start_ts: s, stop_ts: e, status: 'done' });
  const { edges } = buildEdges([
    mk('q1', 'qa', 'REPROVADO', '2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'),
    mk('q2', 'qa', 'APROVADO', '2026-01-01T00:00:11Z', '2026-01-01T00:00:20Z'),
  ]);
  assert.deepEqual(pairs(edges), ['q1>q2:retorno']);
});

test('edge-cases: outro participa das arestas e é terminal sem retorno', () => {
  const ex = buildExecutions(fixture('edge-cases')).filter((e) => e.session_id === 'sess-edge-A');
  const { edges, nodes } = buildEdges(ex);
  assert.deepEqual(pairs(edges), ['a-exp>a-dev-run:avanço']);
  assert.equal(nodes.length, 2);
});

test('hideOthers religa predecessores aos sucessores', () => {
  const mk = (id, role, s, e) => ({ id, role, verdict: null, start_ts: s, stop_ts: e, status: 'done' });
  const ex = [
    mk('pm', 'project-manager', '2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'),
    mk('x', 'outro', '2026-01-01T00:00:11Z', '2026-01-01T00:00:20Z'),
    mk('dev', 'developer', '2026-01-01T00:00:21Z', '2026-01-01T00:00:30Z'),
  ];
  assert.deepEqual(pairs(buildEdges(ex).edges), ['pm>x:avanço', 'x>dev:avanço']);
  const h = buildEdges(ex, { hideOthers: true });
  assert.deepEqual(pairs(h.edges), ['pm>dev:avanço']);
  assert.deepEqual(h.nodes.map((n) => [n.id, n.batch]), [['pm', 1], ['dev', 2]]); // colunas densas
});

test('hideOthers em dois outros encadeados e sucessor fica sem aresta duplicada', () => {
  const mk = (id, role, s, e) => ({ id, role, verdict: null, start_ts: s, stop_ts: e, status: 'done' });
  const ex = [
    mk('pm', 'project-manager', '2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'),
    mk('x', 'outro', '2026-01-01T00:00:11Z', '2026-01-01T00:00:20Z'),
    mk('y', 'outro', '2026-01-01T00:00:21Z', '2026-01-01T00:00:30Z'),
    mk('qa', 'qa', '2026-01-01T00:00:31Z', '2026-01-01T00:00:40Z'),
  ];
  assert.deepEqual(pairs(buildEdges(ex, { hideOthers: true }).edges), ['pm>qa:avanço']);
});

test('paralelos com Stops intercalados: novo lote após o primeiro Stop', () => {
  const mk = (id, role, s, e) => ({ id, role, verdict: null, start_ts: s, stop_ts: e, status: e ? 'done' : 'running' });
  const ex = [
    mk('a', 'designer', '2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'),
    mk('b', 'developer', '2026-01-01T00:00:01Z', '2026-01-01T00:00:30Z'),
    mk('c', 'qa', '2026-01-01T00:00:11Z', null),
  ];
  const { edges, nodes } = buildEdges(ex);
  assert.deepEqual(pairs(edges), ['a>c:avanço']);
  assert.deepEqual(nodes.map((n) => n.batch), [1, 1, 2]);
});

test('lista vazia e execução running não geram aresta de saída', () => {
  assert.deepEqual(buildEdges([]), { nodes: [], edges: [] });
  const { edges } = buildEdges(buildExecutions(fixture('ao-vivo')));
  assert.deepEqual(pairs(edges), ['l-dev>l-qa:avanço', 'l-pm>l-dev:avanço']);
});
