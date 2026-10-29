// v1.4 (tarefa 43 / B8): GET /api/waits e config `alertas`. Tudo em pasta temporária; nunca lê o `~` real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.js';
import { parseAlertas, readAlertConfig, ALERT_DEFAULTS } from '../src/alert-config.js';

const mk = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-waits-')));
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const row = (sid, event, ago, extra = {}) => JSON.stringify({ ts: iso(ago), event, session_id: sid, ...extra }) + '\n';
const FIXTURE = new URL('../fixtures/esperas.jsonl', import.meta.url).pathname;

async function withApp(opts, fn) {
  const app = createApp({ pollMs: 100, ...opts });
  const port = await app.listen(0);
  try {
    await fn(`http://127.0.0.1:${port}`, app);
  } finally {
    await app.close();
  }
}
const getJson = async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json() };
};

function sse(base) {
  const req = http.get(`${base}/api/stream`);
  const events = [];
  let buf = '';
  const ready = new Promise((r) => req.on('response', () => setTimeout(r, 30)));
  req.on('response', (res) => {
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const b = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const n = /^event: (.+)$/m.exec(b)?.[1];
        const d = /^data: (.+)$/m.exec(b)?.[1];
        if (n) events.push({ name: n, data: JSON.parse(d) });
      }
    });
  });
  const until = async (pred, ms = 2000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const e = events.find(pred);
      if (e) return e;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout; ${JSON.stringify(events)}`);
  };
  return { ready, until, close: () => req.destroy() };
}

function three() {
  const root = mk();
  const files = ['alfa', 'beta', 'gama'].map((n) => {
    const dir = path.join(root, n);
    fs.mkdirSync(path.join(dir, '.monitor'), { recursive: true });
    return path.join(dir, '.monitor', 'events.jsonl');
  });
  fs.writeFileSync(files[0], row('a1', 'PreToolUse', 30_000, { tool_name: 'AskUserQuestion', resumo: 'Qual banco?', session_title: 'Sessão Alfa', cwd: '/segredo/cwd', transcript_path: '/segredo/t.jsonl' }));
  fs.writeFileSync(files[1], row('b1', 'Stop', 10_000));
  fs.writeFileSync(files[2], row('c1', 'UserPromptSubmit', 5000) + row('c1', 'PermissionRequest', 4000, { tool_name: 'Bash' }));
  return { root, files };
}

test('multi restrito com 3 projetos: esperas dos 3, título (ou null), ordem e contrato', async () => {
  const { files } = three();
  await withApp({ files }, async (base) => {
    const { status, body } = await getJson(`${base}/api/waits`);
    assert.equal(status, 200);
    assert.ok(Math.abs(Date.parse(body.now) - Date.now()) < 5000);
    assert.deepEqual(body.config, { vezMinutos: 2, expiraHoras: 24, som: false, vez_ms: 120000 });
    assert.deepEqual(body.warnings, []);
    assert.deepEqual(body.waits.map((w) => [w.session_id, w.kind, w.urgent]), [
      ['a1', 'pergunta', true],
      ['c1', 'permissao', true],
      ['b1', 'vez', false],
    ]);
    const a = body.waits[0];
    assert.deepEqual(Object.keys(a).sort(), ['agent_id', 'expires_at', 'id', 'kind', 'project', 'project_name', 'resumo', 'session_id', 'since', 'titleSource', 'title', 'urgent'].sort());
    assert.equal(a.resumo, 'Qual banco?');
    assert.equal(a.title, 'Sessão Alfa');
    assert.equal(a.titleSource, 'evento');
    assert.equal(body.waits[1].title, null);
    assert.equal(a.id, `${a.project}:a1:${a.since}`);
    const projs = (await getJson(`${base}/api/projects`)).body.projects;
    assert.equal(projs.find((p) => p.id === a.project).name, a.project_name);
    assert.equal(Date.parse(a.expires_at) - Date.parse(a.since) >= 24 * 3600e3, true);
  });
});

test('anexar linha num projeto NÃO selecionado emite update com o id dele em < 2 s e /api/waits reflete', async () => {
  const { files } = three();
  await withApp({ files }, async (base) => {
    const projs = (await getJson(`${base}/api/projects`)).body.projects;
    const beta = projs.find((p) => p.name === 'beta');
    const s = sse(base);
    try {
      await s.ready;
      const t0 = Date.now();
      fs.appendFileSync(files[1], row('b1', 'PreToolUse', 0, { tool_name: 'AskUserQuestion', resumo: 'Nova?' }));
      await s.until((e) => e.name === 'update' && e.data.project === beta.id);
      assert.ok(Date.now() - t0 < 2000);
      let w = (await getJson(`${base}/api/waits`)).body.waits.find((x) => x.session_id === 'b1');
      assert.deepEqual([w.kind, w.resumo], ['pergunta', 'Nova?']);
      fs.appendFileSync(files[1], row('b1', 'PostToolUse', 0, { tool_name: 'AskUserQuestion' }));
      await new Promise((r) => setTimeout(r, 300));
      w = (await getJson(`${base}/api/waits`)).body.waits.find((x) => x.session_id === 'b1');
      assert.equal(w, undefined);
    } finally {
      s.close();
    }
  });
});

test('privacidade: o JSON não contém transcript_path, cwd, /.claude/ nem o homeDir; títulos só do evento', async () => {
  const { files, root } = three();
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  await withApp({ files, homeDir: home, titles: false }, async (base) => {
    const txt = await (await fetch(`${base}/api/waits`)).text();
    assert.ok(txt.includes('a1'));
    for (const bad of ['transcript_path', '"cwd"', '/.claude/', home, '/segredo', root]) assert.ok(!txt.includes(bad), bad);
  });
});

test('somente leitura: POST/PUT/DELETE = 405 e não escreve nos eventos; query desconhecida é ignorada', async () => {
  const { files } = three();
  const before = fs.readFileSync(files[0], 'utf8');
  await withApp({ files }, async (base) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await fetch(`${base}/api/waits`, { method, body: '{}' });
      assert.equal(r.status, 405, method);
    }
    const r = await getJson(`${base}/api/waits?foo=1&project=nao-existe`);
    assert.equal(r.status, 200);
    assert.equal(r.body.waits.length, 3);
    const h = await fetch(`${base}/api/waits`, { method: 'HEAD' });
    assert.equal(h.status, 200);
  });
  assert.equal(fs.readFileSync(files[0], 'utf8'), before);
});

test('config alertas: arquivo --config muda vez_ms/urgência; inválido gera aviso sem caminho absoluto', async () => {
  const { files, root } = three();
  const cfg = path.join(root, 'monitor.json');
  fs.writeFileSync(cfg, JSON.stringify({ alertas: { vezMinutos: 0.1, expiraHoras: 1, som: true } })); // 6 s: b1 (10 s) já é urgente
  await withApp({ files, configPath: cfg }, async (base) => {
    const { body } = await getJson(`${base}/api/waits`);
    assert.deepEqual(body.config, { vezMinutos: 0.1, expiraHoras: 1, som: true, vez_ms: 6000 });
    assert.equal(body.waits.find((w) => w.session_id === 'b1').urgent, true);
    assert.equal(Date.parse(body.waits[0].expires_at) - Date.parse(body.waits[0].since) <= 3600e3 + 31_000, true);
  });
  fs.writeFileSync(cfg, JSON.stringify({ alertas: { vezMinutos: -1, som: 'sim' } }));
  await withApp({ files, configPath: cfg }, async (base) => {
    const { body } = await getJson(`${base}/api/waits`);
    assert.equal(body.config.vezMinutos, 2);
    assert.equal(body.config.som, false);
    assert.equal(body.warnings.length, 2);
    for (const w of body.warnings) assert.ok(!w.includes(root) && !w.includes('/tmp'), w);
  });
});

test('expiraHoras pequeno faz a espera sumir pela sessão sem eventos (R30)', async () => {
  const root = mk();
  const f = path.join(root, '.monitor', 'events.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, row('x', 'Stop', 2 * 3600e3));
  const cfg = path.join(root, 'monitor.json');
  fs.writeFileSync(cfg, JSON.stringify({ alertas: { expiraHoras: 1 } }));
  await withApp({ file: f, configPath: cfg }, async (base) => {
    assert.equal((await getJson(`${base}/api/waits`)).body.waits.length, 0);
  });
  await withApp({ file: f }, async (base) => {
    assert.equal((await getJson(`${base}/api/waits`)).body.waits.length, 1);
  });
});

test('--fixture esperas.jsonl devolve exatamente as esperas do critério 42, com títulos e a 9 discreta', async () => {
  await withApp({ fixture: FIXTURE }, async (base) => {
    const { body } = await getJson(`${base}/api/waits`);
    assert.deepEqual(body.waits.map((w) => Number(w.session_id.slice(4, 6))), [6, 10, 8, 4, 1, 9]);
    const by = (n) => body.waits.find((w) => w.session_id.startsWith(`esp-${String(n).padStart(2, '0')}-`));
    assert.equal(by(9).urgent, false);
    assert.equal(by(10).urgent, true);
    assert.equal(by(1).title, 'Pergunta aberta');
    assert.equal(by(1).titleSource, 'evento');
    assert.deepEqual(['pergunta', 'permissao', 'mcp', 'erro', 'vez', 'vez'], [by(1), by(4), by(6), by(8), by(9), by(10)].map((w) => w.kind));
    assert.equal(by(6).project_name, 'esperas.jsonl');
    // o relógio é do "agora": since da 9 a ~60 s
    assert.ok(Math.abs(Date.now() - Date.parse(by(9).since) - 60_000) < 5000);
  });
});

test('sem eventos (arquivo ausente): waits vazio', async () => {
  const root = mk();
  await withApp({ file: path.join(root, '.monitor', 'events.jsonl') }, async (base) => {
    const { status, body } = await getJson(`${base}/api/waits`);
    assert.equal(status, 200);
    assert.deepEqual(body.waits, []);
  });
});

test('/api/projects: sessões só de turno contam (R29) e a resposta mantém o formato', async () => {
  const { files } = three();
  await withApp({ files }, async (base) => {
    const { body } = await getJson(`${base}/api/projects`);
    assert.equal(body.mode, 'multi');
    for (const p of body.projects) assert.equal(p.sessions, 1);
  });
});

// ---- parseAlertas / readAlertConfig ----
test('parseAlertas: padrões, valores válidos e inválidos campo a campo com aviso', () => {
  assert.deepEqual(ALERT_DEFAULTS, { vezMinutos: 2, expiraHoras: 24, som: false });
  const w = [];
  assert.deepEqual(parseAlertas(undefined, 'x', (m) => w.push(m)), ALERT_DEFAULTS);
  assert.deepEqual(w, []);
  assert.deepEqual(parseAlertas({ vezMinutos: 0.5, expiraHoras: 48, som: true }, 'x', (m) => w.push(m)), { vezMinutos: 0.5, expiraHoras: 48, som: true });
  assert.deepEqual(w, []);
  for (const bad of [0, -1, '2', NaN, Infinity, null, [], {}, true]) {
    const ws = [];
    const r = parseAlertas({ vezMinutos: bad, expiraHoras: 6 }, 'global monitor.json', (m) => ws.push(m));
    assert.equal(r.vezMinutos, 2, String(bad));
    assert.equal(r.expiraHoras, 6);
    assert.equal(ws.length, 1);
    assert.ok(ws[0].includes('vezMinutos') && ws[0].includes('global monitor.json'));
  }
  const ws = [];
  assert.equal(parseAlertas({ som: 'sim' }, 'x', (m) => ws.push(m)).som, false);
  assert.equal(ws.length, 1);
  for (const bad of [5, 'x', [], null]) {
    const w2 = [];
    assert.deepEqual(parseAlertas(bad, 'x', (m) => w2.push(m)), ALERT_DEFAULTS);
    assert.equal(w2.length, 1);
  }
});

test('readAlertConfig: ordem home -> projeto -> --config, campo a campo; ausência silenciosa; nunca lança', () => {
  const home = mk();
  const proj = mk();
  const w = (dir, o) => {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'monitor.json'), typeof o === 'string' ? o : JSON.stringify(o));
  };
  assert.deepEqual(readAlertConfig({ homeDir: home, projectDir: proj }), { alertas: ALERT_DEFAULTS, warnings: [] });
  assert.deepEqual(readAlertConfig(), { alertas: ALERT_DEFAULTS, warnings: [] });
  w(home, { alertas: { vezMinutos: 5, som: true }, papeis: {} });
  w(proj, { alertas: { vezMinutos: 3 } });
  const cfg = path.join(home, 'x.json');
  fs.writeFileSync(cfg, JSON.stringify({ alertas: { expiraHoras: 12 } }));
  assert.deepEqual(readAlertConfig({ homeDir: home, projectDir: proj }).alertas, { vezMinutos: 3, expiraHoras: 24, som: true });
  assert.deepEqual(readAlertConfig({ homeDir: home, projectDir: proj, configPath: cfg }).alertas, { vezMinutos: 3, expiraHoras: 12, som: true });
  assert.deepEqual(readAlertConfig({ homeDir: home }).alertas, { vezMinutos: 5, expiraHoras: 24, som: true });
  // quebrado, não-objeto e --config ausente
  w(home, '{quebrado');
  let r = readAlertConfig({ homeDir: home });
  assert.deepEqual(r.alertas, ALERT_DEFAULTS);
  assert.equal(r.warnings.length, 1);
  assert.ok(!r.warnings[0].includes(home));
  w(home, '[1]');
  assert.deepEqual(readAlertConfig({ homeDir: home }), { alertas: ALERT_DEFAULTS, warnings: [] });
  r = readAlertConfig({ configPath: path.join(home, 'nao-existe.json') });
  assert.equal(r.warnings.length, 1);
  assert.ok(!r.warnings[0].includes(home));
  assert.deepEqual(readAlertConfig({ homeDir: '/nao/existe/mesmo' }).warnings, []);
});

test('nenhum child_process novo: só src/titles.js usa (e server.js/src/ não escrevem rotas novas)', () => {
  const root = new URL('..', import.meta.url).pathname;
  const files = ['server.js', ...fs.readdirSync(path.join(root, 'src')).map((f) => `src/${f}`)];
  const hits = files.filter((f) => /child_process/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(hits, ['src/titles.js']);
});
