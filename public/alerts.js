// Lógica pura dos alertas de sessão aguardando (v1.4, spec 9 de docs/design/fluxo.md). Sem DOM: testável em Node.
// `w` = item de `waits` de GET /api/waits: {id, project, session_id, title, kind, since, resumo, expires_at, ...}.
// `store` = objeto com getItem/setItem (localStorage no navegador).

export const DISMISS_KEY = 'monitor.dismissed';
export const NOTIFIED_KEY = 'monitor.notified';
export const SOUND_KEY = 'monitor.som';
export const BASE_TITLE = 'Monitor de execução';
/** Ordem usada nas contagens do "+N" (spec 9.3). */
export const KIND_ORDER = ['pergunta', 'permissao', 'mcp', 'erro', 'vez'];
export const KIND_LABEL = { pergunta: 'Pergunta', permissao: 'Permissão', mcp: 'MCP', erro: 'Erro', vez: 'Sua vez' };
export const MARK = '⚠︎ '; // ⚠︎ em forma de texto

const ms = (w) => Date.parse(w.since);
const kindLabel = (k) => KIND_LABEL[k] ?? String(k ?? '');
export { kindLabel };

/** Imediatos (tudo menos "vez") ou "vez" com tempo >= L. */
export function isUrgent(w, now, vezMs) {
  return w.kind !== 'vez' || now - ms(w) >= vezMs;
}

/** Degrau 0..3 (D0 discreto … D3 parada), por múltiplos de L = vezMs (spec 9.2). */
export function escalation(w, now, vezMs) {
  const t = Math.max(0, now - ms(w));
  if (w.kind === 'vez' && t < vezMs) return 0;
  if (t < 3 * vezMs) return 1;
  if (t < 6 * vezMs) return 2;
  return 3;
}

/** Ordem R31: grupo A (urgentes) antes do B ("vez" em D0); dentro, a mais antiga primeiro. Não altera a entrada. */
export function sortWaits(waits, now, vezMs) {
  const grupo = (w) => (isUrgent(w, now, vezMs) ? 0 : 1);
  return [...waits].sort((a, b) =>
    grupo(a) - grupo(b) || ms(a) - ms(b) || String(a.project ?? '').localeCompare(String(b.project ?? '')) || String(a.session_id).localeCompare(String(b.session_id)));
}

