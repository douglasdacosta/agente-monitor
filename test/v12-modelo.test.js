// v1.2 (tarefa 23): paleta/hash, regras puras (R14, R16, R17), modelo, arestas (R15) e /api/flow com `roles` (R19).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE, fnv1a32, colorFor, fromHex, contrast, paletteIndex } from '../src/palette.js';
import { NATIVE_TYPES, isTeamType, isValidator, humanize, monogram, describeRoles } from '../src/roles.js';
import { buildModel } from '../src/model.js';
import { buildEdges } from '../src/edges.js';
import { EMPTY_TEAM, discoverTeam } from '../src/team.js';
import { createApp } from '../server.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIX = path.join(ROOT, 'fixtures');
const DIFERENTE = path.join(FIX, 'time-diferente', '.monitor', 'events.jsonl');
const SEM_DEFS = path.join(FIX, 'time-diferente-sem-definicoes.jsonl');
const SID = 'sess-time-dif-0001';

const team = (papeis = {}, { defs = [], nativos = [] } = {}) => ({
  defs: new Map(defs.map((d) => [d.name, { description: null, model: null, validador: false, origem: 'projeto', ...d }])),
  config: { papeis, nativos },
  warnings: [],
});
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ---------- paleta e hash ----------
test('fnv1a32: vetores do contrato e UTF-8', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  assert.equal(fnv1a32('é'), fnv1a32('é')); // 2 bytes UTF-8, não 1 code unit
  assert.notEqual(fnv1a32('é'), fnv1a32('e'));
  assert.ok(fnv1a32('x'.repeat(1000)) >= 0);
});

test('paleta: 12 cores na ordem do contrato, rgb e tint coerentes, AA sobre branco e sobre o tint', () => {
  assert.equal(PALETTE.length, 12);
  assert.deepEqual(PALETTE.map((p) => p.cor), [
    '#6D28D9', '#3F6212', '#BE185D', '#0369A1', '#4338CA', '#0F766E',
    '#A21CAF', '#1E3A8A', '#1D4ED8', '#701A75', '#155E75', '#7E22CE',
  ]);
  for (const p of PALETTE) {
    assert.equal(p.rgb, hex2rgb(p.cor).join(' '), p.cor);
    assert.match(p.tint, /^#[0-9A-F]{6}$/);
    assert.ok(contrast(hex2rgb(p.cor), [255, 255, 255]) >= 4.5, `${p.cor} sobre branco`);
    assert.ok(contrast(hex2rgb(p.cor), hex2rgb(p.tint)) >= 4.5, `${p.cor} sobre o tint`);
  }
  assert.ok(Object.isFrozen(PALETTE));
});

test('colorFor: índice = hash de name.trim().toLowerCase() % 12; valores da fixture time-diferente', () => {
  assert.equal(paletteIndex('dba'), 2);
  assert.equal(paletteIndex('arquiteto'), 5);
  assert.equal(paletteIndex('revisor-seguranca'), 11);
  assert.equal(paletteIndex('a'), 4);
  assert.equal(paletteIndex('foobar'), 4);
  assert.deepEqual(colorFor('dba'), { cor: '#BE185D', tint: '#FCE7F3', rgb: '190 24 93' });
  assert.equal(colorFor('arquiteto').cor, '#0F766E');
  assert.equal(colorFor('revisor-seguranca').cor, '#7E22CE');
  // determinismo e normalização
  assert.deepEqual(colorFor('  DBA '), colorFor('dba'));
  for (const n of ['x', 'qa', 'dev-backend', 'ação']) assert.equal(colorFor(n).cor, PALETTE[fnv1a32(n.trim().toLowerCase()) % 12].cor);
});

test('fromHex: cor da paleta mantém o tint da tabela; outra cor mistura 12% com branco', () => {
  assert.deepEqual(fromHex('#be185d'), { cor: '#BE185D', tint: '#FCE7F3', rgb: '190 24 93', ajuste: null });
  const x = fromHex('#111111'); // round(255 - (255-17)*0,12) = 226 = 0xE2
  assert.deepEqual(x, { cor: '#111111', tint: '#E2E2E2', rgb: '17 17 17', ajuste: null });
  assert.equal(fromHex('#FFF')?.cor.length, 7); // #RGB aceito
  assert.equal(fromHex('azul'), null);
  assert.equal(fromHex('#12345'), null);
});

test('fromHex: cor sem AA escurece em passos de 5% até 4,5:1 sobre branco e sobre o tint, com ajuste informado', () => {
  const r = fromHex('#F59E0B');
  assert.ok(r.ajuste);
  assert.equal(r.ajuste.de, '#F59E0B');
  assert.equal(r.ajuste.ratio, 2.1);
  assert.equal(r.ajuste.para, r.cor);
  assert.ok(contrast(hex2rgb(r.cor), [255, 255, 255]) >= 4.5);
  assert.ok(contrast(hex2rgb(r.cor), hex2rgb(r.tint)) >= 4.5);
  // primeiro passo que passa: k-1 não passaria
  const orig = hex2rgb('#F59E0B');
  const at = (k) => orig.map((c) => Math.round(c * (1 - 0.05 * k)));
  const k = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].find((n) => at(n).join(' ') === r.rgb);
  assert.ok(k > 1);
  const prev = fromHex('#' + at(k - 1).map((c) => c.toString(16).padStart(2, '0')).join(''));
  assert.equal(prev.ajuste !== null || contrast(at(k - 1), [255, 255, 255]) < 4.5, true);
  // amarelo puro e branco terminam (no limite, preto)
  for (const c of ['#FFFFFF', '#FFFF00', '#FFFFF0']) {
    const f = fromHex(c);
    assert.ok(contrast(hex2rgb(f.cor), [255, 255, 255]) >= 4.5, c);
  }
});

