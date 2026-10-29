// Título (nome amigável) de cada sessão. Faz I/O somente quando recebe `homeDir`; nunca lança.
// Ordem: (a) Orca conversationName, (b) custom-title do Claude Code, (c) ai-title, (d) `session_title` de um
// evento, (e) null. Nada aqui devolve caminhos: só `{title, titleSource}`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ORCA_MIN_INTERVAL_MS = 5000;
export const PYTHON_TIMEOUT_MS = 3000;
const TITLE_MAX = 200;
const TAIL_SIZES = [64 * 1024, 256 * 1024, 1024 * 1024, 2 * 1024 * 1024];
const SAFE_ID_RE = /^[\w.-]+$/;

// SQLite via stdlib do Python: somente leitura (mode=ro), nunca escreve. Saída: {byClaude:{}, byOrca:{}}.
const PY_SCRIPT = `
import sys, json, sqlite3, urllib.parse
uri = 'file:' + urllib.parse.quote(sys.argv[1]) + '?mode=ro'
con = sqlite3.connect(uri, uri=True, timeout=1)
out = {'byClaude': {}, 'byOrca': {}}
for sid, raw in con.execute('SELECT session_id, record_json FROM agent_session_records'):
    try:
        r = json.loads(raw)
    except Exception:
        continue
    name = r.get('conversationName') if isinstance(r, dict) else None
    if not isinstance(name, str) or not name.strip():
        continue
    out['byOrca'][sid] = name
    for h in (r.get('providerHandleChain') or []):
        hd = h.get('handle') if isinstance(h, dict) else None
        if isinstance(hd, dict) and hd.get('provider') == 'claude' and isinstance(hd.get('sessionId'), str):
            out['byClaude'][hd['sessionId']] = name
con.close()
print(json.dumps(out))
`;

const clean = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, TITLE_MAX) : null;
};

const mtimeOf = (f) => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};

/** Extrai, por sessão, as dicas dos eventos: último session_title, transcript_path e orca_session_id. */
export function collectHints(lines) {
  const hints = new Map();
  for (const l of lines) {
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const k = o.session_id ?? '';
    const h = hints.get(k) ?? {};
    const t = clean(o.session_title);
    if (t) h.eventTitle = t;
    if (typeof o.transcript_path === 'string' && o.transcript_path) h.transcriptPath = o.transcript_path;
    if (typeof o.orca_session_id === 'string' && o.orca_session_id) h.orcaId = o.orca_session_id;
    hints.set(k, h);
  }
  return hints;
}

