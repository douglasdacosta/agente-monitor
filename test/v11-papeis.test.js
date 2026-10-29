import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, TEAM_ROLES as MODEL_ROLES } from '../src/model.js';
import { buildEdges, ROLE_ORDER } from '../src/edges.js';
import { ROLE_LEVEL, TEAM_ROLES } from '../src/roles.js';
import { createApp } from '../server.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const T0 = Date.parse('2026-10-29T10:00:00Z');
const ts = (s) => new Date(T0 + s * 1000).toISOString();
const j = (o) => JSON.stringify(o);
const S = 's1';

/** Sequência de linhas: Start direto com agent_type = role. */
const start = (id, role, s) => j({ ts: ts(s), event: 'SubagentStart', session_id: S, agent_id: id, agent_type: role });
const stop = (id, s, extra = {}) => j({ ts: ts(s), event: 'SubagentStop', session_id: S, agent_id: id, ...extra });

function edgesOf(lines, opts) {
  const { executions } = buildModel(lines);
  const { nodes, edges } = buildEdges(executions, opts);
  const name = (id) => nodes.find((n) => n.id === id)?.id;
  return edges.map((e) => ({ from: name(e.from), to: name(e.to), type: e.type }));
}

/** Dois papéis em sequência: A termina, B começa. Retorna o tipo da aresta A->B. */
function typeBetween(roleA, roleB, verdict) {
  const lines = [
    start('a', roleA, 0),
    stop('a', 10, verdict ? { verdict } : {}),
    start('b', roleB, 11),
    stop('b', 20),
  ];
  const e = edgesOf(lines);
  assert.equal(e.length, 1);
  return e[0].type;
}

test('roles: TEAM_ROLES (R3.1) inclui o legado developer e os níveis seguem R6.1', () => {
  assert.deepEqual(
    [...TEAM_ROLES].sort(),
    ['project-manager', 'designer', 'tech-lead', 'dev-backend', 'dev-frontend', 'developer', 'qa'].sort(),
  );
  assert.equal(MODEL_ROLES, TEAM_ROLES);
  assert.equal(ROLE_ORDER, ROLE_LEVEL);
  assert.equal(ROLE_LEVEL['dev-backend'], 4);
  assert.equal(ROLE_LEVEL['dev-frontend'], 4);
  assert.equal(ROLE_LEVEL.developer, 4);
  assert.equal(ROLE_LEVEL.qa, 5);
  assert.ok(Object.isFrozen(ROLE_LEVEL) && Object.isFrozen(TEAM_ROLES));
});

test('model: Start com agent_type do time novo recebe esse papel', () => {
  for (const role of ['tech-lead', 'dev-backend', 'dev-frontend', 'developer']) {
    const { executions } = buildModel([start('x', role, 0)]);
    assert.equal(executions[0].role, role);
  }
});

test('model: Start general-purpose com PreToolUse dev-frontend recebe dev-frontend', () => {
  const lines = [
    j({ ts: ts(0), event: 'PreToolUse', session_id: S, tool_use_id: 't1', agent_type: 'dev-frontend', description: 'FE' }),
    j({ ts: ts(0.1), event: 'SubagentStart', session_id: S, tool_use_id: 't1', agent_id: 'x', agent_type: 'general-purpose' }),
  ];
  assert.equal(buildModel(lines).executions[0].role, 'dev-frontend');
});

test('model: role sai sem normalização (developer não vira dev-backend)', () => {
  const { executions } = buildModel([start('d', 'developer', 0), stop('d', 5), start('b', 'dev-backend', 6)]);
  assert.deepEqual(executions.map((e) => e.role), ['developer', 'dev-backend']);
});

test('edges: papéis de mesmo nível geram avanço', () => {
  assert.equal(typeBetween('dev-backend', 'dev-frontend'), 'avanço');
  assert.equal(typeBetween('dev-frontend', 'dev-backend'), 'avanço');
  assert.equal(typeBetween('developer', 'dev-backend'), 'avanço');
});

test('edges: nível menor gera retorno', () => {
  assert.equal(typeBetween('tech-lead', 'designer'), 'retorno');
  assert.equal(typeBetween('qa', 'tech-lead', 'APROVADO'), 'retorno');
  assert.equal(typeBetween('dev-backend', 'tech-lead'), 'retorno');
});

test('edges: avanço normal e outro nunca gera retorno', () => {
  assert.equal(typeBetween('tech-lead', 'dev-backend'), 'avanço');
  assert.equal(typeBetween('dev-frontend', 'qa'), 'avanço');
  assert.equal(typeBetween('qa', 'outro', 'APROVADO'), 'avanço');
});

test('edges: QA REPROVADO seguido de dev-backend e dev-frontend gera exatamente 2 retornos', () => {
  const lines = [
    start('q', 'qa', 0),
    stop('q', 10, { verdict: 'REPROVADO' }),
    start('be', 'dev-backend', 11),
    start('fe', 'dev-frontend', 11.1),
    stop('be', 20),
    stop('fe', 21),
  ];
  const e = edgesOf(lines);
  assert.deepEqual(e, [
    { from: 'q', to: 'be', type: 'retorno' },
    { from: 'q', to: 'fe', type: 'retorno' },
  ]);
});

test('api: /api/flow devolve dev-frontend literal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-v11-'));
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, [start('fe', 'dev-frontend', 0), stop('fe', 5)].join('\n') + '\n');
  const app = createApp({ file, pollMs: 100 });
  const port = await app.listen(0);
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/api/flow`)).json();
    assert.deepEqual(body.executions.map((x) => x.role), ['dev-frontend']);
  } finally {
    await app.close();
  }
});
