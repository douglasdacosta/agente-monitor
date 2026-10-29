// QA v1.3 (tarefa 35): descoberta e API com estrutura falsa própria (mkdtemp). Nunca lê o `~` real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.js';
import { discoverProjects, readCwdFromHead } from '../src/projects.js';

const mk = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-desc-')));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ago = 0) => new Date(Date.now() - ago).toISOString();
const ev = (sid, ago = 1000) =>
  JSON.stringify({ ts: iso(ago), event: 'SubagentStart', session_id: sid, agent_id: 'a1', agent_type: 'dev' }) + '\n' +
  JSON.stringify({ ts: iso(ago - 500), event: 'SubagentStop', session_id: sid, agent_id: 'a1', agent_type: 'dev', last_message: 'ok' }) + '\n';

function world() {
  const root = mk();
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  let n = 0;
  const project = (dir, events = ev('s' + n)) => {
    fs.mkdirSync(path.join(dir, '.monitor'), { recursive: true });
    if (events !== null) fs.writeFileSync(path.join(dir, '.monitor', 'events.jsonl'), events);
    return dir;
  };
  const transcript = (cwdOrRaw, { sub = false, raw = false } = {}) => {
    const d = path.join(home, '.claude', 'projects', `slug-${n}`, ...(sub ? ['abc', 'subagents'] : []));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `t${n++}.jsonl`), raw ? cwdOrRaw : JSON.stringify({ cwd: cwdOrRaw }) + '\n');
  };
  return { root, home, project, transcript };
}
const names = (r) => r.projects.map((p) => p.name).sort();

test('descoberta: subagents/ ignorado, worktree, nomes repetidos, ~/.claude, sem sessão, symlink, sem cwd, cwd morto', () => {
  const w = world();
  const a = w.project(path.join(w.root, 'a', 'app'));
  const b = w.project(path.join(w.root, 'b', 'app'));
  const wt = w.project(path.join(w.root, 'orca', 'digisac', 'SD-1'));
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /x\n');
  const sub = w.project(path.join(w.root, 'so-subagent'));
  const vazio = w.project(path.join(w.root, 'vazio'), '');
  const semsessao = w.project(path.join(w.root, 'semsessao'), '{"foo":1}\nlixo\n');
  const inClaude = w.project(path.join(w.home, '.claude', 'plugins', 'x'));
  const real = w.project(path.join(w.root, 'real dir é@x'));
  const link = path.join(w.root, 'link');
  fs.symlinkSync(real, link);
  const semcwd = w.project(path.join(w.root, 'semcwd'));
  const morto = path.join(w.root, 'morto');
  for (const d of [a, b, wt, inClaude, real, link, morto, vazio, semsessao]) w.transcript(d);
  w.transcript(sub, { sub: true });
  w.transcript(JSON.stringify({ type: 'x' }) + '\n' + JSON.stringify({ outro: 1 }) + '\n', { raw: true }); // sem cwd
  w.transcript('lixo{{{\n' + JSON.stringify({ cwd: 'relativo/x' }) + '\n', { raw: true }); // cwd relativo e linha inválida
  const r = discoverProjects({ homeDir: w.home });
  assert.deepEqual(names(r), ['app (a)', 'app (b)', 'digisac · SD-1', 'real dir é@x']);
  assert.equal(r.projects.filter((p) => p.name === 'real dir é@x').length, 1, 'symlink + realpath não duplica');
  for (const p of r.projects) assert.ok(!p.path.includes('/.claude/') && !p.path.startsWith(w.home), p.path);
  assert.ok(!r.projects.some((p) => p.projectDir === sub || p.projectDir === semcwd));
  assert.ok(!JSON.stringify(r).includes(path.join(w.home, '.claude')));
});

test('cwd depois de 64 KB: sem projeto, sem quebrar (comportamento documentado)', () => {
  const w = world();
  const p = w.project(path.join(w.root, 'longe'));
  const pad = JSON.stringify({ x: 'y'.repeat(1000) }) + '\n';
  w.transcript(pad.repeat(80) + JSON.stringify({ cwd: p }) + '\n', { raw: true });
  const file = path.join(w.home, '.claude', 'projects', 'slug-0', 't0.jsonl');
  assert.equal(readCwdFromHead(file), null);
  assert.deepEqual(discoverProjects({ homeDir: w.home }).projects, []);
});

