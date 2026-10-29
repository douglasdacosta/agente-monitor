// QA v1.2 (tarefas 26 e 27): R15.1 (ordem em edgeType), R16 (validador), segurança da descoberta/config e da API.
// Só usa diretórios temporários; nunca lê o `~` real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildModel } from '../src/model.js';
import { buildEdges } from '../src/edges.js';
import { describeRoles } from '../src/roles.js';
import { discoverTeam } from '../src/team.js';
import { createApp } from '../server.js';

const S = 'sess-qa-v12';
const T = (s) => new Date(Date.UTC(2026, 9, 29, 9, 0, 0) + s * 1000).toISOString();
const ev = (o) => JSON.stringify({ session_id: S, ...o });
const start = (id, role, s) => ev({ ts: T(s), event: 'SubagentStart', agent_id: id, agent_type: role });
const stop = (id, role, s, extra = {}) => ev({ ts: T(s), event: 'SubagentStop', agent_id: id, agent_type: role, ...extra });
const mkTeam = ({ defs = [], papeis = {}, nativos = [] } = {}) => ({
  defs: new Map(defs.map((d) => [d.name, { description: null, model: null, validador: false, origem: 'projeto', ...d }])),
  config: { papeis, nativos },
  warnings: [],
});
const run = (lines, team) => {
  const { executions } = buildModel(lines, { team });
  return { executions, ...buildEdges(executions, { team }) };
};
const type = (r, a, b) => r.edges.find((e) => e.from === a && e.to === b)?.type;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v12-qa-'));
const put = (root, rel, content) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return f;
};

// ---------- R15.1: ordem (1) REPROVADO, (2) nivel da config, (3) destino validador, (4) estreia ----------
const QA_DEF = { name: 'auditor', validador: true };

test('R15.1 (3): destino validador que estreou primeiro é avanço (dev -> auditor2); auditor REPROVADO -> dev é retorno (1)', () => {
  const team = mkTeam({ defs: [QA_DEF] });
  const r = run(
    [
      start('a1', 'auditor', 0), stop('a1', 'auditor', 10, { last_message: 'Resultado: REPROVADO' }),
      start('d1', 'dev', 11), stop('d1', 'dev', 20),
      start('a2', 'auditor', 21), stop('a2', 'auditor', 30, { last_message: 'Resultado: APROVADO' }),
    ],
    team,
  );
  assert.equal(type(r, 'a1', 'd1'), 'retorno'); // (1)
  assert.equal(type(r, 'd1', 'a2'), 'avanço'); // (3): sem ela seria retorno (nível 1 < 2)
  // contraprova: o mesmo cenário sem o time (auditor não é validador) vira retorno pelo nível de estreia (4)
  const sem = run(
    [
      start('a1', 'auditor', 0), stop('a1', 'auditor', 10),
      start('d1', 'dev', 11), stop('d1', 'dev', 20),
      start('a2', 'auditor', 21), stop('a2', 'auditor', 30),
    ],
    mkTeam(),
  );
  assert.equal(type(sem, 'd1', 'a2'), 'retorno');
});

test('R15.1 (1) vence (2): REPROVADO é retorno mesmo que o nivel da config dê avanço', () => {
  const team = mkTeam({ defs: [QA_DEF], papeis: { auditor: { nivel: 1 }, dev: { nivel: 9 } } });
  const r = run(
    [
      start('d1', 'dev', 0), stop('d1', 'dev', 10),
      start('a1', 'auditor', 11), stop('a1', 'auditor', 20, { last_message: 'Resultado: REPROVADO' }),
      start('d2', 'dev', 21), stop('d2', 'dev', 30),
    ],
    team,
  );
  assert.equal(type(r, 'a1', 'd2'), 'retorno'); // nivel(dev)=9 > nivel(auditor)=1 seria avanço
});