// ---------- R14 ----------
test('isTeamType (R14): nativos, plugin com ":" e nativos da config são outro; o resto é do time', () => {
  assert.deepEqual([...NATIVE_TYPES], ['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'output-style-setup', 'claude', 'outro']);
  for (const n of NATIVE_TYPES) assert.equal(isTeamType(n), false, n);
  for (const n of ['plugin:agente', 'a:b']) assert.equal(isTeamType(n), false, n);
  for (const n of [undefined, null, '', '  ', 42, {}]) assert.equal(isTeamType(n), false, String(n));
  for (const n of ['developer', 'dev-backend', 'qa', 'arquiteto', 'frontend-dev', 'explore']) assert.equal(isTeamType(n), true, n);
  assert.equal(isTeamType('meu-interno', team({}, { nativos: ['meu-interno'] })), false);
  assert.equal(isTeamType('meu-interno'), true);
});

// ---------- R16 ----------
test('isValidator (R16): config > definição > role qa', () => {
  assert.equal(isValidator('qa'), true);
  assert.equal(isValidator('dba'), false);
  const comDef = (validador) => team({}, { defs: [{ name: 'x', validador }] });
  assert.equal(isValidator('x', comDef(true)), true);
  assert.equal(isValidator('x', comDef(false)), false);
  // config vence a definição, nos dois sentidos
  assert.equal(isValidator('x', team({ x: { validador: false } }, { defs: [{ name: 'x', validador: true }] })), false);
  assert.equal(isValidator('x', team({ x: { validador: true } }, { defs: [{ name: 'x', validador: false }] })), true);
  // definição vence o nome: `qa` com definição sem modelo de veredito não é validador
  assert.equal(isValidator('qa', team({}, { defs: [{ name: 'qa', validador: false }] })), false);
  assert.equal(isValidator('qa', team({ qa: { validador: false } })), false);
  assert.equal(isValidator('toString'), false); // sem protótipo vazando
});

// ---------- R17 ----------
test('humanize (R17): palavras por - _ espaço, inicial maiúscula, até 2 letras em maiúsculas', () => {
  const casos = {
    'dev-backend': 'Dev Backend', 'project-manager': 'Project Manager', qa: 'QA', dba: 'Dba',
    'revisor-seguranca': 'Revisor Seguranca', arquiteto: 'Arquiteto', 'tech_lead': 'Tech Lead',
    'especialista-em-acessibilidade': 'Especialista EM Acessibilidade', 'a  b': 'A B', '-x-': 'X', 'é-ação': 'É Ação',
  };
  for (const [k, v] of Object.entries(casos)) assert.equal(humanize(k), v, k);
  assert.equal(humanize('---'), '---'); // sem palavras: devolve o próprio nome
});

test('monogram (R17/spec 7.3): 2 iniciais ou 2 primeiras letras; 1 letra; grafemas', () => {
  const casos = {
    'dev-backend': 'DB', 'revisor-seguranca': 'RS', 'especialista-em-acessibilidade': 'EE', qa: 'QA', dba: 'DB',
    arquiteto: 'AR', x: 'X', 'a_b c': 'AB', 'ação': 'AÇ',
  };
  for (const [k, v] of Object.entries(casos)) assert.equal(monogram(k), v, k);
  assert.equal(monogram('👩‍💻x'), '👩‍💻X'); // grafema (emoji composto) conta como 1
  assert.equal(monogram('---'), '');
});

// ---------- modelo e arestas com time-diferente ----------
const pairs = (edges) => edges.map((e) => `${e.from}>${e.to}:${e.type}`);

test('time-diferente com definições: 7 nós, arestas e vereditos (23b)', () => {
  const t = discoverTeam({ projectDir: path.join(FIX, 'time-diferente') });
  const lines = fs.readFileSync(DIFERENTE, 'utf8');
  const { executions } = buildModel(lines, { team: t });
  const { nodes, edges, levels } = buildEdges(executions.filter((e) => e.session_id === SID), { team: t });
  assert.equal(nodes.length, 7);
  assert.deepEqual(Object.fromEntries(nodes.map((n) => [n.id, n.role])), {
    'x-arq1': 'arquiteto', 'x-dba1': 'dba', 'x-exp': 'outro', 'x-rev1': 'revisor-seguranca',
    'x-dba2': 'dba', 'x-rev2': 'revisor-seguranca', 'x-arq2': 'arquiteto',
  });
  assert.deepEqual(pairs(edges), [
    'x-arq1>x-dba1:avanço', 'x-arq1>x-exp:avanço', 'x-dba1>x-rev1:avanço', 'x-exp>x-rev1:avanço',
    'x-rev1>x-dba2:retorno', 'x-dba2>x-rev2:avanço', 'x-rev2>x-arq2:retorno',
  ]);
  assert.deepEqual(levels, { arquiteto: 1, dba: 2, 'revisor-seguranca': 3 });
  const v = Object.fromEntries(nodes.map((n) => [n.id, n.verdict]));
  assert.deepEqual(v, {
    'x-arq1': null, 'x-dba1': null, 'x-exp': null, 'x-rev1': 'REPROVADO', 'x-dba2': null, 'x-rev2': 'APROVADO', 'x-arq2': null,
  });
});

test('o dba que cita "Resultado: APROVADO" tem verdict null (R16), e passa a ter se virar validador na config', () => {
  const lines = fs.readFileSync(DIFERENTE, 'utf8');
  const citou = buildModel(lines).executions.filter((e) => e.role === 'dba' && /Resultado:\s*\**\s*APROVADO/i.test(e.last_message ?? ''));
  assert.ok(citou.length >= 1);
  for (const e of citou) assert.equal(e.verdict, null);
  const t = team({ dba: { validador: true } });
  assert.ok(buildModel(lines, { team: t }).executions.filter((e) => e.role === 'dba').some((e) => e.verdict !== null));
});

test('time-diferente-sem-definicoes: mesmos nós e arestas; revisor sem veredito (23c); validador na config devolve (23d)', () => {
  const lines = fs.readFileSync(SEM_DEFS, 'utf8');
  const run = (t) => {
    const { executions } = buildModel(lines, { team: t });
    return buildEdges(executions.filter((e) => e.session_id === SID), { team: t });
  };
  const sem = run(EMPTY_TEAM);
  const com = run(discoverTeam({ projectDir: path.join(FIX, 'time-diferente') }));
  assert.equal(sem.nodes.length, 7);
  assert.deepEqual(sem.nodes.map((n) => [n.id, n.role]), com.nodes.map((n) => [n.id, n.role]));
  assert.deepEqual(sem.nodes.filter((n) => n.role === 'revisor-seguranca').map((n) => n.verdict), [null, null]);
  // sem veredito, rev1 -> dba2 continua retorno pelo nível (revisor estreou depois do dba)
  assert.deepEqual(pairs(sem.edges).filter((p) => p.includes('x-rev1>')), ['x-rev1>x-dba2:retorno']);
  assert.equal(sem.edges.find((e) => e.from === 'x-rev2').type, 'retorno');
  const val = run(team({ 'revisor-seguranca': { validador: true } }));
  assert.deepEqual(val.nodes.filter((n) => n.role === 'revisor-seguranca').map((n) => n.verdict), ['REPROVADO', 'APROVADO']);
  assert.deepEqual(pairs(val.edges), pairs(com.edges));
});

test('nivel da config só vale quando os DOIS papéis têm nivel; senão cai nos níveis de estreia (R15)', () => {
  const lines = fs.readFileSync(SEM_DEFS, 'utf8');
  const run = (t) => {
    const { executions } = buildModel(lines, { team: t });
    return buildEdges(executions.filter((e) => e.session_id === SID), { team: t });
  };
  const tipo = (r, f, t) => r.edges.find((e) => e.from === f && e.to === t)?.type;
  // só um com nivel: ignorado (dba2 -> rev2 segue avanço)
  assert.equal(tipo(run(team({ dba: { nivel: 9 } })), 'x-dba2', 'x-rev2'), 'avanço');
  // os dois com nivel: dba(9) > revisor(1) inverte a seta dba2 -> rev2
  assert.equal(tipo(run(team({ dba: { nivel: 9 }, 'revisor-seguranca': { nivel: 1 } })), 'x-dba2', 'x-rev2'), 'retorno');
});

test('R15.1: destino validador é avanço; nivel da config vence; veredito REPROVADO da origem vence tudo', () => {
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const L = (o) => JSON.stringify({ session_id: 's', ...o, ts: new Date(t0 + o.s * 1000).toISOString() });
  // v (validador por config) estreia primeiro; depois dev, depois v2 (dev -> v2 teria retorno por nível)
  const lines = (v1) => [
    L({ s: 0, event: 'SubagentStart', agent_id: 'v1', agent_type: 'rev' }),
    L({ s: 5, event: 'SubagentStop', agent_id: 'v1', ...(v1 ? { verdict: v1 } : {}) }),
    L({ s: 10, event: 'SubagentStart', agent_id: 'd', agent_type: 'dev' }),
    L({ s: 15, event: 'SubagentStop', agent_id: 'd' }),
    L({ s: 20, event: 'SubagentStart', agent_id: 'v2', agent_type: 'rev' }),
  ];
  const run = (t, v1) => {
    const { executions } = buildModel(lines(v1), { team: t });
    return buildEdges(executions, { team: t });
  };
  const tipo = (r, f, to) => r.edges.find((e) => e.from === f && e.to === to)?.type;
  const val = { rev: { validador: true } };
  assert.equal(tipo(run(team({}), 'APROVADO'), 'd', 'v2'), 'retorno'); // rev não é validador: vale o nível (1 < 2)
  assert.equal(tipo(run(team(val), 'APROVADO'), 'd', 'v2'), 'avanço'); // (3) destino validador
  // validador sem nenhum veredito emitido (running/sem verdict) também conta: vem do time, não do veredito
  assert.equal(tipo(run(team(val)), 'd', 'v2'), 'avanço');
  // (2) nivel da config nos dois vence (3): dev(5) -> rev(1) é retorno mesmo com rev validador
  assert.equal(tipo(run(team({ rev: { validador: true, nivel: 1 }, dev: { nivel: 5 } }), 'APROVADO'), 'd', 'v2'), 'retorno');
  // e com nivel invertido a config também força avanço onde o nível de estreia daria retorno
  assert.equal(tipo(run(team({ rev: { nivel: 9 }, dev: { nivel: 5 } })), 'd', 'v2'), 'avanço');
  // (1) REPROVADO da origem validador vence tudo, inclusive nivel da config crescente
  assert.equal(tipo(run(team({ rev: { validador: true, nivel: 1 }, dev: { nivel: 5 } }), 'REPROVADO'), 'v1', 'd'), 'retorno');
  assert.equal(tipo(run(team({ rev: { validador: true, nivel: 1 }, dev: { nivel: 5 } }), 'REPROVADO'), 'v1', 'd'), 'retorno');
});

test('hideOthers não muda os níveis (calculados sobre todas as execuções) e nunca gera retorno com outro', () => {
  const { executions } = buildModel(fs.readFileSync(SEM_DEFS, 'utf8'));
  const mine = executions.filter((e) => e.session_id === SID);
  const a = buildEdges(mine);
  const b = buildEdges(mine, { hideOthers: true });
  assert.deepEqual(a.levels, b.levels);
  assert.ok(!('outro' in a.levels));
  assert.equal(b.nodes.some((n) => n.role === 'outro'), false);
});

test('papéis que estreiam no mesmo lote têm o mesmo nível e nenhuma seta entre eles', () => {
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const L = (o) => JSON.stringify({ session_id: 's', ...o, ts: new Date(t0 + o.s * 1000).toISOString() });
  const lines = [
    L({ s: 0, event: 'SubagentStart', agent_id: 'a', agent_type: 'alfa' }),
    L({ s: 0.1, event: 'SubagentStart', agent_id: 'b', agent_type: 'beta' }),
    L({ s: 10, event: 'SubagentStop', agent_id: 'a' }),
    L({ s: 11, event: 'SubagentStop', agent_id: 'b' }),
    L({ s: 20, event: 'SubagentStart', agent_id: 'c', agent_type: 'gama' }),
    L({ s: 30, event: 'SubagentStart', agent_id: 'a2', agent_type: 'alfa' }),
  ];
  const { executions } = buildModel(lines);
  const r = buildEdges(executions);
  assert.deepEqual(r.levels, { alfa: 1, beta: 1, gama: 2 });
  assert.equal(r.edges.some((e) => (e.from === 'a' && e.to === 'b') || (e.from === 'b' && e.to === 'a')), false);
});

// ---------- describeRoles ----------
test('describeRoles: ordem = ordem da config (null por último), nível, 1º start_ts, name', () => {
  const ex = (id, role, s) => ({ id, role, start_ts: `2026-01-01T00:00:${String(s).padStart(2, '0')}Z` });
  const execs = [ex('1', 'zeta', 0), ex('2', 'alfa', 1), ex('3', 'beta', 2), ex('4', 'outro', 3), ex('5', 'gama', 4), ex('6', 'zeta', 5)];
  const levels = { zeta: 1, alfa: 2, beta: 2, gama: 3 };
  assert.deepEqual(describeRoles(execs, levels, EMPTY_TEAM).map((r) => r.name), ['zeta', 'alfa', 'beta', 'gama']);
  const t = team({ gama: { ordem: 1 }, beta: { ordem: 0 } });
  assert.deepEqual(describeRoles(execs, levels, t).map((r) => r.name), ['beta', 'gama', 'zeta', 'alfa']);
  // empate total (mesmo nível e start_ts): por name
  const emp = [ex('1', 'b', 0), ex('2', 'a', 0)];
  assert.deepEqual(describeRoles(emp, { a: 1, b: 1 }).map((r) => r.name), ['a', 'b']);
  assert.deepEqual(describeRoles([], {}), []);
  assert.deepEqual(describeRoles([ex('1', 'outro', 0)], {}), []);
});

test('describeRoles: forma de cada papel, config sobre nome/sigla/cor e aviso de contraste', () => {
  const execs = [{ id: '1', role: 'dba', start_ts: '2026-01-01T00:00:00Z' }, { id: '2', role: 'sec', start_ts: '2026-01-01T00:00:01Z' }];
  const t = team(
    { dba: { nome: 'Banco', sigla: 'BD', cor: '#6d28d9', nivel: 7, ordem: 2 }, sec: { cor: '#F59E0B' } },
    { defs: [{ name: 'dba', description: 'desc', model: 'opus', origem: 'global' }] },
  );
  const w = [];
  const [dba, sec] = describeRoles(execs, { dba: 1, sec: 2 }, t, w);
  assert.deepEqual(dba, {
    name: 'dba', nome: 'Banco', sigla: 'BD', cor: '#6D28D9', tint: '#EDE9FE', rgb: '109 40 217',
    nivel: 1, nivelConfig: 7, ordem: 2, validador: false, origem: 'global', description: 'desc', model: 'opus',
  });
  assert.equal(sec.origem, 'inferido');
  assert.equal(sec.description, null);
  assert.equal(sec.ordem, null);
  assert.match(sec.cor, /^#[0-9A-F]{6}$/);
  assert.notEqual(sec.cor, '#F59E0B');
  assert.equal(w.length, 1);
  assert.equal(w[0], `config: papel "sec": cor #F59E0B tem contraste 2,1:1; ajustada para ${sec.cor}`);
  assert.match(sec.rgb, /^\d{1,3} \d{1,3} \d{1,3}$/);
});

test('a cor não depende do nome da config (hash usa o name)', () => {
  const execs = [{ id: '1', role: 'dba', start_ts: '2026-01-01T00:00:00Z' }];
  const [a] = describeRoles(execs, {}, team({ dba: { nome: 'Outro Nome' } }));
  assert.equal(a.cor, colorFor('dba').cor);
});

// ---------- config: sigla longa, #RGB e nativos ----------
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-v12-modelo-'));
}
function projeto(config) {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'monitor.json'), JSON.stringify(config));
  return dir;
}