test('API ponta a ponta: projeto novo aparece sem reiniciar + SSE projects; removido some; 404; chaves; caminhos', async () => {
  const w = world();
  const a = w.project(path.join(w.home, 'w', 'alpha'), ev('sa', 5000));
  w.transcript(a);
  const app = createApp({ discover: true, homeDir: w.home, cwd: w.root, repoDir: w.root, pollMs: 50, rediscoverMs: 150, titles: false });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const get = async (u) => {
    const r = await fetch(base + u);
    return { status: r.status, text: await r.text() };
  };
  const frames = [];
  const req = http.get(`${base}/api/stream`, (res) => {
    res.setEncoding('utf8');
    res.on('data', (c) => frames.push(c));
  });
  try {
    let l = JSON.parse((await get('/api/projects')).text);
    assert.equal(l.mode, 'multi');
    assert.deepEqual(l.projects.map((p) => p.name), ['alpha']);
    // projeto novo
    const b = w.project(path.join(w.home, 'w', 'beta'), ev('sb', 100));
    w.transcript(b);
    await wait(600);
    assert.ok(frames.join('').includes('event: projects'), 'SSE projects chegou');
    l = JSON.parse((await get('/api/projects')).text);
    assert.deepEqual(l.projects.map((p) => p.name), ['beta', 'alpha'], 'ordem por atividade');
    // 404
    for (const q of ['project=', 'project=pzzz', 'project=%00', 'project=' + 'x'.repeat(5000)]) {
      for (const u of ['sessions', 'flow']) assert.equal((await get(`/api/${u}?${q}`)).status, 404, `${u}?${q.slice(0, 20)}`);
    }
    // sem parametro = mais recente
    const def = JSON.parse((await get('/api/sessions')).text);
    assert.equal(def.source.project, l.projects[0].id);
    const flow = JSON.parse((await get('/api/flow')).text);
    assert.deepEqual(Object.keys(flow), ['session', 'executions', 'edges', 'others', 'roles', 'warnings', 'source']);
    assert.deepEqual(Object.keys(def), ['sessions', 'source']);
    for (const p of l.projects) {
      for (const u of ['sessions', 'flow']) {
        const t = (await get(`/api/${u}?project=${p.id}`)).text;
        assert.ok(!t.includes('/.claude/') && !t.includes(w.home), `${u} vaza caminho`);
      }
    }
    // removido some
    fs.rmSync(path.join(w.home, 'w', 'alpha', '.monitor'), { recursive: true });
    await wait(600);
    l = JSON.parse((await get('/api/projects')).text);
    assert.deepEqual(l.projects.map((p) => p.name), ['beta']);
    assert.equal((await get('/api/sessions?project=pnaoexiste000')).status, 404);
  } finally {
    req.destroy();
    await app.close();
  }
});

test('50 projetos falsos: lista completa, tempo razoável, 0 watchers, timers só com cliente SSE', async () => {
  const w = world();
  for (let i = 0; i < 50; i++) {
    const d = w.project(path.join(w.root, 'p', `proj${i}`), ev('s' + i, 1000 + i));
    w.transcript(d);
  }
  const t0 = Date.now();
  const app = createApp({ discover: true, homeDir: w.home, cwd: w.root, repoDir: w.root, titles: false });
  const tCreate = Date.now() - t0;
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.deepEqual(app._debug(), { watchers: 0, timers: 0, clients: 0 });
    const t1 = Date.now();
    const l = await (await fetch(`${base}/api/projects`)).json();
    assert.equal(l.projects.length, 50);
    const t2 = Date.now();
    const r = await fetch(`${base}/api/flow?project=${l.projects[7].id}`);
    assert.equal(r.status, 200);
    console.log(`# 50 projetos: createApp ${tCreate} ms, /api/projects ${t2 - t1} ms, flow ${Date.now() - t2} ms`);
    assert.ok(tCreate < 2000 && t2 - t1 < 1000);
    const req = http.get(`${base}/api/stream`, (res) => res.resume());
    await wait(200);
    const d = app._debug();
    assert.equal(d.watchers, 0);
    assert.equal(d.clients, 1);
    assert.ok(d.timers >= 2);
    req.destroy();
    await wait(300);
    assert.deepEqual(app._debug(), { watchers: 0, timers: 0, clients: 0 });
  } finally {
    await app.close();
  }
});

test('arquivo de eventos apagado com o servidor rodando (multi restrito): sem erro 500', async () => {
  const w = world();
  const a = w.project(path.join(w.root, 'a'));
  const b = w.project(path.join(w.root, 'b'));
  const app = createApp({ files: [path.join(a, '.monitor/events.jsonl'), path.join(b, '.monitor/events.jsonl')], pollMs: 50, titles: false });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const l = await (await fetch(`${base}/api/projects`)).json();
    fs.rmSync(path.join(a, '.monitor', 'events.jsonl'));
    await wait(200);
    for (const p of l.projects) for (const u of ['sessions', 'flow']) assert.ok((await fetch(`${base}/api/${u}?project=${p.id}`)).status < 500);
    const l2 = await (await fetch(`${base}/api/projects`)).json();
    assert.equal(l2.projects.length, 2); // explícitos permanecem (decisão do tech-lead)
  } finally {
    await app.close();
  }
});
