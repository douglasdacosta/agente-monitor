// Frontend do monitor. Sem build, sem dependências. Segue docs/design/fluxo.md.
// Toda a lógica de domínio (execuções, lotes, arestas) vem pronta do servidor (/api/flow).
// Aqui ficam só: apresentação, layout, timers e o critério "sem término".

/** Execução "running" sem nenhum evento na sessão há mais que isto vira "Sem término" (calculado aqui, no relógio do navegador). */
const STALE_MS = 2 * 3600e3;

// ---------- Constantes de layout (spec 3.1) ----------
const C = { PAD: 40, HEAD_H: 32, START_W: 72, START_H: 32, NODE_W: 272, NODE_H: 128, COL_GAP: 88, ROW_GAP: 28, RET_GAP: 40, RET_STEP: 24, R: 12 };
/** Papéis da sessão (vêm prontos do servidor em /api/flow `roles`; o cliente não tem tabela nem paleta). */
const HEX_RE = /^#[0-9a-f]{6}$/i, RGB_RE = /^\d{1,3} \d{1,3} \d{1,3}$/;
const roleMap = () => new Map((state.flow?.roles ?? []).map((r) => [r.name, r]));
/** Papel ausente de `roles` (ou "outro") usa o visual de "outro". */
const papelDe = (role) => roleMap().get(role) ?? null;
const ehOutro = (role) => !papelDe(role);
const nomeDoPapel = (role) => papelDe(role)?.nome ?? (role === 'outro' || role == null ? 'Outro' : String(role));
const ordemDoPapel = (role) => { const i = (state.flow?.roles ?? []).findIndex((r) => r.name === role); return i < 0 ? 1e9 : i; };
/** Aplica --role/--tint/--role-rgb por setProperty (validados); papel "outro" usa os padrões do CSS. */
function aplicaCor(elem, role) {
  const r = papelDe(role);
  const set = (k, v, re) => { if (r && re.test(String(v))) elem.style.setProperty(k, v); else elem.style.removeProperty(k); };
  set('--role', r?.cor, HEX_RE); set('--tint', r?.tint, HEX_RE); set('--role-rgb', r?.rgb, RGB_RE);
}
/** Ícone do papel: monograma escapado (9px/12px se 3 caracteres) ou glifo de três pontos para "outro". */
function iconePapel(role) {
  const r = papelDe(role);
  if (!r) return '<span class="ic-papel" aria-hidden="true"><svg><use href="#i-outro"/></svg></span>';
  const sigla = String(r.sigla ?? '').trim() || nomeDoPapel(role).slice(0, 2).toUpperCase();
  return `<span class="ic-papel mono${[...sigla].length >= 3 ? ' m3' : ''}" aria-hidden="true">${esc(sigla)}</span>`;
}
const CONN_FALLBACK_MS = 15000;

const $ = (id) => document.getElementById(id);
const el = {
  sessao: $('sessao'), nova: $('nova-sessao'), toggle: $('toggle-outros'), toggleTxt: $('toggle-txt'),
  chip: $('chip-fixture'), conexao: $('conexao'), conexaoTxt: $('conexao-txt'), total: $('total'),
  faixa: $('faixa-erro'), reconectar: $('reconectar'), canvas: $('canvas'), grafo: $('grafo'),
  arestas: $('arestas'), decor: $('decor'), nos: $('nos'), estado: $('estado'), painel: $('painel'),
  btnLista: $('btn-lista'), resumo: $('resumo'), resumoLista: $('resumo-lista'), anuncios: $('anuncios'),
  legPapeis: $('legenda-papeis'),
};

const state = {
  sessions: [], source: null, flow: null,
  selected: null, follow: true, knownLatest: null,
  hideOthers: localStorage.getItem('monitor.hideOthers') === '1',
  loading: true, error: null,
  conn: 'reconnecting', openId: null,
};

