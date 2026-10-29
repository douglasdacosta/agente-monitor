#!/usr/bin/env node
// Registra eventos de subagentes (início/fim) em .monitor/events.jsonl para o painel de fluxo.
// Contrato: sempre sai com código 0 e imprime "{}" no stdout; nunca bloqueia o Claude Code.
const fs = require('fs');
const path = require('path');

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

module.exports = { extractVerdict, buildEvent };

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('error', () => {});
  process.stdin.on('end', () => {
    try {
      const p = JSON.parse(raw || '{}');
      const root = process.env.CLAUDE_PROJECT_DIR || (p && p.cwd) || process.cwd();
      const event = buildEvent(p && typeof p === 'object' ? p : {}, process.env);
      const dir = path.join(root, '.monitor');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
    } catch {
      // Nunca bloquear o Claude Code por falha de log.
    }
    process.stdout.write('{}\n');
    process.exitCode = 0;
  });
}
