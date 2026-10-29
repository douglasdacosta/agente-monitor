// v1.3: nome das sessões (Orca > custom-title > ai-title > session_title). Nunca lê o ~ real: tudo em pasta temporária.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTitleResolver, readTranscriptTitles, collectHints } from '../src/titles.js';
import { createApp } from '../server.js';

const HAS_PY = spawnSync('python3', ['-I', '-c', 'import sqlite3']).status === 0;
const tmp = () => mkdtempSync(join(tmpdir(), 'titles-'));
const CLAUDE_SID = 'c6806eab-367e-4521-8db6-380b07e8f1f5';

/** Cria <home>/.config/orca/agent-session-journal.db com os registros dados. */
function makeOrcaDb(home, records) {
  const dir = join(home, '.config', 'orca');
  mkdirSync(dir, { recursive: true });
  const script = `
import sys, json, sqlite3
con = sqlite3.connect(sys.argv[1])
con.execute('CREATE TABLE agent_session_records (session_id TEXT PRIMARY KEY, record_json TEXT)')
for sid, rec in json.loads(sys.argv[2]).items():
    con.execute('INSERT INTO agent_session_records VALUES (?, ?)', (sid, json.dumps(rec)))
con.commit(); con.close()`;
  const r = spawnSync('python3', ['-I', '-c', script, join(dir, 'agent-session-journal.db'), JSON.stringify(records)]);
  assert.equal(r.status, 0, String(r.stderr));
  return dir;
}
const orcaRec = (claudeId, name) => ({
  conversationName: name,
  providerHandleChain: [{ handle: { provider: 'claude', sessionId: claudeId } }],
});

