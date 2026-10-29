# Planejamento técnico — v1.1 (time novo)

Tarefa 12 de `docs/plano.md`. Cobre as tarefas 13, 14 e 15. Regras: R3.1, R6.1, R9 a R12.

## Visão técnica
- A lógica de domínio continua só no servidor (`src/`), como já está no comentário de `server.js`. Os papéis e os níveis passam a viver numa **fonte única de domínio**: o arquivo novo `src/roles.js`, importado por `src/model.js` e `src/edges.js`.
- **Decisão 12b: a API não exporta metadados de papéis.** O contrato de `/api/flow` não muda. O cliente mantém uma única tabela de apresentação (`PAPEIS`, com nome e ordem vertical) que junta os atuais `ORDER` e `NOME`.
  - Justificativa: o que o cliente precisa (nome R10, ordem R11, cor, ícone) é apresentação, e cabe ao designer. O nível R6.1 é domínio e o cliente nunca o usa, porque as arestas já chegam tipadas. A ordem R11 nem coincide com o nível (`developer` fica antes de `dev-backend`).
  - Um papel novo sempre exige mexer no front (CSS `.papel-*` e `<symbol>`), então exportar a lista pela API não eliminaria a edição dupla. Só criaria acoplamento e faria o front depender do back.
  - O desvio entre as duas listas fica protegido por um **teste de sincronia** (task F2) e por um fallback no cliente para papel desconhecido.
- **Decisão 12c: o `role` sai na API exatamente como veio no evento** (R3.1). Valores possíveis: `project-manager | designer | tech-lead | dev-backend | dev-frontend | developer | qa | outro`. Não há mapa, alias nem normalização em nenhuma camada, nem no cliente. `developer` continua `developer`.
- O hook, `src/parse.js` e `server.js` não mudam. Os testes existentes (61, incluindo `test/qa-bordas.test.js`) não são editados. Os testes novos ficam em arquivos novos.

## Contratos

### Domínio — `src/roles.js` (novo, dono: dev-backend)
```js
export const ROLE_LEVEL = Object.freeze({
  'project-manager': 1, designer: 2, 'tech-lead': 3,
  'dev-backend': 4, 'dev-frontend': 4, developer: 4, qa: 5,
});
export const TEAM_ROLES = Object.freeze(Object.keys(ROLE_LEVEL)); // R3.1 (inclui o legado developer)
```
- `src/model.js` continua exportando `TEAM_ROLES` (reexporta de `roles.js`).
- `src/edges.js` continua exportando `ROLE_ORDER` (alias de `ROLE_LEVEL`), para compatibilidade.
- `edgeType` não muda de forma: `outro` vale `avanço`, `qa`+REPROVADO vale `retorno`, e `nível(to) < nível(from)` vale `retorno`. Mesmo nível vale `avanço`.

### API — `/api/flow` (sem mudança de forma)
Mesmo JSON de hoje: `{session, executions, edges, others, warnings, source}`. Só o conjunto de valores de `executions[].role` cresce, conforme a lista da 12c. O JSDoc de `buildModel` deve ser atualizado com essa lista.

### Apresentação — cliente (dono: dev-frontend)
- **`public/app.js`**: `ORDER` e `NOME` viram uma tabela só:
  ```js
  const PAPEIS = {
    'project-manager': { nome: 'PM', ordem: 1 }, designer: { nome: 'Designer', ordem: 2 },
    'tech-lead': { nome: 'Tech Lead', ordem: 3 }, developer: { nome: 'Desenvolvedor', ordem: 4 },
    'dev-backend': { nome: 'Dev Backend', ordem: 5 }, 'dev-frontend': { nome: 'Dev Frontend', ordem: 6 },
    qa: { nome: 'QA', ordem: 7 }, outro: { nome: 'Outro', ordem: 8 },
  }; // nomes: R10, ou o texto final da spec 11. ordem: R11.
  ```
  - **Fallback para papel desconhecido** (servidor mais novo que o cliente): o nome é o próprio `role`, a ordem é 99, o ícone é `#i-outro` e o visual é o padrão de `.no` (cinza). Nada pode quebrar.
  - `vezes()` não muda (R9).
