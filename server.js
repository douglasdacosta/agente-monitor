// Servidor do monitor: estático (public/) + API + SSE. Só módulos nativos.
//
// A lógica de domínio (parse/model/edges) roda APENAS aqui; o navegador recebe o resultado pronto
// (/api/flow). Única exceção deliberada: "sem término" (STALE_MS) é calculado no cliente (public/app.js),
// porque depende do relógio do navegador e precisa virar sozinho sem novo evento.
//
// Uso:  node server.js [--fixture arquivo.jsonl] [--port 4317] [--events caminho.jsonl]... [--config monitor.json] [--no-titles]
// Modos: sem --events/--fixture = multi-projeto com descoberta (R20/R21); 1 --events ou --fixture = projeto único (v1.2);
//        2+ --events (flag repetível) = multi restrito a esses arquivos, sem descoberta.
// Env:  PORT, MONITOR_FIXTURE, MONITOR_EVENTS, MONITOR_CONFIG, MONITOR_TITLES=0, ORCA_USER_DATA_PATH, MONITOR_HOST (padrão 127.0.0.1)
// O time (definições de agentes e config de papéis) é descoberto a cada leitura; `~` só é lido se a CLI passar
// `homeDir` (nunca no modo --fixture).
// Títulos das sessões (src/titles.js): Orca/Claude Code só com `homeDir` da CLI; `--no-titles`/MONITOR_TITLES=0 desliga.
// GET /api/waits (v1.4): esperas de todos os projetos, somente leitura; a API não executa nada.
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
import { readEventLines } from './src/events.js';
import { scanWaits, finalizeWaits } from './src/waits.js';
import { readAlertConfig } from './src/alert-config.js';
import { EMPTY_TEAM } from './src/team.js';
import { discoverProjects, createDiscoveryCache, projectId, projectName, abbreviateHome, REDISCOVER_MS } from './src/projects.js';
import { isLiveSession } from './public/stale.js';

export { readEventLines };

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
 * @param {{file?: string, fixture?: string|null, files?: string[], discover?: boolean, cwd?: string|null,
 *   repoDir?: string|null, rediscoverMs?: number, host?: string, pollMs?: number, heartbeatMs?: number,
 *   configPath?: string|null, homeDir?: string|null, orcaDataDir?: string|null, titles?: boolean,
 *   onWarn?: (msg: string) => void}} [opts]
 *   homeDir: pasta cujo `.claude/` vale como global; padrão null (nunca lê o `~` por conta própria) e sempre null com fixture.
 *   Modo: fixture => único; discover => multi com descoberta; files.length >= 2 => multi restrito; senão único.
 * @returns {{server: http.Server, mode: string, source: Function, projects: Function, listen(port?: number): Promise<number>, close(): Promise<void>}}
 */
