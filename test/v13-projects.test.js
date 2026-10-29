// v1.3 (B1): descoberta de projetos. Estrutura falsa em pasta temporária; nunca lê o `~` real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readCwdFromHead, listTranscripts, projectName, projectId, abbreviateHome, disambiguate,
  createDiscoveryCache, discoverProjects, HEAD_BYTES,
} from '../src/projects.js';
import { STALE_MS, isLiveSession } from '../public/stale.js';

const mk = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-proj-')));
const ev = (sid, ts = '2026-10-29T10:00:00.000Z') =>
  JSON.stringify({ ts, event: 'SubagentStart', session_id: sid, agent_id: 'a1', agent_type: 'x' }) + '\n';

/** home falso + util para criar projetos e transcrições */
function world() {
  const root = mk();
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  let n = 0;
  const project = (dir, { events = ev('s1'), git } = {}) => {
    fs.mkdirSync(path.join(dir, '.monitor'), { recursive: true });
    if (events !== null) fs.writeFileSync(path.join(dir, '.monitor', 'events.jsonl'), events);
    if (git === 'file') fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /x/.git/worktrees/y\n');
    if (git === 'dir') fs.mkdirSync(path.join(dir, '.git'));
    return dir;
  };
  const transcript = (cwd, { slug = `slug-${n}`, body } = {}) => {
    const d = path.join(home, '.claude', 'projects', slug);
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, `t${n++}.jsonl`);
    fs.writeFileSync(f, body ?? JSON.stringify({ type: 'user', cwd }) + '\n');
    return f;
  };
  return { root, home, project, transcript };
}

test('stale.js: fonte única do limite e isLiveSession', () => {
  assert.equal(STALE_MS, 7200000);
  const now = Date.parse('2026-10-29T12:00:00Z');
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(isLiveSession({ running: 1, last_ts: at(1000) }, now), true);
  assert.equal(isLiveSession({ running: 1, last_ts: at(STALE_MS) }, now), true);
  assert.equal(isLiveSession({ running: 1, last_ts: at(STALE_MS + 1) }, now), false);
  assert.equal(isLiveSession({ running: 0, last_ts: at(1000) }, now), false);
});

test('readCwdFromHead: primeiro cwd válido; ignora linhas ruins; nunca lança', () => {
  const w = world();
  const f = path.join(w.root, 't.jsonl');
  fs.writeFileSync(f, 'lixo "cwd"\n' + JSON.stringify({ cwd: 'relativo' }) + '\n' + JSON.stringify({ cwd: '/a/b' }) + '\n' + JSON.stringify({ cwd: '/c' }) + '\n');
  assert.equal(readCwdFromHead(f), '/a/b');
  assert.equal(readCwdFromHead(path.join(w.root, 'nao-existe.jsonl')), null);
  assert.equal(readCwdFromHead(w.root), null); // diretório
});

test('readCwdFromHead: cwd depois de HEAD_BYTES não é achado (comportamento documentado)', () => {
  const w = world();
  const f = path.join(w.root, 'big.jsonl');
  const filler = JSON.stringify({ type: 'x', pad: 'z'.repeat(1000) }) + '\n';
  fs.writeFileSync(f, filler.repeat(Math.ceil(HEAD_BYTES / filler.length) + 2) + JSON.stringify({ cwd: '/tarde' }) + '\n');
  assert.equal(readCwdFromHead(f), null);
  // linha cortada pelo limite não é parseada
  const g = path.join(w.root, 'cut.jsonl');
  fs.writeFileSync(g, JSON.stringify({ cwd: '/inteiro-demais-para-caber' }) + '\n');
  assert.equal(readCwdFromHead(g, { maxBytes: 10 }), null);
  assert.equal(readCwdFromHead(g, { maxBytes: 4096 }), '/inteiro-demais-para-caber');
});