- **`public/style.css`**: o designer define os valores na spec 11. O contrato é este:
  - Variáveis no `:root`: `--tl`, `--tl-tint`, `--be`, `--be-tint`, `--fe`, `--fe-tint`.
  - Classes `.papel-tech-lead`, `.papel-dev-backend` e `.papel-dev-frontend`, cada uma definindo `--role`, `--tint` e `--role-rgb` (no formato `R G B`, como já se faz hoje).
  - `--dev` continua sendo a cor do `developer` e também a cor de destaque da UI (switch, links). Não pode ser renomeada.
- **`public/index.html`**:
  - `<symbol id="i-tech-lead">`, `<symbol id="i-dev-backend">` e `<symbol id="i-dev-frontend">`, com os glifos da spec 11.
  - Legenda (R12): PM, Designer, Tech Lead, Dev Backend, Dev Frontend, QA, Outro.
  - O item "Desenvolvedor" ganha `data-papel="developer" hidden`. `app.js` remove o `hidden` quando a sessão renderizada tem algum nó `developer` e o recoloca quando não tem.

## Tasks
| # | Task | Responsável | Depende de | Arquivos | Pronto quando |
|---|------|-------------|------------|----------|---------------|
| B1 (plano 13) | Fonte única de papéis + R3.1/R6.1 | dev-backend | - | `src/roles.js` (novo), `src/model.js`, `src/edges.js`, `test/v11-papeis.test.js` (novo) | Atende aos critérios 13(a) a 13(d). Inclui também um teste de que `role` sai sem normalização (`developer` não vira `dev-backend`) e um teste via `createApp` de que `/api/flow` devolve `dev-frontend` literal. Os 61 testes antigos passam sem edição. |
| B2 (plano 14) | Fixture do time novo | dev-backend | - (pode rodar junto com B1) | `fixtures/cenario-time-novo.jsonl` (novo), `test/v11-cenario.test.js` (novo) | Sessões 0001 e 0002 conforme o critério 14, no formato de `fixtures/cenario-usuario.jsonl`. O teste confere 8 nós, 7 colunas e as arestas exatas com os tipos (0001) e as 2 arestas `retorno` saindo do QA (0002). O teste só passa depois de B1. |
| F1 (plano 15) | Papéis novos no front | dev-frontend | 11 (valores visuais). Para validar 15(e), precisa de B1 e B2 | `public/app.js`, `public/style.css`, `public/index.html` | Atende aos critérios 15(a) a 15(g) com os contratos acima. Não sobra referência a `ORDER` ou `NOME` fora de `PAPEIS`. Nenhum `<use href="#i-X">` aponta para um símbolo inexistente. O console do navegador fica sem erros. |
| F2 | Teste de sincronia front x domínio | dev-frontend | B1 (precisa importar `src/roles.js`) | `test/v11-front-sync.test.js` (novo; só lê arquivos de `public/` como texto) | Para cada papel em `TEAM_ROLES` mais `outro`, confere que existe uma chave em `PAPEIS` de `app.js`, um `<symbol id="i-<role>">` em `index.html` e uma regra `.papel-<role>` em `style.css` (`outro` já tem a sua). Falha se alguém acrescentar um papel só de um lado. |

**Separação de arquivos:** o dev-backend mexe só em `src/`, `fixtures/` e nos arquivos `test/v11-papeis*` e `test/v11-cenario*`. O dev-frontend mexe só em `public/` e em `test/v11-front-sync.test.js`. Os dois não tocam no mesmo arquivo, e ninguém edita `server.js` ou os testes existentes.

