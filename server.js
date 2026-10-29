// Servidor do monitor: estático (public/) + API + SSE. Só módulos nativos.
//
// A lógica de domínio (parse/model/edges) roda APENAS aqui; o navegador recebe o resultado pronto
// (/api/flow). Única exceção deliberada: "sem término" (STALE_MS) é calculado no cliente (public/app.js),
// porque depende do relógio do navegador e precisa virar sozinho sem novo evento.
//
// Uso:  node server.js [--fixture arquivo.jsonl] [--port 4317] [--events caminho.jsonl] [--config monitor.json] [--no-titles]
// Env:  PORT, MONITOR_FIXTURE, MONITOR_EVENTS, MONITOR_CONFIG, MONITOR_TITLES=0, ORCA_USER_DATA_PATH, MONITOR_HOST (padrão 127.0.0.1)
// O time (definições de agentes e config de papéis) é descoberto a cada leitura; `~` só é lido se a CLI passar
// `homeDir` (nunca no modo --fixture).
// Títulos das sessões (src/titles.js): Orca/Claude Code só com `homeDir` da CLI; `--no-titles`/MONITOR_TITLES=0 desliga.
// Este processo NUNCA escreve em .monitor/events.jsonl: só lê.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildModel } from './src/model.js';
import { buildEdges } from './src/edges.js';
import { discoverTeam, projectDirOf } from './src/team.js';
import { describeRoles } from './src/roles.js';
import { createTitleResolver, collectHints } from './src/titles.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
export const DEFAULT_EVENTS = path.join(ROOT, '.monitor', 'events.jsonl');
export const DEFAULT_PORT = 4317;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

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

/** Deslocamento (ms) que leva o maior ts das linhas para `now`; 0 se não houver ts válido. */
export function fixtureShiftMs(lines, now) {
  let max = -Infinity;
  for (const l of lines) {
    try {
      const t = Date.parse(JSON.parse(l)?.ts);
      if (t > max) max = t;
    } catch {}
  }
  return Number.isFinite(max) ? now - max : 0;
}

/** Soma `shift` ms ao ts de cada linha JSON válida; linhas inválidas passam intactas. */
export function shiftLines(lines, shift) {
  return lines.map((l) => {
    try {
      const o = JSON.parse(l);
      const t = Date.parse(o?.ts);
      if (Number.isNaN(t)) return l;
      return JSON.stringify({ ...o, ts: new Date(t + shift).toISOString() });
    } catch {
      return l;
    }
  });
}

