// Front v1.4 (alerta de sessão aguardando): lógica pura de public/alerts.js em Node + contrato estático de app.js/index.html/style.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isUrgent, escalation, sortWaits, formatElapsed, isExpired, resumoTexto, nomeDaEspera, textoMais, contaPorTipo,
  marcaProjeto, marcaSessao, tabTitle, faviconSvg, isDismissed, dismiss, undismiss, pruneDismissed, wasNotified, markNotified, pruneNotified,
} from '../public/alerts.js';

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const js = pub('app.js'), html = pub('index.html'), css = pub('style.css');

const L = 120000, NOW = Date.parse('2026-10-29T12:00:00.000Z');
const W = (kind, segAtras, extra = {}) => ({
  id: `p:${extra.session_id ?? 's'}:${new Date(NOW - segAtras * 1000).toISOString()}`, project: 'p', session_id: 's', kind,
  since: new Date(NOW - segAtras * 1000).toISOString(), resumo: null, expires_at: new Date(NOW + 3600e3).toISOString(), ...extra,
});
const memoria = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('formatElapsed: mm:ss até 59:59, depois h:mm', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(59_999), '00:59');
  assert.equal(formatElapsed(65_000), '01:05');
  assert.equal(formatElapsed(3_599_000), '59:59');
  assert.equal(formatElapsed(3_600_000), '1:00');
  assert.equal(formatElapsed(3_900_000), '1:05');
  assert.equal(formatElapsed(-5), '00:00');
});

test('degraus D0–D3 por múltiplos de L (imediatos e "vez")', () => {
  const g = (kind, s) => escalation(W(kind, s), NOW, L);
  assert.deepEqual([0, 119, 120, 359, 360, 719, 720].map((s) => g('vez', s)), [0, 0, 1, 1, 2, 2, 3]);
  assert.deepEqual([0, 359, 360, 719, 720, 5000].map((s) => g('pergunta', s)), [1, 1, 2, 2, 3, 3]);
  for (const k of ['permissao', 'mcp', 'erro']) assert.equal(g(k, 0), 1);
  // mudar L escala tudo junto
  assert.equal(escalation(W('vez', 30), NOW, 30000), 1);
});

test('isUrgent: imediatos sempre; "vez" só depois de L', () => {
  assert.equal(isUrgent(W('pergunta', 0), NOW, L), true);
  assert.equal(isUrgent(W('vez', 119), NOW, L), false);
  assert.equal(isUrgent(W('vez', 120), NOW, L), true);
});

test('ordem R31: urgentes primeiro, "vez" D0 depois; mais antiga primeiro; empate estável; não altera a entrada', () => {
  const a = W('vez', 60, { session_id: 'a' }), b = W('pergunta', 10, { session_id: 'b' }), c = W('vez', 500, { session_id: 'c' }),
    d = W('erro', 200, { session_id: 'd' }), e = W('vez', 30, { session_id: 'e' }), f = W('vez', 500, { session_id: 'b2' });
  const entrada = [a, b, c, d, e, f];
  const ord = sortWaits(entrada, NOW, L).map((w) => w.session_id);
  assert.deepEqual(ord, ['b2', 'c', 'd', 'b', 'a', 'e']);
  assert.deepEqual(entrada.map((w) => w.session_id), ['a', 'b', 'c', 'd', 'e', 'b2']);
});

test('dispensar: some com o mesmo since; volta com since novo; desfazer; poda quem saiu das esperas', () => {
  const store = memoria(), w = W('vez', 300);
  assert.equal(isDismissed(w, store), false);
  dismiss(w, store);
  assert.equal(isDismissed(w, store), true);
  assert.equal(isDismissed({ ...w, since: new Date(NOW).toISOString() }, store), false); // espera nova da mesma sessão
  assert.equal(isDismissed({ ...w, session_id: 'outra' }, store), false);
  assert.deepEqual(JSON.parse(store.getItem('monitor.dismissed')), { [`p:s`]: w.since });
  undismiss(w, store);
  assert.equal(isDismissed(w, store), false);
  dismiss(w, store); dismiss({ ...w, project: 'q', session_id: 'x' }, store);
  pruneDismissed([w], store);
  assert.deepEqual(Object.keys(JSON.parse(store.getItem('monitor.dismissed'))), ['p:s']);
  pruneDismissed([], store);
  assert.deepEqual(JSON.parse(store.getItem('monitor.dismissed')), {});
});

