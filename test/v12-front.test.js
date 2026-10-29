// Teste estático do front (v1.2): lê public/ como texto (o projeto não tem build nem DOM em teste).
// Garante que o cliente não tem tabela/classes/símbolos por papel: a apresentação vem de `roles` (/api/flow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const js = pub('app.js'), html = pub('index.html'), css = pub('style.css');
const simbolos = new Set([...html.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1]));

test('app.js não tem a tabela PAPEIS nem iconeDoPapel', () => {
  assert.doesNotMatch(js, /\bPAPEIS\b/);
  assert.doesNotMatch(js, /iconeDoPapel/);
});

test('não há <symbol> de papel além de i-outro', () => {
  const papeis = [...simbolos].filter((id) => /^i-(project-manager|designer|developer|tech-lead|dev-backend|dev-frontend|qa)$/.test(id));
  assert.deepEqual(papeis, []);
  assert.ok(simbolos.has('i-outro'));
});

test('todo <use href="#i-X"> (HTML e app.js) aponta para um símbolo existente', () => {
  for (const src of [html, js]) {
    for (const m of src.matchAll(/<use\s+href="#([^"$]+)"/g)) assert.ok(simbolos.has(m[1]), `símbolo ausente: ${m[1]}`);
  }
});

test('style.css só tem .papel-outro e .papel-time, sem tokens por papel', () => {
  const classes = new Set([...css.matchAll(/\.papel-([\w-]+)/g)].map((m) => m[1]));
  for (const c of classes) assert.ok(['outro', 'time'].includes(c), `classe .papel-${c} não permitida`);
  assert.doesNotMatch(css, /--(pm|des|tl|be|fe|qa)(-tint)?\s*:/);
});

test('nenhum nome de papel do time em public/ (exceto outro)', () => {
  for (const [n, src] of [['app.js', js], ['index.html', html], ['style.css', css]]) {
    assert.doesNotMatch(src, /project-manager|tech-lead|dev-backend|dev-frontend/, n);
  }
});

test('existe #legenda-papeis e app.js aplica as cores por variáveis CSS', () => {
  assert.match(html, /id="legenda-papeis"/);
  assert.match(js, /\$\('legenda-papeis'\)/);
  for (const v of ['--role', '--tint', '--role-rgb']) assert.ok(js.includes(`'${v}'`), `app.js sem ${v}`);
});
