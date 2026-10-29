import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/model.js';
import { buildEdges } from '../src/edges.js';
import { fixture } from './_helpers.js';

function flow(session) {
  const { executions } = buildModel(fixture('cenario-time-novo'));
  return buildEdges(executions.filter((e) => e.session_id === session));
}

test('cenario-time-novo 0001: 8 nós, 7 colunas e arestas exatas', () => {
  const { nodes, edges } = flow('sess-time-novo-0001');
  assert.equal(nodes.length, 8);
  assert.equal(Math.max(...nodes.map((n) => n.batch)), 7);
  assert.deepEqual(
    Object.fromEntries(nodes.map((n) => [n.id, n.role])),
    {
      'a-pm': 'project-manager', 'a-des': 'designer', 'a-tl': 'tech-lead', 'a-be': 'dev-backend',
      'a-fe': 'dev-frontend', 'a-qa1': 'qa', 'a-fe2': 'dev-frontend', 'a-qa2': 'qa',
    },
  );
  assert.equal(nodes.find((n) => n.id === 'a-be').batch, nodes.find((n) => n.id === 'a-fe').batch);
  assert.deepEqual(edges, [
    { from: 'a-pm', to: 'a-des', type: 'avanço' },
    { from: 'a-des', to: 'a-tl', type: 'avanço' },
    { from: 'a-tl', to: 'a-be', type: 'avanço' },
    { from: 'a-tl', to: 'a-fe', type: 'avanço' },
    { from: 'a-be', to: 'a-qa1', type: 'avanço' },
    { from: 'a-fe', to: 'a-qa1', type: 'avanço' },
    { from: 'a-qa1', to: 'a-fe2', type: 'retorno' },
    { from: 'a-fe2', to: 'a-qa2', type: 'avanço' },
  ]);
});

test('cenario-time-novo 0002: 2 arestas retorno saindo do QA', () => {
  const { nodes, edges } = flow('sess-time-novo-0002');
  assert.equal(nodes.length, 4);
  assert.deepEqual(edges.filter((e) => e.type === 'retorno'), [
    { from: 'b-qa1', to: 'b-be', type: 'retorno' },
    { from: 'b-qa1', to: 'b-fe', type: 'retorno' },
  ]);
  assert.equal(edges.length, 4);
});

test('cenario-time-novo: 0002 é a sessão mais antiga', () => {
  const { sessions } = buildModel(fixture('cenario-time-novo'));
  assert.deepEqual(sessions.map((s) => s.session_id), ['sess-time-novo-0001', 'sess-time-novo-0002']);
});
