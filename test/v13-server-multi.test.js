// v1.3 (B2): servidor multi-projeto. Tudo em pasta temporária; nunca lê o `~` real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp, parseArgs, DEFAULT_PORT } from '../server.js';

const mk = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-multi-')));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const start = (sid, ago, agent = 'a1') =>
  JSON.stringify({ ts: iso(ago), event: 'SubagentStart', session_id: sid, agent_id: agent, agent_type: 'dev' }) + '\n';
const stop = (sid, ago, agent = 'a1') =>
  JSON.stringify({ ts: iso(ago), event: 'SubagentStop', session_id: sid, agent_id: agent, agent_type: 'dev', last_message: 'ok' }) + '\n';

function world() {
  const root = mk();
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  let n = 0;
  const project = (dir, events, { git } = {}) => {
    fs.mkdirSync(path.join(dir, '.monitor'), { recursive: true });
    if (events !== null) fs.writeFileSync(path.join(dir, '.monitor', 'events.jsonl'), events);
    if (git === 'file') fs.writeFileSync(path.join(dir, '.git'), 'gitdir: x\n');
    return path.join(dir, '.monitor', 'events.jsonl');
  };
  const transcript = (cwd) => {
    const d = path.join(home, '.claude', 'projects', `slug-${n}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `t${n++}.jsonl`), JSON.stringify({ cwd }) + '\n');
  };
  return { root, home, project, transcript };
}

async function withApp(opts, fn) {
  const app = createApp({ pollMs: 50, rediscoverMs: 150, ...opts });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base, app);
  } finally {
    await app.close();
  }
}
const getJson = async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json() };
};

function openSse(base) {
  const req = http.get(`${base}/api/stream`);
  const events = [];
  let waiters = [];
  let buf = '';
  const ready = new Promise((resolve) => {
    req.on('response', (res) => {
      res.setEncoding('utf8');
      resolve();
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (name) events.push({ name, data: JSON.parse(data) });
          waiters = waiters.filter((w) => !w());
        }
      });
    });
  });
  return {
    ready,
    events,
    /** espera um evento que satisfaça `pred` (desde o início) */
    until: (pred, ms = 2500) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout; recebidos: ${JSON.stringify(events)}`)), ms);
        const check = () => {
          const e = events.find(pred);
          if (e) {
            clearTimeout(t);
            resolve(e);
            return true;
          }
          return false;
        };
        if (!check()) waiters.push(check);
      }),
    close: () => req.destroy(),
  };
}

/** Mundo padrão: 3 projetos descobertos pelas transcrições (um deles worktree). */
function standard() {
  const w = world();
  const dig = path.join(w.home, 'apps', 'digisac');
  const wt = path.join(w.home, 'orca', 'workspaces', 'digisac', 'SD-2476');
  const mon = path.join(w.home, 'apps', 'monitor');
  w.project(dig, start('d1', 9e6) + stop('d1', 8.9e6) + start('d2', 8e6, 'b') + stop('d2', 7.9e6, 'b'));
  w.project(wt, start('w1', 5000), { git: 'file' }); // em andamento
  w.project(mon, start('m1', 4 * 3600e3)); // running mas sem término (> STALE_MS)
  for (const d of [dig, wt, mon]) w.transcript(d);
  return { ...w, dig, wt, mon };
}

test('parseArgs: --events repetível, MONITOR_EVENTS e padrões', () => {
  assert.deepEqual(parseArgs([], {}).files, []);
  assert.deepEqual(parseArgs(['--events', 'a', '--events=b', '--events', 'c'], {}).files, ['a', 'b', 'c']);
  assert.deepEqual(parseArgs([], { MONITOR_EVENTS: 'e.jsonl' }).files, ['e.jsonl']);
  assert.deepEqual(parseArgs(['--events', 'x'], { MONITOR_EVENTS: 'e.jsonl' }).files, ['x']);
  assert.equal(parseArgs(['--fixture', 'f.jsonl'], {}).fixture, 'f.jsonl');
  assert.equal(parseArgs([], {}).port, DEFAULT_PORT);
  assert.equal(parseArgs(['--port=0'], {}).port, 0);
  assert.throws(() => parseArgs(['--port', 'abc'], {}));
});

