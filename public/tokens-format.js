// Lógica pura de tokens por agente (v1.5, spec 10 de docs/design/fluxo.md). Sem DOM: testável em Node.
// `t` = `executions[i].tokens` ({count,total,input,cache_creation,cache_read,output,messages,models,source})
//    ou `session.tokens` ({count,total,input,...,models,executions,with_data,without_data}) de GET /api/flow.
// Os textos devolvidos são texto puro: quem os coloca no HTML escapa (esc/textContent).

const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Décimos inteiros arredondados, sem Intl: "1" -> "1", "1,3". Resultado igual em qualquer locale. */
function umaCasa(dec, sufixo) {
  const i = Math.floor(dec / 10), d = dec % 10;
  return `${formatTokensFull(i)}${d ? `,${d}` : ''} ${sufixo}`;
}

/** Formato curto pt-BR: 850 | "48,2 mil" | "1,3 mi". Corte em 999.950 -> "1 mi" (nunca "1.000 mil"). */
export function formatTokensShort(n) {
  n = num(n);
  if (n < 1000) return String(n);
  const mil = Math.round(n / 100); // décimos de mil
  if (mil < 10000) return umaCasa(mil, 'mil');
  return umaCasa(Math.round(n / 1e5), 'mi');
}

/** Formato completo pt-BR: separador de milhar ".". */
export function formatTokensFull(n) {
  return String(num(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Totais da sessão trazem `with_data`; os de uma execução, não. */
export const isSessionTokens = (t) => !!t && typeof t === 'object' && 'with_data' in t;

/** Tem dados = objeto existe e (execução) messages > 0 ou (sessão) with_data > 0. Sem dados, o cartão não mostra nada. */
export function hasTokenData(t) {
  if (!t || typeof t !== 'object') return false;
  if (isSessionTokens(t)) return num(t.with_data) > 0;
  return num(t.messages) > 0;
}

/** Linhas de detalhe com números completos: [rótulo, valor]. Campo ausente vale "0". */
export function tokensRows(t) {
  const o = t ?? {};
  return [['Entrada', formatTokensFull(o.input)], ['Cache criado', formatTokensFull(o.cache_creation)],
    ['Cache lido', formatTokensFull(o.cache_read)], ['Saída', formatTokensFull(o.output)]];
}
/** Linhas de total: "No cartão"/"No nó" e "Total completo". */
export function tokensTotals(t) {
  const o = t ?? {};
  return [[isSessionTokens(t) ? 'No nó' : 'No cartão', formatTokensFull(o.count)], ['Total completo', formatTokensFull(o.total)]];
}
/** Nomes de modelo como lista de strings (a API é filtrada, mas o disco não é confiável). */
export const tokensModels = (t) => (Array.isArray(t?.models) ? t.models.filter((m) => typeof m === 'string' && m) : []);

/** "parcial: N de M agentes sem dados" (só sessão com `without_data` > 0). */
export function parcialTexto(t) {
  if (!isSessionTokens(t) || num(t.without_data) <= 0) return '';
  return `parcial: ${num(t.without_data)} de ${num(t.executions)} agentes sem dados`;
}

/** Nota final da dica (spec 10.5 e 10.8). `running` só vale para execução. */
export function tokensNote(t, running = false) {
  if (isSessionTokens(t)) {
    const p = parcialTexto(t), com = num(t.with_data);
    return p ? `${p[0].toUpperCase()}${p.slice(1)}. Somados os ${com} com dados. Não inclui o agente principal.`
      : `${com} ${com === 1 ? 'agente somado' : 'agentes somados'}. Não inclui o agente principal.`;
  }
  return `${running ? 'Atualizando enquanto o agente roda. ' : ''}O cartão soma entrada, cache criado e saída.`;
}

/** Dica em texto puro (uma linha por item), com números completos. `opts.title` = nome do papel; `opts.running`. */
export function tokensTooltip(t, opts = {}) {
  const sess = isSessionTokens(t);
  const titulo = sess ? 'Tokens dos subagentes' : `Tokens${opts.title ? ` · ${opts.title}` : ''}`;
  const ms = tokensModels(t);
  const linhas = [titulo, ...tokensRows(t).map(([r, v]) => `${r}: ${v}`), ...tokensTotals(t).map(([r, v]) => `${r}: ${v}`)];
  if (ms.length) linhas.push(`${ms.length > 1 ? 'Modelos' : 'Modelo'}: ${ms.join(', ')}`);
  linhas.push(tokensNote(t, !!opts.running));
  return linhas.join('\n');
}

/**
 * Texto por extenso para aria-label e resumo (spec 10.9). Vazio sem dados.
 * Execução concluída: número completo; `running`: "Cerca de 48,2 mil tokens até agora."; sessão: "Subagentes usaram 48.213 tokens[, parcial: …]."
 */
export function tokensAria(t, opts = {}) {
  if (!hasTokenData(t)) return '';
  if (isSessionTokens(t)) {
    const p = parcialTexto(t);
    return `Subagentes usaram ${formatTokensFull(t.count)} tokens${p ? `, ${p}` : ''}.`;
  }
  return opts.running ? `Cerca de ${formatTokensShort(t.count)} tokens até agora.` : `${formatTokensFull(t.count)} tokens.`;
}

/** Total no nó "Agente principal" (spec 10.8): turno terminou (done, ou sem eventos de turno e nada rodando) e há dados. */
export function showSessionTotal(session) {
  if (!session || !hasTokenData(session.tokens)) return false;
  const st = session.main?.status ?? null;
  return st === 'done' || (st === null && (session.running ?? 0) === 0);
}