### Comandos de verificação
- **B1:** `node --test test/` mostra 61 testes antigos mais os novos, todos passando. Além disso, `node --test test/v11-papeis.test.js` também passa.
- **B2:** `node --test test/v11-cenario.test.js`, e depois `node server.js --fixture fixtures/cenario-time-novo.jsonl --port 4318 & curl -s 'localhost:4318/api/flow?session=sess-time-novo-0001'`. O resultado deve ter 8 `executions`, `batch` máximo 7, e o `role` dos nós deve vir literal.
- **F1:**
  - `node server.js --fixture fixtures/cenario-time-novo.jsonl`: confere 15(e), com backend acima de frontend e "2ª vez" só em FE2 e QA2.
  - `node server.js --fixture fixtures/cenario-usuario.jsonl`: confere 15(f), com "Desenvolvedor" no nó e na legenda.
  - `grep -o 'href="#i-[a-z-]*"' public/index.html | sort -u` deve casar com os `<symbol id>`.
- **F2:** `node --test test/v11-front-sync.test.js`.
- **Final:** `npm test` sem falhas.

## Riscos técnicos / Perguntas em aberto
- A asserção "61 testes passando" depende de nenhum teste antigo checar `ROLE_ORDER.developer === 3`. Isso foi verificado: nenhum teste importa `ROLE_ORDER` nem `TEAM_ROLES`. A mudança do nível do `developer` de 3 para 4 não muda o resultado de nenhum teste antigo, porque o QA sobe de 4 para 5.
- F2 lê o JS e o CSS do front como texto, com regex. É frágil a mudanças de formatação, mas é aceitável, porque o projeto não tem build nem DOM em teste. A regex deve ser tolerante (procurar a chave entre aspas ou como identificador).
- A largura com 7 colunas (pendência 3 da v1) fica fora do escopo. A tarefa 11 só registra o impacto.
- Sem perguntas bloqueantes.

## Próximo passo recomendado
- **Já, em paralelo:** dev-backend com B1 e B2.
- **dev-frontend** com F1 assim que a spec 11 sair. A tabela `PAPEIS`, a legenda condicional e o fallback podem começar antes, com valores provisórios. F2 entra depois de B1.
- Em seguida, QA 16 (depois de B1 e B2) e QA 17 (depois de F1 e F2).

---

# v1.2 — time dinâmico

Tarefa 20 de `docs/plano.md`. Cobre as tarefas 21 a 25. Regras: R13 a R19. Decisão confirmada pelo orquestrador: R14 como o PM propôs (time = todo `agent_type` não nativo; definições são só metadados).

## Visão técnica
- **O servidor calcula toda a apresentação dos papéis** (nome, sigla, cor, tint, rgb, ordem) e a entrega pronta em `roles` no `/api/flow`. O cliente não tem hash, paleta nem tabela de papéis: só aplica o que chega. Justificativa: a config (`cor`, `sigla`, `nome`) já é lida e validada no servidor; manter o hash lá deixa **uma única fonte**, testável com `node --test` sem DOM, e elimina a sincronia front x back que a v1.1 precisava proteger com teste.
- **Módulos novos/alterados (todos em `src/`, dono: dev-backend):**
  - `src/team.js` (novo): descoberta do projeto, leitura das definições (frontmatter mínimo) e da config. Faz I/O, mas recebe todos os diretórios por parâmetro.
  - `src/palette.js` (novo): paleta da spec 19, FNV-1a, derivação de tint/rgb. Único lugar com valores de cor de papel.
  - `src/roles.js` (reescrito): regras puras R14, R16, R17 (nativo, validador, nome, sigla, montagem de `roles`). Sem lista de papéis do time.
  - `src/model.js` e `src/edges.js`: recebem `team` por opção; o nível fixo some (R15 = lote de estreia).