/** `mm:ss` até 59:59; depois `h:mm`. */
export function formatElapsed(msec) {
  const s = Math.floor(Math.max(0, msec) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`;
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Espera expirada (R30): some no cliente sem refetch. */
export const isExpired = (w, now) => Number.isFinite(Date.parse(w.expires_at)) && Date.parse(w.expires_at) <= now;

// ---------- Texto ----------
/** Resumo do item (spec 9.4), texto puro: quem insere no DOM usa textContent ou esc(). */
export function resumoTexto(w) {
  const r = typeof w.resumo === 'string' ? w.resumo.trim() : '';
  switch (w.kind) {
    case 'pergunta': return r ? `“${r}”` : 'A sessão fez uma pergunta.';
    case 'permissao': return r && r !== 'permission_prompt' ? `Pede permissão para usar ${r}` : 'Pede permissão para continuar.';
    case 'mcp': return r && r !== 'elicitation_dialog' ? `O servidor MCP ${r} pede uma resposta` : 'Um servidor MCP pede uma resposta';
    case 'erro': return r ? `O turno parou com erro: ${r}` : 'O turno parou com erro';
    case 'vez': return 'Turno encerrado. Pode haver uma pergunta no texto.';
    default: return r;
  }
}

/** Nome exibido da sessão: título ou código curto (o mesmo critério do seletor). */
export function nomeDaEspera(w) {
  const t = typeof w?.title === 'string' ? w.title.trim() : '';
  return t || (w?.session_id ? String(w.session_id).slice(0, 8) : '(sem id)');
}

/** Contagem por tipo na ordem de KIND_ORDER, sem tipos com 0. */
export function contaPorTipo(waits) {
  return KIND_ORDER.map((k) => ({ kind: k, label: kindLabel(k), n: waits.filter((w) => w.kind === k).length })).filter((x) => x.n > 0);
}

/** Linha "+N": `+10 aguardando · 4 Pergunta · 3 Sua vez`. */
export function textoMais(ocultos) {
  return [`+${ocultos.length} aguardando`, ...contaPorTipo(ocultos).map((x) => `${x.n} ${x.label}`)].join(' · ');
}

/** Marcador do projeto no seletor (spec 9.6): {pre, suf}. `waits` = esperas visíveis (não dispensadas) do projeto. */
export function marcaProjeto(waits, now, vezMs) {
  if (!waits.length) return { pre: '', suf: '' };
  const k = waits.filter((w) => isUrgent(w, now, vezMs)).length;
  return k > 0 ? { pre: MARK, suf: ` · ${k} aguardando` } : { pre: '', suf: ' · sua vez' };
}
/** Marcador da sessão (spec 9.6). */
export function marcaSessao(w, now, vezMs) {
  return isUrgent(w, now, vezMs) ? { pre: MARK, suf: ` · aguardando: ${kindLabel(w.kind)}` } : { pre: '', suf: ' · sua vez' };
}

/** Título da aba (spec 9.7). `alt` = fase alternada (mostra o título normal). */
export function tabTitle(n, base = BASE_TITLE, alt = false) {
  return n > 0 && !alt ? `(${n}) ${MARK}Aguardando — Monitor` : base;
}

/** Favicon SVG (spec 9.7). n=0: glifo de fluxo; n>0: contador (9+ acima de 9); `alt`: fase clara. */
export function faviconSvg(n, alt = false) {
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">';
  if (!(n > 0)) {
    return `${open}<rect width="32" height="32" rx="7" fill="#0F172A"/><path d="M11 16l9-6M11 16l9 6" stroke="#fff" stroke-width="2.5"/><circle cx="9" cy="16" r="4" fill="#fff"/><circle cx="23" cy="9" r="4" fill="#fff"/><circle cx="23" cy="23" r="4" fill="#fff"/></svg>`;
  }
  const txt = n > 9 ? '9+' : String(n);
  const bg = alt ? '<rect x="1" y="1" width="30" height="30" rx="6" fill="#fff" stroke="#0F172A" stroke-width="2"/>' : '<rect width="32" height="32" rx="7" fill="#0F172A"/>';
  return `${open}${bg}<text x="16" y="24" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-weight="700" font-size="${n > 9 ? 17 : 22}" fill="${alt ? '#0F172A' : '#fff'}">${txt}</text></svg>`;
}
export const faviconHref = (n, alt = false) => `data:image/svg+xml,${encodeURIComponent(faviconSvg(n, alt))}`;

// ---------- Persistência (localStorage) ----------
function readMap(store, key) {
  try {
    const o = JSON.parse(store.getItem(key) ?? '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}
function writeMap(store, key, m) {
  try { store.setItem(key, JSON.stringify(m)); } catch { /* cota cheia/modo privado: segue sem persistir */ }
}
const dkey = (w) => `${w.project ?? ''}:${w.session_id}`;

/** Dispensado = a chave `<projeto>:<sessão>` guarda exatamente o `since` desta espera (outra espera volta a aparecer). */
export const isDismissed = (w, store) => readMap(store, DISMISS_KEY)[dkey(w)] === w.since;
export function dismiss(w, store) { const m = readMap(store, DISMISS_KEY); m[dkey(w)] = w.since; writeMap(store, DISMISS_KEY, m); }
export function undismiss(w, store) { const m = readMap(store, DISMISS_KEY); delete m[dkey(w)]; writeMap(store, DISMISS_KEY, m); }
/** Poda as chaves cuja sessão não está mais em `waits`. */
export function pruneDismissed(waits, store) {
  const m = readMap(store, DISMISS_KEY), vivas = new Set(waits.map(dkey));
  const keys = Object.keys(m);
  const sobra = keys.filter((k) => vivas.has(k));
  if (sobra.length !== keys.length) writeMap(store, DISMISS_KEY, Object.fromEntries(sobra.map((k) => [k, m[k]])));
}

/** Notificação já enviada para esta espera (por `id`): vale entre reloads e abas. */
export const wasNotified = (w, store) => w.id in readMap(store, NOTIFIED_KEY);
export function markNotified(w, store, now = Date.now()) { const m = readMap(store, NOTIFIED_KEY); m[w.id] = now; writeMap(store, NOTIFIED_KEY, m); }
export function pruneNotified(waits, store) {
  const m = readMap(store, NOTIFIED_KEY), vivas = new Set(waits.map((w) => w.id));
  const keys = Object.keys(m);
  const sobra = keys.filter((k) => vivas.has(k));
  if (sobra.length !== keys.length) writeMap(store, NOTIFIED_KEY, Object.fromEntries(sobra.map((k) => [k, m[k]])));
}
