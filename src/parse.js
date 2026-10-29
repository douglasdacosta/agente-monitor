// Linhas de .jsonl -> eventos válidos. Módulo puro (sem fs), usável no servidor e no navegador.

/**
 * @param {string|string[]} input texto inteiro do arquivo ou array de linhas
 * @returns {{events: object[], warnings: string[]}}
 *   events: objetos originais acrescidos de `t` (ms desde epoch) e `line` (nº da linha, base 1).
 */
export function parseLines(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const events = [];
  const warnings = [];
  lines.forEach((text, i) => {
    const line = i + 1;
    if (typeof text !== 'string' || text.trim() === '') return;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      warnings.push(`linha ${line}: JSON inválido, ignorada`);
      return;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      warnings.push(`linha ${line}: não é um objeto, ignorada`);
      return;
    }
    if (typeof obj.event !== 'string' || !obj.event) {
      warnings.push(`linha ${line}: sem "event", ignorada`);
      return;
    }
    const t = typeof obj.ts === 'string' ? Date.parse(obj.ts) : NaN;
    if (Number.isNaN(t)) {
      warnings.push(`linha ${line}: sem "ts" válido, ignorada`);
      return;
    }
    events.push({ ...obj, t, line });
  });
  return { events, warnings };
}