- **Diretório do projeto:** `projectDirOf(eventsFile)` devolve `dirname(dirname(file))` se `basename(dirname(file)) === '.monitor'`, senão `null`. Vale igual para `--events` e `--fixture` (R13: a fixture `fixtures/time-diferente/.monitor/events.jsonl` tem definições próprias; a `time-diferente-sem-definicoes.jsonl` não tem).
- **Home:** `createApp` **nunca** lê `~` por padrão (`homeDir` padrão = `null`). Só o bloco CLI de `server.js` passa `os.homedir()`, e só fora do modo `--fixture` (no modo fixture, `homeDir` é forçado a `null` mesmo se informado). Isso garante R13 (fixture igual em qualquer máquina) e que nenhum teste existente passe a ler o `~` real.
- **Recarga e cache:** a descoberta roda a cada `load()` (R18: mudança aparece no próximo update/reload, sem reiniciar). Cache por arquivo, chaveado por `mtimeMs:size`: o `readdir` e o `stat` rodam sempre; o parse só quando o arquivo muda. Mudar agentes ou config **não** dispara SSE (só o arquivo de eventos é observado); aparece no próximo refresh.
- **Sentinela `outro`:** um `agent_type` literal `outro` entra na lista de nativos (vira `outro`). Evita colisão sem mudar o contrato.

## Contratos

### Descoberta — `src/team.js` (dev-backend)
```js
/** Pasta pai de `.monitor/`, ou null. */
export function projectDirOf(eventsFile): string|null

/** Frontmatter mínimo: só o 1º bloco `---` no início do arquivo (BOM tolerado); chaves de topo `chave: valor`
 *  (coluna 0); aspas simples/duplas removidas; valores `|`, `>` ou vazios viram null; linhas indentadas ignoradas.
 *  Retorna null se não houver frontmatter. Só `name`, `description`, `model` são mantidos. */
export function parseFrontmatter(text): {name?, description?, model?, body: string} | null

/** Nunca lança. Lê só `<projectDir>/.claude/agents/*.md`, `<homeDir>/.claude/agents/*.md` (sem recursão, só arquivo
 *  regular, <= 256 KB), `<dir>/.claude/monitor.json` (<= 64 KB) e `configPath`. projectDir/homeDir/configPath null = não lê. */
export function discoverTeam({ projectDir = null, homeDir = null, configPath = null } = {}): Team

/** Team: estrutura opaca para model/edges/roles. */
type Team = {
  defs: Map<string, { name, description: string|null, model: string|null, validador: boolean, origem: 'projeto'|'global' }>,
  config: { papeis: Record<string, RoleConfig>, nativos: string[] },
  warnings: string[],
}
type RoleConfig = { nome?: string, sigla?: string, cor?: string, ordem?: number, nivel?: number, validador?: boolean }
export const EMPTY_TEAM: Team // defs vazio, config vazia, warnings []
```
- `name` ausente cai para o nome do arquivo sem `.md`. Projeto vence global para o mesmo `name`.
- `validador` da definição = regex `/Resultado:\s*\**\s*APROVADO\s*\|\s*REPROVADO/i` no **corpo** (após o frontmatter).
- `description` cortada em 300 caracteres; `model` em 40.
- **Config:** ordem de aplicação global -> projeto -> `--config`, **campo a campo** por papel. `nativos` é a **união** das três (lista aditiva; nenhuma fonte "des-nativa" um tipo).
- **Validação de campos** (tipo errado = campo ignorado + aviso): `nome` string 1–40; `sigla` string 1–N (N e o tratamento de 3+ caracteres vêm da spec 19b; o servidor aplica, o cliente só exibe); `cor` `^#[0-9A-Fa-f]{6}$` (falha de AA tratada como a spec 19e decidir, em `src/palette.js`); `ordem`/`nivel` número finito; `validador` booleano; `nativos` array de strings.
- **CLI:** `--config <arq>` / `--config=<arq>` e env `MONITOR_CONFIG`. `createApp({ file, fixture, configPath, homeDir })`.

### Regras puras — `src/roles.js` e `src/palette.js` (dev-backend)
```js
// roles.js
export const NATIVE_TYPES // ['general-purpose','Explore','Plan','statusline-setup','output-style-setup','claude','outro']
export function isTeamType(agentType, team = EMPTY_TEAM): boolean   // R14: string não vazia, não nativa, sem ':', fora de config.nativos
export function isValidator(role, team = EMPTY_TEAM): boolean       // R16: config > definição > role === 'qa'
export function humanize(name): string                               // R17 nome
export function monogram(name): string                               // R17 sigla
export function describeRoles(executions, levels, team = EMPTY_TEAM): Role[]  // R19, ordem R17
// palette.js
export const PALETTE  // [{cor, tint, rgb}] — valores copiados da spec 19a, nada mais
export function fnv1a32(str): number   // UTF-8, resultado >>> 0. Vetores: '' = 0x811c9dc5, 'a' = 0xe40c292c
export function colorFor(name): {cor, tint, rgb}  // PALETTE[fnv1a32(name) % PALETTE.length]
export function fromHex(cor): {cor, tint, rgb}    // para `cor` da config; tint conforme spec 19e
```