function statSig(file) {
  try {
    const s = fs.statSync(file);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

/**
 * @param {{file?: string, fixture?: string|null, host?: string, pollMs?: number, heartbeatMs?: number,
 *   configPath?: string|null, homeDir?: string|null, orcaDataDir?: string|null, titles?: boolean,
 *   onWarn?: (msg: string) => void}} [opts]
 *   homeDir: pasta cujo `.claude/` vale como global; padrão null (nunca lê o `~` por conta própria) e sempre null com fixture.
 * @returns {{server: http.Server, source: object, listen(port?: number): Promise<number>, close(): Promise<void>}}
 */
export function createApp(opts = {}) {
  const fixture = opts.fixture ? path.resolve(opts.fixture) : null;
  const file = fixture ?? path.resolve(opts.file ?? DEFAULT_EVENTS);
  const host = opts.host ?? '127.0.0.1';
  const pollMs = opts.pollMs ?? 1000;
  const heartbeatMs = opts.heartbeatMs ?? 15000;
  const configPath = opts.configPath ? path.resolve(opts.configPath) : null;
  const homeDir = fixture ? null : (opts.homeDir ?? null); // R13: fixture igual em qualquer máquina
  const projectDir = projectDirOf(file);
  const titleResolver = createTitleResolver({
    homeDir,
    orcaDataDir: fixture ? null : (opts.orcaDataDir ?? null),
    enabled: opts.titles !== false,
    onWarn: opts.onWarn,
  });

  const source = () => ({
    path: file,
    exists: fs.existsSync(file),
    fixture: fixture ? path.basename(fixture) : null,
  });
  // Fixture: desloca todos os ts para o último evento cair em ~agora (preserva intervalos). Offset fixo por instância.
  let fixtureShift = null;
  const load = () => {
    let { lines } = readEventLines(file);
    if (fixture) {
      if (fixtureShift === null) fixtureShift = fixtureShiftMs(lines, Date.now());
      lines = shiftLines(lines, fixtureShift);
    }
    const team = discoverTeam({ projectDir, homeDir, configPath }); // R18: relido a cada leitura (cache por mtime)
    const model = buildModel(lines, { team });
    const hints = collectHints(lines);
    const sessions = model.sessions.map((s) => ({ ...s, ...titleResolver.resolve(s.session_id, hints.get(s.session_id)) }));
    return { ...model, sessions, team, warnings: [...model.warnings, ...team.warnings] };
  };
  if (fixture) load(); // fixa o deslocamento na subida: o relógio dos nós "running" corre desde o início do servidor

  // ---- SSE: um único observador compartilhado, ligado só enquanto há clientes ----
  const clients = new Set();
  let watcher = null;
  let pollTimer = null;
  let beatTimer = null;
  let lastSig = null;

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  const check = () => {
    const sig = statSig(file);
    if (sig !== lastSig) {
      lastSig = sig;
      broadcast('update', { ts: new Date().toISOString() });
    }
  };
  const startWatching = () => {
    if (watcher || pollTimer) return;
    lastSig = statSig(file);
    try {
      // Observa o diretório: cobre arquivo criado depois ou recriado (troca de inode).
      watcher = fs.watch(path.dirname(file), { persistent: false }, (_ev, name) => {
        if (!name || name === path.basename(file)) check();
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null; // sem fs.watch: o polling cobre
    }
    pollTimer = setInterval(check, pollMs);
    beatTimer = setInterval(() => {
      for (const res of clients) res.write(': ping\n\n');
    }, heartbeatMs);
  };
  const stopWatching = () => {
    watcher?.close();
    watcher = null;
    clearInterval(pollTimer);
    clearInterval(beatTimer);
    pollTimer = beatTimer = null;
  };

  // ---- Handlers ----
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function apiSessions(res) {
    const { sessions } = load();
    json(res, 200, { sessions, source: source() });
  }

  function apiFlow(res, url) {
    const { executions, sessions, warnings, team } = load();
    const wanted = url.searchParams.get('session');
    const hideOthers = ['1', 'true'].includes(url.searchParams.get('hideOthers'));
    if (!sessions.length) {
      return json(res, 200, { session: null, executions: [], edges: [], others: 0, roles: [], warnings, source: source() });
    }
    const session = wanted === null ? sessions[0] : sessions.find((s) => s.session_id === wanted);
    if (!session) return json(res, 404, { error: `sessão não encontrada: ${wanted}` });
    const mine = executions.filter((e) => (e.session_id ?? '') === session.session_id);
    const { nodes, edges, levels } = buildEdges(mine, { hideOthers, team });
    const others = mine.filter((e) => e.role === 'outro').length;
    const roleWarnings = [];
    const roles = describeRoles(mine, levels, team, roleWarnings);
    json(res, 200, {
      session,
      executions: nodes,
      edges,
      others,
      roles,
      warnings: [...warnings, ...roleWarnings],
      source: source(),
    });
  }

  function apiStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n: conectado\n\n');
    clients.add(res);
    startWatching();
    req.on('close', () => {
      clients.delete(res);
      if (!clients.size) stopWatching();
    });
  }

  function serveStatic(res, pathname, head) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return json(res, 400, { error: 'caminho inválido' });
    }
    if (rel.includes('\0')) return json(res, 400, { error: 'caminho inválido' });
    if (rel.endsWith('/')) rel += 'index.html';
    const abs = path.join(PUBLIC_DIR, path.normalize(rel));
    if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'proibido' });
    fs.readFile(abs, (err, data) => {
      if (err) return json(res, 404, { error: 'não encontrado' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(head ? undefined : data);
    });
  }

  const server = http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return json(res, 405, { error: 'método não permitido' });
      }
      const url = new URL(req.url, 'http://localhost');
      switch (url.pathname) {
        case '/api/sessions':
          return apiSessions(res);
        case '/api/flow':
          return apiFlow(res, url);
        case '/api/stream':
          return apiStream(req, res);
        default:
          if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'não encontrado' });
          return serveStatic(res, url.pathname, req.method === 'HEAD');
      }
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: String(err.message ?? err) });
      else res.end();
    }
  });

  return {
    server,
    source,
    listen: (port = DEFAULT_PORT) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        stopWatching();
        for (const res of clients) res.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

// ---- CLI ----
function parseArgs(argv, env) {
  const out = {
    fixture: env.MONITOR_FIXTURE || null,
    file: env.MONITOR_EVENTS || null,
    config: env.MONITOR_CONFIG || null,
    port: env.PORT,
    titles: !['0', 'false', 'off'].includes(String(env.MONITOR_TITLES ?? '').toLowerCase()),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--fixture') out.fixture = val();
    else if (a.startsWith('--fixture=')) out.fixture = a.slice(10);
    else if (a === '--port') out.port = val();
    else if (a.startsWith('--port=')) out.port = a.slice(7);
    else if (a === '--events') out.file = val();
    else if (a.startsWith('--events=')) out.file = a.slice(9);
    else if (a === '--config') out.config = val();
    else if (a.startsWith('--config=')) out.config = a.slice(9);
    else if (a === '--no-titles') out.titles = false;
  }
  const port = out.port === undefined || out.port === '' ? DEFAULT_PORT : Number(out.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`porta inválida: ${out.port}`);
  return { ...out, port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let cfg;
  try {
    cfg = parseArgs(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const app = createApp({
    fixture: cfg.fixture,
    file: cfg.file ?? undefined,
    host: process.env.MONITOR_HOST,
    configPath: cfg.config,
    homeDir: cfg.fixture ? null : os.homedir(), // só a CLI lê o `~`, e nunca com --fixture
    orcaDataDir: process.env.ORCA_USER_DATA_PATH || null,
    titles: cfg.titles,
  });
  app
    .listen(cfg.port)
    .then((port) => {
      const s = app.source();
      console.log(`monitor-execucao em http://${process.env.MONITOR_HOST ?? '127.0.0.1'}:${port}`);
      console.log(`${s.fixture ? 'fixture' : 'eventos'}: ${s.path}${s.exists ? '' : ' (ainda não existe)'}`);
    })
    .catch((err) => {
      console.error(`falha ao iniciar: ${err.message}`);
      process.exit(1);
    });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