// ---------- Utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
function relogio(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
}
function humano(ms) {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(x)}s`;
  return `${x}s`;
}
const hora = (ts, seg) => new Date(ts).toLocaleTimeString('pt-BR', seg ? {} : { hour: '2-digit', minute: '2-digit' });
const reduzMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function dataRelativa(ts) {
  const d = new Date(ts), hoje = new Date();
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dia(hoje) - dia(d)) / 86400e3);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'ontem';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

const nodes = () => state.flow?.executions ?? [];
const edges = () => state.flow?.edges ?? [];
const byId = () => new Map(nodes().map((n) => [n.id, n]));
const predsOf = (id) => edges().filter((e) => e.to === id).map((e) => e.from);
const succsOf = (id) => edges().filter((e) => e.from === id).map((e) => e.to);
const isStale = (n) => n.status === 'running' && Date.now() - Date.parse(state.flow.session.last_ts) > STALE_MS;

function estado(n) {
  if (n.status === 'running') return isStale(n) ? 'stale' : 'run';
  return n.verdict === 'APROVADO' ? 'ok' : n.verdict === 'REPROVADO' ? 'fail' : 'done';
}
/** Duração em ms: concluído usa duration_ms; stale congela em last_ts - start_ts; running usa o relógio. */
function dur(n, st = estado(n)) {
  if (n.status === 'done') return n.duration_ms ?? Date.parse(n.stop_ts) - Date.parse(n.start_ts);
  if (st === 'stale') return Date.parse(state.flow.session.last_ts) - Date.parse(n.start_ts);
  return Date.now() - Date.parse(n.start_ts);
}
function durTxt(n, st) {
  if (st === 'run') return relogio(dur(n, st));
  if (st === 'stale') return humano(dur(n, st)) + '+';
  return humano(dur(n, st));
}

const BADGE = {
  run: '<span class="badge b-run"><span class="dot" aria-hidden="true"></span>Em execução</span>',
  done: '<span class="badge b-done"><svg aria-hidden="true"><use href="#i-check"/></svg>Concluído</span>',
  ok: '<span class="badge b-ok"><svg aria-hidden="true"><use href="#i-check"/></svg>Aprovado</span>',
  fail: '<span class="badge b-fail"><svg aria-hidden="true"><use href="#i-x"/></svg>Reprovado</span>',
  stale: '<span class="badge b-stale"><svg aria-hidden="true"><use href="#i-ampulheta"/></svg>Sem término</span>',
};
const STATUS_TXT = { run: 'em execução', done: 'concluído', ok: 'aprovado', fail: 'reprovado', stale: 'sem término' };

/** n-ésima vez do mesmo papel na sessão, por start_ts. */
function vezes() {
  const cont = {}, vez = {};
  [...nodes()].sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts)).forEach((n) => {
    cont[n.role] = (cont[n.role] || 0) + 1;
    vez[n.id] = cont[n.role];
  });
  return vez;
}
function nomePapel(n) {
  if (n.role !== 'outro') return nomeDoPapel(n.role);
  const l = String(n.label ?? '');
  return `Outro · ${l.length > 18 ? l.slice(0, 17) + '…' : l}`;
}
/** Nome curto para frases (sem o label do "outro"). */
const nomeCurto = (n) => nomeDoPapel(n.role);

// ---------- Layout ----------
function computeLayout() {
  const ns = nodes(), es = edges();
  const cols = {};
  ns.forEach((n) => (cols[n.batch] ||= []).push(n));
  Object.values(cols).forEach((c) => c.sort((a, b) => ordemDoPapel(a.role) - ordemDoPapel(b.role) || Date.parse(a.start_ts) - Date.parse(b.start_ts)));
  const batches = Object.keys(cols).map(Number).sort((a, b) => a - b);
  const maxRows = Math.max(...batches.map((b) => cols[b].length));
  const mainH = maxRows * C.NODE_H + (maxRows - 1) * C.ROW_GAP;
  const top = C.PAD + C.HEAD_H;
  const colX = (b) => C.PAD + C.START_W + C.COL_GAP + (b - 1) * (C.NODE_W + C.COL_GAP);
  const pos = {};
  batches.forEach((b) => {
    const k = cols[b].length, h = k * C.NODE_H + (k - 1) * C.ROW_GAP;
    cols[b].forEach((n, i) => (pos[n.id] = { x: colX(b), y: top + (mainH - h) / 2 + i * (C.NODE_H + C.ROW_GAP) }));
  });
  const map = byId();
  const rets = es.filter((e) => e.type === 'retorno')
    .sort((a, b) => Date.parse(map.get(a.to).start_ts) - Date.parse(map.get(b.to).start_ts));
  const retY = (j) => top + mainH + C.RET_GAP + j * C.RET_STEP;
  const W = colX(batches[batches.length - 1]) + C.NODE_W + C.PAD;
  const H = rets.length ? retY(rets.length - 1) + 16 + C.PAD : top + mainH + C.PAD;
  return { cols, batches, mainH, top, colX, pos, rets, retY, W, H, map };
}

const bez = (x1, y1, x2, y2) => `M${x1},${y1} C${x1 + 44},${y1} ${x2 - 44},${y2} ${x2},${y2}`;

function renderArestas(L) {
  const { pos, top, mainH, map, rets, retY, cols, batches } = L;
  let svg = `<defs>
    <marker id="seta-avanco" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#64748B"/></marker>
    <marker id="seta-retorno" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#B91C1C"/></marker></defs>`;
  const sy = top + mainH / 2;
  const rodando = (id) => (estado(map.get(id)) === 'run' ? ' fluxo' : '');
  cols[batches[0]].forEach((n) => {
    svg += `<path class="e-avanco${rodando(n.id)}" data-to="${esc(n.id)}" marker-end="url(#seta-avanco)" d="${bez(C.PAD + C.START_W, sy, pos[n.id].x - 1, pos[n.id].y + C.NODE_H / 2)}"/>`;
  });
  for (const e of edges().filter((x) => x.type !== 'retorno')) {
    const p = pos[e.from], q = pos[e.to];
    if (!p || !q) continue;
    const adjacente = Math.abs(q.x - p.x) <= C.NODE_W + C.COL_GAP + 1;
    let d;
    if (adjacente) d = bez(p.x + C.NODE_W, p.y + C.NODE_H / 2, q.x - 1, q.y + C.NODE_H / 2);
    else {
      // Coluna não adjacente: canal ACIMA de todos os nós, sem rótulo.
      const R = C.R, y = top - 12, sx = p.x + C.NODE_W / 2, tx = q.x + C.NODE_W / 2;
      d = `M${sx},${p.y} V${y + R} Q${sx},${y} ${sx + R},${y} H${tx - R} Q${tx},${y} ${tx},${y + R} V${q.y - 1}`;
    }
    svg += `<path class="e-avanco${rodando(e.to)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" marker-end="url(#seta-avanco)" d="${d}"/>`;
  }
  rets.forEach((e, j) => {
    const p = pos[e.from], q = pos[e.to];
    if (!p || !q) return;
    const R = C.R, y = retY(j);
    const sx = p.x + C.NODE_W / 2, sb = p.y + C.NODE_H, tx = q.x + C.NODE_W / 2, tb = q.y + C.NODE_H, d = tx >= sx ? 1 : -1;
    svg += `<path class="e-retorno${rodando(e.to)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" marker-end="url(#seta-retorno)"
      d="M${sx},${sb} V${y - R} Q${sx},${y} ${sx + d * R},${y} H${tx - d * R} Q${tx},${y} ${tx},${y - R} V${tb + 1}"/>`;
    const f = map.get(e.from), t = map.get(e.to);
    const motivo = f.verdict === 'REPROVADO' ? `${nomeCurto(f)} reprovou → volta para ${nomeCurto(t)}` : `Voltou para ${nomeCurto(t)}`;
    svg += `<g transform="translate(${(sx + tx) / 2 - 32},${y - 11})"><title>${esc(motivo)}</title>
      <rect width="64" height="22" rx="11" fill="#fff" stroke="#B91C1C" stroke-width="1.5"/>
      <use href="#i-voltou" x="8" y="5" width="12" height="12" style="color:#B91C1C"/>
      <text x="23" y="15" font-size="12" font-weight="700" fill="#B91C1C" font-family="system-ui,sans-serif">voltou</text></g>`;
  });
  el.arestas.setAttribute('width', L.W);
  el.arestas.setAttribute('height', L.H);
  el.arestas.innerHTML = svg;
}

