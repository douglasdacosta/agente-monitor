import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp, readEventLines } from '../server.js';

const FIX = new URL('../fixtures/', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));

async function withApp(opts, fn) {
  const app = createApp({ pollMs: 100, ...opts });
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

/** Abre o SSE e devolve {next(ms), close()}; next resolve com o próximo evento ou rejeita no timeout. */
function openSse(base) {
  const req = http.get(`${base}/api/stream`);
  const events = [];
  let waiter = null;
  let buf = '';
  const ready = new Promise((resolve) => {
    req.on('response', (res) => {
      res.setEncoding('utf8');
      resolve(res);
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block);
          if (ev) {
            events.push(ev[1]);
            waiter?.();
          }
        }
      });
    });
  });
  return {
    ready,
    next: (ms = 2500) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          waiter = null;
          reject(new Error('timeout aguardando evento SSE'));
        }, ms);
        const take = () => {
          if (!events.length) return;
          clearTimeout(t);
          waiter = null;
          resolve(events.shift());
        };
        waiter = take;
        take();
      }),
    close: () => req.destroy(),
  };
}

test('fixture: /api/sessions traz source e ordena pela mais recente', async () => {
  await withApp({ fixture: FIX + 'edge-cases.jsonl' }, async (base) => {
    const { status, body } = await getJson(`${base}/api/sessions`);
    assert.equal(status, 200);
    assert.equal(body.source.exists, true);
    assert.equal(body.source.fixture, 'edge-cases.jsonl');
    assert.equal(body.source.path, FIX + 'edge-cases.jsonl');
    assert.equal(body.sessions.length, 2);
    assert.ok(Date.parse(body.sessions[0].last_ts) >= Date.parse(body.sessions[1].last_ts));
  });
});

test('fixture cenario-usuario: /api/flow devolve 6 nós, 5 colunas e a aresta de retorno', async () => {
  await withApp({ fixture: FIX + 'cenario-usuario.jsonl' }, async (base) => {
    const { body } = await getJson(`${base}/api/flow`);
    assert.equal(body.executions.length, 6);
    assert.equal(new Set(body.executions.map((n) => n.batch)).size, 5);
    assert.equal(body.edges.length, 6);
    assert.equal(body.edges.filter((e) => e.type === 'retorno').length, 1);
    assert.equal(body.session.session_id, body.executions[0].session_id);
  });
});

test('/api/flow: sessão explícita, desconhecida (404) e hideOthers com contagem de outros', async () => {
  await withApp({ fixture: FIX + 'edge-cases.jsonl' }, async (base) => {
    const { body: s } = await getJson(`${base}/api/sessions`);
    const withOther = [];
    for (const sess of s.sessions) {
      const { body } = await getJson(`${base}/api/flow?session=${encodeURIComponent(sess.session_id)}`);
      assert.equal(body.session.session_id, sess.session_id);
      assert.ok(body.executions.every((n) => n.session_id === sess.session_id));
      if (body.others > 0) withOther.push(sess.session_id);
    }
    assert.ok(withOther.length > 0, 'a fixture deveria ter um agente "outro"');
    const id = encodeURIComponent(withOther[0]);
    const full = (await getJson(`${base}/api/flow?session=${id}`)).body;
    const hidden = (await getJson(`${base}/api/flow?session=${id}&hideOthers=1`)).body;
    assert.equal(hidden.others, full.others);
    assert.equal(hidden.executions.length, full.executions.length - full.others);
    assert.ok(hidden.executions.every((n) => n.role !== 'outro'));

    const nf = await getJson(`${base}/api/flow?session=nao-existe`);
    assert.equal(nf.status, 404);
  });
});

test('arquivo inexistente: lista vazia e source.exists=false, sem 500', async () => {
  const dir = tmp();
  const file = path.join(dir, 'nao-existe', 'events.jsonl');
  await withApp({ file }, async (base) => {
    const sess = await getJson(`${base}/api/sessions`);
    assert.equal(sess.status, 200);
    assert.deepEqual(sess.body.sessions, []);
    assert.equal(sess.body.source.exists, false);
    assert.equal(sess.body.source.fixture, null);
    const flow = await getJson(`${base}/api/flow`);
    assert.equal(flow.status, 200);
    assert.deepEqual(flow.body.executions, []);
    assert.deepEqual(flow.body.edges, []);
  });
  fs.rmSync(dir, { recursive: true });
});

