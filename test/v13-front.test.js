// Teste estático do front (v1.3): nome da sessão (title) no seletor, tooltip, aria-live e largura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const js = pub('app.js'), css = pub('style.css');

test('seletor usa o título da sessão (com fallback para o código curto) e corta em 60 caracteres', () => {
  assert.match(js, /TITULO_MAX = 60/);
  assert.match(js, /tituloDe\(s\) \|\| \(s\?\.session_id \? s\.session_id\.slice\(0, 8\)/);
  assert.match(js, /function cortar[\s\S]*'…'/);
  assert.match(js, /const id = cortar\(nomeSessao\(s\)\)/);
});

test('option e select têm title com nome completo, origem e código; títulos sempre escapados', () => {
  assert.match(js, /<option value="\$\{esc\(s\.session_id\)\}" title="\$\{esc\(sessaoDica\(s\)\)\}">\$\{esc\(sessaoTexto\(s\)\)\}<\/option>/);
  assert.match(js, /Nome do Orca/);
  assert.match(js, /Título do Claude Code/);
  assert.match(js, /Sessão: \$\{id\}/);
  assert.match(js, /el\.sessao\.title = /);
  assert.doesNotMatch(js, /innerHTML[^\n]*\$\{(?:tituloDe|nomeSessao|cortar)\(/);
});

test('link "Nova sessão", resumo e aria-live usam o título', () => {
  assert.match(js, /el\.nova\.title = /);
  assert.match(js, /\$\('resumo-titulo'\)\.textContent = /);
  assert.match(js, /el\.anuncios\.textContent = \(tituloDe\(flow\.session\)/);
});

test('select limitado a 420px com reticências', () => {
  assert.match(css, /select\{[^}]*max-width:420px[^}]*text-overflow:ellipsis/);
});
