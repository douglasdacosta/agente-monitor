// Esperas do usuário (R27, R28, R30): sessão aguardando pergunta, permissão, MCP, erro ou "vez do Arquiteto".
// Módulo puro (sem fs, sem relógio): `scanWaits` é a máquina de estados por sessão (cacheável por statSig) e
// `finalizeWaits` aplica o relógio. Nada aqui devolve cwd, transcript_path ou texto de prompt.
import { parseLines } from './parse.js';
import { STALE_MS } from '../public/stale.js';

export const VEZ_MS = 2 * 60e3; // alertas.vezMinutos = 2
export const EXPIRA_MS = 24 * 3600e3; // alertas.expiraHoras = 24
export const KINDS = Object.freeze(['pergunta', 'permissao', 'mcp', 'erro', 'vez']);
const RESUMO_MAX = 120;

const actorOf = (e) => (typeof e.agent_id === 'string' && e.agent_id ? e.agent_id : null);
const resumoOf = (e) => (typeof e.resumo === 'string' && e.resumo.trim() ? e.resumo.slice(0, RESUMO_MAX) : null);
const toolOf = (e) => (typeof e.tool_name === 'string' && e.tool_name ? e.tool_name.slice(0, RESUMO_MAX) : null);
const useOf = (e) => (typeof e.tool_use_id === 'string' && e.tool_use_id ? e.tool_use_id : null);

/**
 * @param {string|string[]} lines
 * @returns {{sessions: Map<string, ScanState>, warnings: string[]}}
 * ScanState: {open: {kind, since, resumo, agent_id, tool_use_id}|null, pendingVez, ended, last_ts, last_t}
 */
export function scanWaits(lines) {
  const { events, warnings } = parseLines(lines);
  const bySession = new Map();
  for (const e of events) {
    if (typeof e.session_id !== 'string' || !e.session_id) continue; // sem sessão não há de quem esperar
    if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
    bySession.get(e.session_id).push(e);
  }

  const sessions = new Map();
  for (const [sid, evs] of bySession) {
    evs.sort((a, b) => a.t - b.t || a.line - b.line);
    const st = { open: null, pendingVez: false, ended: false, last_ts: evs[evs.length - 1].ts, last_t: evs[evs.length - 1].t };
    const running = new Map(); // agent_id -> t do SubagentStart (sem SubagentStop)
    const background = (t) => [...running.values()].some((t0) => t - t0 <= STALE_MS);
    const openWait = (kind, e, resumo) => {
      st.open = { kind, since: e.ts, resumo, agent_id: actorOf(e), tool_use_id: useOf(e) };
    };

    for (const e of evs) {
      const name = e.event;
      const actor = actorOf(e);
      st.ended = false; // qualquer evento posterior ao SessionEnd reabre a sessão
      // Atividade da sessão principal cancela a "vez" pendente (menos Stop e Notification).
      if (!actor && name !== 'Stop' && name !== 'Notification') st.pendingVez = false;
      // Outro evento do mesmo ator da permissão aberta: a permissão foi resolvida.
      if (st.open?.kind === 'permissao' && st.open.agent_id === actor && name !== 'PermissionRequest' && name !== 'Notification' && name !== 'PostToolUse' && name !== 'PostToolUseFailure') {
        st.open = null;
      }

      switch (name) {
        case 'PreToolUse':
          if (e.tool_name === 'AskUserQuestion') {
            openWait('pergunta', e, resumoOf(e));
            st.pendingVez = false;
          }
          break;
        case 'PermissionRequest':
        case 'Notification': {
          const isNotif = name === 'Notification';
          if (isNotif && e.resumo !== 'permission_prompt' && e.resumo !== 'elicitation_dialog') break; // outro tipo: ignorado
          const kind = isNotif && e.resumo === 'elicitation_dialog' ? 'mcp' : 'permissao';
          const resumo = isNotif ? null : resumoOf(e) ?? toolOf(e);
          const o = st.open;
          if (kind === 'permissao') {
            if (o?.kind === 'permissao' && (o.agent_id === actor || (isNotif && actor === null))) {
              o.resumo ??= resumo; // PermissionRequest + Notification = uma espera: mantém o since
              break;
            }
            if (o?.kind === 'pergunta' && (toolOf(e) === 'AskUserQuestion' || (isNotif && o.agent_id === actor))) break; // a pergunta já está aberta
            openWait('permissao', e, resumo);
          } else {
            if (o?.kind === 'mcp') o.resumo ??= resumo;
            else openWait('mcp', e, resumo);
          }
          st.pendingVez = false;
          break;
        }
        case 'Elicitation':
          if (st.open?.kind === 'mcp') st.open.resumo ??= resumoOf(e);
          else openWait('mcp', e, resumoOf(e));
          st.pendingVez = false;
          break;
        case 'ElicitationResult':
          if (st.open?.kind === 'mcp') st.open = null;
          break;
        case 'PostToolUse':
        case 'PostToolUseFailure': {
          const o = st.open;
          if (o?.kind === 'pergunta' && (e.tool_name === 'AskUserQuestion' || (useOf(e) && useOf(e) === o.tool_use_id))) st.open = null;
          // Permissão: com tool_use_id nos dois lados ele decide; senão, só o mesmo ator (inclusive ambos sem agent_id) fecha.
          if (o?.kind === 'permissao') {
            const same = o.tool_use_id && useOf(e) ? o.tool_use_id === useOf(e) : o.agent_id === actor;
            if (same) st.open = null;
          }
          break;
        }
        case 'StopFailure':
          openWait('erro', e, resumoOf(e));
          st.pendingVez = false;
          break;
        case 'Stop':
          if (actor) break; // só a sessão principal
          if (background(e.t)) {
            st.open = null;
            st.pendingVez = true;
          } else {
            openWait('vez', e, null);
            st.pendingVez = false;
          }
          break;
        case 'SubagentStart':
          if (actor && !running.has(actor)) running.set(actor, e.t);
          break;
        case 'SubagentStop':
          if (actor) running.delete(actor);
          if (st.pendingVez && !background(e.t)) {
            openWait('vez', e, null);
            st.open.agent_id = null; // a vez é da sessão principal
            st.pendingVez = false;
          }
          break;
        case 'UserPromptSubmit':
          st.open = null;
          st.pendingVez = false;
          break;
        case 'SessionEnd':
          st.open = null;
          st.pendingVez = false;
          st.ended = true;
          break;
        default:
          break;
      }
    }
    sessions.set(sid, st);
  }
  return { sessions, warnings };
}

/**
 * Aplica o relógio. Ordem: urgent desc, since asc, session_id.
 * @returns {{session_id, kind, since, resumo, agent_id, urgent, expires_at}[]}
 */
export function finalizeWaits(scan, { now = Date.now(), vezMs = VEZ_MS, expiraMs = EXPIRA_MS } = {}) {
  const out = [];
  for (const [session_id, st] of scan.sessions) {
    if (!st.open || st.ended || now - st.last_t > expiraMs) continue;
    const { kind, since, resumo, agent_id } = st.open;
    out.push({
      session_id,
      kind,
      since,
      resumo,
      agent_id,
      urgent: kind !== 'vez' || now - Date.parse(since) >= vezMs,
      expires_at: new Date(st.last_t + expiraMs).toISOString(),
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      Date.parse(a.since) - Date.parse(b.since) ||
      (a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0),
  );
}

export function buildWaits(lines, opts) {
  return finalizeWaits(scanWaits(lines), opts);
}