function ariaNo(n, vez, map) {
  const st = estado(n), v = vez[n.id] > 1 ? `, ${vez[n.id]}ª vez` : '';
  const t = st === 'run' ? `Em execução há ${Math.max(0, Math.floor(dur(n, st) / 60000))} minutos`
    : st === 'stale' ? `Sem término, rodando há ${humano(dur(n, st))} ou mais`
    : `${STATUS_TXT[st]}, levou ${humano(dur(n, st))}`;
  const pr = predsOf(n.id).map((p) => nomeCurto(map.get(p)) + (map.get(p).verdict === 'REPROVADO' ? ', que reprovou' : '')).join(' e ') || 'Início';
  return `${nomePapel(n)}${v}. ${n.label}. ${t}. Veio de ${pr}.`;
}

function noInner(n, st, vez) {
  const v = vez[n.id] > 1 ? `<small class="vez">${vez[n.id]}ª vez · </small>` : '';
  const nome = ehOutro(n.role) && n.role === 'outro' ? 'Outro' : nomePapel(n);
  const run = st === 'run';
  return `<span class="l1">${iconePapel(n.role)}
      <span class="nome" title="${esc(nome)}">${esc(nome)}</span>${BADGE[st]}</span>
    <span class="l2" title="${esc(n.label)}">${v}${esc(n.label)}</span>
    <span class="l3" aria-hidden="true"><span class="pref">${n.status === 'running' ? 'rodando há' : 'levou'}</span>
      <span class="dur" ${run ? `data-start="${esc(n.start_ts)}"` : ''}>${durTxt(n, st)}</span>
      <span class="ini">início ${hora(n.start_ts)}</span></span>`;
}

