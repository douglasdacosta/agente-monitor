// Descoberta de projetos (R21/R22). Faz I/O, mas recebe todos os diretórios por parâmetro (nunca lê o `~`
// sozinho) e nunca lança. Só leitura: não escreve em nada.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readEventLines } from './events.js';
import { buildModel } from './model.js';
import { projectDirOf } from './team.js';

export const HEAD_BYTES = 64 * 1024;
export const REDISCOVER_MS = 30_000;

/** Primeiro `cwd` (string absoluta) de uma linha JSON válida entre os primeiros `maxBytes`, ou null. Nunca lança. */
export function readCwdFromHead(file, { maxBytes = HEAD_BYTES } = {}) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    const lines = buf.toString('utf8', 0, n).split('\n');
    if (n === maxBytes) lines.pop(); // bloco cortado: a última linha pode estar incompleta
    for (const l of lines) {
      if (!l.includes('"cwd"')) continue;
      try {
        const cwd = JSON.parse(l)?.cwd;
        if (typeof cwd === 'string' && path.isAbsolute(cwd)) return cwd;
      } catch {}
    }
  } catch {
    // leitura que falha é silenciosa
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
  return null;
}

/** `<homeDir>/.claude/projects/*\/*.jsonl` (1º nível de cada slug; `<id>/subagents/` fica de fora). */
export function listTranscripts(homeDir) {
  const out = [];
  if (!homeDir) return out;
  const root = path.join(homeDir, '.claude', 'projects');
  let slugs;
  try {
    slugs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, slug.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(root, slug.name, e.name));
  }
  return out;
}

/** R22: basename(dir); `<dir>/.git` ARQUIVO (worktree) => `pai · pasta`. */
export function projectName(dir) {
  let worktree = false;
  try {
    worktree = fs.lstatSync(path.join(dir, '.git')).isFile();
  } catch {}
  const base = path.basename(dir);
  return { name: worktree ? `${path.basename(path.dirname(dir))} · ${base}` : base, worktree };
}

/** 'p' + sha256(chave).hex.slice(0, 12). */
export function projectId(key) {
  return 'p' + crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}

/** `~` + resto se p === homeDir ou está dentro dele; senão p. */
export function abbreviateHome(p, homeDir) {
  if (!homeDir || typeof p !== 'string') return p;
  const home = homeDir.length > 1 ? homeDir.replace(/[\\/]+$/, '') : homeDir;
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

const dirOf = (p) => p.dir ?? p.projectDir ?? (p.file ? path.dirname(p.file) : '');

/** Desempate R22, determinístico: 1) ` (pasta de referência)`; 2) se ainda colidir, ` (path abreviado)`. */
export function disambiguate(projects) {
  const groups = (list) => {
    const m = new Map();
    for (const p of list) {
      if (!m.has(p.name)) m.set(p.name, []);
      m.get(p.name).push(p);
    }
    return [...m.values()].filter((g) => g.length > 1);
  };
  for (const g of groups(projects)) {
    for (const p of g) {
      const d = dirOf(p);
      const ref = path.basename(p.worktree ? path.dirname(path.dirname(d)) : path.dirname(d));
      p.name = `${p.name} (${ref})`;
    }
  }
  for (const g of groups(projects)) for (const p of g) p.name = `${p.name} (${p.path})`;
}

export function createDiscoveryCache() {
  return { transcripts: new Map() };
}

function defaultHasSessions(file) {
  try {
    return buildModel(readEventLines(file).lines).sessions.length > 0;
  } catch {
    return false;
  }
}

const realOr = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Nunca lança. Candidatos: cwd das transcrições (se homeDir && scan), `cwd`, `repoDir`; mais `files` explícitos
 * (sempre entram, mesmo vazios ou inexistentes). Ver docs/tecnico.md (v1.3).
 */
export function discoverProjects({
  homeDir = null,
  scan = true,
  cwd = null,
  repoDir = null,
  files = [],
  cache = createDiscoveryCache(),
  readHead = readCwdFromHead,
  hasSessions = defaultHasSessions,
} = {}) {
  const warnings = [];
  const found = new Map(); // key -> project
  const homeReal = homeDir ? realOr(homeDir) : null;
  const claudeDirs = homeDir ? [path.resolve(homeDir, '.claude'), ...(homeReal ? [path.join(homeReal, '.claude')] : [])] : [];
  const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
  const shown = (p) => {
    const a = abbreviateHome(p, homeDir);
    return a === p && homeReal ? abbreviateHome(p, homeReal) : a;
  };

  try {
    for (const f of files) {
      try {
        const file = path.resolve(f);
        const key = realOr(file) ?? file;
        if (found.has(key)) continue;
        const projectDir = projectDirOf(file);
        const info = projectDir ? projectName(projectDir) : { name: path.basename(path.dirname(file)), worktree: false };
        found.set(key, {
          id: projectId(key),
          key,
          file,
          projectDir,
          name: info.name,
          worktree: info.worktree,
          path: shown(projectDir ?? path.dirname(file)),
        });
      } catch {}
    }

    const candidates = [];
    if (homeDir && scan) {
      const transcripts = listTranscripts(homeDir);
      const alive = new Set(transcripts);
      for (const t of [...cache.transcripts.keys()]) if (!alive.has(t)) cache.transcripts.delete(t);
      const seen = new Set();
      for (const t of transcripts) {
        let entry = cache.transcripts.get(t);
        if (!entry || entry.cwd === null) {
          let size = -1;
          try {
            size = fs.statSync(t).size;
          } catch {}
          if (!entry || entry.size !== size) {
            entry = { size, cwd: readHead(t) };
            cache.transcripts.set(t, entry);
          }
        }
        if (entry.cwd && !seen.has(entry.cwd)) {
          seen.add(entry.cwd);
          candidates.push(entry.cwd);
        }
      }
    }
    if (cwd) candidates.push(cwd);
    if (repoDir) candidates.push(repoDir);

    for (const c of candidates) {
      try {
        const dir = realOr(path.resolve(c));
        if (!dir) continue; // cwd morto
        if (claudeDirs.some((d) => inside(dir, d))) continue;
        const file = path.join(dir, '.monitor', 'events.jsonl');
        if (!isFile(file)) continue;
        const key = realOr(file) ?? file;
        if (found.has(key)) continue;
        if (!hasSessions(file)) continue;
        const info = projectName(dir);
        found.set(key, { id: projectId(key), key, file, projectDir: dir, name: info.name, worktree: info.worktree, path: shown(dir) });
      } catch {}
    }
  } catch {
    // nunca lança
  }

  const projects = [...found.values()];
  disambiguate(projects);
  return { projects, warnings };
}
