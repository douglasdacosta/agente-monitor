// v1.4 (tarefa 41 / B6): valida só a FORMA de fixtures/esperas.jsonl. A lógica de esperas é testada em v14-waits.
// Casos (um session_id "esp-NN-*" cada; o maior ts do arquivo é o "agora" do teste):
//  01 pergunta aberta | 02 respondida (PostToolUse) | 03 encerrada por UserPromptSubmit
//  04 permissão aberta (PermissionRequest + Notification permission_prompt = uma espera) | 05 encerrada por PostToolUseFailure
//  06 MCP aberto (precedido de um Stop: duas esperas seguidas, vale a última) | 07 MCP encerrado por ElicitationResult
//  08 erro (StopFailure) | 09 vez 60 s antes do "agora" | 10 vez 5 min antes | 11 vez encerrada por UserPromptSubmit
//  12 Stop com subagente ainda running (sem alerta) | 13 espera encerrada por SessionEnd | 14 espera expirada (25 h)
//  15 sem subagentes, só turnos (inclui UserPromptSubmit sem espera aberta) | 16 linha inválida no meio
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = new URL('../fixtures/esperas.jsonl', import.meta.url);
const ALLOWED = new Set([
  'ts', 'event', 'session_id', 'cwd', 'transcript_path', 'orca_session_id', 'agent_id', 'resumo',
  'tool_name', 'tool_use_id', 'session_title', 'agent_type', 'description',
]);
const raw = readFileSync(FILE, 'utf8').split('\n').filter((l) => l.trim() !== '');
const rows = [];
const invalid = [];
for (const l of raw) {
  try { rows.push(JSON.parse(l)); } catch { invalid.push(l); }
}
const by = new Map();
for (const r of rows) (by.get(r.session_id) ?? by.set(r.session_id, []).get(r.session_id)).push(r);
const sess = (n) => {
  const id = [...by.keys()].find((k) => k.startsWith(`esp-${String(n).padStart(2, '0')}-`));
  assert.ok(id, `sessão ${n} ausente`);
  return by.get(id).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
};
const evs = (n) => sess(n).map((e) => e.event);
const maxTs = Math.max(...rows.map((r) => Date.parse(r.ts)));

test('exatamente uma linha inválida, dentro da sessão 16, e as demais são objetos JSON', () => {
  assert.equal(invalid.length, 1);
  assert.ok(raw.indexOf(invalid[0]) > 0 && raw.indexOf(invalid[0]) < raw.length - 1);
  for (const r of rows) assert.ok(r && typeof r === 'object' && !Array.isArray(r));
});

test('só campos permitidos pela R26, sem texto de prompt/comando/mensagem', () => {
  for (const r of rows) {
    for (const k of Object.keys(r)) assert.ok(ALLOWED.has(k), `campo proibido: ${k}`);
    assert.ok(typeof r.event === 'string' && typeof r.session_id === 'string');
    assert.ok(!Number.isNaN(Date.parse(r.ts)));
    if (r.resumo != null) assert.ok(typeof r.resumo === 'string' && r.resumo.length <= 120);
  }
  const txt = raw.join('\n');
  for (const k of ['prompt', 'tool_input', 'message', 'last_assistant_message', 'transcript_path', '/.claude/']) {
    assert.ok(!txt.includes(k === '/.claude/' ? k : `"${k}"`), k);
  }
});

test('16 sessões, cada uma com session_title', () => {
  assert.equal(by.size, 16);
  for (let n = 1; n <= 16; n++) {
    assert.ok(sess(n).some((e) => typeof e.session_title === 'string' && e.session_title.trim()), `título da ${n}`);
  }
});

test('cobertura dos tipos de espera e de seus encerramentos, por sessão', () => {
  assert.deepEqual(evs(1).slice(-1), ['PreToolUse']);
  assert.equal(sess(1).at(-1).tool_name, 'AskUserQuestion');
  assert.ok(sess(1).at(-1).resumo);
  assert.deepEqual(evs(2), ['PreToolUse', 'PostToolUse']);
  assert.deepEqual(evs(3), ['PreToolUse', 'UserPromptSubmit']);
  assert.deepEqual(evs(4), ['PermissionRequest', 'Notification']);
  assert.equal(sess(4)[1].resumo, 'permission_prompt');
  assert.deepEqual(evs(5), ['PermissionRequest', 'PostToolUseFailure']);
  assert.deepEqual(evs(6), ['Stop', 'Elicitation']);
  assert.deepEqual(evs(7), ['Elicitation', 'ElicitationResult']);
  assert.deepEqual(evs(8), ['StopFailure']);
  assert.equal(evs(9).at(-1), 'Stop');
  assert.equal(evs(10).at(-1), 'Stop');
  assert.deepEqual(evs(11), ['Stop', 'UserPromptSubmit']);
  assert.deepEqual(evs(13), ['Stop', 'SessionEnd']);
});

test('vez: 9 a 60 s e 10 a 5 min do "agora"; 14 expirada (25 h)', () => {
  const at = (n) => (maxTs - Date.parse(sess(n).at(-1).ts)) / 1000;
  assert.equal(at(9), 60);
  assert.equal(at(10), 300);
  assert.equal(at(14), 25 * 3600);
  assert.equal(sess(14).length, 1);
});

test('12: Stop com subagente sem SubagentStop; 15: sem subagentes e com UserPromptSubmit sem espera; maior ts é da 15', () => {
  assert.deepEqual(evs(12), ['SubagentStart', 'Stop']);
  assert.ok(sess(12)[0].agent_id);
  assert.ok(evs(15).every((e) => e === 'UserPromptSubmit'));
  assert.equal(Date.parse(sess(15).at(-1).ts), maxTs);
  for (let n = 1; n <= 16; n++) if (n !== 12) assert.ok(!evs(n).some((e) => e.startsWith('Subagent')), `subagente na ${n}`);
});

test('16: linhas válidas em volta da inválida', () => {
  assert.deepEqual(evs(16), ['UserPromptSubmit', 'Stop', 'UserPromptSubmit']);
});
