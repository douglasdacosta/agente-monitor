// Teste estático do front v1.3 (vários projetos): contrato com a API, escape de texto do usuário e estrutura do cabeçalho.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const js = pub('app.js'), html = pub('index.html'), css = pub('style.css');

test('STALE_MS vem de ./stale.js (fonte única), sem constante local', () => {
  assert.match(js, /^import \{ STALE_MS \} from '\.\/stale\.js';$/m);
  assert.doesNotMatch(js, /const STALE_MS\b/);
});

test('usa /api/projects, o project= só no modo multi e a chave monitor.project', () => {
  assert.match(js, /getJson\('\/api\/projects'\)/);
  assert.match(js, /PROJ_KEY = 'monitor\.project'/);
  assert.match(js, /project=\$\{encodeURIComponent\(state\.project\)\}/);
  assert.match(js, /multi\(\) && state\.project \?/); // modo único nunca manda project=
  assert.match(js, /includes\('404'\)[\s\S]{0,80}mode: 'single'/); // servidor antigo = modo único
});

test('SSE: trata "projects" e o project do "update"', () => {
  assert.match(js, /es\.addEventListener\('projects', scheduleProjects\)/);
  assert.match(js, /es\.addEventListener\('update', \(ev\) =>/);
  assert.match(js, /JSON\.parse\(ev\.data\)\?\.project/);
});

test('troca de projeto com debounce de 300ms; painel aberto adia a troca automática', () => {
  assert.match(js, /projDebounce = setTimeout\([\s\S]*?\}, 300\);/);
  assert.match(js, /state\.openId && alvo && ids\.has\(alvo\) && alvo !== topo/);
  assert.match(js, /--header-h/);
  assert.match(js, /new ResizeObserver/);
});

test('name/path (vêm do usuário) só entram em HTML por esc()', () => {
  const linhas = js.split('\n').filter((l) => /innerHTML|<option|<code>/.test(l));
  const nu = /(?<!esc\()(?<![\w.])(?:caminho\b|projetoTexto\(|projetoDica\(|p\.name|p\.path|topo\.name|novo\.name)/;
  for (const l of linhas) assert.doesNotMatch(l, nu, `sem esc(): ${l.trim()}`);
  assert.match(js, /<option value="\$\{esc\(p\.id\)\}" title="\$\{esc\(projetoDica\(p\)\)\}">\$\{esc\(projetoTexto\(p\)\)\}<\/option>/);
  assert.doesNotMatch(js, /innerHTML[^\n]*\$\{(?:p|topo|novo|pj)\.(?:name|path)\}/);
});

test('texto da opção: nome cortado em 22, contagem no singular/plural e "em andamento"', () => {
  const pega = (re) => { const m = js.match(re); assert.ok(m, String(re)); return m[0]; };
  const ctx = vm.createContext({});
  vm.runInContext([
    pega(/const TITULO_MAX = 60;/), pega(/const PROJ_NOME_MAX = 22[^\n]*/),
    pega(/function cortar[^\n]*/), pega(/const sessoesTxt[^\n]*/), pega(/const projetoTexto[^\n]*/), pega(/const projetoDica[^\n]*/),
  ].join('\n'), ctx);
  const t = (p) => vm.runInContext(`projetoTexto(${JSON.stringify(p)})`, ctx);
  assert.equal(t({ name: 'digisac', sessions: 6, running: 0 }), 'digisac — 6 sessões');
  assert.equal(t({ name: 'digisac · SD-2476', sessions: 1, running: 1 }), 'digisac · SD-2476 — 1 sessão · em andamento');
  assert.equal(t({ name: 'digisac · SD-2476-nome-muito-longo-de-branch', sessions: 1, running: 0 }), 'digisac · SD-2476-nom… — 1 sessão');
  assert.equal(vm.runInContext(`projetoDica({name:'a',path:'~/x/a'})`, ctx), 'a\n~/x/a');
});

test('index.html: label do projeto, descrição do caminho, slot de avisos e quebra de linha', () => {
  assert.match(html, /<label for="projeto">Projeto<\/label>/);
  assert.match(html, /<select id="projeto" aria-describedby="projeto-caminho">/);
  assert.match(html, /<span class="sr-only" id="projeto-caminho">/);
  assert.match(html, /id="campo-projeto" hidden/); // modo único: oculto
  assert.match(html, /<div class="quebra" aria-hidden="true">/);
  assert.match(html, /<label for="sessao">Sessão<\/label>/);
  // ordem do DOM = ordem do foco: Projeto, Sessão, avisos, toggle
  const ord = ['id="projeto"', 'id="sessao"', 'id="nova-sessao"', 'id="aviso-projeto"', 'id="toggle-outros"'].map((x) => html.indexOf(x));
  assert.deepEqual([...ord].sort((a, b) => a - b), ord);
});

test('style.css: larguras e quebras do cabeçalho multi; painel usa --header-h', () => {
  assert.match(css, /header\.multi #projeto\{[^}]*min-width:280px;max-width:380px/);
  assert.match(css, /header\.multi #sessao\{[^}]*min-width:240px;max-width:420px/);
  assert.match(css, /@media \(max-width:1535px\)\{\s*header\.multi h1\{position:absolute/);
  assert.match(css, /@media \(max-width:1279px\)\{[^@]*header\.multi \.quebra\{display:block;flex-basis:100%/);
  assert.match(css, /top:var\(--header-h,64px\)/);
});

test('lista vazia não pula o ramo que escreve a opção "Nenhum projeto" (BUG-1)', () => {
  assert.match(js, /const mesmoConjunto = ps\.length > 0 && atuais\.length === ps\.length/);
  assert.match(js, /<option value="">Nenhum projeto<\/option>/);
});
