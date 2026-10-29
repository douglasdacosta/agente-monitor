// Fonte única de domínio dos papéis do time (R3.1) e dos níveis para "retorno" (R6.1).
// O `developer` é o papel legado: continua reconhecido e nunca é normalizado.

export const ROLE_LEVEL = Object.freeze({
  'project-manager': 1,
  designer: 2,
  'tech-lead': 3,
  'dev-backend': 4,
  'dev-frontend': 4,
  developer: 4,
  qa: 5,
});

export const TEAM_ROLES = Object.freeze(Object.keys(ROLE_LEVEL));