test('R15.1 (2) vence (3): nivel nos dois papéis decide mesmo com destino validador; só um com nivel cai em (3)/(4)', () => {
  const lines = [
    start('a1', 'auditor', 0), stop('a1', 'auditor', 10),
    start('d1', 'dev', 11), stop('d1', 'dev', 20),
    start('a2', 'auditor', 21), stop('a2', 'auditor', 30),
  ];
  const ambos = run(lines, mkTeam({ defs: [QA_DEF], papeis: { auditor: { nivel: 1 }, dev: { nivel: 2 } } }));
  assert.equal(type(ambos, 'd1', 'a2'), 'retorno'); // config: 1 < 2, apesar do destino ser validador
  const so1 = run(lines, mkTeam({ defs: [QA_DEF], papeis: { dev: { nivel: 2 } } }));
  assert.equal(type(so1, 'd1', 'a2'), 'avanço'); // só um com nivel: (3)
});

test('R16: dev que cita "Resultado: APROVADO" sem ser validador fica sem veredito, mesmo com verdict gravado pelo hook', () => {
  const team = mkTeam({ defs: [{ name: 'dba', validador: false }] });
  const { executions } = buildModel(
    [
      start('x', 'dba', 0), stop('x', 'dba', 5, { last_message: 'ok. Resultado: APROVADO' }),
      start('y', 'dba', 6), stop('y', 'dba', 9, { verdict: 'REPROVADO' }),
      start('z', 'sem-def', 10), stop('z', 'sem-def', 12, { last_message: 'Resultado: REPROVADO' }),
    ],
    { team },
  );
  assert.deepEqual(executions.map((e) => e.verdict), [null, null, null]);
});

test('R16: cor/validador da config com tipo errado não derruba; config validador:false vence a definição', () => {
  const team = mkTeam({ defs: [QA_DEF], papeis: { auditor: { validador: false } } });
  const { executions } = buildModel([start('a', 'auditor', 0), stop('a', 'auditor', 5, { last_message: 'Resultado: REPROVADO' })], { team });
  assert.equal(executions[0].verdict, null);
});

// ---------- R19 / segurança: dados hostis em roles ----------
test('describeRoles: nomes com HTML ficam como texto nos dados; cor da config sem contraste é ajustada com aviso', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const team = mkTeam({ papeis: { [evil]: { nome: '<b>x</b>', sigla: '<i>' }, planejador: { cor: '#F59E0B' } } });
  const { executions, levels } = run([start('a', evil, 0), stop('a', evil, 1), start('b', 'planejador', 2), stop('b', 'planejador', 3)], team);
  const warnings = [];
  const roles = describeRoles(executions, levels, team, warnings);
  const e = roles.find((r) => r.name === evil);
  assert.equal(e.nome, '<b>x</b>');
  assert.match(e.cor, /^#[0-9A-F]{6}$/i);
  const p = roles.find((r) => r.name === 'planejador');
  assert.notEqual(p.cor.toUpperCase(), '#F59E0B');
  assert.ok(warnings.some((w) => w.includes('#F59E0B') && w.includes('ajustada')));
});

// ---------- descoberta: segurança e bordas ----------
test('config: __proto__, constructor e prototype não poluem Object.prototype nem entram em papeis', () => {
  const p = tmp();
  put(p, '.claude/monitor.json', '{"papeis":{"__proto__":{"nome":"X","validador":true},"constructor":{"nome":"Y"},"prototype":{"nome":"Z"},"ok":{"nome":"Ok"}},"__proto__":{"polluted":1}}');
  const t = discoverTeam({ projectDir: p });
  assert.equal({}.polluted, undefined);
  assert.equal({}.nome, undefined);
  assert.equal({}.validador, undefined);
  assert.deepEqual(Object.keys(t.config.papeis), ['ok']);
});

