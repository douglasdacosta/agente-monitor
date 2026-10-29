#!/usr/bin/env node
// Registra eventos de subagentes (início/fim) e de espera do usuário (v1.4) em .monitor/events.jsonl
// para o painel de fluxo.
// Contrato: sempre sai com código 0 e imprime "{}" no stdout; nunca bloqueia o Claude Code nem decide permissão.
// Eventos de espera (R26): lista branca de campos; prompt, tool_input, message e last_assistant_message
// NUNCA são gravados. Marcador por sessão em .monitor/open/ evita gravar todo PostToolUse (tecnico.md 39b).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERDICT_RE = /Resultado:\s*\**\s*(APROVADO|REPROVADO)/i;

function extractVerdict(msg) {
  if (typeof msg !== 'string') return undefined;
  const m = VERDICT_RE.exec(msg);
  return m ? m[1].toUpperCase() : undefined;
}

function buildEvent(p, env) {
  const full = typeof p.last_assistant_message === 'string' ? p.last_assistant_message : undefined;
  const event = {
    ts: new Date().toISOString(),
    event: p.hook_event_name,
    session_id: p.session_id,
    agent_id: p.agent_id,
    tool_use_id: p.tool_use_id,
    agent_type: p.agent_type || (p.tool_input && p.tool_input.subagent_type),
    description: p.tool_input && p.tool_input.description,
    model: p.tool_input && p.tool_input.model,
    agent_transcript_path: p.agent_transcript_path,
    transcript_path: typeof p.transcript_path === 'string' ? p.transcript_path : undefined,
    orca_session_id: env.ORCA_AGENT_SESSION_ID ? String(env.ORCA_AGENT_SESSION_ID) : undefined,
    // O veredito é calculado sobre a mensagem completa, antes do corte.
    verdict: extractVerdict(full),
    last_message: full !== undefined ? full.slice(0, 500) : undefined,
  };
  if (env.MONITOR_HOOK_DEBUG === '1') event.raw_keys = Object.keys(p);
  return event; // chaves undefined somem no JSON.stringify
}

// ---- Eventos de espera (v1.4) ----
const WAIT_EVENTS = new Set([
  'PreToolUse', 'PermissionRequest', 'Notification', 'Elicitation', 'ElicitationResult',
  'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd',
]);
const POST_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure']);
const CLOSE_EVENTS = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']);
const RESUMO_MAX = 120;
const ERR_RE = /^[a-z_]{1,40}$/;

const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);
// Sem caracteres de controle, espaços colapsados, cortado em 120. Vazio vira undefined.
function clean(v) {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, RESUMO_MAX) : undefined;
}

/** Evento que passa pelo ramo "espera". PreToolUse só se for AskUserQuestion; o resto segue o ramo da v1. */
function isWaitEvent(p) {
  const name = p.hook_event_name;
  if (typeof name !== 'string' || !WAIT_EVENTS.has(name)) return false;
  if (name === 'PreToolUse') return p.tool_name === 'AskUserQuestion';
  return true;
}

function resumoOf(p) {
  switch (p.hook_event_name) {
    case 'PreToolUse': {
      const q = p.tool_input && Array.isArray(p.tool_input.questions) ? p.tool_input.questions[0] : undefined;
      return q && typeof q === 'object' ? clean(q.question) || clean(q.header) : undefined;
    }
    case 'PermissionRequest':
      return clean(p.tool_name);
    case 'Notification': {
      const t = p.notification_type;
      return typeof t === 'string' && ERR_RE.test(t) ? t : undefined;
    }
    case 'Elicitation':
    case 'ElicitationResult':
      return clean(p.mcp_server_name);
    case 'StopFailure': {
      for (const c of [p.error_type, p.error]) if (typeof c === 'string' && ERR_RE.test(c)) return c;
      return 'erro';
    }
    default:
      return undefined;
  }
}

/** Linha de espera: só a lista branca da R26 (+ tool_name/tool_use_id, identificadores sem conteúdo). */
function buildWaitEvent(p, env) {
  const name = p.hook_event_name;
  const withTool = name === 'PreToolUse' || name === 'PermissionRequest' || POST_EVENTS.has(name);
  const withUse = name === 'PreToolUse' || POST_EVENTS.has(name);
  const event = {
    ts: new Date().toISOString(),
    event: name,
    session_id: str(p.session_id),
    cwd: str(p.cwd),
    transcript_path: str(p.transcript_path),
    orca_session_id: env.ORCA_AGENT_SESSION_ID ? String(env.ORCA_AGENT_SESSION_ID) : undefined,
    agent_id: str(p.agent_id),
    tool_name: withTool ? clean(p.tool_name) : undefined,
    tool_use_id: withUse ? clean(p.tool_use_id) : undefined,
    resumo: resumoOf(p),
  };
  if (env.MONITOR_HOOK_DEBUG === '1') event.raw_keys = Object.keys(p);
  return event;
}

const markerName = (sessionId) => crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16);

function readMarker(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function removeMarker(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
}

/** Decide (pelo marcador) se grava e atualiza o marcador. Devolve a linha a gravar ou null. Tudo silencioso. */
function handleWait(p, root, env) {
  if (!str(p.session_id)) return null;
  if (p.hook_event_name === 'Stop' && str(p.agent_id)) return null; // não é a sessão principal: ignora (e nunca grava last_assistant_message)
  const monitorDir = path.join(root, '.monitor');
  const openDir = path.join(monitorDir, 'open');
  const marker = path.join(openDir, markerName(p.session_id));
  const name = p.hook_event_name;
  const kind = readMarker(marker);
  let write = true;
  let after = null; // 'pergunta' | 'permissao' | 'close' | null (sem mudança)

  if (name === 'PreToolUse') after = 'pergunta';
  else if (name === 'PermissionRequest' || (name === 'Notification' && p.notification_type === 'permission_prompt')) {
    after = kind === 'pergunta' ? null : 'permissao';
  } else if (POST_EVENTS.has(name)) {
    if (kind === 'permissao' || (kind === 'pergunta' && p.tool_name === 'AskUserQuestion')) after = 'close';
    else write = false;
  } else if (CLOSE_EVENTS.has(name)) after = 'close';

  if (!write) return null;
  const event = buildWaitEvent(p, env);
  fs.mkdirSync(monitorDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(monitorDir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch {} // já existe (ou sem permissão): segue
  fs.appendFileSync(path.join(monitorDir, 'events.jsonl'), JSON.stringify(event) + '\n');
  try {
    if (after === 'close') removeMarker(marker);
    else if (after) {
      fs.mkdirSync(openDir, { recursive: true });
      fs.writeFileSync(marker, after);
    }
  } catch {}
  return event;
}

module.exports = { extractVerdict, buildEvent, buildWaitEvent, isWaitEvent, handleWait, markerName };

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('error', () => {});
  process.stdin.on('end', () => {
    try {
      const p = JSON.parse(raw || '{}');
      const root = process.env.CLAUDE_PROJECT_DIR || (p && p.cwd) || process.cwd();
      const obj = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
      if (isWaitEvent(obj)) {
        handleWait(obj, root, process.env);
      } else {
        const event = buildEvent(obj, process.env);
        const dir = path.join(root, '.monitor');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
      }
    } catch {
      // Nunca bloquear o Claude Code por falha de log.
    }
    process.stdout.write('{}\n');
    process.exitCode = 0;
  });
}