test('armazenamento corrompido ou indisponível não quebra', () => {
  const ruim = { getItem: () => '{nao e json', setItem: () => { throw new Error('cheio'); } };
  const w = W('vez', 1);
  assert.equal(isDismissed(w, ruim), false);
  assert.doesNotThrow(() => dismiss(w, ruim));
  assert.equal(wasNotified(w, { getItem: () => '[1,2]', setItem() {} }), false);
});

test('notificado por id: marca, lembra e poda', () => {
  const store = memoria(), w = W('pergunta', 5);
  assert.equal(wasNotified(w, store), false);
  markNotified(w, store, 123);
  assert.equal(wasNotified(w, store), true);
  assert.equal(wasNotified({ ...w, id: 'outro' }, store), false);
  pruneNotified([], store);
  assert.equal(wasNotified(w, store), false);
});

test('expiração no cliente', () => {
  assert.equal(isExpired(W('vez', 0, { expires_at: new Date(NOW + 1).toISOString() }), NOW), false);
  assert.equal(isExpired(W('vez', 0, { expires_at: new Date(NOW).toISOString() }), NOW), true);
});

test('título da aba e favicon', () => {
  assert.equal(tabTitle(0), 'Monitor de execução');
  assert.equal(tabTitle(3), '(3) ⚠︎ Aguardando — Monitor');
  assert.equal(tabTitle(3, 'Monitor de execução', true), 'Monitor de execução');
  assert.match(faviconSvg(0), /<path d="M11 16l9-6M11 16l9 6"/);
  assert.match(faviconSvg(3), />3<\/text>/);
  assert.match(faviconSvg(12), /font-size="17"[^>]*>9\+<\/text>/);
  assert.match(faviconSvg(3, true), /fill="#fff" stroke="#0F172A"/);
});

test('textos: resumo por tipo, nome da sessão, "+N" e marcadores do seletor', () => {
  assert.equal(resumoTexto({ kind: 'pergunta', resumo: 'Qual banco?' }), '“Qual banco?”');
  assert.equal(resumoTexto({ kind: 'permissao', resumo: 'Bash' }), 'Pede permissão para usar Bash');
  assert.equal(resumoTexto({ kind: 'mcp', resumo: 'atlassian' }), 'O servidor MCP atlassian pede uma resposta');
  assert.equal(resumoTexto({ kind: 'erro', resumo: 'rate_limit' }), 'O turno parou com erro: rate_limit');
  assert.equal(resumoTexto({ kind: 'erro', resumo: null }), 'O turno parou com erro');
  assert.equal(resumoTexto({ kind: 'vez' }), 'Turno encerrado. Pode haver uma pergunta no texto.');
  assert.equal(nomeDaEspera({ title: ' Ajuste do login ', session_id: 'abcdef123456' }), 'Ajuste do login');
  assert.equal(nomeDaEspera({ title: null, session_id: 'abcdef123456' }), 'abcdef12');
  const ocultos = [W('pergunta', 1), W('pergunta', 2), W('vez', 3), W('permissao', 4)];
  assert.deepEqual(contaPorTipo(ocultos).map((x) => `${x.n} ${x.label}`), ['2 Pergunta', '1 Permissão', '1 Sua vez']);
  assert.equal(textoMais(ocultos), '+4 aguardando · 2 Pergunta · 1 Permissão · 1 Sua vez');
  assert.deepEqual(marcaProjeto([], NOW, L), { pre: '', suf: '' });
  assert.deepEqual(marcaProjeto([W('pergunta', 1), W('erro', 1), W('vez', 1)], NOW, L), { pre: '⚠︎ ', suf: ' · 2 aguardando' });
  assert.deepEqual(marcaProjeto([W('vez', 10)], NOW, L), { pre: '', suf: ' · sua vez' });
  assert.deepEqual(marcaSessao(W('pergunta', 1), NOW, L), { pre: '⚠︎ ', suf: ' · aguardando: Pergunta' });
  assert.deepEqual(marcaSessao(W('vez', 10), NOW, L), { pre: '', suf: ' · sua vez' });
});