test('modo: createApp({}) e 1 arquivo = único; >=2 arquivos ou discover = multi; fixture sempre único', async () => {
  const w = world();
  const a = w.project(path.join(w.root, 'a'), start('s', 1000));
  const b = w.project(path.join(w.root, 'b'), start('s', 1000));
  assert.equal(createApp({}).mode, 'single');
  assert.equal(createApp({ file: a }).mode, 'single');
  assert.equal(createApp({ files: [a] }).mode, 'single');
  assert.equal(createApp({ files: [a, b] }).mode, 'multi');
  assert.equal(createApp({ discover: true, homeDir: w.home }).mode, 'multi');
  const fx = new URL('../fixtures/cenario-time-novo.jsonl', import.meta.url).pathname;
  const f = createApp({ fixture: fx, files: [a, b], discover: true, homeDir: w.home });
  assert.equal(f.mode, 'single');
  assert.equal(f.projects().length, 1);
});

test('/api/projects: descoberta, ordem R24, contagens, em andamento e caminhos abreviados', async () => {
  const w = standard();
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    const { status, body } = await getJson(`${base}/api/projects`);
    assert.equal(status, 200);
    assert.equal(body.mode, 'multi');
    assert.deepEqual(body.projects.map((p) => p.name), ['digisac · SD-2476', 'digisac', 'monitor']);
    const [wt, dig, mon] = body.projects;
    assert.deepEqual([wt.sessions, wt.running, wt.worktree, wt.path], [1, 1, true, '~/orca/workspaces/digisac/SD-2476']);
    assert.deepEqual([mon.sessions, mon.running, mon.worktree], [1, 0, false]); // sem término não conta
    assert.deepEqual([dig.sessions, dig.running, dig.path], [2, 0, '~/apps/digisac']);
    for (const p of body.projects) {
      assert.match(p.id, /^p[0-9a-f]{12}$/);
      assert.deepEqual(Object.keys(p), ['id', 'name', 'path', 'worktree', 'sessions', 'running', 'last_ts']);
    }
    assert.ok(Date.parse(wt.last_ts) > Date.parse(mon.last_ts));
  });
});

test('modo único: /api/projects sempre com 1 item (mesmo com arquivo inexistente); project desconhecido = 404', async () => {
  const w = world();
  const ghost = path.join(w.root, 'g', '.monitor', 'events.jsonl');
  await withApp({ file: ghost }, async (base) => {
    const { body } = await getJson(`${base}/api/projects`);
    assert.equal(body.mode, 'single');
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0].sessions, 0);
    assert.equal(body.projects[0].last_ts, null);
    assert.equal((await getJson(`${base}/api/sessions?project=pzzz`)).status, 404);
    assert.equal((await getJson(`${base}/api/flow?project=pzzz`)).status, 404);
    const ok = await getJson(`${base}/api/sessions?project=${body.projects[0].id}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.sessions, []);
  });
});

test('/api/sessions e /api/flow com project=: dados da fonte certa, mesmas chaves da v1.2, source.project', async () => {
  const w = standard();
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    const { body: list } = await getJson(`${base}/api/projects`);
    const dig = list.projects.find((p) => p.name === 'digisac');
    const wt = list.projects.find((p) => p.worktree);
    const s = await getJson(`${base}/api/sessions?project=${dig.id}`);
    assert.deepEqual(s.body.sessions.map((x) => x.session_id).sort(), ['d1', 'd2']);
    assert.deepEqual(Object.keys(s.body), ['sessions', 'source']);
    assert.deepEqual(s.body.source, {
      path: '~/apps/digisac/.monitor/events.jsonl', exists: true, fixture: null, project: dig.id,
    });
    const f = await getJson(`${base}/api/flow?project=${dig.id}&session=d2`);
    assert.equal(f.status, 200);
    assert.deepEqual(Object.keys(f.body), ['session', 'executions', 'edges', 'others', 'roles', 'warnings', 'source']);
    assert.equal(f.body.session.session_id, 'd2');
    assert.equal((await getJson(`${base}/api/flow?project=${wt.id}&session=d2`)).status, 404); // sessão de outro projeto
    // sem project: o mais recente
    const def = await getJson(`${base}/api/sessions`);
    assert.deepEqual(def.body.sessions.map((x) => x.session_id), ['w1']);
    assert.equal(def.body.source.project, wt.id);
    assert.equal((await getJson(`${base}/api/flow`)).body.session.session_id, 'w1');
    for (const bad of ['pzzz', '', '../x', 'p'.repeat(500)]) {
      const r = await getJson(`${base}/api/flow?project=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 404);
      assert.deepEqual(r.body, { error: 'projeto não encontrado' });
    }
  });
});

