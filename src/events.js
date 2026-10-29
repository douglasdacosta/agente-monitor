// Leitura do arquivo de eventos (.jsonl). Só leitura; nunca escreve.
import fs from 'node:fs';

/** Lê o jsonl tolerando arquivo ausente e última linha parcial (append em andamento). */
export function readEventLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return { exists: false, lines: [] };
    throw err;
  }
  const lines = text.split(/\r?\n/);
  const last = lines[lines.length - 1];
  if (last !== '') {
    // Não termina em \n: a última linha pode estar incompleta. Só vale se for JSON completo.
    try {
      JSON.parse(last);
    } catch {
      lines.pop();
    }
  }
  return { exists: true, lines };
}