export function createApp(opts = {}) {
  const fixture = opts.fixture ? path.resolve(opts.fixture) : null;
  const explicit = fixture ? [] : (opts.files ?? []).map((f) => path.resolve(f));
  const discover = !fixture && opts.discover === true;
  const multi = !fixture && (discover || explicit.length >= 2);
  const mode = multi ? 'multi' : 'single';
  const file0 = fixture ?? path.resolve(explicit.length === 1 ? explicit[0] : (opts.file ?? DEFAULT_EVENTS));
  const host = opts.host ?? '127.0.0.1';
  const pollMs = opts.pollMs ?? 1000;
  const heartbeatMs = opts.heartbeatMs ?? 15000;
  const rediscoverMs = opts.rediscoverMs ?? REDISCOVER_MS;
  const configPath = opts.configPath ? path.resolve(opts.configPath) : null;
  const homeDir = fixture ? null : (opts.homeDir ?? null); // R13: fixture igual em qualquer máquina
  const homeReal = (() => {
    try {
      return homeDir ? fs.realpathSync(homeDir) : null;
    } catch {
      return null;
    }
  })();
  const shown = (p) => {
    const a = abbreviateHome(p, homeDir);
    return a === p && homeReal ? abbreviateHome(p, homeReal) : a;
  };
  const titleResolver = createTitleResolver({
    homeDir,
    orcaDataDir: fixture ? null : (opts.orcaDataDir ?? null),
    enabled: opts.titles !== false,
    onWarn: opts.onWarn,
  });

  // ---- Fontes: {id, name, path, worktree, file, projectDir, fixtureShift, lastSig} ----
  const sources = new Map();
  const makeSource = (p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    worktree: p.worktree,
    file: p.file,
    projectDir: p.projectDir,
    fixtureShift: null,
    lastSig: null,
  });

  // Resumo barato por arquivo (sem time, sem títulos), em cache por statSig.
  const summaries = new Map();
  // Fixture: desloca todos os ts para o último evento cair em ~agora (preserva intervalos). Offset fixo por fonte.
  const readLines = (src) => {
    let { lines } = readEventLines(src.file);
    if (fixture) {
      if (src.fixtureShift === null) src.fixtureShift = fixtureShiftMs(lines, Date.now());
      lines = shiftLines(lines, src.fixtureShift);
    }
    return lines;
  };
  const summary = (file, src = null) => {
    const sig = statSig(file);
    const hit = summaries.get(file);
    if (hit && hit.sig === sig) return hit;
    const lines = src ? readLines(src) : readEventLines(file).lines;
    const sessions = buildModel(lines, { team: EMPTY_TEAM }).sessions;
    // v1.4: o scan de esperas (sem relógio) e as dicas de título ficam no mesmo cache; o relógio entra em apiWaits.
    const entry = { sig, sessions, scan: scanWaits(lines), hints: collectHints(lines) };
    summaries.set(file, entry);
    return entry;
  };

  let watcher = null;
  let pollTimer = null;
  let beatTimer = null;
  let rediscoverTimer = null;
  const cache = createDiscoveryCache();
  let lastDiscovery = 0;
  const clients = new Set();
  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };

  /** Refaz o registro. Fonte que continua mantém o objeto; só emite `projects` se o conjunto de ids mudou. */
  function rediscover() {
    lastDiscovery = Date.now();
    const { projects } = discoverProjects({
      homeDir,
      scan: discover,
      cwd: discover ? (opts.cwd ?? null) : null,
      repoDir: discover ? (opts.repoDir ?? null) : null,
      files: explicit,
      cache,
      hasSessions: (f) => summary(f).sessions.length > 0,
    });
    let changed = false;
    const next = new Map();
    for (const p of projects) {
      let src = sources.get(p.id);
      if (!src) {
        src = makeSource(p);
        src.lastSig = pollTimer ? statSig(src.file) : null;
        changed = true;
      } else {
        src.name = p.name;
        src.path = p.path;
      }
      next.set(p.id, src);
    }
    for (const id of sources.keys()) if (!next.has(id)) changed = true;
    sources.clear();
    for (const [id, src] of next) sources.set(id, src);
    if (changed && clients.size) broadcast('projects', { ts: new Date().toISOString() });
  }

  if (mode === 'single') {
    const base = discoverProjects({ homeDir, scan: false, files: [file0] }).projects[0];
    if (fixture) {
      base.name = path.basename(fixture);
      base.path = fixture;
    }
    const src = makeSource(base);
    sources.set(src.id, src);
    if (fixture) readLines(src); // fixa o deslocamento na subida: o relógio dos nós "running" corre desde o início do servidor
  } else {
    rediscover();
  }
  const only = () => sources.values().next().value;

  const source = () => ({
    path: mode === 'single' ? file0 : null,
    exists: mode === 'single' ? fs.existsSync(file0) : false,
    fixture: fixture ? path.basename(fixture) : null,
  });
  const sourceOf = (src) => ({
    path: shown(src.file),
    exists: fs.existsSync(src.file),
    fixture: fixture ? path.basename(fixture) : null,
    project: src.id,
  });

  /** Lista na ordem R24: last_ts desc (null por último), depois name e id. `running` é calculado agora. */
  function listProjects(now = Date.now()) {
    const list = [...sources.values()].map((src) => {
      const { sessions } = summary(src.file, src);
      return {
        id: src.id,
        name: src.name,
        path: src.path,
        worktree: src.worktree,
        sessions: sessions.length,
        running: sessions.filter((s) => isLiveSession(s, now)).length,
        last_ts: sessions[0]?.last_ts ?? null,
      };
    });
    const t = (p) => (p.last_ts === null ? -Infinity : Date.parse(p.last_ts));
    list.sort((a, b) => t(b) - t(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return list;
  }

  const loadSource = (src) => {
    const lines = readLines(src);
    const team = discoverTeam({ projectDir: src.projectDir, homeDir, configPath }); // R18/R23: relido a cada leitura (cache por mtime)
    const model = buildModel(lines, { team });
    const hints = collectHints(lines);
    const sessions = model.sessions.map((s) => ({ ...s, ...titleResolver.resolve(s.session_id, hints.get(s.session_id)) }));
    return { ...model, sessions, team, warnings: [...model.warnings, ...team.warnings] };
  };

  // ---- SSE: um único observador compartilhado, ligado só enquanto há clientes ----
  const checkSource = (src) => {
    const sig = statSig(src.file);
    if (sig !== src.lastSig) {
      src.lastSig = sig;
      broadcast('update', { ts: new Date().toISOString(), project: src.id });
    }
  };
  const checkAll = () => {
    for (const src of [...sources.values()]) checkSource(src);
  };
  const startWatching = () => {
    if (pollTimer) return;
    for (const src of sources.values()) src.lastSig = statSig(src.file);
    if (mode === 'single') {
      const src = only();
      try {
        // Observa o diretório: cobre arquivo criado depois ou recriado (troca de inode).
        watcher = fs.watch(path.dirname(src.file), { persistent: false }, (_ev, name) => {
          if (!name || name === path.basename(src.file)) checkSource(src);
        });
        watcher.on('error', () => {
          watcher?.close();
          watcher = null;
        });
      } catch {
        watcher = null; // sem fs.watch: o polling cobre
      }
    }
    pollTimer = setInterval(checkAll, pollMs);
    beatTimer = setInterval(() => {
      for (const res of clients) res.write(': ping\n\n');
    }, heartbeatMs);
    if (discover) rediscoverTimer = setInterval(rediscover, rediscoverMs);
  };
  const stopWatching = () => {
    watcher?.close();
    watcher = null;
    clearInterval(pollTimer);
    clearInterval(beatTimer);
    clearInterval(rediscoverTimer);
    pollTimer = beatTimer = rediscoverTimer = null;
  };

  // ---- Handlers ----
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  /** Resolve `?project=`; responde 404 e devolve undefined se desconhecido; null = multi sem projetos. */
  function pickSource(res, url) {
    if (discover && Date.now() - lastDiscovery > rediscoverMs) rediscover();
    const wanted = url.searchParams.get('project');
    if (wanted !== null) {
      const src = sources.get(wanted);
      if (!src) {
        json(res, 404, { error: 'projeto não encontrado' });
        return undefined;
      }
      return src;
    }
    if (mode === 'single') return only();
    const first = listProjects()[0];
    return first ? sources.get(first.id) : null;
  }
  const NO_SOURCE = { path: null, exists: false, fixture: null, project: null };

  function apiProjects(res) {
    if (discover && Date.now() - lastDiscovery > rediscoverMs) rediscover();
    json(res, 200, { mode, projects: listProjects() });
  }

  /** v1.4: esperas de todas as fontes (global, somente leitura). Nunca expõe cwd, transcript_path nem caminhos. */
  function apiWaits(res) {
    if (discover && Date.now() - lastDiscovery > rediscoverMs) rediscover();
    const now = Date.now();
    // Config global (home + --config); no modo único vale também a do projeto.
    const { alertas, warnings } = readAlertConfig({
      homeDir,
      projectDir: mode === 'single' ? (only()?.projectDir ?? null) : null,
      configPath,
    });
    const vezMs = alertas.vezMinutos * 60e3;
    const expiraMs = alertas.expiraHoras * 3600e3;
    const waits = [];
    for (const src of sources.values()) {
      const { scan, hints } = summary(src.file, src);
      for (const w of finalizeWaits(scan, { now, vezMs, expiraMs })) {
        const t = titleResolver.resolve(w.session_id, hints.get(w.session_id));
        waits.push({
          id: `${src.id}:${w.session_id}:${w.since}`,
          project: src.id,
          project_name: src.name,
          session_id: w.session_id,
          title: t.title,
          titleSource: t.titleSource,
          kind: w.kind,
          since: w.since,
          resumo: w.resumo,
          agent_id: w.agent_id,
          urgent: w.urgent,
          expires_at: w.expires_at,
        });
      }
    }
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    waits.sort((a, b) => Number(b.urgent) - Number(a.urgent) || Date.parse(a.since) - Date.parse(b.since) || cmp(a.project, b.project) || cmp(a.session_id, b.session_id));
    json(res, 200, {
      now: new Date(now).toISOString(),
      config: { ...alertas, vez_ms: vezMs },
      waits,
      warnings,
    });
  }

  function apiSessions(res, url) {
    const src = pickSource(res, url);
    if (src === undefined) return;
    if (src === null) return json(res, 200, { sessions: [], source: NO_SOURCE });
    const { sessions } = loadSource(src);
    json(res, 200, { sessions, source: sourceOf(src) });
  }

  function apiFlow(res, url) {
    const src = pickSource(res, url);
    if (src === undefined) return;
    if (src === null) return json(res, 200, { session: null, executions: [], edges: [], others: 0, roles: [], warnings: [], source: NO_SOURCE });
    const { executions, sessions, warnings, team } = loadSource(src);
    const wanted = url.searchParams.get('session');
    const hideOthers = ['1', 'true'].includes(url.searchParams.get('hideOthers'));
    if (!sessions.length) {
      return json(res, 200, { session: null, executions: [], edges: [], others: 0, roles: [], warnings, source: sourceOf(src) });
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
      source: sourceOf(src),
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
        case '/api/projects':
          return apiProjects(res);
        case '/api/waits':
          return apiWaits(res);
        case '/api/sessions':
          return apiSessions(res, url);
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
    mode,
    source,
    projects: () => listProjects(),
    _debug: () => ({ watchers: watcher ? 1 : 0, timers: [pollTimer, beatTimer, rediscoverTimer].filter(Boolean).length, clients: clients.size }),
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
/** `--events` é repetível; `MONITOR_EVENTS` vale como 1 arquivo (a flag, se houver, substitui). */
export function parseArgs(argv, env = {}) {
  const out = {
    fixture: env.MONITOR_FIXTURE || null,
    files: env.MONITOR_EVENTS ? [env.MONITOR_EVENTS] : [],
    config: env.MONITOR_CONFIG || null,
    port: env.PORT,
    titles: !['0', 'false', 'off'].includes(String(env.MONITOR_TITLES ?? '').toLowerCase()),
  };
  let flagFiles = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--fixture') out.fixture = val();
    else if (a.startsWith('--fixture=')) out.fixture = a.slice(10);
    else if (a === '--port') out.port = val();
    else if (a.startsWith('--port=')) out.port = a.slice(7);
    else if (a === '--events') flagFiles.push(val());
    else if (a.startsWith('--events=')) flagFiles.push(a.slice(9));
    else if (a === '--config') out.config = val();
    else if (a.startsWith('--config=')) out.config = a.slice(9);
    else if (a === '--no-titles') out.titles = false;
  }
  flagFiles = flagFiles.filter((f) => typeof f === 'string' && f !== '');
  if (flagFiles.length) out.files = flagFiles;
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
  const home = cfg.fixture ? null : os.homedir(); // só a CLI lê o `~`, e nunca com --fixture
  const auto = !cfg.fixture && cfg.files.length === 0;
  const app = createApp({
    fixture: cfg.fixture,
    files: cfg.fixture ? [] : cfg.files,
    discover: auto,
    cwd: auto ? process.cwd() : null,
    repoDir: auto ? ROOT : null,
    host: process.env.MONITOR_HOST,
    configPath: cfg.config,
    homeDir: home,
    orcaDataDir: process.env.ORCA_USER_DATA_PATH || null,
    titles: cfg.titles,
  });
  app
    .listen(cfg.port)
    .then((port) => {
      console.log(`monitor-execucao em http://${process.env.MONITOR_HOST ?? '127.0.0.1'}:${port}`);
      if (app.mode === 'multi') {
        const list = app.projects();
        console.log(`modo: multi-projeto${auto ? ' (descoberta automática)' : ' (restrito aos --events)'}; ${list.length} projeto(s)`);
        for (const p of list) console.log(`  ${p.name} - ${p.path} (${p.sessions} sessão(ões))`);
      } else {
        const s = app.source();
        console.log(`modo: projeto único`);
        console.log(`${s.fixture ? 'fixture' : 'eventos'}: ${s.path}${s.exists ? '' : ' (ainda não existe)'}`);
      }
    })
    .catch((err) => {
      console.error(`falha ao iniciar: ${err.message}`);
      process.exit(1);
    });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