### Modelo e arestas (dev-backend)
```js
buildModel(lines, { team = EMPTY_TEAM } = {}) -> { executions, sessions, warnings }   // forma de saída igual à v1.1
buildEdges(executions, { hideOthers = false, team = EMPTY_TEAM } = {}) -> { nodes, edges, levels }
//   levels: Record<role, number> — nível R15, rank denso (1..n) do lote de estreia, calculado sobre TODAS
//   as execuções (antes do hideOthers), só papéis != 'outro'.
```
- `buildModel`: `role` = Start se `isTeamType`, senão PreToolUse casado se `isTeamType`, senão `outro` (R3 + R14). `verdict` só se `isValidator(role, team)` (R16); senão `null`.
- `edgeType`: `outro` em qualquer ponta = `avanço`; `from.verdict === 'REPROVADO'` = `retorno` (o model já garante verdict null para não validador, então edges não precisa consultar o validador); se os **dois** papéis têm `config.papeis[x].nivel`, compara esses; senão compara `levels`. Menor = `retorno`.
- Removidos: `ROLE_LEVEL`, `TEAM_ROLES`, `ROLE_ORDER` (e os reexports em `model.js`/`edges.js`).

### API — `/api/flow` (acréscimo de `roles`; o resto não muda)
```json
{
  "session": {"session_id": "sess-time-dif-0001", "last_ts": "...", "executions": 7, "running": 0},
  "executions": [{"id": "a1", "role": "arquiteto", "batch": 1, "...": "igual à v1.1"}],
  "edges": [{"from": "r1", "to": "d2", "type": "retorno"}],
  "others": 1,
  "roles": [
    {"name": "arquiteto", "nome": "Arquiteto", "sigla": "AR", "cor": "#......", "tint": "#......", "rgb": "R G B",
     "nivel": 1, "nivelConfig": null, "ordem": null, "validador": false, "origem": "projeto",
     "description": "Desenha a arquitetura...", "model": "opus"},
    {"name": "dba", "nome": "Dba", "sigla": "DB", "...": "..."},
    {"name": "revisor-seguranca", "nome": "Revisor Seguranca", "sigla": "SEC", "nivel": 3, "validador": true,
     "origem": "projeto", "...": "..."}
  ],
  "warnings": ["agentes: projeto/quebrado.md ignorado: sem frontmatter",
               "config: global monitor.json: JSON inválido",
               "config: projeto monitor.json: papeis.dba.cor ignorado: esperado #RRGGBB"],
  "source": {"path": "...", "exists": true, "fixture": null}
}
```
- `roles`: só papéis com execução **na sessão** (antes do `hideOthers`), sem `outro`. Ordenado por `ordem` (null por último), depois `nivel`, depois o 1º `start_ts` do papel, depois `name`. **Essa ordem é a única**: ordem vertical na coluna e legenda usam o índice no array (desvio consciente da R17: com `ordem` na config, a legenda também a segue). Sem sessões: `roles: []`.
- `origem`: `projeto` | `global` (definição encontrada) | `inferido` (sem definição; config não muda a origem).
- `cor`/`tint` sempre `#RRGGBB` validados; `rgb` sempre `"R G B"` (formato atual de `--role-rgb`).
- `warnings`: continua `string[]` (parse + time). Mensagens do time começam com `agentes:` ou `config:` e citam a origem (`projeto`, `global`, `--config`) e o **nome do arquivo**, nunca o caminho absoluto. `/api/sessions` não muda.
- **Segurança:** nada de caminho absoluto em `roles`/`warnings`; da definição só saem `name`, `description`, `model` e o booleano `validador`. Servidor continua em `127.0.0.1`.

