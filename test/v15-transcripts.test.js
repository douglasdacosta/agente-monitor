// v1.5 (tarefa 52 / B12): leitor de transcrições (cache, incremental, limites). Só diretórios temporários.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTranscriptReader } from '../src/transcripts.js';

const U = (i, cc, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: o });
const line = (id, u) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage: u } }) + '\n';

function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v15r-')));
  const root = path.join(home, '.claude', 'projects');
  const dir = path.join(root, 'p', 's', 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir, file: (id) => path.join(dir, `agent-${id}.jsonl`) };
}

test('projectsRoot null: nunca abre', () => {
  const c = setup();
  fs.writeFileSync(c.file('a'), line('m', U(1, 1, 1, 1)));
  const r = createTranscriptReader({ projectsRoot: null });
  assert.equal(r.read(c.file('a'), 'a'), null);
  assert.equal(r._opens(), 0);
});

test('incremental: lê só os bytes novos; cache sem abrir; linha parcial completa depois', () => {
  const c = setup();
  const f = c.file('a');
  const r = createTranscriptReader({ projectsRoot: c.root });
  fs.writeFileSync(f, line('m1', U(1, 2, 3, 4)));
  assert.equal(r.read(f, 'a').output, 4);
  assert.equal(r._opens(), 1);
  assert.equal(r.read(f, 'a').output, 4);
  assert.equal(r._opens(), 1); // cache
  const l2 = line('m2', U(1, 0, 0, 10));
  fs.appendFileSync(f, l2.slice(0, 20));
  assert.equal(r.read(f, 'a').output, 4); // parcial não conta (JSON inválido)
  fs.appendFileSync(f, l2.slice(20));
  const t = r.read(f, 'a');
  assert.deepEqual([t.input, t.output, t.messages], [2, 14, 2]);
  assert.equal(r._opens(), 3);
});

test('linha final sem \\n conta uma vez só, mesmo depois do \\n chegar (sem id)', () => {
  const c = setup();
  const f = c.file('a');
  const r = createTranscriptReader({ projectsRoot: c.root });
  const noId = JSON.stringify({ type: 'assistant', message: { usage: U(1, 0, 0, 1) } });
  fs.writeFileSync(f, noId);
  assert.equal(r.read(f, 'a').messages, 1);
  fs.appendFileSync(f, '\n');
  assert.equal(r.read(f, 'a').messages, 1);
});

test('chunkBytes pequeno: várias chamadas chegam ao mesmo resultado', () => {
  const c = setup();
  const f = c.file('a');
  const body = line('m1', U(1, 2, 3, 4)) + line('m2', U(5, 6, 7, 8));
  fs.writeFileSync(f, body);
  const r = createTranscriptReader({ projectsRoot: c.root, chunkBytes: 50 });
  let t;
  for (let i = 0; i < 20; i++) t = r.read(f, 'a');
  assert.deepEqual([t.input, t.cache_creation, t.cache_read, t.output, t.messages], [6, 8, 10, 12, 2]);
});

test('truncado/recriado recomeça do zero', () => {
  const c = setup();
  const f = c.file('a');
  const r = createTranscriptReader({ projectsRoot: c.root });
  fs.writeFileSync(f, line('m1', U(1, 1, 1, 100)) + line('m2', U(1, 1, 1, 100)));
  assert.equal(r.read(f, 'a').output, 200);
  fs.writeFileSync(f, line('x', U(1, 1, 1, 7)));
  assert.equal(r.read(f, 'a').output, 7);
  fs.rmSync(f);
  assert.equal(r.read(f, 'a'), null);
});

test('maior que maxBytes -> null sem abrir; fora da raiz / id errado -> null sem abrir', () => {
  const c = setup();
  const f = c.file('a');
  fs.writeFileSync(f, line('m1', U(1, 1, 1, 1)));
  const r = createTranscriptReader({ projectsRoot: c.root, maxBytes: 10 });
  assert.equal(r.read(f, 'a'), null);
  const r2 = createTranscriptReader({ projectsRoot: c.root });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v15o-')), 'subagents');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'agent-a.jsonl'), line('m', U(1, 1, 1, 1)));
  assert.equal(r2.read(path.join(out, 'agent-a.jsonl'), 'a'), null);
  assert.equal(r2.read('/etc/passwd', 'passwd'), null);
  assert.equal(r2.read(f, 'b'), null);
  assert.equal(r._opens() + r2._opens(), 0);
});

test('cache limitado a maxEntries', () => {
  const c = setup();
  const r = createTranscriptReader({ projectsRoot: c.root, maxEntries: 2 });
  for (const id of ['a', 'b', 'c']) {
    fs.writeFileSync(c.file(id), line('m', U(1, 1, 1, 1)));
    r.read(c.file(id), id);
  }
  assert.equal(r._size(), 2);
  r.read(c.file('a'), 'a'); // foi removida: reabre
  assert.equal(r._opens(), 4);
});