// ---------- Contrato estático de app.js / index.html / style.css ----------
test('app.js: usa /api/waits, as chaves monitor.* e o módulo alerts.js; sem evento SSE novo', () => {
  assert.match(js, /from '\.\/alerts\.js'/);
  assert.match(js, /getJson\('\/api\/waits'\)/);
  assert.match(pub('alerts.js'), /DISMISS_KEY = 'monitor\.dismissed'/);
  assert.match(pub('alerts.js'), /NOTIFIED_KEY = 'monitor\.notified'/);
  assert.match(pub('alerts.js'), /SOUND_KEY = 'monitor\.som'/);
  assert.match(js, /es\.addEventListener\('projects', scheduleWaits\)/);
  assert.match(js, /es\.addEventListener\('update', \(ev\) => \{\s*scheduleWaits\(\)/);
  assert.doesNotMatch(js, /addEventListener\('(?:waits|alert|alertas|espera)'/);
  assert.match(js, /async function refreshWaits\(\)[\s\S]*?waitsInflight[\s\S]*?waitsDirty/); // single-flight + trailing
});

test('requestPermission só dentro de listener de clique (nunca no carregamento)', () => {
  const usos = [...js.matchAll(/requestPermission/g)];
  assert.equal(usos.length, 1);
  const i = usos[0].index;
  const ini = js.lastIndexOf("addEventListener('click'", i);
  assert.ok(ini > 0, 'sem listener de clique antes de requestPermission');
  const trecho = js.slice(ini, i);
  assert.doesNotMatch(trecho, /\n\}\);\n/); // o listener ainda não fechou
  assert.match(trecho, /ativar-notif/);
});

test('texto vindo da API entra em HTML só por esc()', () => {
  const linhas = js.split('\n').filter((l) => /innerHTML/.test(l) || /^\s*(?:li\.innerHTML|host\.innerHTML)/.test(l));
  const bloco = js.slice(js.indexOf('function montaItem'), js.indexOf('function atualizaItem'));
  for (const campo of ['nome', 'res', 'proj', 'w.project_name']) {
    for (const m of bloco.matchAll(new RegExp(`\\$\\{([^}]*\\b${campo.replace('.', '\\.')}\\b[^}]*)\\}`, 'g'))) {
      assert.match(m[1], /esc\(|cortar\(|proj \?|\.length/, `sem esc(): \${${m[1]}}`);
    }
  }
  assert.match(bloco, /title="\$\{esc\(nome\)\}">\$\{esc\(nome\)\}/);
  assert.match(bloco, /\$\{esc\(proj\)\}/);
  assert.match(bloco, /title="\$\{esc\(w\.project_name\)\}"/);
  assert.match(bloco, /\$\{esc\(res\)\}/);
  assert.match(js, /\$\{esc\(kindLabel\(k\)\)\}/);
  assert.ok(linhas.length > 0);
  assert.doesNotMatch(bloco, /\$\{(?:w\.(?:title|resumo|project_name)|res|proj)\}/); // nenhuma interpolação crua
  assert.match(bloco, /aria-label="\$\{esc\(`Copiar o nome da sessão \$\{nome\}`\)\}"/);
  assert.match(bloco, /aria-label="\$\{esc\(`Dispensar o alerta da sessão \$\{nome\}`\)\}"/);
});

test('nada abre o orquestrador: sem window.open, location, href externo nem esquema de URL nos alertas', () => {
  const al = pub('alerts.js');
  for (const src of [js, al]) {
    assert.doesNotMatch(src, /window\.open/);
    assert.doesNotMatch(src, /location\s*(?:\.href)?\s*=[^=]/);
    assert.doesNotMatch(src, /orca:\/\/|vscode:\/\//);
  }
  const bloco = js.slice(js.indexOf('function montaItem'), js.indexOf('function atualizaItem'));
  assert.doesNotMatch(bloco, /<a\b|href="(?!#)/);
  assert.match(bloco, /Verifique no orquestrador/);
  assert.match(bloco, /Copiar nome/);
  assert.match(bloco, /Dispensar/);
});

test('copiar nome: clipboard com fallback de seleção; dispensar com Desfazer por 6 s', () => {
  assert.match(js, /navigator\.clipboard\.writeText\(nome\)/);
  assert.match(js, /Não foi possível copiar\. O nome está selecionado: use Ctrl\+C\./);
  assert.match(js, /AL_UNDO_MS = 6000/);
  assert.match(js, /Desfazer/);
  assert.match(js, /Alerta de \$\{esc\(cortar\(nome, 40\)\)\} dispensado\. Ele volta se a sessão parar de novo\./);
});

test('aria-live: assertivo só para alerta novo; carga da página usa o polite', () => {
  assert.match(html, /<div class="sr-only" aria-live="assertive" id="anuncios-alerta">/);
  assert.match(html, /<div class="sr-only" aria-live="polite" id="anuncios">/);
  assert.match(js, /el\.anunciosAlerta\.textContent = /);
  assert.equal([...js.matchAll(/anunciosAlerta\.textContent =/g)].length, 1);
  assert.match(js, /sessões aguardando você/);
  assert.doesNotMatch(html, /id="alertas"[^>]*role="alert"/); // a faixa muda a cada segundo
});

test('index.html: faixa depois do cabeçalho e antes da faixa de erro; título sr-only; sino no cabeçalho; ícones', () => {
  assert.match(html, /<section id="alertas" class="alertas" aria-labelledby="alertas-titulo" hidden>/);
  assert.match(html, /<h2 id="alertas-titulo" class="sr-only">/);
  assert.match(html, /<ul id="alertas-lista"/);
  const ord = ['</header>', 'id="alertas"', 'class="faixa-erro"', 'class="legenda"'].map((x) => html.indexOf(x));
  assert.deepEqual([...ord].sort((a, b) => a - b), ord);
  assert.ok(html.indexOf('id="btn-alertas"') > html.indexOf('class="espaco"') && html.indexOf('id="btn-alertas"') < html.indexOf('id="conexao"'));
  assert.match(html, /id="btn-alertas"[^>]*aria-label="Alertas: notificações e som" aria-haspopup="dialog" aria-expanded="false"/);
  assert.match(html, /id="pop-alertas" role="dialog" aria-label="Alertas"/);
  for (const s of ['i-al-pergunta', 'i-al-permissao', 'i-al-mcp', 'i-al-erro', 'i-al-vez', 'i-copiar', 'i-sino']) assert.match(html, new RegExp(`<symbol id="${s}"`));
});

test('style.css: tokens --al-*, degraus, piscar só na pílula (0,5 e 1 Hz) e reduced-motion estático', () => {
  for (const t of ['--al-faixa:#F1F5F9', '--al-d1:#334155', '--al-d2:#1E293B', '--al-d3:#0F172A']) assert.ok(css.includes(t), t);
  assert.match(css, /@keyframes al-piscar\{0%,50%\{background:#FFFFFF;color:#0F172A\}50\.01%,100%\{background:transparent;color:#FFFFFF\}\}/);
  assert.match(css, /\.d1 \.pilula\{animation:al-piscar 2s steps\(1,end\) infinite/);
  assert.match(css, /\.d2 \.pilula,\.d3 \.pilula\{animation:al-piscar 1s steps\(1,end\) infinite/);
  assert.doesNotMatch(css, /\.alerta(?:\.d[0-3])?\{[^}]*animation:/); // o item inteiro não pisca
  assert.match(css, /\.alerta\{[^}]*height:52px/);
  assert.match(css, /\.alerta\.d3\{[^}]*inset 6px 0 0 #fff/);
  const rm = css.slice(css.lastIndexOf('@media (prefers-reduced-motion:reduce){'));
  assert.match(rm, /\.pilula\{animation:none!important\}/);
  assert.match(rm, /inset 0 0 0 2px #fff/);
});

test('marcação do seletor por texto, título só alterna em segundo plano, sem agentes e rótulo "Sua vez"', () => {
  assert.match(js, /\$\{p\._pre \?\? ''\}/);
  assert.match(js, /\$\{s\._suf \?\? ''\}/);
  assert.match(js, /document\.visibilityState === 'hidden' && !reduzMovimento\(\)/);
  assert.match(js, /f\.session && f\.session\.executions === 0\) return 'sem-agentes'/);
  assert.match(js, /Sessão sem agentes/);
  assert.match(pub('alerts.js'), /vez: 'Sua vez'/);
  assert.match(js, /Notification\(`\$\{kindLabel\(w\.kind\)\}: \$\{nomeDaEspera\(w\)\}`/);
  assert.match(js, /tag: w\.id/);
});

test('popover do sino: Esc fecha com o foco em qualquer lugar e o re-render devolve o foco (BUG-2)', () => {
  assert.match(js, /document\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key === 'Escape' && !el\.pop\.hidden\) \{[^}]*abrePopover\(false\); el\.sino\.focus\(\);[^}]*\}\s*\}, true\);/);
  assert.match(js, /requestPermission\(\)\)\.then\(\(\) => \{ renderPopover\(\); atualizaSino\(\); if \(!el\.pop\.hidden\) el\.chkSom\.focus\(\);/);
});
