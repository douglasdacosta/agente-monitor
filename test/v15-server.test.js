// v1.5 (tarefa 52 / B12): tokens em /api/flow, leitura ao vivo e privacidade. Só diretórios temporários.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.js';

const FIXTURE = new URL('../fixtures/tokens.jsonl', import.meta.url).pathname;
const U = (i, cc, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: o });
const aline = (id, u) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage: u } }) + '\n';
const mk = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v15s-')));
const iso = (ago = 0) => new Date(Date.now() - ago).toISOString();
const row = (o, ago) => JSON.stringify({ ts: iso(ago), session_id: 's1', ...o }) + '\n';

async function withApp(opts, fn) {
  const app = createApp({ pollMs: 100, ...opts });
  const port = await app.listen(0);
  try {
    await fn(`http://127.0.0.1:${port}`, app);
  } finally {
    await app.close();
  }
}
const flow = async (base, q = '') => (await fetch(`${base}/api/flow${q}`)).json();

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
  const until = async (pred, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const e = events.find(pred);
      if (e) return e;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout; ${JSON.stringify(events)}`);
  };
  return { ready, until, events, close: () => req.destroy() };
}

test('fixture: números por execução e session.tokens de A, B e C; hideOthers não muda o total', async () => {
  await withApp({ fixture: FIXTURE }, async (base, app) => {
    const a = await flow(base, '?session=sess-tokens-0001');
    const by = Object.fromEntries(a.executions.map((e) => [e.id, e.tokens]));
    assert.equal(by['a-pm1'].count, 19206);
    assert.equal(by['a-pm1'].total, 61206);
    assert.equal(by['a-pm1'].source, 'event');
    assert.equal(by['a-des'].count, 48213);
    assert.equal(by['a-exp'].count, 1250000);
    assert.equal(by['a-be'], null);
    assert.equal(by['a-pm2'].count, 850);
    assert.equal(by['a-pm3'].count, 999950);
    assert.deepEqual(by['a-des'].models, ['claude-opus-5-5', 'claude-sonnet-5-5']);
    const t = a.session.tokens;
    assert.deepEqual([t.count, t.total, t.input, t.cache_creation, t.cache_read, t.output], [2318219, 8283219, 81, 2253600, 5965000, 64538]);
    assert.deepEqual([t.executions, t.with_data, t.without_data], [6, 5, 1]);
    assert.deepEqual(t.models, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
    const h = await flow(base, '?session=sess-tokens-0001&hideOthers=1');
    assert.ok(h.executions.length < a.executions.length);
    assert.deepEqual(h.session.tokens, t);
    const b = (await flow(base, '?session=sess-tokens-0002')).session.tokens;
    assert.deepEqual([b.count, b.with_data, b.without_data], [999, 1, 1]);
    const c = (await flow(base, '?session=sess-tokens-0003')).session.tokens;
    assert.deepEqual([c.count, c.total, c.with_data, c.without_data], [14000, 44500, 2, 0]);
    assert.equal(app._opens(), 0); // (e) --fixture nunca abre transcrição
  });
});

test('fixture com transcrição plantada no caminho derivado: não abre', async () => {
  const home = mk();
  const f = path.join(home, '.claude', 'projects', 'p', 's', 'subagents');
  fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(f, 'agent-a-be.jsonl'), aline('m', U(1, 1, 1, 1)));
  await withApp({ fixture: FIXTURE, homeDir: home }, async (base, app) => {
    const a = await flow(base, '?session=sess-tokens-0001');
    assert.equal(a.executions.find((e) => e.id === 'a-be').tokens, null);
    assert.equal(app._opens(), 0);
  });
});

function live() {
  const home = mk();
  const proj = mk();
  const sdir = path.join(home, '.claude', 'projects', 'p', 'sess', 'subagents');
  fs.mkdirSync(sdir, { recursive: true });
  const events = path.join(proj, 'events.jsonl');
  const tpath = path.join(home, '.claude', 'projects', 'p', 'sess.jsonl');
  return { home, sdir, events, tpath, f: (id) => path.join(sdir, `agent-${id}.jsonl`) };
}

test('running: número vem da transcrição e atualiza com update no SSE; sem mudança, sem update', async () => {
  const L = live();
  fs.writeFileSync(L.events,
    row({ event: 'PreToolUse', tool_use_id: 't1', agent_type: 'qa' }, 5000) +
    row({ event: 'SubagentStart', tool_use_id: 't1', agent_id: 'r1', agent_type: 'qa', transcript_path: L.tpath }, 4900));
  fs.writeFileSync(L.f('r1'), aline('m1', U(1, 10, 100, 5)));
  await withApp({ files: [L.events], homeDir: L.home, tokenPollMs: 300, titles: false }, async (base, app) => {
    const first = await flow(base);
    assert.equal(first.executions[0].tokens.count, 16);
    assert.equal(first.executions[0].tokens.source, 'transcript');
    const s = sse(base);
    await s.ready;
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(s.events.filter((e) => e.name === 'update').length, 0);
    fs.appendFileSync(L.f('r1'), aline('m2', U(2, 0, 0, 20)));
    const t0 = Date.now();
    await s.until((e) => e.name === 'update', 2300);
    assert.ok(Date.now() - t0 < 2300);
    assert.equal((await flow(base)).executions[0].tokens.count, 38);
    const n = s.events.filter((e) => e.name === 'update').length;
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(s.events.filter((e) => e.name === 'update').length, n);
    s.close();
  });
});

test('done sem campo: com transcrição vira número (transcript); sem transcrição, null; done com campo nunca abre', async () => {
  const L = live();
  const stopTokens = { input: 1, cache_creation: 2, cache_read: 3, output: 4, messages: 1, models: ['claude-opus-5-5'] };
  fs.writeFileSync(L.events,
    row({ event: 'SubagentStart', agent_id: 'd1', agent_type: 'qa', transcript_path: L.tpath }, 9000) +
    row({ event: 'SubagentStop', agent_id: 'd1', agent_type: 'qa' }, 8000) +
    row({ event: 'SubagentStart', agent_id: 'd2', agent_type: 'qa', transcript_path: L.tpath }, 7000) +
    row({ event: 'SubagentStop', agent_id: 'd2', agent_type: 'qa' }, 6000) +
    row({ event: 'SubagentStart', agent_id: 'd3', agent_type: 'qa', transcript_path: L.tpath }, 5000) +
    row({ event: 'SubagentStop', agent_id: 'd3', agent_type: 'qa', tokens: stopTokens }, 4000));
  fs.writeFileSync(L.f('d1'), aline('m', U(1, 1, 1, 1)));
  fs.writeFileSync(L.f('d3'), aline('m', U(9, 9, 9, 9)));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(L.f('d3'), old, old); // anterior ao Stop: não abre (BUG-3 só relê arquivo mais novo)
  await withApp({ files: [L.events], homeDir: L.home, titles: false }, async (base, app) => {
    const j = await flow(base);
    const by = Object.fromEntries(j.executions.map((e) => [e.id, e.tokens]));
    assert.equal(by.d1.source, 'transcript');
    assert.equal(by.d1.count, 3);
    assert.equal(by.d2, null);
    assert.equal(by.d3.source, 'event');
    assert.equal(by.d3.count, 7);
    assert.equal(app._opens(), 1); // só d1
    assert.equal(j.session.tokens.without_data, 1);
  });
});

test('caminho de evento fora de ~/.claude/projects ou de outro agente: não é lido; nenhum caminho nas respostas', async () => {
  const L = live();
  const out = path.join(mk(), 'subagents');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'agent-x1.jsonl'), aline('m', U(1, 1, 1, 1)));
  fs.writeFileSync(L.f('outro'), aline('m', U(1, 1, 1, 1)));
  fs.writeFileSync(L.events,
    row({ event: 'SubagentStart', agent_id: 'x1', agent_type: 'qa', transcript_path: '/etc/passwd', agent_transcript_path: path.join(out, 'agent-x1.jsonl') }, 5000) +
    row({ event: 'SubagentStart', agent_id: 'x2', agent_type: 'qa', agent_transcript_path: L.f('outro') }, 4000) +
    row({ event: 'SubagentStart', agent_id: 'x3', agent_type: 'qa', agent_transcript_path: '/etc/passwd' }, 3000));
  await withApp({ files: [L.events], homeDir: L.home, titles: false }, async (base, app) => {
    const txt = await (await fetch(`${base}/api/flow`)).text();
    assert.ok(JSON.parse(txt).executions.every((e) => e.tokens === null));
    assert.equal(app._opens(), 0);
    for (const u of ['/api/flow', '/api/sessions', '/api/projects', '/api/waits']) {
      const body = await (await fetch(base + u)).text();
      assert.ok(!/transcript_path|\/\.claude\/|subagents|\/etc\/passwd/.test(body), u);
    }
  });
});

test('BUG-3: evento com 1 mensagem e transcrição mais nova com 2 -> vale a transcrição, lida uma vez', async () => {
  const L = live();
  const ev = { input: 2, cache_creation: 21680, cache_read: 0, output: 85, messages: 1, models: ['claude-haiku-4-5'] };
  fs.writeFileSync(L.events,
    row({ event: 'SubagentStart', agent_id: 'h1', agent_type: 'qa', transcript_path: L.tpath }, 9000) +
    row({ event: 'SubagentStop', agent_id: 'h1', agent_type: 'qa', tokens: ev }, 8000) +
    row({ event: 'SubagentStart', agent_id: 'h2', agent_type: 'qa', transcript_path: L.tpath }, 7000) +
    row({ event: 'SubagentStop', agent_id: 'h2', agent_type: 'qa', tokens: ev }, 6000) +
    row({ event: 'SubagentStart', agent_id: 'h3', agent_type: 'qa', transcript_path: L.tpath }, 5000) +
    row({ event: 'SubagentStop', agent_id: 'h3', agent_type: 'qa', tokens: ev }, 4000));
  // h1: transcrição com 2 mensagens, mtime posterior ao Stop. h2: mesma quantidade (empate). h3: mtime anterior ao Stop.
  fs.writeFileSync(L.f('h1'), aline('m1', U(2, 21680, 0, 85)) + aline('m2', U(2, 6417, 21680, 8)));
  fs.writeFileSync(L.f('h2'), aline('m1', U(9, 9, 9, 9)));
  fs.writeFileSync(L.f('h3'), aline('m1', U(2, 1, 1, 1)) + aline('m2', U(2, 1, 1, 1)));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(L.f('h3'), old, old);
  await withApp({ files: [L.events], homeDir: L.home, titles: false }, async (base, app) => {
    const by = async () => Object.fromEntries((await flow(base)).executions.map((e) => [e.id, e.tokens]));
    const a = await by();
    assert.equal(a.h1.source, 'transcript');
    assert.equal(a.h1.messages, 2);
    assert.equal(a.h1.count, 4 + 28097 + 93);
    assert.equal(a.h1.cache_read, 21680);
    assert.equal(a.h2.source, 'event'); // empate: fica o do evento
    assert.equal(a.h2.count, 2 + 21680 + 85);
    assert.equal(a.h3.source, 'event'); // arquivo mais antigo que o Stop: nem lê
    const opens = app._opens();
    await by();
    await by();
    assert.equal(app._opens(), opens); // cache: sem releitura por requisição
    const txt = JSON.stringify(await flow(base));
    assert.ok(!/transcript_path|\/\.claude\/|subagents/.test(txt));
  });
});

test('BUG-3: em --fixture não relê nada', async () => {
  await withApp({ fixture: FIXTURE }, async (base, app) => {
    const a = await flow(base, '?session=sess-tokens-0001');
    assert.equal(a.executions.find((e) => e.id === 'a-pm1').tokens.source, 'event');
    assert.equal(app._opens(), 0);
  });
});
