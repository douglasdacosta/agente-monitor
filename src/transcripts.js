// Leitor de transcrições de subagentes (R37), com cache por arquivo e leitura incremental.
// Só lê `agent-<id>.jsonl` dentro de projectsRoot (validação de src/tokens.js). Nunca lança.
import fs from 'node:fs';
import { createTokenAcc, feedTokenLine, tokenResult, isAgentTranscriptPath, TOKENS_MAX_BYTES } from './tokens.js';

const NL = 10;

/**
 * @param {{projectsRoot: string|null, maxBytes?: number, chunkBytes?: number, maxEntries?: number}} opts
 *   projectsRoot = <homeDir>/.claude/projects, ou null (=> nunca lê; caso de --fixture).
 */
export function createTranscriptReader({ projectsRoot, maxBytes = TOKENS_MAX_BYTES, chunkBytes = 8 * 1024 * 1024, maxEntries = 500 } = {}) {
  const cache = new Map(); // file -> {ino, size, mtimeMs, offset, acc, rest, result}
  let opens = 0;

  const touch = (file, e) => {
    cache.delete(file);
    cache.set(file, e);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  };
  const feedText = (acc, text) => {
    for (const line of text.split('\n')) {
      if (line.includes('"assistant"') && line.includes('"usage"')) feedTokenLine(acc, line);
    }
  };

  function read(file, agentId) {
    if (!projectsRoot || !isAgentTranscriptPath(file, agentId, projectsRoot)) return null;
    let fd;
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > maxBytes) {
        cache.delete(file);
        return null;
      }
      let e = cache.get(file);
      if (e && e.ino === st.ino && e.size === st.size && e.mtimeMs === st.mtimeMs) {
        touch(file, e);
        return e.result;
      }
      if (!e || e.ino !== st.ino || st.size < e.offset) {
        e = { ino: st.ino, size: -1, mtimeMs: -1, offset: 0, acc: createTokenAcc(), rest: Buffer.alloc(0), result: null };
      }
      opens++;
      fd = fs.openSync(file, 'r');
      const want = Math.min(chunkBytes, st.size - e.offset);
      const buf = Buffer.allocUnsafe(Math.max(0, want));
      let got = 0;
      while (got < want) {
        const n = fs.readSync(fd, buf, got, want - got, e.offset + got);
        if (n === 0) break;
        got += n;
      }
      const data = e.rest.length ? Buffer.concat([e.rest, buf.subarray(0, got)]) : buf.subarray(0, got);
      const cut = data.lastIndexOf(NL);
      if (cut >= 0) feedText(e.acc, data.subarray(0, cut).toString('utf8'));
      e.rest = Buffer.from(cut >= 0 ? data.subarray(cut + 1) : data);
      e.offset += got;
      // Linha final sem '\n' conta, mas só numa cópia: quando o '\n' chegar ela entra de verdade (sem contar duas vezes).
      let acc = e.acc;
      if (e.rest.length && e.offset >= st.size) {
        acc = { byId: new Map(e.acc.byId), loose: e.acc.loose.slice(), models: e.acc.models.slice() };
        feedText(acc, e.rest.toString('utf8'));
      }
      e.result = tokenResult(acc);
      if (e.offset >= st.size) {
        e.size = st.size;
        e.mtimeMs = st.mtimeMs;
      } // senão: assinatura não casa e a próxima chamada continua de `offset`
      touch(file, e);
      return e.result;
    } catch {
      cache.delete(file);
      return null;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    }
  }

  /** Como `read`, mas só se o arquivo foi modificado depois de `afterMs` (BUG-3: transcrição gravada depois do SubagentStop). */
  function readIfNewer(file, agentId, afterMs) {
    if (!projectsRoot || !Number.isFinite(afterMs) || !isAgentTranscriptPath(file, agentId, projectsRoot)) return null;
    try {
      if (fs.statSync(file).mtimeMs <= afterMs) return null;
    } catch {
      return null;
    }
    return read(file, agentId);
  }

  return { read, readIfNewer, _opens: () => opens, _size: () => cache.size };
}