function renderNos(L, vez) {
  const existing = new Map([...el.nos.children].map((b) => [b.dataset.id, b]));
  let prev = null;
  const wanted = [];
  L.batches.forEach((b) => L.cols[b].forEach((n) => wanted.push(n)));
  for (const n of wanted) {
    const st = estado(n), p = L.pos[n.id];
    let btn = existing.get(n.id);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = n.id;
    }
    existing.delete(n.id);
    btn.className = `no ${ehOutro(n.role) ? 'papel-outro' : 'papel-time'} st-${st}${state.openId === n.id ? ' selecionado' : ''}`;
    aplicaCor(btn, n.role);
    btn.style.left = p.x + 'px';
    btn.style.top = p.y + 'px';
    btn.setAttribute('aria-label', ariaNo(n, vez, L.map));
    const inner = noInner(n, st, vez);
    if (btn._inner !== inner) { btn.innerHTML = inner; btn._inner = inner; }
    // Mantém a ordem do DOM (= ordem de tabulação) sem mover quem já está certo (preserva o foco).
    const esperado = prev ? prev.nextElementSibling : el.nos.firstElementChild;
    if (esperado !== btn) el.nos.insertBefore(btn, esperado);
    prev = btn;
  }
  for (const b of existing.values()) b.remove();
}

function renderDecor(L) {
  const sy = L.top + L.mainH / 2;
  let h = `<div class="inicio" style="left:${C.PAD}px;top:${sy - C.START_H / 2}px;width:${C.START_W}px;height:${C.START_H}px">Início</div>`;
  L.batches.forEach((b) => {
    const k = L.cols[b].length, agora = L.cols[b].some((n) => estado(n) === 'run');
    h += `<div class="col-rotulo" style="left:${L.colX(b)}px;top:${C.PAD}px;width:${C.NODE_W}px">Etapa ${b}${k > 1 ? ` · ${k} em paralelo` : ''}${agora ? ' <b>· agora</b>' : ''}</div>`;
  });
  el.decor.innerHTML = h;
}

function renderResumo(L, vez) {
  $('resumo-titulo').textContent = tituloDe(state.flow?.session) ? `Resumo do fluxo: ${cortar(tituloDe(state.flow.session))}` : 'Resumo do fluxo';
  el.resumoLista.innerHTML = L.batches.map((b) => {
    const k = L.cols[b];
    const itens = k.map((n) => {
      const st = estado(n);
      const r = predsOf(n.id).some((p) => edges().find((e) => e.from === p && e.to === n.id)?.type === 'retorno');
      return `${r ? 'voltou para ' : ''}${esc(nomeCurto(n))}${vez[n.id] > 1 ? ` (${vez[n.id]}ª vez)` : ''}, ${esc(n.label)}, ${st === 'run' ? 'em execução' : `${STATUS_TXT[st]} em ${humano(dur(n, st))}`}`;
    });
    return `<li>Etapa ${b}${k.length > 1 ? ', em paralelo' : ''}: ${itens.join('; ')}.</li>`;
  }).join('');
}

// ---------- Estados globais ----------
const CAIXA = (icone, titulo, texto, botao, cor) => `<div class="caixa">
  <svg aria-hidden="true"${cor ? ` style="color:${cor}"` : ''}><use href="#i-${icone}"/></svg>
  <h2>${titulo}</h2>${texto ? `<p>${texto}</p>` : ''}${botao ?? ''}</div>`;

function estadoGlobal() {
  const f = state.flow;
  if (state.loading && !f) return 'carregando';
  if (state.error && !f) return 'erro';
  if (!state.sessions.length) return state.source && state.source.exists === false ? 'sem-arquivo' : 'vazio';
  if (!f) return 'carregando';
  if (!nodes().length) return state.hideOthers && f.others > 0 ? 'todos-ocultos' : 'sem-execucoes';
  return null;
}

function renderEstado(tipo) {
  const e = el.estado;
  e.classList.toggle('ativo', !!tipo);
  el.canvas.setAttribute('aria-busy', String(tipo === 'carregando'));
  if (!tipo) { e.innerHTML = ''; e._tipo = null; return; }
  if (tipo === 'erro') {
    e.innerHTML = CAIXA('erro', 'Não foi possível carregar o fluxo',
      `Verifique se o servidor está rodando (<code>node server.js</code>). Detalhe: ${esc(state.error)}`,
      '<button type="button" class="btn" id="tentar">Tentar novamente</button>', '#DC2626');
    $('tentar').addEventListener('click', () => { state.loading = true; render(); refresh(); });
    e._tipo = tipo;
    return;
  }
  if (e._tipo === tipo) return;
  e._tipo = tipo;
  if (tipo === 'carregando') {
    e.innerHTML = `<span class="sr-only">Carregando fluxo…</span><div style="position:relative;width:1000px;height:300px">
      <div class="esqueleto" style="left:40px;top:134px;width:72px;height:32px;border-radius:999px"></div>
      <div class="esqueleto" style="left:200px;top:86px;width:272px;height:128px"></div>
      <div class="esqueleto" style="left:544px;top:86px;width:272px;height:128px"></div>
      <div class="esqueleto" style="left:888px;top:86px;width:272px;height:128px"></div></div>`;
  } else if (tipo === 'vazio') {
    e.innerHTML = CAIXA('vazio', 'Nenhuma execução registrada ainda', 'Quando um agente do time for acionado, o fluxo aparece aqui automaticamente. Os eventos são lidos de <code>.monitor/events.jsonl</code>.');
  } else if (tipo === 'sem-arquivo') {
    e.innerHTML = CAIXA('vazio', 'Arquivo de eventos não encontrado', 'Ainda não existe <code>.monitor/events.jsonl</code>. Ele é criado pelo hook na primeira execução de um agente.');
  } else if (tipo === 'sem-execucoes') {
    e.innerHTML = CAIXA('vazio', 'Esta sessão ainda não tem execuções', 'Houve chamadas, mas nenhum agente chegou a iniciar.');
  } else if (tipo === 'todos-ocultos') {
    e.innerHTML = CAIXA('vazio', 'Só há agentes fora do time nesta sessão', '', '<button type="button" class="btn" id="mostrar">Mostrar outros</button>');
    $('mostrar').addEventListener('click', () => setHideOthers(false));
  }
}