test('listTranscripts: só o 1º nível de cada slug; subagents/ fica de fora', () => {
  const w = world();
  const t = w.transcript('/x', { slug: 'a' });
  const sub = path.join(w.home, '.claude', 'projects', 'a', 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-1.jsonl'), JSON.stringify({ cwd: '/sub' }) + '\n');
  fs.writeFileSync(path.join(w.home, '.claude', 'projects', 'a', 'nota.txt'), 'x');
  assert.deepEqual(listTranscripts(w.home), [t]);
  assert.deepEqual(listTranscripts(null), []);
  assert.deepEqual(listTranscripts(path.join(w.root, 'nada')), []);
});

test('projectName: pasta; worktree (.git arquivo) => "pai · pasta"; .git diretório não é worktree', () => {
  const w = world();
  const plain = w.project(path.join(w.root, 'apps', 'meu app'), { git: 'dir' });
  const wt = w.project(path.join(w.root, 'ws', 'digisac', 'SD-2476'), { git: 'file' });
  assert.deepEqual(projectName(plain), { name: 'meu app', worktree: false });
  assert.deepEqual(projectName(wt), { name: 'digisac · SD-2476', worktree: true });
  assert.deepEqual(projectName(path.join(w.root, 'inexistente')), { name: 'inexistente', worktree: false });
});

test('projectId: estável, formato p + 12 hex, distinto por chave', () => {
  assert.match(projectId('/a/b'), /^p[0-9a-f]{12}$/);
  assert.equal(projectId('/a/b'), projectId('/a/b'));
  assert.notEqual(projectId('/a/b'), projectId('/a/c'));
});

test('abbreviateHome: só abrevia dentro do home (não confunde /home/xy com /home/x)', () => {
  assert.equal(abbreviateHome('/home/x', '/home/x'), '~');
  assert.equal(abbreviateHome('/home/x/a/b', '/home/x'), '~/a/b');
  assert.equal(abbreviateHome('/home/xy/a', '/home/x'), '/home/xy/a');
  assert.equal(abbreviateHome('/home/x/a', null), '/home/x/a');
  assert.equal(abbreviateHome('/home/x/a', '/home/x/'), '~/a');
});

test('disambiguate: nível 1 pela pasta pai; nível 2 pelo path; independe da ordem', () => {
  const mkp = (dir, worktree = false) => ({ name: path.basename(dir), dir, worktree, path: dir });
  const run = (list) => {
    disambiguate(list);
    return list.map((p) => p.name).sort();
  };
  const a = () => mkp('/h/clientes/app');
  const b = () => mkp('/h/interno/app');
  const solo = () => mkp('/h/x/solo');
  const r1 = run([a(), b(), solo()]);
  const r2 = run([solo(), b(), a()]);
  assert.deepEqual(r1, ['app (clientes)', 'app (interno)', 'solo']);
  assert.deepEqual(r1, r2);
  // mesmo pai de referência => nível 2 com o caminho abreviado
  const c = { name: 'app', dir: '/h1/z/app', worktree: false, path: '~/h1/z/app' };
  const d = { name: 'app', dir: '/h2/z/app', worktree: false, path: '~/h2/z/app' };
  disambiguate([c, d]);
  assert.equal(c.name, 'app (z) (~/h1/z/app)');
  assert.equal(d.name, 'app (z) (~/h2/z/app)');
  // worktree: o pai já está no nome; a referência é o avô
  const e = { name: 'p · t', dir: '/h/v1/p/t', worktree: true, path: '/h/v1/p/t' };
  const f = { name: 'p · t', dir: '/h/v2/p/t', worktree: true, path: '/h/v2/p/t' };
  disambiguate([e, f]);
  assert.deepEqual([e.name, f.name], ['p · t (v1)', 'p · t (v2)']);
});

test('discoverProjects: estrutura falsa completa (R21/R22)', () => {
  const w = world();
  const a = w.project(path.join(w.home, 'apps', 'digisac'));
  const wt = w.project(path.join(w.home, 'orca', 'workspaces', 'digisac', 'SD-2476'), { git: 'file' });
  const spaced = w.project(path.join(w.home, 'apps', 'Projeto Ação @1'));
  const semSessao = w.project(path.join(w.home, 'apps', 'vazio'), { events: 'lixo\n{"sem":"ts"}\n' });
  const semArquivo = path.join(w.home, 'apps', 'sem-eventos');
  fs.mkdirSync(semArquivo, { recursive: true });
  const dentroClaude = w.project(path.join(w.home, '.claude', 'scratch'));
  w.transcript(a); w.transcript(a); // cwd repetido: um item só
  w.transcript(wt, { slug: 'wt' });
  w.transcript(spaced);
  w.transcript(semSessao);
  w.transcript(semArquivo);
  w.transcript(dentroClaude);
  w.transcript(path.join(w.root, 'morto-nao-existe'));
  w.transcript('', { body: 'sem cwd nenhum\n' });
  // subagents/ ignorado: cwd só ali não vira projeto
  const outro = w.project(path.join(w.home, 'apps', 'so-subagent'));
  const sub = path.join(w.home, '.claude', 'projects', 'wt', 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-1.jsonl'), JSON.stringify({ cwd: outro }) + '\n');

  const { projects, warnings } = discoverProjects({ homeDir: w.home });
  const by = Object.fromEntries(projects.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(by).sort(), ['Projeto Ação @1', 'digisac', 'digisac · SD-2476']);
  assert.equal(by['digisac · SD-2476'].worktree, true);
  assert.equal(by['digisac'].worktree, false);
  assert.equal(by['digisac'].path, '~/apps/digisac');
  assert.equal(by['digisac · SD-2476'].path, '~/orca/workspaces/digisac/SD-2476');
  assert.equal(by['digisac'].file, path.join(a, '.monitor', 'events.jsonl'));
  for (const p of projects) {
    assert.match(p.id, /^p[0-9a-f]{12}$/);
    assert.equal(p.id, projectId(p.key));
  }
  assert.ok(!JSON.stringify({ projects, warnings }).includes('/.claude/'));
  // sem homeDir: nada de transcrições
  assert.deepEqual(discoverProjects({}).projects, []);
});

test('discoverProjects: cwd e repoDir como candidatos, deduplicados com as transcrições; symlink normaliza', () => {
  const w = world();
  const a = w.project(path.join(w.root, 'repo'));
  const link = path.join(w.root, 'link-repo');
  fs.symlinkSync(a, link);
  w.transcript(link);
  const r = discoverProjects({ homeDir: w.home, cwd: a, repoDir: link + path.sep + '.' });
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].projectDir, a);
  // scan: false ignora transcrições, mas cwd/repoDir valem
  assert.equal(discoverProjects({ homeDir: w.home, scan: false }).projects.length, 0);
  assert.equal(discoverProjects({ homeDir: w.home, scan: false, repoDir: a }).projects.length, 1);
  // candidato dentro de home/.claude é descartado, mesmo via cwd
  const d = w.project(path.join(w.home, '.claude', 'x'));
  assert.equal(discoverProjects({ homeDir: w.home, scan: false, cwd: d }).projects.length, 0);
});