function makeTranscript(home, sid, lines, slug = '-proj-x') {
  const dir = join(home, '.claude', 'projects', slug);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${sid}.jsonl`);
  writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return f;
}
const ai = (t) => ({ type: 'ai-title', aiTitle: t, sessionId: 'x' });
const custom = (t) => ({ type: 'custom-title', customTitle: t, sessionId: 'x' });

test('transcrição: custom vence ai; última ocorrência vence', () => {
  const home = tmp();
  const f = makeTranscript(home, 's1', [ai('A1'), custom('C1'), ai('A2'), custom('C2'), ai('A3')]);
  assert.deepEqual(readTranscriptTitles(f), { custom: 'C2', ai: 'A3' });
  const g = makeTranscript(home, 's2', [ai('A1'), { type: 'user' }, ai('A2')]);
  assert.deepEqual(readTranscriptTitles(g), { custom: null, ai: 'A2' });
  rmSync(home, { recursive: true });
});

test('transcrição grande: só o final é lido', () => {
  const home = tmp();
  const filler = JSON.stringify({ type: 'user', message: 'x'.repeat(1000) });
  const f = makeTranscript(home, 'big', [ai('Antigo'), ...Array(8000).fill(filler), ai('Recente')]); // ~8 MB
  const t0 = Date.now();
  assert.equal(readTranscriptTitles(f).ai, 'Recente');
  assert.ok(Date.now() - t0 < 1000);
  // título só no começo de um arquivo grande: fora da janela de leitura, não é encontrado
  const g = makeTranscript(home, 'big2', [ai('SoNoInicio'), ...Array(8000).fill(filler)]);
  assert.equal(readTranscriptTitles(g).ai, null);
  rmSync(home, { recursive: true });
});

test('resolver: ai-title e custom-title via transcript_path e via busca por session_id', () => {
  const home = tmp();
  const f = makeTranscript(home, 'sA', [ai('IA')]);
  makeTranscript(home, 'sB', [ai('IA'), custom('Meu nome')], '-outro');
  const r = createTitleResolver({ homeDir: home });
  assert.deepEqual(r.resolve('sA', { transcriptPath: f }), { title: 'IA', titleSource: 'claude' });
  assert.deepEqual(r.resolve('sB', {}), { title: 'Meu nome', titleSource: 'claude' });
  assert.deepEqual(r.resolve('nada', {}), { title: null, titleSource: null });
  // atualiza (mtime+size mudam): o cache não segura título velho
  appendFileSync(f, JSON.stringify(custom('Renomeada')) + '\n');
  assert.equal(r.resolve('sA', { transcriptPath: f }).title, 'Renomeada');
  rmSync(home, { recursive: true });
});

test('resolver: transcript_path fora de ~/.claude/projects é ignorado', () => {
  const home = tmp();
  const outside = join(tmp(), 'x.jsonl');
  writeFileSync(outside, JSON.stringify(ai('Vazado')) + '\n');
  const r = createTitleResolver({ homeDir: home });
  assert.equal(r.resolve('sX', { transcriptPath: outside }).title, null);
  assert.equal(r.resolve('../x', {}).title, null);
  rmSync(home, { recursive: true });
});

test('resolver: sem homeDir só usa session_title do evento', () => {
  const r = createTitleResolver({});
  assert.deepEqual(r.resolve('s', { eventTitle: 'Do evento' }), { title: 'Do evento', titleSource: 'evento' });
  assert.deepEqual(r.resolve('s', {}), { title: null, titleSource: null });
  const off = createTitleResolver({ homeDir: tmp(), enabled: false });
  assert.equal(off.resolve('s', { eventTitle: 'E' }).titleSource, 'evento');
});

test('collectHints pega o último session_title, transcript_path e orca_session_id por sessão', () => {
  const h = collectHints([
    JSON.stringify({ session_id: 'a', session_title: 'T1' }),
    JSON.stringify({ session_id: 'a', session_title: 'T2', transcript_path: '/p.jsonl', orca_session_id: 'claude_1' }),
    'lixo',
    JSON.stringify({ session_id: 'b' }),
  ]);
  assert.deepEqual(h.get('a'), { eventTitle: 'T2', transcriptPath: '/p.jsonl', orcaId: 'claude_1' });
  assert.deepEqual(h.get('b'), {});
});

test('Orca > custom > ai > evento', { skip: !HAS_PY && 'python3 ausente' }, () => {
  const home = tmp();
  makeOrcaDb(home, { claude_1: orcaRec(CLAUDE_SID, 'Nome no Orca') });
  makeTranscript(home, CLAUDE_SID, [ai('IA'), custom('Custom')]);
  const hint = { eventTitle: 'Evento' };
  const r = createTitleResolver({ homeDir: home });
  assert.deepEqual(r.resolve(CLAUDE_SID, hint), { title: 'Nome no Orca', titleSource: 'orca' });
  // sem Orca: custom; depois ai; depois evento
  const home2 = tmp();
  makeTranscript(home2, 's', [ai('IA'), custom('Custom')]);
  assert.deepEqual(createTitleResolver({ homeDir: home2 }).resolve('s', hint), { title: 'Custom', titleSource: 'claude' });
  const home3 = tmp();
  makeTranscript(home3, 's', [ai('IA')]);
  assert.deepEqual(createTitleResolver({ homeDir: home3 }).resolve('s', hint), { title: 'IA', titleSource: 'claude' });
  assert.deepEqual(createTitleResolver({ homeDir: tmp() }).resolve('s', hint), { title: 'Evento', titleSource: 'evento' });
  for (const d of [home, home2, home3]) rmSync(d, { recursive: true });
});

test('Orca por orca_session_id do evento e orcaDataDir explícito; registro sem nome é ignorado', { skip: !HAS_PY && 'python3 ausente' }, () => {
  const home = tmp();
  const dir = makeOrcaDb(home, {
    claude_9: orcaRec('outro-id', 'Pelo id do Orca'),
    claude_8: { providerHandleChain: [{ handle: { provider: 'claude', sessionId: 'sem-nome' } }] },
  });
  const r = createTitleResolver({ homeDir: home, orcaDataDir: dir });
  assert.deepEqual(r.resolve('qualquer', { orcaId: 'claude_9' }), { title: 'Pelo id do Orca', titleSource: 'orca' });
  assert.equal(r.resolve('sem-nome', {}).title, null);
  rmSync(home, { recursive: true });
});

test('Orca: consulta limitada a 1 a cada 5 s e refeita quando o banco muda', { skip: !HAS_PY && 'python3 ausente' }, () => {
  const home = tmp();
  const dir = makeOrcaDb(home, { claude_1: orcaRec('s1', 'Um') });
  let t = 1_000_000;
  const r = createTitleResolver({ homeDir: home, now: () => t });
  assert.equal(r.resolve('s1', {}).title, 'Um');
  // adiciona registro (muda mtime) antes de 5 s: ainda não vê
  spawnSync('python3', ['-I', '-c', `
import sys, sqlite3, json
c = sqlite3.connect(sys.argv[1]); c.execute('INSERT INTO agent_session_records VALUES (?, ?)', ('claude_2', json.dumps({'conversationName': 'Dois', 'providerHandleChain': [{'handle': {'provider': 'claude', 'sessionId': 's2'}}]}))); c.commit(); c.close()`,
  join(dir, 'agent-session-journal.db')]);
  t += 1000;
  assert.equal(r.resolve('s2', {}).title, null);
  t += 5000;
  assert.equal(r.resolve('s2', {}).title, 'Dois');
  rmSync(home, { recursive: true });
});

test('falha do python não derruba: avisa uma vez e segue com transcrição', () => {
  const home = tmp();
  const dir = join(home, '.config', 'orca');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-session-journal.db'), 'isto não é um sqlite');
  makeTranscript(home, 's', [ai('IA')]);
  const warns = [];
  let t = 0;
  const r = createTitleResolver({ homeDir: home, onWarn: (m) => warns.push(m), now: () => (t += 10_000) });
  assert.deepEqual(r.resolve('s', {}), { title: 'IA', titleSource: 'claude' });
  appendFileSync(join(dir, 'agent-session-journal.db'), 'mais');
  r.resolve('s', {});
  assert.equal(warns.length, 1);
  rmSync(home, { recursive: true });
});

test('python3 ausente do PATH: segue sem Orca', () => {
  const home = tmp();
  makeTranscript(home, 's', [ai('IA')]);
  mkdirSync(join(home, '.config', 'orca'), { recursive: true });
  writeFileSync(join(home, '.config', 'orca', 'agent-session-journal.db'), 'x');
  const old = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const warns = [];
    const r = createTitleResolver({ homeDir: home, onWarn: (m) => warns.push(m) });
    assert.equal(r.resolve('s', {}).title, 'IA');
    assert.equal(warns.length, 1);
  } finally {
    process.env.PATH = old;
  }
  rmSync(home, { recursive: true });
});

// ---- API ----
async function withApp(opts, fn) {
  const app = createApp({ pollMs: 100, ...opts });
  const port = await app.listen(0);
  try {
    await fn(async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json());
  } finally {
    await app.close();
  }
}
function eventsIn(home, extra = {}) {
  const proj = join(home, 'proj');
  mkdirSync(join(proj, '.monitor'), { recursive: true });
  const file = join(proj, '.monitor', 'events.jsonl');
  const base = { ts: new Date().toISOString(), session_id: CLAUDE_SID, agent_id: 'a', agent_type: 'qa', ...extra };
  writeFileSync(
    file,
    [{ ...base, event: 'SubagentStart' }, { ...base, event: 'SubagentStop' }].map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  return file;
}

test('API: /api/sessions e /api/flow trazem title/titleSource e nenhum caminho absoluto', async () => {
  const home = tmp();
  const tpath = makeTranscript(home, CLAUDE_SID, [ai('Título IA')]);
  const file = eventsIn(home, { transcript_path: tpath, orca_session_id: 'claude_zzz' });
  await withApp({ file, homeDir: home }, async (get) => {
    const s = await get('/api/sessions');
    assert.equal(s.sessions[0].title, 'Título IA');
    assert.equal(s.sessions[0].titleSource, 'claude');
    const f = await get('/api/flow');
    assert.equal(f.session.title, 'Título IA');
    assert.equal(f.session.titleSource, 'claude');
    const body = JSON.stringify([s.sessions, f.session, f.warnings]);
    assert.ok(!body.includes(home) && !body.includes('transcript_path') && !body.includes('.jsonl'));
  });
  rmSync(home, { recursive: true });
});

test('API: titles:false e fixture não leem o home; session_title do evento continua valendo', async () => {
  const home = tmp();
  const tpath = makeTranscript(home, CLAUDE_SID, [ai('Título IA')]);
  const file = eventsIn(home, { transcript_path: tpath, session_title: 'Do evento' });
  await withApp({ file, homeDir: home, titles: false }, async (get) => {
    const s = await get('/api/sessions');
    assert.deepEqual([s.sessions[0].title, s.sessions[0].titleSource], ['Do evento', 'evento']);
  });
  await withApp({ fixture: new URL('../fixtures/cenario-time-novo.jsonl', import.meta.url).pathname, homeDir: home }, async (get) => {
    const s = await get('/api/sessions');
    const byId = Object.fromEntries(s.sessions.map((x) => [x.session_id, x]));
    assert.equal(byId['sess-time-novo-0001'].title, 'Painel do time novo');
    assert.equal(byId['sess-time-novo-0002'].titleSource, 'evento');
  });
  await withApp({ file: join(tmp(), 'nao-existe.jsonl') }, async (get) => {
    assert.deepEqual((await get('/api/sessions')).sessions, []);
  });
  rmSync(home, { recursive: true });
});

test('API: sessão sem nenhum título tem title null', async () => {
  const home = tmp();
  const file = eventsIn(home);
  await withApp({ file }, async (get) => {
    const s = (await get('/api/sessions')).sessions[0];
    assert.deepEqual([s.title, s.titleSource], [null, null]);
  });
  rmSync(home, { recursive: true });
});
