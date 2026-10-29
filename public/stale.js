// Fonte única do limite de "sem término" (R7/R24). ES module sem dependências: importado pelo
// cliente (./stale.js) e pelo servidor (./public/stale.js).
export const STALE_MS = 2 * 3600e3;

/** Sessão "em andamento": tem nó running e não está "sem término" (R7/R24). */
export function isLiveSession(s, now = Date.now()) {
  return s.running > 0 && now - Date.parse(s.last_ts) <= STALE_MS;
}