// ---------- Cabeçalho ----------
const TITULO_MAX = 60;
const ORIGEM_TXT = { orca: 'Nome do Orca', claude: 'Título do Claude Code', evento: 'Título da sessão' };
/** Nome da sessão (vem do usuário: sempre usar via esc()/textContent). Sem título, cai no código curto. */
const tituloDe = (s) => (typeof s?.title === 'string' ? s.title.trim() : '');
const nomeSessao = (s) => tituloDe(s) || (s?.session_id ? s.session_id.slice(0, 8) : '(sem id)');
function cortar(t, max = TITULO_MAX) { const a = [...t]; return a.length > max ? a.slice(0, max - 1).join('').trimEnd() + '…' : t; }
/** Tooltip: nome completo + origem + código da sessão. */
function sessaoDica(s) {
  const t = tituloDe(s), id = s?.session_id ?? '';
  if (!t) return id;
  const o = ORIGEM_TXT[s.titleSource];
  return `${t}${o ? ` (${o})` : ''}\nSessão: ${id}`;
}

function sessaoTexto(s) {
  const id = cortar(nomeSessao(s));
  const andamento = s.running > 0 && Date.now() - Date.parse(s.last_ts) <= STALE_MS;
  const n = s.executions;
  return `${id} · ${dataRelativa(s.last_ts)} ${hora(s.last_ts)} · ${n} ${n === 1 ? 'execução' : 'execuções'}${andamento ? ' · em andamento' : ''}`;
}

function renderHeader() {
  const opts = state.sessions.map((s) => `<option value="${esc(s.session_id)}" title="${esc(sessaoDica(s))}">${esc(sessaoTexto(s))}</option>`).join('');
  if (el.sessao._opts !== opts) { el.sessao.innerHTML = opts || '<option value="">Nenhuma sessão</option>'; el.sessao._opts = opts; }
  el.sessao.disabled = !state.sessions.length;
  if (state.selected !== null) el.sessao.value = state.selected;

  const sel = state.sessions.find((x) => x.session_id === el.sessao.value);
  el.sessao.title = sel ? sessaoDica(sel) : '';
  const latest = state.sessions[0]?.session_id;
  const novaTitulo = tituloDe(state.sessions[0]);
  el.nova.title = novaTitulo ? `Ver: ${novaTitulo}` : '';
  el.nova.setAttribute('aria-label', novaTitulo ? `Nova sessão: ${cortar(novaTitulo)}. Ver` : 'Nova sessão · ver');
  el.nova.classList.toggle('ativo', !state.follow && latest !== undefined && latest !== state.knownLatest);

  const n = state.flow?.others ?? 0;
  const on = state.hideOthers && n > 0;
  el.toggle.setAttribute('aria-checked', String(on));
  el.toggle.setAttribute('aria-disabled', String(n === 0));
  el.toggle.title = n === 0 ? 'Nenhum agente fora do time nesta sessão' : '';
  el.toggleTxt.textContent = `Ocultar outros (${n})`;

  const fx = state.source?.fixture;
  el.chip.classList.toggle('ativo', !!fx);
  el.chip.textContent = fx ? `Fixture: ${fx}` : '';

  const labels = { live: ['ao-vivo', 'Ao vivo'], reconnecting: ['reconectando', 'Reconectando…'], down: ['desconectado', 'Desconectado'] };
  const [cls, txt] = labels[state.conn];
  el.conexao.className = `conexao ${cls}`;
  if (el.conexaoTxt.textContent !== txt) el.conexaoTxt.textContent = txt;
  el.faixa.classList.toggle('ativa', state.conn === 'down');
}

