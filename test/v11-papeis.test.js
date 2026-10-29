import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/model.js';
import { buildEdges } from '../src/edges.js';
import { EMPTY_TEAM } from '../src/team.js';
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

// v1.2: o teste da lista fixa de papéis/níveis (R3.1/R6.1) saiu; isTeamType/NATIVE_TYPES são testados em v12-modelo.

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

// v1.2 (R15): o nível é o lote de estreia. Cada caso ganha a estreia do papel de destino ANTES da origem
// (typeBetween faz o destino estrear depois, o que pela R15 seria avanço). A intenção é a mesma: ir para um
// papel de nível menor é retorno, mesmo sem veredito reprovado.
/** Destino -> origem -> destino2: devolve o tipo da aresta origem -> destino2. */
function typeBack(roleTo, roleFrom, verdict) {
  const lines = [
    start('t', roleTo, 0),
    stop('t', 10),
    start('f', roleFrom, 11),
    stop('f', 20, verdict ? { verdict } : {}),
    start('t2', roleTo, 21),
    stop('t2', 30),
  ];
  return edgesOf(lines).find((e) => e.from === 'f' && e.to === 't2').type;
}

test('edges: nível menor gera retorno (R15, estreia do destino antes da origem)', () => {
  assert.equal(typeBack('designer', 'tech-lead'), 'retorno');
  assert.equal(typeBack('tech-lead', 'qa', 'APROVADO'), 'retorno');
  assert.equal(typeBack('tech-lead', 'dev-backend'), 'retorno');
});

test('edges: nivel na config reproduz a R6.1 nos casos originais (destino estreia depois da origem)', () => {
  const nivel = { 'project-manager': 1, designer: 2, 'tech-lead': 3, 'dev-backend': 4, 'dev-frontend': 4, developer: 4, qa: 5 };
  const papeis = Object.fromEntries(Object.entries(nivel).map(([k, v]) => [k, { nivel: v }]));
  const team = { ...EMPTY_TEAM, config: { papeis, nativos: [] } };
  const tipo = (a, b, verdict) => {
    const { executions } = buildModel([start('a', a, 0), stop('a', 10, verdict ? { verdict } : {}), start('b', b, 11), stop('b', 20)], { team });
    return buildEdges(executions, { team }).edges[0].type;
  };
  assert.equal(tipo('tech-lead', 'designer'), 'retorno');
  assert.equal(tipo('qa', 'tech-lead', 'APROVADO'), 'retorno');
  assert.equal(tipo('dev-backend', 'tech-lead'), 'retorno');
  assert.equal(tipo('dev-backend', 'dev-frontend'), 'avanço'); // mesmo nivel
  assert.equal(tipo('tech-lead', 'dev-backend'), 'avanço');
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