test('multi sem projetos: listas vazias e source nulo', async () => {
  const w = world();
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    assert.deepEqual((await getJson(`${base}/api/projects`)).body, { mode: 'multi', projects: [] });
    const s = await getJson(`${base}/api/sessions`);
    assert.deepEqual(s.body, { sessions: [], source: { path: null, exists: false, fixture: null, project: null } });
    const f = await getJson(`${base}/api/flow`);
    assert.equal(f.body.session, null);
    assert.deepEqual(f.body.source, { path: null, exists: false, fixture: null, project: null });
  });
});

test('multi restrito (2+ --events): sem descoberta; arquivos vazios entram; transcrições ignoradas', async () => {
  const w = standard();
  const a = w.project(path.join(w.root, 'solo-a'), start('a', 1000));
  const b = w.project(path.join(w.root, 'solo-b'), '');
  await withApp({ files: [a, b], homeDir: w.home }, async (base, app) => {
    assert.equal(app.mode, 'multi');
    const { body } = await getJson(`${base}/api/projects`);
    assert.deepEqual(body.projects.map((p) => [p.name, p.sessions]), [['solo-a', 1], ['solo-b', 0]]);
    assert.equal(body.projects[1].last_ts, null); // null por último
  });
});

test('cache do resumo: /api/projects não relê o arquivo quando nada mudou, e vê o append', async () => {
  const w = standard();
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    const first = (await getJson(`${base}/api/projects`)).body.projects.find((p) => p.name === 'monitor');
    assert.equal(first.sessions, 1);
    fs.appendFileSync(path.join(w.mon, '.monitor', 'events.jsonl'), start('m2', 100, 'z'));
    const again = (await getJson(`${base}/api/projects`)).body.projects.find((p) => p.name === 'monitor');
    assert.equal(again.sessions, 2);
    assert.equal(again.running, 1);
  });
});

test('SSE: update leva o project; projeto novo e removido emitem `projects` na redescoberta', async () => {
  const w = standard();
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    const { body } = await getJson(`${base}/api/projects`);
    const dig = body.projects.find((p) => p.name === 'digisac');
    const sse = openSse(base);
    try {
      await sse.ready;
      await wait(120);
      fs.appendFileSync(path.join(w.dig, '.monitor', 'events.jsonl'), start('d3', 10, 'q'));
      const up = await sse.until((e) => e.name === 'update' && e.data.project === dig.id);
      assert.ok(up.data.ts);
      assert.ok(!sse.events.some((e) => e.name === 'update' && e.data.project !== dig.id));
      // projeto novo
      const novo = path.join(w.home, 'apps', 'novo');
      w.project(novo, start('n1', 10));
      w.transcript(novo);
      const n = sse.events.filter((e) => e.name === 'projects').length;
      await sse.until((e) => e.name === 'projects' && sse.events.filter((x) => x.name === 'projects').length > n);
      assert.ok((await getJson(`${base}/api/projects`)).body.projects.some((p) => p.name === 'novo'));
      // arquivo apagado com o servidor rodando: update e depois sai da lista
      const gone = sse.events.length;
      fs.rmSync(path.join(novo, '.monitor', 'events.jsonl'));
      await sse.until((e) => e.name === 'projects' && sse.events.indexOf(e) >= gone);
      assert.ok(!(await getJson(`${base}/api/projects`)).body.projects.some((p) => p.name === 'novo'));
    } finally {
      sse.close();
    }
  });
});

