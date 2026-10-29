// Sincronia entre o domínio (src/roles.js) e a apresentação do front (public/).
// Lê app.js, index.html e style.css como texto (o projeto não tem build nem DOM em teste).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEAM_ROLES } from '../src/roles.js';

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const js = pub('app.js'), html = pub('index.html'), css = pub('style.css');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const papeis = [...TEAM_ROLES, 'outro'];

// Corpo do objeto PAPEIS = { ... };
const corpo = (js.match(/const PAPEIS\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] ?? '';

test('app.js declara a tabela PAPEIS', () => {
  assert.ok(corpo.length > 0, 'const PAPEIS = {...} não encontrada em public/app.js');
});

for (const role of papeis) {
  const r = escRe(role);
  test(`papel "${role}" existe em PAPEIS, no <symbol> e no CSS`, () => {
    assert.match(corpo, new RegExp(`(^|[\\s,{])(['"]${r}['"]|${r})\\s*:\\s*\\{`), `PAPEIS sem chave ${role}`);
    assert.match(html, new RegExp(`<symbol\\s+id="i-${r}"`), `index.html sem <symbol id="i-${role}">`);
    assert.match(css, new RegExp(`\\.papel-${r}(?![\\w-])\\s*\\{`), `style.css sem regra .papel-${role}`);
  });
}

test('PAPEIS não tem papel que o domínio desconheça', () => {
  const chaves = [...corpo.matchAll(/(?:^|[\s,{])(?:'([\w-]+)'|"([\w-]+)"|([A-Za-z_]\w*))\s*:\s*\{/g)]
    .map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual([...chaves].sort(), [...papeis].sort());
});

test('todo <use href="#i-X"> do HTML aponta para um <symbol> existente', () => {
  const ids = new Set([...html.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<use\s+href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `símbolo ausente: ${m[1]}`);
});

test('a legenda tem o item "developer" oculto por padrão (R12)', () => {
  assert.match(html, /<span[^>]*data-papel="developer"[^>]*\shidden/);
});