/** Lê o fim do arquivo (blocos crescentes) e devolve {custom, ai} da última ocorrência de cada um. */
export function readTranscriptTitles(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    let custom = null;
    let ai = null;
    for (const want of TAIL_SIZES) {
      const len = Math.min(want, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      if (len < size) lines.shift(); // primeira linha pode estar cortada
      custom = ai = null;
      for (let i = lines.length - 1; i >= 0 && !custom; i--) {
        const l = lines[i];
        const isCustom = l.includes('"custom-title"');
        if (!isCustom && !(ai === null && l.includes('"ai-title"'))) continue;
        try {
          const o = JSON.parse(l);
          if (o.type === 'custom-title') custom = clean(o.customTitle);
          else if (o.type === 'ai-title' && ai === null) ai = clean(o.aiTitle);
        } catch {}
      }
      if (custom || len >= size) break;
    }
    return { custom, ai };
  } catch {
    return { custom: null, ai: null };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/**
 * @param {{homeDir?: string|null, orcaDataDir?: string|null, enabled?: boolean, now?: () => number,
 *   onWarn?: (msg: string) => void}} [opts]
 * @returns {{resolve(sessionId: string, hint?: object): {title: string|null, titleSource: string|null}}}
 */
export function createTitleResolver(opts = {}) {
  const homeDir = opts.enabled === false ? null : (opts.homeDir ?? null);
  const now = opts.now ?? Date.now;
  const warn = opts.onWarn ?? ((m) => console.warn(m));
  const warned = new Set();
  const warnOnce = (key, msg) => {
    if (warned.has(key)) return;
    warned.add(key);
    try { warn(msg); } catch {}
  };
  const projectsDir = homeDir ? path.join(homeDir, '.claude', 'projects') : null;

  // ---- Orca ----
  const orcaDirs = !homeDir
    ? []
    : opts.orcaDataDir
      ? [opts.orcaDataDir]
      : [path.join(homeDir, '.config', 'orca'), path.join(homeDir, 'Library', 'Application Support', 'orca')];
  let orca = { key: null, at: -Infinity, maps: { byClaude: {}, byOrca: {} } };
  const queryOrca = () => {
    const db = orcaDirs.map((d) => path.join(d, 'agent-session-journal.db')).find((f) => mtimeOf(f) > 0);
    if (!db) return orca.maps;
    const key = `${db}:${mtimeOf(db)}:${mtimeOf(db + '-wal')}`;
    const t = now();
    if (key === orca.key || t - orca.at < ORCA_MIN_INTERVAL_MS) return orca.maps;
    let maps = orca.maps;
    try {
      const r = spawnSync('python3', ['-I', '-c', PY_SCRIPT, db], {
        encoding: 'utf8',
        timeout: PYTHON_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (r.error || r.status !== 0) {
        warnOnce('python', 'títulos do Orca indisponíveis (python3 ausente ou falhou); seguindo sem eles');
      } else {
        const j = JSON.parse(r.stdout);
        maps = { byClaude: j.byClaude ?? {}, byOrca: j.byOrca ?? {} };
      }
    } catch {
      warnOnce('python', 'títulos do Orca indisponíveis (saída inválida); seguindo sem eles');
    }
    orca = { key, at: t, maps };
    return maps;
  };

  // ---- Transcrição ----
  const tcache = new Map(); // arquivo -> {sig, value}
  const transcriptTitles = (file) => {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return null;
    }
    const sig = `${st.mtimeMs}:${st.size}`;
    const hit = tcache.get(file);
    if (hit && hit.sig === sig) return hit.value;
    const value = readTranscriptTitles(file);
    tcache.set(file, { sig, value });
    return value;
  };
  const inside = (dir, f) => {
    const rel = path.relative(dir, path.resolve(f));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const findTranscript = (sid, hint) => {
    if (hint?.transcriptPath && path.isAbsolute(hint.transcriptPath) && hint.transcriptPath.endsWith('.jsonl')
      && inside(projectsDir, hint.transcriptPath) && mtimeOf(hint.transcriptPath) > 0) {
      return path.resolve(hint.transcriptPath);
    }
    if (!SAFE_ID_RE.test(sid)) return null;
    try {
      for (const d of fs.readdirSync(projectsDir)) {
        const f = path.join(projectsDir, d, `${sid}.jsonl`);
        if (mtimeOf(f) > 0) return f;
      }
    } catch {}
    return null;
  };

  return {
    resolve(sessionId, hint = {}) {
      const sid = sessionId ?? '';
      if (homeDir) {
        try {
          const maps = queryOrca();
          const name = clean(maps.byClaude[sid]) ?? (hint.orcaId ? clean(maps.byOrca[hint.orcaId]) : null);
          if (name) return { title: name, titleSource: 'orca' };
        } catch {}
        let tt = null;
        try {
          const f = sid ? findTranscript(sid, hint) : null;
          tt = f ? transcriptTitles(f) : null;
        } catch {}
        if (tt?.custom) return { title: tt.custom, titleSource: 'claude' };
        if (tt?.ai) return { title: tt.ai, titleSource: 'claude' };
      }
      if (hint.eventTitle) return { title: hint.eventTitle, titleSource: 'evento' };
      return { title: null, titleSource: null };
    },
  };
}