test('redescoberta preguiçosa sem clientes: projeto novo aparece num request após rediscoverMs', async () => {
  const w = standard();
  await withApp({ discover: true, homeDir: w.home, rediscoverMs: 100 }, async (base, app) => {
    assert.equal((await getJson(`${base}/api/projects`)).body.projects.length, 3);
    const novo = path.join(w.home, 'apps', 'novo');
    w.project(novo, start('n1', 10));
    w.transcript(novo);
    assert.equal(app._debug().timers, 0);
    await wait(150);
    assert.equal((await getJson(`${base}/api/projects`)).body.projects.length, 4);
  });
});

test('watchers/timers: multi não usa fs.watch; nada ligado sem clientes; único mantém 1 fs.watch', async () => {
  const w = standard();
  await withApp({ discover: true, homeDir: w.home }, async (base, app) => {
    assert.deepEqual(app._debug(), { watchers: 0, timers: 0, clients: 0 });
    const sse = openSse(base);
    await sse.ready;
    await wait(50);
    assert.deepEqual(app._debug(), { watchers: 0, timers: 3, clients: 1 }); // poll + heartbeat + redescoberta
    sse.close();
    await wait(100);
    assert.deepEqual(app._debug(), { watchers: 0, timers: 0, clients: 0 });
  });
  await withApp({ file: path.join(w.dig, '.monitor', 'events.jsonl') }, async (base, app) => {
    const sse = openSse(base);
    await sse.ready;
    await wait(50);
    assert.equal(app._debug().watchers, 1);
    assert.equal(app._debug().timers, 2);
    sse.close();
    await wait(100);
    assert.deepEqual(app._debug(), { watchers: 0, timers: 0, clients: 0 });
  });
});

test('segurança: respostas não contêm /.claude/ nem o homeDir absoluto', async () => {
  const w = standard();
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    const { body } = await getJson(`${base}/api/projects`);
    const all = [JSON.stringify(body)];
    for (const p of body.projects) {
      all.push(JSON.stringify((await getJson(`${base}/api/sessions?project=${p.id}`)).body));
      all.push(JSON.stringify((await getJson(`${base}/api/flow?project=${p.id}`)).body));
    }
    for (const t of all) {
      assert.ok(!t.includes('/.claude/'), t);
      assert.ok(!t.includes(w.home), t);
    }
  });
});

test('nomes repetidos: sufixo com a pasta pai também na API', async () => {
  const w = world();
  const a = path.join(w.home, 'clientes', 'app');
  const b = path.join(w.home, 'interno', 'app');
  w.project(a, start('a', 1000));
  w.project(b, start('b', 2000));
  w.transcript(a);
  w.transcript(b);
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    const { body } = await getJson(`${base}/api/projects`);
    assert.deepEqual(body.projects.map((p) => p.name), ['app (clientes)', 'app (interno)']);
  });
});

test('projeto com config própria (R23): cada fonte usa o seu .claude/monitor.json', async () => {
  const w = world();
  const a = path.join(w.home, 'a');
  const b = path.join(w.home, 'b');
  w.project(a, JSON.stringify({ ts: iso(1000), event: 'SubagentStart', session_id: 's', agent_id: 'x', agent_type: 'papel-a' }) + '\n');
  w.project(b, JSON.stringify({ ts: iso(2000), event: 'SubagentStart', session_id: 's', agent_id: 'x', agent_type: 'papel-a' }) + '\n');
  fs.mkdirSync(path.join(b, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(b, '.claude', 'monitor.json'), JSON.stringify({ nativos: ['papel-a'] }));
  w.transcript(a);
  w.transcript(b);
  await withApp({ discover: true, homeDir: w.home }, async (base) => {
    const { body } = await getJson(`${base}/api/projects`);
    const roleOf = async (name) => {
      const id = body.projects.find((p) => p.name === name).id;
      return (await getJson(`${base}/api/flow?project=${id}`)).body.executions[0].role;
    };
    assert.equal(await roleOf('a'), 'papel-a');
    assert.equal(await roleOf('b'), 'outro');
  });
});