test('config: sigla de 4+ caracteres usa os 3 primeiros e avisa; #RGB expande; nativos não são reestilizados', () => {
  const dir = projeto({
    papeis: {
      a: { sigla: ' ABCDE ' }, b: { sigla: 'ab' }, c: { cor: '#f0a' }, outro: { nome: 'X' }, Explore: { cor: '#111111' },
      meu: { nome: 'Meu' },
    },
    nativos: ['meu'],
  });
  const t = discoverTeam({ projectDir: dir });
  assert.equal(t.config.papeis.a.sigla, 'ABC');
  assert.equal(t.config.papeis.b.sigla, 'ab'); // exibida como veio
  assert.equal(t.config.papeis.c.cor, '#ff00aa');
  for (const n of ['outro', 'Explore', 'meu']) assert.equal(Object.hasOwn(t.config.papeis, n), false, n);
  assert.ok(t.warnings.includes('config: projeto monitor.json: papel "a": sigla "ABCDE" tem mais de 3 caracteres; usando "ABC"'));
  assert.ok(t.warnings.includes('config: papeis.outro ignorado: tipo nativo não pode ser reestilizado'));
  assert.equal(t.warnings.every((w) => !w.includes(dir)), true);
});

// ---------- API ----------
async function flow(opts, query = '') {
  const app = createApp({ pollMs: 100, ...opts });
  const port = await app.listen(0);
  try {
    return await (await fetch(`http://127.0.0.1:${port}/api/flow${query}`)).json();
  } finally {
    await app.close();
  }
}