### Apresentação — cliente (dev-frontend)
- `public/app.js`: some `PAPEIS`, `conhecido`, `iconeDoPapel`, `renderLegenda` fixa. `const R = new Map(flow.roles.map(r => [r.name, r]))`. Nome = `R.get(role)?.nome ?? role`; papel sem entrada em `roles` (não deve ocorrer) usa visual de `outro`.
- Nó e painel: classe `no papel-time` (ou `papel-outro`) e as variáveis `--role`, `--tint`, `--role-rgb` aplicadas com `el.style.setProperty` (nunca por concatenação em `style="..."`), revalidadas no cliente com `/^#[0-9a-f]{6}$/i` e `/^\d{1,3} \d{1,3} \d{1,3}$/`.
- Ícone: monograma `<span class="ic-papel mono" aria-hidden="true">SEC</span>` (texto escapado; métricas e corte da spec 19b). `outro` mantém `#i-outro`.
- Ordem vertical: índice em `roles`, depois `start_ts`; `outro` por último.
- Legenda: itens Avanço/Voltou fixos no HTML; os papéis são gerados por `app.js` a partir de `roles` (+ "Outro" se `others > 0`), em um contêiner `<span id="legenda-papeis">`, conforme a spec 19d.
- `public/style.css`: saem `.papel-<nome>` por papel e as variáveis `--pm/--des/--tl/--be/--fe/--qa` (+tints). Fica `--dev` (cor de destaque da UI, não pode ser renomeada), `--out`/`--out-tint` e `.papel-outro`. Estilo `.ic-papel.mono` e corte do nome da spec 19c.
- `public/index.html`: saem os `<symbol id="i-<papel>">` de papéis (fica `i-outro`) e os itens de papel da legenda.

## Tasks
| # | Task | Responsável | Depende de | Arquivos | Pronto quando |
|---|------|-------------|------------|----------|---------------|
| B1 (plano 21) | Fixtures do time diferente | dev-backend | - | `fixtures/time-diferente/.monitor/events.jsonl`, `fixtures/time-diferente/.claude/agents/{arquiteto,revisor-seguranca,dba}.md`, `fixtures/time-diferente/.claude/monitor.json`, `fixtures/time-diferente-sem-definicoes.jsonl` (todos novos) | Critério 21 completo. Mesmo formato de `fixtures/cenario-time-novo.jsonl`. O `.gitignore` atual (`.monitor/`, sem âncora) **ignora** `fixtures/time-diferente/.monitor/`: trocar para `/.monitor/` (só a raiz), o que mantém ignorado o `.monitor/` real do projeto. É o único arquivo de raiz tocado. |
| B2 (plano 22) | Descoberta do time e config | dev-backend | - (contrato acima) | `src/team.js` (novo), `test/v12-team.test.js` (novo) | Critérios 22(a)–(d) e (f) com `fs.mkdtempSync`: projeto/sem projeto, projeto vence global, `name` ausente, sem frontmatter, >256 KB, ilegível (`chmod 000`, pular se root), frontmatter com aspas e `description: >`, validador pelo corpo, merge campo a campo, união de `nativos`, `--config` vence, JSON inválido/tipo errado viram aviso, aviso sem caminho absoluto. Nenhum teste passa `os.homedir()`. |
| B3 (plano 23) | Modelo, arestas, paleta e API dinâmicos | dev-backend | B2; valores de paleta da spec 19a (até lá, paleta provisória de 10 cores marcada `// TODO spec 19`) | `src/roles.js`, `src/palette.js` (novo), `src/model.js`, `src/edges.js`, `server.js`, `test/v12-modelo.test.js` (novo), `test/v12-equivalencia.test.js` (novo), `test/edges.test.js`, `test/v11-papeis.test.js`, `test/v11-qa-bordas.test.js`, **remove** `test/v11-front-sync.test.js` | **Primeiro passo, antes de mexer em `src/`:** criar `test/v12-equivalencia.test.js` com as arestas e tipos atuais (golden) de `cenario-usuario`, `cenario-time-novo` 0001/0002, `edge-cases` e `ao-vivo` (todas as sessões, com e sem `hideOthers`), e vê-lo passar no código da v1.1 — atende 23(g). Depois, critérios 23(a)–(f) e (h); 22(e) via `createApp({fixture, homeDir: tmp})` sem `origem: 'global'`; `grep -nE "'(project-manager\|designer\|tech-lead\|dev-backend\|dev-frontend\|developer)'" src/` vazio; `fnv1a32` com os vetores do contrato; `roles` com a ordem do contrato; testes alterados exatamente os da lista abaixo. |
| F1 (plano 24) | Frontend dinâmico | dev-frontend | spec 19; contrato acima (não precisa esperar B3 para começar); B1+B3 para validar | `public/app.js`, `public/style.css`, `public/index.html` | Critérios 24(a)–(g). Nenhuma ocorrência de `PAPEIS`, `iconeDoPapel` nem de nome de papel do time em `public/` (exceto `outro`). Funciona com `roles` vazio/ausente (servidor antigo): tudo cai no visual de `outro` sem erro no console. |
| F2 | Teste estático do front | dev-frontend | F1 | `test/v12-front.test.js` (novo; lê `public/` como texto) | Confere: sem `PAPEIS` em `app.js`; nenhum `<symbol id="i-X">` de papel além de `i-outro`; todo `<use href="#i-X">` (HTML e `app.js`) aponta para símbolo existente; `style.css` sem `.papel-` exceto `.papel-outro` e `.papel-time`; existe `#legenda-papeis`. |
| B4 (plano 25) | Config deste projeto e README | dev-backend | B2, B3, F1 | `README.md`, `.claude/monitor.json` (novo) | Critério 25. `.claude/monitor.json` dá `sigla` PM/QA e as cores da v1.1 (`#6D28D9`, `#BE185D`, `#4338CA`, `#3F6212`, `#AD4E0A`, `#1D4ED8` para `developer`, `#0F766E`) e `nome` "PM"/"QA". Cada comando do README executado. |