test('discoverProjects: nomes repetidos recebem a pasta pai', () => {
  const w = world();
  const a = w.project(path.join(w.root, 'clientes', 'app'));
  const b = w.project(path.join(w.root, 'interno', 'app'));
  w.transcript(a);
  w.transcript(b);
  const names = discoverProjects({ homeDir: w.home }).projects.map((p) => p.name).sort();
  assert.deepEqual(names, ['app (clientes)', 'app (interno)']);
});

test('discoverProjects: files explícitos sempre entram (vazio/inexistente), fora de .monitor o nome é a pasta', () => {
  const w = world();
  const vazio = w.project(path.join(w.root, 'p1'), { events: '' });
  const inexistente = path.join(w.root, 'p2', '.monitor', 'events.jsonl');
  const solto = path.join(w.root, 'logs', 'eventos.jsonl');
  fs.mkdirSync(path.dirname(solto), { recursive: true });
  fs.writeFileSync(solto, ev('s'));
  const r = discoverProjects({
    homeDir: w.home, scan: false,
    files: [path.join(vazio, '.monitor', 'events.jsonl'), inexistente, solto, solto],
  });
  const by = Object.fromEntries(r.projects.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(by).sort(), ['logs', 'p1', 'p2']);
  assert.equal(by.logs.projectDir, null);
  assert.equal(by.p1.projectDir, vazio);
  assert.equal(by.logs.path, path.dirname(solto)); // fora do home: absoluto
});

test('discoverProjects: cache — transcrição com cwd não é relida; sem cwd só relê se crescer; sumidas são podadas', () => {
  const w = world();
  const a = w.project(path.join(w.root, 'a'));
  const t1 = w.transcript(a);
  const t2 = w.transcript('', { body: 'sem cwd\n' });
  const cache = createDiscoveryCache();
  const reads = [];
  const readHead = (f) => (reads.push(f), readCwdFromHead(f));
  const run = () => discoverProjects({ homeDir: w.home, cache, readHead });
  assert.equal(run().projects.length, 1);
  assert.deepEqual(reads.sort(), [t1, t2].sort());
  reads.length = 0;
  assert.equal(run().projects.length, 1);
  assert.deepEqual(reads, [], '2ª chamada não relê nada');
  // t2 cresce e passa a ter cwd: relê só t2
  const b = w.project(path.join(w.root, 'b'));
  fs.writeFileSync(t2, JSON.stringify({ cwd: b }) + '\n');
  assert.equal(run().projects.length, 2);
  assert.deepEqual(reads, [t2]);
  // t1 sumiu: sai do cache
  fs.rmSync(t1);
  run();
  assert.ok(!cache.transcripts.has(t1));
  // transcrição nova: só ela é lida
  reads.length = 0;
  const t3 = w.transcript(a);
  run();
  assert.deepEqual(reads, [t3]);
});

test('discoverProjects: hasSessions injetável; arquivo apagado sai na redescoberta', () => {
  const w = world();
  const a = w.project(path.join(w.root, 'a'));
  w.transcript(a);
  const calls = [];
  const r = discoverProjects({ homeDir: w.home, hasSessions: (f) => (calls.push(f), false) });
  assert.equal(r.projects.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(discoverProjects({ homeDir: w.home }).projects.length, 1);
  fs.rmSync(path.join(a, '.monitor', 'events.jsonl'));
  assert.equal(discoverProjects({ homeDir: w.home }).projects.length, 0);
});

test('discoverProjects: nunca lança com entradas absurdas', () => {
  assert.doesNotThrow(() =>
    discoverProjects({ homeDir: '/nao/existe/mesmo', cwd: '\0', repoDir: 42, files: [null, undefined, ''] }),
  );
});