test('api: /api/flow da fixture time-diferente devolve roles pelo contrato', async () => {
  const body = await flow({ file: DIFERENTE });
  assert.deepEqual(Object.keys(body), ['session', 'executions', 'edges', 'others', 'roles', 'warnings', 'source']);
  assert.equal(body.executions.length, 7);
  assert.equal(body.others, 1);
  assert.deepEqual(body.roles.map((r) => r.name), ['arquiteto', 'dba', 'revisor-seguranca']);
  assert.deepEqual(body.roles.map((r) => r.sigla), ['AR', 'DB', 'SEC']); // SEC vem da config do projeto
  assert.deepEqual(body.roles.map((r) => r.cor), ['#0F766E', '#BE185D', '#7E22CE']);
  assert.deepEqual(body.roles.map((r) => r.validador), [false, false, true]);
  assert.deepEqual(body.roles.map((r) => r.origem), ['projeto', 'projeto', 'projeto']);
  for (const r of body.roles) {
    assert.deepEqual(Object.keys(r), ['name', 'nome', 'sigla', 'cor', 'tint', 'rgb', 'nivel', 'nivelConfig', 'ordem', 'validador', 'origem', 'description', 'model']);
    assert.match(r.cor, /^#[0-9A-F]{6}$/);
    assert.match(r.tint, /^#[0-9A-F]{6}$/);
    assert.match(r.rgb, /^\d{1,3} \d{1,3} \d{1,3}$/);
  }
  assert.deepEqual(body.warnings, []);
  assert.equal(JSON.stringify(body.roles).includes(ROOT), false); // nada de caminho absoluto em roles
});

test('api: hideOthers não tira papéis de roles nem muda as arestas do time', async () => {
  const a = await flow({ file: DIFERENTE });
  const b = await flow({ file: DIFERENTE }, '?hideOthers=1');
  assert.deepEqual(a.roles, b.roles);
  assert.equal(b.executions.length, 6);
  assert.equal(b.others, 1);
});

test('api: fixture sem definições (22e): origem inferido, nunca global, mesmo com homeDir; revisor sem veredito', async () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'dba.md'), '---\nname: dba\ndescription: do home\n---\nResultado: APROVADO | REPROVADO\n');
  fs.writeFileSync(path.join(home, '.claude', 'monitor.json'), JSON.stringify({ papeis: { dba: { nome: 'DoHome' } } }));
  const body = await flow({ fixture: SEM_DEFS, homeDir: home });
  assert.equal(body.roles.length, 3);
  assert.deepEqual(body.roles.map((r) => r.origem), ['inferido', 'inferido', 'inferido']);
  assert.equal(body.roles.find((r) => r.name === 'dba').nome, 'Dba');
  assert.deepEqual(body.executions.filter((e) => e.role === 'revisor-seguranca').map((e) => e.verdict), [null, null]);
  assert.deepEqual(body.edges.map((e) => e.type).filter((t) => t === 'retorno').length, 2);
});