**Separação de arquivos:** dev-backend mexe só em `src/`, `server.js`, `fixtures/`, `README.md`, `.claude/monitor.json`, `.gitignore` (B1) e nos testes `v12-team`, `v12-modelo`, `v12-equivalencia`, `edges`, `v11-papeis`, `v11-qa-bordas`, `v11-front-sync` (remoção). dev-frontend mexe só em `public/` e `test/v12-front.test.js`. A remoção de `v11-front-sync` fica com o backend porque ela importa `TEAM_ROLES`, que B3 apaga; sem isso a suíte quebraria entre B3 e F2.

**Paralelismo:** B1 e B2 já (mesmo dev, em sequência ou em duas instâncias; não compartilham arquivo). F1 assim que a spec 19 sair, em paralelo com B3. F2 depois de F1. B4 por último.

### Testes existentes que mudam (20e)
| Teste | Mudança | Motivo |
|-------|---------|--------|
| `test/edges.test.js:27` (Dev -> PM sem veredito) | Cenário vira PM -> Dev -> PM2; assere `d>p2:retorno` | R15: no cenário original o PM estreia depois do Dev, então seria `avanço`. A intenção (retorno por nível sem veredito) fica. |
| `test/v11-papeis.test.js:40` (lista fixa e níveis R6.1) | Removido; substituído em `v12-modelo` por testes de `isTeamType`/`NATIVE_TYPES` | Não há mais lista fixa (23a). |
| `test/v11-papeis.test.js:80` (nível menor gera retorno) | Cada caso ganha a estreia do papel de destino antes (ex.: designer -> tech-lead -> designer2), mais uma versão com `nivel` na config reproduzindo R6.1 | `typeBetween` faz o destino estrear depois da origem; pela R15 seria `avanço`. |
| `test/v11-papeis.test.js` imports de `ROLE_LEVEL`, `TEAM_ROLES`, `ROLE_ORDER` | Removidos | Símbolos apagados. Demais testes do arquivo ficam iguais. |
| `test/v11-qa-bordas.test.js:52` | `security-reviewer` -> `Explore` | R14 (conforme o plano). |
| `test/v11-qa-bordas.test.js:71` | Desdobrado em (a) designer estreia antes do tech-lead e (b) cenário original com `nivel` na config | R15 (conforme o plano). |
| `test/v11-qa-bordas.test.js:88` | Papéis esperados `['dev-frontend','frontend-dev','dev-frontend']`; contagem igual | R14 (conforme o plano). |
| `test/v11-front-sync.test.js` | Removido; substituído por `test/v12-front.test.js` | Fim de `PAPEIS`/classes/símbolos por papel (20c). |
| `test/qa-bordas.test.js`, `model.test.js`, `server.test.js`, `hook.test.js`, `v11-cenario.test.js` | Sem mudança | Usam `qa`/`developer`/nativos; R15 e R16.3 preservam o resultado. |