test('descoberta: nenhum aviso contém caminho absoluto; pasta .md, FIFO e arquivo enorme são ignorados sem travar', () => {
  const p = tmp(), h = tmp();
  put(p, '.claude/agents/ok.md', '---\nname: ok\n---\n');
  put(p, '.claude/agents/sem-fm.md', 'texto');
  put(p, '.claude/agents/enorme.md', '---\nname: enorme\n---\n' + 'a'.repeat(300 * 1024));
  fs.mkdirSync(path.join(p, '.claude/agents/pasta.md'));
  try { execFileSync('mkfifo', [path.join(p, '.claude/agents/fifo.md')]); } catch {}
  put(p, '.claude/monitor.json', '{quebrado');
  const t = discoverTeam({ projectDir: p, homeDir: h, configPath: path.join(p, 'nao-existe.json') });
  assert.ok(t.defs.has('ok'));
  assert.ok(!t.defs.has('enorme') && !t.defs.has('sem-fm'));
  assert.ok(t.warnings.length >= 3);
  for (const w of t.warnings) {
    assert.ok(!w.includes(p) && !w.includes(h) && !w.includes(os.tmpdir()), `caminho absoluto em aviso: ${w}`);
  }
});

test('descoberta: nome longo e unicode vira definição e papel; description é cortada', () => {
  const p = tmp();
  const longo = 'auditor-' + 'x'.repeat(120);
  put(p, '.claude/agents/a.md', `---\nname: ${longo}\ndescription: ${'d'.repeat(1000)}\n---\n`);
  put(p, '.claude/agents/b.md', '---\nname: arquiteto-solução-ñandú\n---\n');
  const t = discoverTeam({ projectDir: p });
  assert.ok(t.defs.has(longo));
  assert.ok(t.defs.get(longo).description.length <= 300);
  assert.ok(t.defs.has('arquiteto-solução-ñandú'));
});

// ---------- servidor: homeDir e fixture ----------
async function flowOf(app) {
  const port = await app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/flow`);
    return { status: res.status, ctype: res.headers.get('content-type'), body: await res.json() };
  } finally {
    await app.close();
  }
}

test('createApp: sem homeDir não lê ~; com homeDir lê; com fixture ignora homeDir (R13)', async () => {
  const proj = tmp(), home = tmp();
  put(home, '.claude/agents/dba.md', '---\nname: dba\ndescription: DO-HOME\n---\n');
  put(home, '.claude/monitor.json', '{"papeis":{"dba":{"nome":"DoHome"}}}');
  const file = put(proj, '.monitor/events.jsonl', [start('a', 'dba', 0), stop('a', 'dba', 5)].join('\n') + '\n');
  const nomeDe = (b) => b.roles[0];

  const sem = await flowOf(createApp({ file }));
  assert.equal(nomeDe(sem.body).origem, 'inferido');
  assert.equal(nomeDe(sem.body).nome, 'Dba');

  const com = await flowOf(createApp({ file, homeDir: home }));
  assert.equal(nomeDe(com.body).origem, 'global');
  assert.equal(nomeDe(com.body).nome, 'DoHome');

  const fx = await flowOf(createApp({ fixture: file, homeDir: home }));
  assert.equal(nomeDe(fx.body).origem, 'inferido');
  assert.notEqual(nomeDe(fx.body).nome, 'DoHome');
  assert.ok(!JSON.stringify(fx.body.warnings).includes(home));
});

test('API: strings hostis saem como JSON e sem caminho do home em warnings', async () => {
  const proj = tmp(), home = tmp();
  put(proj, '.claude/monitor.json', JSON.stringify({ papeis: { '<script>x</script>': { nome: '<script>x</script>', sigla: '<<<' } } }));
  put(proj, '.claude/agents/x.md', '---\nname: <script>x</script>\ndescription: "<svg onload=1>"\n---\n');
  const file = put(proj, '.monitor/events.jsonl', [start('a', '<script>x</script>', 0), stop('a', '<script>x</script>', 5)].join('\n') + '\n');
  const r = await flowOf(createApp({ file, homeDir: home }));
  assert.match(r.ctype, /application\/json/);
  assert.equal(r.body.roles[0].description, '<svg onload=1>');
  assert.ok(![...r.body.warnings].some((w) => w.includes(home) || w.includes(proj)));
});