test('readEventLines ignora última linha parcial, mas aceita JSON completo sem \\n final', () => {
  const dir = tmp();
  const f = path.join(dir, 'e.jsonl');
  fs.writeFileSync(f, '{"a":1}\n{"b":');
  assert.deepEqual(readEventLines(f).lines, ['{"a":1}']);
  fs.writeFileSync(f, '{"a":1}\n{"b":2}');
  assert.deepEqual(readEventLines(f).lines, ['{"a":1}', '{"b":2}']);
  assert.equal(readEventLines(path.join(dir, 'x')).exists, false);
  fs.rmSync(dir, { recursive: true });
});

test('SSE: emite update ao criar o arquivo e ao acrescentar linha (em até 2s)', async () => {
  const dir = tmp();
  const file = path.join(dir, 'events.jsonl');
  await withApp({ file }, async (base) => {
    const sse = openSse(base);
    try {
      await sse.ready;
      fs.writeFileSync(file, '{"ts":"2026-01-01T00:00:00Z","event":"PreToolUse","session_id":"s1","agent_type":"qa"}\n');
      assert.equal(await sse.next(), 'update');
      let sess = (await getJson(`${base}/api/sessions`)).body;
      assert.equal(sess.source.exists, true);
      assert.equal(sess.sessions.length, 1);

      fs.appendFileSync(file, '{"ts":"2026-01-01T00:00:05Z","event":"SubagentStart","session_id":"s1","agent_id":"a1","agent_type":"qa"}\n');
      assert.equal(await sse.next(), 'update');
      sess = (await getJson(`${base}/api/sessions`)).body;
      assert.equal(sess.sessions[0].running, 1);
    } finally {
      sse.close();
    }
  });
  fs.rmSync(dir, { recursive: true });
});

test('estático: index.html e módulos .js com Content-Type correto; sem path traversal', async () => {
  await withApp({ fixture: FIX + 'ao-vivo.jsonl' }, async (base) => {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /^text\/html/);
    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /^text\/javascript/);
    const css = await fetch(`${base}/style.css`);
    assert.match(css.headers.get('content-type'), /^text\/css/);
    // fetch normaliza ../, então usa http.get cru
    const status = await new Promise((resolve) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: '/..%2fserver.js' }, (r) => {
        r.resume();
        resolve(r.statusCode);
      });
    });
    assert.ok(status === 403 || status === 404);
    assert.equal((await fetch(`${base}/nada.js`)).status, 404);
    const post = await fetch(`${base}/api/sessions`, { method: 'POST' });
    assert.equal(post.status, 405);
  });
});

test('fixture: ts deslocados para o último evento ficar em ~agora, preservando intervalos', async () => {
  const { fixtureShiftMs, shiftLines } = await import('../server.js');
  const lines = [
    '{"ts":"2030-01-01T00:00:00.000Z","event":"A"}',
    'lixo',
    '{"ts":"2030-01-01T00:01:00.000Z","event":"B"}',
  ];
  const now = Date.parse('2026-06-01T12:00:00.000Z');
  const out = shiftLines(lines, fixtureShiftMs(lines, now));
  assert.equal(JSON.parse(out[2]).ts, '2026-06-01T12:00:00.000Z');
  assert.equal(JSON.parse(out[0]).ts, '2026-06-01T11:59:00.000Z');
  assert.equal(out[1], 'lixo');
  assert.equal(fixtureShiftMs([], now), 0);

  for (const f of ['ao-vivo', 'cenario-usuario', 'edge-cases']) {
    await withApp({ fixture: FIX + f + '.jsonl' }, async (base) => {
      const { body } = await getJson(`${base}/api/sessions`);
      const last = Math.max(...body.sessions.map((s) => Date.parse(s.last_ts)));
      assert.ok(Math.abs(Date.now() - last) < 5000, `${f}: último evento deveria estar em ~agora`);
    });
  }
});
