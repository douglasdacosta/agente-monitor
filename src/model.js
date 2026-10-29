// Eventos -> execuções (R1 a R4, R8). Módulo puro.
import { parseLines } from './parse.js';
import { isTeamType, isValidator } from './roles.js';
import { EMPTY_TEAM } from './team.js';

export const CORRELATION_WINDOW_MS = 5000;
const VERDICT_RE = /Resultado:\s*\**\s*(APROVADO|REPROVADO)/i;

/** R4: extrai APROVADO|REPROVADO de um texto, ou null. */
export function extractVerdict(msg) {
  if (typeof msg !== 'string') return null;
  const m = VERDICT_RE.exec(msg);
  return m ? m[1].toUpperCase() : null;
}


/**
 * Correlaciona PreToolUse -> SubagentStart (R2) dentro de uma sessão.
 * Retorna Map(startEvent -> preEvent|null).
 */
function correlate(starts, pres) {
  const used = new Set();
  const result = new Map();
  for (const st of starts) {
    let pre = null;
    if (st.tool_use_id) {
      pre = pres.find((p) => !used.has(p) && p.tool_use_id === st.tool_use_id) || null;
    }
    if (!pre) {
      // FIFO: o PreToolUse mais antigo, não casado, até 5s antes do Start.
      pre =
        pres.find(
          (p) =>
            !used.has(p) &&
            !(st.tool_use_id && p.tool_use_id) && // ids divergentes nunca casam por FIFO
            p.t <= st.t &&
            st.t - p.t <= CORRELATION_WINDOW_MS,
        ) || null;
    }
    if (pre) used.add(pre);
    result.set(st, pre);
  }
  return result;
}

/**
 * @param {string|string[]} lines
 * @param {{team?: Team}} [opts] time descoberto (src/team.js); sem ele, só valem os nativos e o fallback `qa`
 * @returns {{executions: Execution[], sessions: Session[], warnings: string[]}}
 * Execution: {id, session_id, role, label, start_ts, stop_ts|null, duration_ms|null,
 *             status:'running'|'done', verdict:'APROVADO'|'REPROVADO'|null, last_message}
 *   role (sem normalização, R3.1/R14): o `agent_type` do time (qualquer tipo não nativo) ou 'outro'
 * Session: {session_id, last_ts, executions, running}  (ordenadas pelo evento mais recente primeiro)
 * `executions` ordenadas por start_ts.
 */
export function buildModel(lines, { team = EMPTY_TEAM } = {}) {
  const { events, warnings } = parseLines(lines);

  const bySession = new Map();
  for (const e of events) {
    const k = e.session_id ?? '';
    if (!bySession.has(k)) bySession.set(k, []);
    bySession.get(k).push(e);
  }

  const executions = [];
  const lastTs = new Map();

  for (const [sid, evs] of bySession) {
    evs.sort((a, b) => a.t - b.t || a.line - b.line);
    lastTs.set(sid, evs[evs.length - 1].ts);
    const starts = evs.filter((e) => e.event === 'SubagentStart' && e.agent_id);
    // R29: PreToolUse de outra ferramenta (ex.: AskUserQuestion, v1.4) nunca é "pré" de subagente. Linhas da v1 não têm tool_name.
    const pres = evs.filter((e) => e.event === 'PreToolUse' && (e.tool_name == null || e.tool_name === 'Agent' || e.tool_name === 'Task'));
    const stops = evs.filter((e) => e.event === 'SubagentStop' && e.agent_id);
    const match = correlate(starts, pres);
    const byId = new Map();

    for (const st of starts) {
      if (byId.has(st.agent_id)) continue; // Start duplicado: vale o primeiro
      const pre = match.get(st);
      const role = isTeamType(st.agent_type, team)
        ? st.agent_type
        : pre && isTeamType(pre.agent_type, team)
          ? pre.agent_type
          : 'outro';
      const ex = {
        id: st.agent_id,
        session_id: st.session_id ?? null,
        role,
        label: (pre && pre.description) || st.agent_type || pre?.agent_type || st.agent_id,
        start_ts: st.ts,
        stop_ts: null,
        duration_ms: null,
        status: 'running',
        verdict: null,
        last_message: null,
        _t: st.t,
      };
      byId.set(st.agent_id, ex);
      executions.push(ex);
    }

    for (const sp of stops) {
      const ex = byId.get(sp.agent_id);
      if (!ex || ex.status === 'done') continue; // Stop órfão ou repetido
      ex.stop_ts = sp.ts;
      ex.duration_ms = Math.max(0, sp.t - ex._t);
      ex.status = 'done';
      ex.last_message = typeof sp.last_message === 'string' ? sp.last_message : null;
      // Veredito só vale para validador (R16): um papel que cita "Resultado: APROVADO" não emite veredito.
      ex.verdict = isValidator(ex.role, team) ? (sp.verdict ? String(sp.verdict).toUpperCase() : extractVerdict(sp.last_message)) : null;
      if (ex.verdict !== 'APROVADO' && ex.verdict !== 'REPROVADO') ex.verdict = null;
    }
  }

  executions.sort((a, b) => a._t - b._t);
  for (const ex of executions) delete ex._t;

  const sessions = [...lastTs]
    .map(([session_id, last_ts]) => {
      const mine = executions.filter((e) => (e.session_id ?? '') === session_id);
      return {
        session_id,
        last_ts,
        executions: mine.length,
        running: mine.filter((e) => e.status === 'running').length,
      };
    })
    .sort((a, b) => Date.parse(b.last_ts) - Date.parse(a.last_ts));

  return { executions, sessions, warnings };
}

/** Atalho: só as execuções (todas as sessões; filtre por session_id). */
export function buildExecutions(lines, opts) {
  return buildModel(lines, opts).executions;
}