function tickTotal() {
  const ns = nodes();
  if (!ns.length) { el.total.textContent = '--:--'; return; }
  const ini = Math.min(...ns.map((n) => Date.parse(n.start_ts)));
  const vivo = ns.some((n) => estado(n) === 'run');
  const last = Date.parse(state.flow.session.last_ts);
  const stops = ns.filter((n) => n.stop_ts).map((n) => Date.parse(n.stop_ts));
  const fim = vivo ? Date.now() : stops.length ? Math.max(...stops, ns.some((n) => n.status === 'running') ? last : 0) : last;
  el.total.textContent = relogio(fim - ini);
}

// ---------- Painel de detalhes ----------
let origemPainel = null;
function renderPainel() {
  const p = el.painel, n = byId().get(state.openId);
  if (!n) {
    if (state.openId) state.openId = null;
    p.className = 'painel'; p.innerHTML = ''; p._key = null;
    return;
  }
  const map = byId(), vez = vezes(), st = estado(n);
  const key = JSON.stringify([n, st, predsOf(n.id), succsOf(n.id), vez[n.id]]);
  if (p._key === key) return;
  p._key = key;
  const lk = (ids, vazio) => ids.length ? ids.map((x) => {
    const o = map.get(x);
    return `<button type="button" class="link" data-ir="${esc(x)}">${esc(nomeCurto(o))}${vez[x] > 1 ? ` (${vez[x]}ª vez)` : ''}${o.verdict ? ` (${o.verdict === 'REPROVADO' ? 'reprovou' : 'aprovou'})` : ''}</button>`;
  }).join(', ') : vazio;
  const msg = n.last_message
    ? `<pre class="msg">${esc(n.last_message)}</pre>${n.last_message.length >= 500 ? '<p class="nota" style="font-size:12px;color:#64748B">Mensagem truncada em 500 caracteres pelo registro.</p>' : ''}`
    : `<p class="nota">${n.status === 'running' ? 'O agente ainda está em execução. A mensagem aparece quando ele terminar.' : 'Nenhuma mensagem registrada.'}</p>`;
  const tinhaFoco = p.contains(document.activeElement);
  p.className = `painel aberto ${ehOutro(n.role) ? 'papel-outro' : 'papel-time'}`;
  aplicaCor(p, n.role);
  p.innerHTML = `<div class="p-topo">${iconePapel(n.role)}
      <h2 id="painel-titulo">${esc(nomePapel(n))}${vez[n.id] > 1 ? ` <small style="font-size:14px;color:#475569;font-weight:500;white-space:nowrap">· ${vez[n.id]}ª vez</small>` : ''}</h2>${BADGE[st]}
      <button type="button" class="fechar" aria-label="Fechar detalhes"><svg width="18" height="18" aria-hidden="true"><use href="#i-fechar"/></svg></button></div>
    <dl><dt>Tarefa</dt><dd>${esc(n.label)}</dd>
      <dt>Início</dt><dd>${pad(new Date(n.start_ts).getDate())}/${pad(new Date(n.start_ts).getMonth() + 1)} ${hora(n.start_ts, true)}</dd>
      <dt>Término</dt><dd>${n.stop_ts ? hora(n.stop_ts, true) : '—'}</dd>
      <dt>Duração</dt><dd><span ${st === 'run' ? `data-start="${esc(n.start_ts)}" style="font-family:var(--mono)"` : ''}>${durTxt(n, st)}</span></dd>
      <dt>Veredito</dt><dd>${n.verdict === 'APROVADO' ? 'Aprovado' : n.verdict === 'REPROVADO' ? 'Reprovado' : '—'}</dd>
      <dt>Veio de</dt><dd>${lk(predsOf(n.id), 'Início')}</dd>
      <dt>Seguiu para</dt><dd>${lk(succsOf(n.id), '—')}</dd>
      <dt>ID</dt><dd><span class="mono">${esc(n.id)}</span> <button type="button" class="btn peq" id="copiar">Copiar</button></dd></dl>
    <h3>Última mensagem</h3>${msg}`;
  p.querySelector('.fechar').addEventListener('click', fecharPainel);
  p.querySelector('#copiar').addEventListener('click', (e) => {
    navigator.clipboard?.writeText(n.id);
    e.target.textContent = 'Copiado';
    setTimeout(() => { e.target.textContent = 'Copiar'; }, 2000);
  });
  p.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => abrirPainel(b.dataset.ir)));
  if (tinhaFoco) p.querySelector('.fechar').focus();
}
const noEl = (id) => [...el.nos.children].find((b) => b.dataset.id === id);
function abrirPainel(id, de) {
  if (state.openId === id) return fecharPainel();
  state.openId = id;
  origemPainel = de || noEl(id);
  el.painel._key = null;
  render();
  el.painel.querySelector('.fechar')?.focus();
}
function fecharPainel() {
  state.openId = null;
  render();
  origemPainel?.focus();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.openId) fecharPainel(); });

