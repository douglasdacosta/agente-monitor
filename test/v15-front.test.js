// Front v1.5 (tokens por agente): lógica pura de public/tokens-format.js em Node + contrato estático de app.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatTokensShort, formatTokensFull, tokensTooltip, tokensAria, showSessionTotal, hasTokenData,
} from '../public/tokens-format.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('formatTokensShort: pt-BR com corte em 999.950', () => {
  const casos = [[0, '0'], [850, '850'], [999, '999'], [1000, '1 mil'], [48213, '48,2 mil'], [12000, '12 mil'],
    [999949, '999,9 mil'], [999950, '1 mi'], [1250000, '1,3 mi']];
  for (const [n, esperado] of casos) assert.equal(formatTokensShort(n), esperado, String(n));
});

test('formatTokensFull usa ponto de milhar', () => {
  assert.equal(formatTokensFull(48213), '48.213');
  assert.equal(formatTokensFull(0), '0');
  assert.equal(formatTokensFull(2104877), '2.104.877');
});

const sess = (main, running, tokens = { count: 1, with_data: 1, without_data: 0, executions: 1 }) => ({ main: { status: main }, running, tokens });

test('showSessionTotal: done, running e null (com e sem running)', () => {
  assert.equal(showSessionTotal(sess('done', 0)), true);
  assert.equal(showSessionTotal(sess('done', 2)), true);
  assert.equal(showSessionTotal(sess('running', 0)), false);
  assert.equal(showSessionTotal(sess(null, 0)), true);
  assert.equal(showSessionTotal(sess(null, 1)), false);
  assert.equal(showSessionTotal(sess('done', 0, null)), false);
  assert.equal(showSessionTotal(sess('done', 0, { with_data: 0, without_data: 1, executions: 1 })), false);
});

test('tokensTooltip: sessão parcial e execução', () => {
  const t = { count: 10, total: 20, input: 1, cache_creation: 2, cache_read: 10, output: 7, models: ['a', 'b'], executions: 6, with_data: 5, without_data: 1 };
  assert.match(tokensTooltip(t), /parcial: 1 de 6 agentes sem dados\. Somados os 5 com dados/i);
  assert.match(tokensTooltip(t), /Modelos: a, b/);
  const e = { count: 48213, total: 450769, input: 1204, cache_creation: 31877, cache_read: 402556, output: 15132, messages: 3, models: ['m'] };
  assert.match(tokensTooltip(e, { title: 'PM' }), /No cartão: 48\.213/);
  assert.doesNotMatch(tokensTooltip(e), /parcial/);
});

test('tokensAria e dados: sem dados não gera texto', () => {
  assert.equal(tokensAria(null), '');
  assert.equal(tokensAria({ messages: 0, count: 0 }), '');
  assert.equal(hasTokenData({ messages: 0 }), false);
  assert.equal(tokensAria({ messages: 2, count: 48213 }), '48.213 tokens.');
  assert.equal(tokensAria({ messages: 2, count: 48213 }, { running: true }), 'Cerca de 48,2 mil tokens até agora.');
  assert.match(tokensAria({ with_data: 5, without_data: 2, executions: 7, count: 48213 }), /^Subagentes usaram 48\.213 tokens, parcial: 2 de 7 agentes sem dados\.$/);
});

test('app.js: models escapados, sem aria-live no número, sem "0"/"—" sem dados', () => {
  assert.match(app, /from '\.\/tokens-format\.js'/);
  assert.equal((app.match(/ms\.map\(esc\)/g) || []).length, 2); // painel e dica
  assert.doesNotMatch(app, /ms\.join/, 'models nunca sem esc');
  assert.doesNotMatch(app, /\.tok[^\n]*aria-live|aria-live[^\n]*\.tok/);
  assert.match(app, /tokDe\(n\) \?/); // .tok só com dados
});

test('style.css: a regra [hidden] da legenda de tokens vence .legenda>span[role] (especificidade)', () => {
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.legenda>\.leg-tokens\[hidden\]\{display:none\}/);
  assert.doesNotMatch(css, /(^|\n)\.leg-tokens\[hidden\]/);
});