### Comandos de verificação
- **B1:** `git check-ignore -v fixtures/time-diferente/.monitor/events.jsonl` sem saída; `node server.js --events fixtures/time-diferente/.monitor/events.jsonl --port 4318 & curl -s 'localhost:4318/api/flow?session=sess-time-dif-0001'` (depois de B3: 7 nós, `roles` com 3 papéis).
- **B2:** `node --test test/v12-team.test.js`.
- **B3:** `node --test test/v12-equivalencia.test.js` (antes e depois da mudança); `node --test`; `node server.js --fixture fixtures/time-diferente-sem-definicoes.jsonl --port 4318` + `curl` (revisor com `verdict: null`); o mesmo com `--config` dando `validador: true` (veredito volta); `grep` do critério 23(a).
- **F1:** com `--events fixtures/time-diferente/.monitor/events.jsonl`, `--fixture fixtures/cenario-time-novo.jsonl` e `--fixture fixtures/cenario-usuario.jsonl`, conferir 24(d)/(e) e console sem erros; `grep -nE "PAPEIS|iconeDoPapel|tech-lead|dev-backend" public/` vazio.
- **F2:** `node --test test/v12-front.test.js`.
- **B4:** cada comando do README; editar `.claude/monitor.json` com o servidor no ar e recarregar a página: nome/cor mudam.
- **Final:** `npm test` sem falhas.

## Riscos técnicos / Perguntas em aberto
- **Equivalência não provada por inspeção.** A R15 foi conferida pelo PM só para `cenario-usuario` e `cenario-time-novo`; o golden de B3 (feito antes da mudança) é o que garante 23(g) para `edge-cases` e `ao-vivo`.
- **`--events` lê o `~` real.** No teste 27 com `--events fixtures/time-diferente/...`, um `~/.claude/monitor.json` pessoal pode mudar nome/cor. O QA deve rodar com `HOME` temporário ou conferir que não há config pessoal para esses nomes.
- **Custo por request.** `readdir` + `stat` de duas pastas a cada `load()`; parse só com cache invalidado. Desprezível em localhost; se virar problema, cache por `mtime` do diretório.
- **Mudança de agente/config sem SSE.** Só aparece no próximo update de eventos ou reload. Aceito pela R18.
- **`source.path` já expõe o caminho absoluto do arquivo de eventos** (desde a v1). Fora do escopo; os campos novos não expõem caminho.
- **Legenda segue `ordem` da config** (não só nível). Desvio pequeno e deliberado da R17 para ter uma ordem só.
- **Paleta provisória em B3** até a spec 19 sair: os testes não podem fixar cores concretas, só `colorFor(x) === PALETTE[fnv1a32(x) % PALETTE.length]` e determinismo.
- Sem perguntas bloqueantes.

## Próximo passo recomendado
- **Agora:** dev-backend com B1 e B2 (em paralelo entre si).
- **Quando a spec 19 sair:** dev-frontend com F1 (e depois F2), em paralelo com dev-backend em B3.
- **Depois:** dev-backend com B4; QA 26 (após B1–B3) e QA 27 (após F1, F2, B4).