/** Legenda dinâmica (spec 7.5): papéis na ordem de `roles`, "Outro" por último se houver. Recriada só se mudou. */
function renderLegenda() {
  const roles = state.flow?.roles ?? [];
  const outro = (state.flow?.others ?? 0) > 0 || nodes().some((n) => ehOutro(n.role));
  const key = JSON.stringify([roles.map((r) => [r.name, r.nome, r.cor]), outro]);
  if (el.legPapeis._key === key) return;
  el.legPapeis._key = key;
  const itens = roles.map((r) => {
    const cor = HEX_RE.test(String(r.cor)) ? r.cor : '#475569';
    return `<span role="listitem" class="leg-papel" data-papel="${esc(r.name)}" title="${esc(r.nome)}"><span class="bolinha" style="background:${cor}"></span><span class="leg-nome">${esc(r.nome)}</span></span>`;
  });
  if (outro) itens.push('<span role="listitem" class="leg-papel"><span class="bolinha outro"></span><span class="leg-nome">Outro</span></span>');
  el.legPapeis.innerHTML = itens.join('');
}

// ---------- Render principal ----------
let lastRunning = new Set();
let firstScrollDone = null; // session_id para o qual já rolamos
let lastUserInput = 0;
for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.canvas.addEventListener(ev, () => { lastUserInput = Date.now(); }, { passive: true });

function render() {
  renderHeader();
  renderLegenda();
  const tipo = estadoGlobal();
  renderEstado(tipo);
  const mostra = !tipo;
  el.grafo.hidden = !mostra;
  el.btnLista.hidden = !mostra;
  if (!mostra) {
    el.resumoLista.innerHTML = '';
    renderPainel();
    tickTotal();
    return;
  }
  if (state.openId && !byId().has(state.openId)) state.openId = null; // nó sumiu (ex.: ocultar outros)
  const L = computeLayout(), vez = vezes();
  el.grafo.style.width = L.W + 'px';
  el.grafo.style.height = L.H + 'px';
  renderArestas(L);
  renderDecor(L);
  renderNos(L, vez);
  renderResumo(L, vez);
  renderPainel();
  tickTotal();

  // Rolagem: 1º render da sessão ou novo nó running (sem interferir se o usuário rolou há <10s).
  const runningIds = new Set(nodes().filter((n) => estado(n) === 'run').map((n) => n.id));
  const novoRunning = [...runningIds].find((id) => !lastRunning.has(id));
  const primeiro = firstScrollDone !== state.flow.session.session_id;
  if ((primeiro || novoRunning) && Date.now() - lastUserInput > 10000) {
    const alvo = noEl(novoRunning ?? [...runningIds][0]) ?? null;
    alvo?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduzMovimento() || primeiro ? 'auto' : 'smooth' });
  }
  if (primeiro) firstScrollDone = state.flow.session.session_id;
  lastRunning = runningIds;
}

// ---------- Anúncios (somente mudanças de estado) ----------
let prevSnap = null; // {session, map id->{status, verdict, role}}
function anunciar(flow) {
  const snap = { session: flow.session.session_id, m: new Map(flow.executions.map((n) => [n.id, n])) };
  if (prevSnap && prevSnap.session === snap.session) {
    const msgs = [];
    for (const [id, n] of snap.m) {
      const o = prevSnap.m.get(id);
      const nome = nomeDoPapel(n.role);
      if (!o) msgs.push(`${nome} iniciou.`);
      else if (o.status === 'running' && n.status === 'done') {
        msgs.push(n.verdict === 'REPROVADO' ? `${nome} reprovou.` : `${nome} concluiu em ${humano(n.duration_ms ?? 0)}.`);
      }
    }
    if (msgs.length) el.anuncios.textContent = (tituloDe(flow.session) ? `${cortar(tituloDe(flow.session))}: ` : '') + msgs.join(' ');
  }
  prevSnap = snap;
}

// ---------- Dados ----------
let seq = 0;
let pending = null;
async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
let inflight = false;
let dirty = false;
/**
 * Single-flight + trailing: nunca há dois refreshes em voo (uma rajada de SSE
 * não descarta a resposta em andamento); pedidos feitos durante o voo viram
 * uma única repetição ao final. `user` = mudança de seleção/filtro: invalida
 * a resposta em voo (seq), para que a escolha mais nova prevaleça.
 */