test('api: com homeDir (sem fixture) o global entra, e o projeto vence', async () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'dba.md'), '---\nname: dba\ndescription: do home\n---\n');
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'extra.md'), '---\nname: arquiteto\ndescription: do home\n---\n');
  // projeto temporário só com `arquiteto` definido: dba vem do global, arquiteto vence no projeto
  const proj = tmp();
  fs.mkdirSync(path.join(proj, '.monitor'));
  fs.mkdirSync(path.join(proj, '.claude', 'agents'), { recursive: true });
  fs.copyFileSync(DIFERENTE, path.join(proj, '.monitor', 'events.jsonl'));
  fs.writeFileSync(path.join(proj, '.claude', 'agents', 'arq.md'), '---\nname: arquiteto\ndescription: do projeto\n---\n');
  const body = await flow({ file: path.join(proj, '.monitor', 'events.jsonl'), homeDir: home });
  const by = Object.fromEntries(body.roles.map((r) => [r.name, r]));
  assert.equal(by.dba.origem, 'global');
  assert.equal(by.dba.description, 'do home');
  assert.equal(by.arquiteto.origem, 'projeto'); // projeto vence o global
  assert.equal(by.arquiteto.description, 'do projeto');
  assert.equal(by['revisor-seguranca'].origem, 'inferido');
});