async function refresh(user = false) {
  if (user) seq++;
  if (inflight) { dirty = true; return; }
  inflight = true;
  try {
    do { dirty = false; await refreshOnce(); } while (dirty);
  } finally { inflight = false; }
}
async function refreshOnce() {
  const mine = seq;
  try {
    const { sessions, source } = await getJson('/api/sessions');
    if (mine !== seq) return;
    state.sessions = sessions;
    state.source = source;
    const ids = sessions.map((s) => s.session_id);
    if (state.follow || !ids.includes(state.selected)) {
      state.follow = state.follow || !ids.includes(state.selected);
      state.selected = ids[0] ?? null;
    }
    if (state.selected === null) {
      state.flow = null;
    } else {
      const q = `session=${encodeURIComponent(state.selected)}&hideOthers=${state.hideOthers ? 1 : 0}`;
      const flow = await getJson(`/api/flow?${q}`);
      if (mine !== seq) return;
      state.flow = flow;
      anunciar(flow);
    }
    state.error = null;
  } catch (err) {
    if (mine !== seq) return;
    state.error = err.message || String(err);
  }
  state.loading = false;
  render();
}
/** Agrupa refreshes concorrentes (ex.: rajada de eventos SSE). */
function scheduleRefresh() {
  if (pending) return;
  pending = setTimeout(() => { pending = null; refresh(); }, 50);
}

function setHideOthers(v) {
  state.hideOthers = v;
  localStorage.setItem('monitor.hideOthers', v ? '1' : '0');
  refresh(true);
}

el.sessao.addEventListener('change', () => {
  state.selected = el.sessao.value;
  state.follow = false;
  state.knownLatest = state.sessions[0]?.session_id ?? null;
  state.openId = null;
  state.flow = null;
  state.loading = true;
  render();
  refresh(true);
});
el.nova.addEventListener('click', () => {
  state.follow = true;
  state.openId = null;
  refresh(true);
});
el.toggle.addEventListener('click', () => {
  if (el.toggle.getAttribute('aria-disabled') === 'true') return;
  setHideOthers(!state.hideOthers);
});
el.nos.addEventListener('click', (e) => {
  const b = e.target.closest('.no');
  if (b) abrirPainel(b.dataset.id, b);
});
el.nos.addEventListener('keydown', (e) => {
  const b = e.target.closest('.no');
  if (!b) return;
  const id = b.dataset.id;
  let alvo = null;
  if (e.key === 'ArrowRight') alvo = succsOf(id)[0];
  else if (e.key === 'ArrowLeft') alvo = predsOf(id)[0];
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const n = byId().get(id);
    const col = [...el.nos.children].filter((x) => byId().get(x.dataset.id)?.batch === n.batch);
    const i = col.indexOf(b) + (e.key === 'ArrowDown' ? 1 : -1);
    alvo = col[i]?.dataset.id;
  }
  if (alvo) { e.preventDefault(); noEl(alvo)?.focus(); }
});
// Realce das arestas ligadas ao nó (hover/foco).
const realce = (e, on) => {
  const b = e.target.closest?.('.no');
  if (!b) return;
  const id = CSS.escape(b.dataset.id);
  el.arestas.querySelectorAll(`path[data-from="${id}"],path[data-to="${id}"]`).forEach((p) => p.classList.toggle('realce', on));
};
el.nos.addEventListener('mouseover', (e) => realce(e, true));
el.nos.addEventListener('mouseout', (e) => realce(e, false));
el.nos.addEventListener('focusin', (e) => realce(e, true));
el.nos.addEventListener('focusout', (e) => realce(e, false));

el.btnLista.addEventListener('click', () => {
  const on = el.resumo.classList.toggle('visivel');
  el.resumo.classList.toggle('sr-only', !on);
  el.btnLista.setAttribute('aria-expanded', String(on));
  el.btnLista.textContent = on ? 'Ocultar lista' : 'Ver como lista';
});

// ---------- SSE ----------
let es = null;
let downTimer = null;
function conectar() {
  es?.close();
  es = new EventSource('/api/stream');
  es.addEventListener('open', () => {
    clearTimeout(downTimer); downTimer = null;
    state.conn = 'live';
    renderHeader();
    scheduleRefresh(); // recupera o que perdeu enquanto estava fora
  });
  es.addEventListener('update', scheduleRefresh);
  es.addEventListener('error', () => {
    if (state.conn === 'live') state.conn = 'reconnecting';
    if (!downTimer && state.conn !== 'down') {
      downTimer = setTimeout(() => { downTimer = null; state.conn = 'down'; renderHeader(); }, CONN_FALLBACK_MS);
    }
    // CLOSED = o navegador desistiu de reconectar sozinho.
    if (es.readyState === EventSource.CLOSED) setTimeout(conectar, 3000);
    renderHeader();
  });
}
el.reconectar.addEventListener('click', () => {
  state.conn = 'reconnecting';
  clearTimeout(downTimer); downTimer = null;
  renderHeader();
  conectar();
  refresh();
});

// ---------- Timers: um único intervalo ----------
let ticks = 0;
setInterval(() => {
  ticks++;
  document.querySelectorAll('[data-start]').forEach((n) => { n.textContent = relogio(Date.now() - Date.parse(n.dataset.start)); });
  if (state.flow) tickTotal();
  // A cada minuto: rótulos de acessibilidade, "sem término" e texto da sessão se atualizam.
  if (ticks % 60 === 0 && state.flow) render();
}, 1000);

render();
refresh();
conectar();