test('api: --config valida e dá validador ao revisor da fixture sem definições (23d)', async () => {
  const dir = tmp();
  const cfg = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ papeis: { 'revisor-seguranca': { validador: true, nome: 'Seg', cor: '#F59E0B' } } }));
  const body = await flow({ fixture: SEM_DEFS, configPath: cfg });
  assert.deepEqual(body.executions.filter((e) => e.role === 'revisor-seguranca').map((e) => e.verdict), ['REPROVADO', 'APROVADO']);
  const rev = body.roles.find((r) => r.name === 'revisor-seguranca');
  assert.equal(rev.nome, 'Seg');
  assert.equal(rev.validador, true);
  assert.ok(body.warnings.some((w) => w.startsWith('config: papel "revisor-seguranca": cor #F59E0B tem contraste')));
  assert.equal(body.warnings.some((w) => w.includes(dir)), false);
});

test('api: sem sessões roles = [] (arquivo ausente)', async () => {
  const dir = tmp();
  const body = await flow({ file: path.join(dir, 'nada.jsonl') });
  assert.deepEqual(body.roles, []);
  assert.equal(body.session, null);
});

test('src/: nenhum nome de papel do time hardcoded (23a)', () => {
  const re = /'(project-manager|designer|tech-lead|dev-backend|dev-frontend|developer)'/;
  for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
    assert.equal(re.test(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')), false, f);
  }
});
