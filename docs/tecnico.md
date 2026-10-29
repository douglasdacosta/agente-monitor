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

---

# v1.3 — vários projetos

Tarefa 30 de `docs/plano.md`. Cobre as tarefas 31 a 34. Regras: R20 a R25. A parte de cliente fixa só o contrato e o comportamento; os valores visuais (texto da opção, aviso, estados) vêm da spec 29 (seção 8 de `docs/design/fluxo.md`).

## Visão técnica
- **Módulo novo `src/projects.js`** (dev-backend): descoberta, nome, id e caminho exibido. Faz I/O, mas recebe todos os diretórios por parâmetro (mesmo padrão de `src/team.js`); nunca lê o `~` sozinho e nunca lança.
- **`createApp` passa a ter N fontes.** Uma *fonte* = `{id, name, path, worktree, file, projectDir, fixtureShift}`. O `load()` atual vira `loadSource(src)` (mesmo código, parametrizado pela fonte); o resolvedor de títulos é **um só**, criado uma vez, como hoje. O modo único é só "registro com 1 fonte fixa", então não há segundo caminho de código para load/flow.
- **Modo decidido por opções** (`createApp({})` continua sendo o modo único com `DEFAULT_EVENTS`, então todo teste existente segue no modo único). Só a CLI liga a descoberta.
- **Resumo barato por fonte** (`sessions`, `running`, `last_ts` para `/api/projects` e para o filtro "tem sessão válida"): `buildModel(lines)` com `EMPTY_TEAM` e **sem títulos**, em cache por `statSig` (`ino:size:mtime`, já existe). Contagens e `last_ts` não dependem do time. Títulos e time só em `/api/sessions` e `/api/flow` do projeto pedido.
- **Detecção de mudança no modo multi = só polling** (um `setInterval` de `pollMs`, padrão 1 s, que faz `stat` de cada fonte). Zero `fs.watch` no multi: escala para 50+ projetos sem esbarrar no limite de inotify, é determinístico em teste e 1 s cumpre os 2 s do critério 32e. O modo único mantém exatamente o `fs.watch` + polling da v1.2.
- **Redescoberta preguiçosa + periódica**: na subida (síncrona, no `createApp`), a cada request de API se a última tiver mais de `rediscoverMs` (30 s), e por timer de 30 s **só enquanto houver cliente SSE** (para avisar `projects`). Sem clientes, nenhum timer.
- **Fonte única do STALE_MS**: novo `public/stale.js` (ES module sem dependências), importado pelo cliente (`./stale.js`) e pelo servidor (`./public/stale.js`). Justificativa: o servidor precisa do limite para `running` de `/api/projects`, e o cliente continua precisando dele para virar "sem término" sozinho.

## Contratos

### `public/stale.js` (novo; dono: dev-backend, criado no início de B1; o frontend só importa)
```js
export const STALE_MS = 2 * 3600e3;
/** Sessão "em andamento": tem nó running e não está "sem término" (R7/R24). */
export function isLiveSession(s, now = Date.now()) { return s.running > 0 && now - Date.parse(s.last_ts) <= STALE_MS; }
```

### `src/events.js` (novo; dev-backend)
- `readEventLines(file)` sai de `server.js` para cá **sem mudança**; `server.js` reexporta (`export { readEventLines } from './src/events.js'`), então `test/server.test.js` continua importando de `../server.js`. Motivo: `src/projects.js` precisa dele sem import circular.

### Descoberta — `src/projects.js` (dev-backend)
```js
export const HEAD_BYTES = 64 * 1024;
export const REDISCOVER_MS = 30_000;

/** Lê só os primeiros HEAD_BYTES; devolve o 1º `cwd` (string absoluta) de uma linha JSON válida, ou null.
 *  Linhas sem '"cwd"' nem são parseadas; a última linha é descartada se o bloco foi cortado. Nunca lança. */
export function readCwdFromHead(file, { maxBytes = HEAD_BYTES } = {}): string|null

/** `<homeDir>/.claude/projects/*\/*.jsonl` (só arquivos regulares do 1º nível de cada slug; `<id>/subagents/` fica de fora). */
export function listTranscripts(homeDir): string[]

/** R22: basename(dir); se `<dir>/.git` for ARQUIVO (worktree) => `${basename(dirname(dir))} · ${basename(dir)}` (U+00B7). */
export function projectName(dir): { name: string, worktree: boolean }

/** 'p' + sha256(chave).hex.slice(0, 12). chave = realpath do arquivo de eventos (path.resolve se não existir). */
export function projectId(key): string            // ex.: 'p3f9a1c2b7d4e'

/** `~` + resto se p === homeDir ou começa com homeDir + sep; senão p. homeDir null => p. */
export function abbreviateHome(p, homeDir): string

/** Desempate R22, determinístico (independe da ordem de entrada). Muta `name` dos repetidos:
 *  1) + ` (${pasta de referência})`, onde a referência é o pai do projeto (o avô, se worktree, porque o pai já está no nome);
 *  2) se ainda colidir: + ` (${path abreviado})`. */
export function disambiguate(projects: {name, dir, worktree, path}[]): void

/** Cache entre chamadas: transcrição -> {size, cwd}. Reuso: se `cwd` já foi achado (o início não muda) ou se o size
 *  não mudou; senão relê. Entradas de arquivos que sumiram são podadas. */
export function createDiscoveryCache(): { transcripts: Map<string, {size: number, cwd: string|null}> }

/**
 * Nunca lança. Candidatos: (a) cwd das transcrições (só se homeDir && scan), (b) `cwd`, (c) `repoDir`.
 * Candidato -> path.resolve -> realpath (falhou = ignora em silêncio, ex.: cwd morto) -> ignora se estiver dentro de
 * `<homeDir>/.claude` -> vira projeto se `<dir>/.monitor/events.jsonl` for arquivo E hasSessions(file).
 * `files` (explícitos, via --events): sempre entram (mesmo vazios ou inexistentes), projectDir = projectDirOf(file)
 * e, fora de `.monitor`, name = basename(dirname(file)).
 * Dedup pela chave (realpath do arquivo de eventos). `path` = abbreviateHome(projectDir ?? dirname(file), homeDir).
 */
export function discoverProjects({
  homeDir = null, scan = true, cwd = null, repoDir = null, files = [],
  cache = createDiscoveryCache(),
  readHead = readCwdFromHead,          // injetável: espião do critério 31(i)
  hasSessions = defaultHasSessions,    // padrão: readEventLines + buildModel(lines).sessions.length > 0
} = {}): { projects: Project[], warnings: string[] }

type Project = { id, key, file, projectDir: string|null, name, worktree: boolean, path: string }
```
- "Sessão válida" = entra em `buildModel(lines).sessions` (pelo menos um evento parseável com `ts`). O servidor injeta `hasSessions` usando o seu cache de resumo, para não parsear duas vezes.
- `projects` sai sem ordem garantida; quem ordena é o servidor (precisa de `last_ts`).
- Avisos (`warnings`) nunca citam caminho de `~/.claude`; leitura de transcrição que falha é silenciosa.

### `createApp` (dev-backend)
```js
createApp({
  file, fixture,                 // modo único (v1.2, inalterado). Também: files.length === 1
  files = [],                    // >= 2 => multi RESTRITO (sem descoberta)
  discover = false,              // true => multi com descoberta (homeDir/cwd/repoDir + files)
  cwd = null, repoDir = null,    // candidatos (b) e (c); só a CLI passa process.cwd() e ROOT
  rediscoverMs = REDISCOVER_MS,  // testes usam ~200
  pollMs, heartbeatMs, configPath, homeDir, orcaDataDir, titles, onWarn, host,
})
// mode: fixture => 'single' (discover/files ignorados, homeDir forçado a null)
//       discover => 'multi' | files.length >= 2 => 'multi' (restrito) | senão 'single'
// retorna também mode e projects() (lista atual, para o log da CLI e testes)
```
- `team` por fonte: `discoverTeam({ projectDir: src.projectDir, homeDir, configPath })` (R23; `--config` vale para todos).
- **CLI (`parseArgs`, exportado para teste):** `--events` repetível -> `files: string[]` (`MONITOR_EVENTS` = 1 arquivo). `--fixture` -> único; 1 arquivo -> único; >= 2 -> multi restrito com `homeDir` (para time e títulos, mas `scan: false`); nenhum -> `discover: true, cwd: process.cwd(), repoDir: ROOT, homeDir: os.homedir()`. O log de subida lista o modo e o número de projetos.

### API
**`GET /api/projects`** (novo; ordem R24: `last_ts` desc, `null` por último, desempate por `name` e depois `id`)
```json
{
  "mode": "multi",
  "projects": [
    {"id": "p3f9a1c2b7d4e", "name": "digisac · SD-2476", "path": "~/orca/workspaces/digisac/SD-2476",
     "worktree": true, "sessions": 1, "running": 1, "last_ts": "2026-10-29T14:02:11.000Z"},
    {"id": "p81c0d2e94a17", "name": "digisac", "path": "~/Documentos/apps/digisac",
     "worktree": false, "sessions": 6, "running": 0, "last_ts": "2026-10-29T13:40:00.000Z"},
    {"id": "p0b6e5f7a3c29", "name": "monitor-execucao", "path": "~/Documentos/apps/monitor-execucao",
     "worktree": false, "sessions": 9, "running": 0, "last_ts": "2026-10-29T11:00:00.000Z"}
  ]
}
```
- `sessions`: número de sessões válidas. `running`: número de sessões com `isLiveSession` no instante da resposta (0 = não está em andamento). `last_ts`: maior `last_ts` das sessões, ou `null`.
- **Modo único:** `{"mode": "single", "projects": [<1 item>]}` sempre com 1 item (mesmo com arquivo inexistente: `sessions: 0`, `last_ts: null`). O cliente oculta o seletor por `mode`, não pela contagem.
- **Multi sem projetos:** `{"mode": "multi", "projects": []}`.

**`GET /api/sessions?project=<id>`** e **`GET /api/flow?project=<id>&session=...&hideOthers=...`**
- Corpo **com as mesmas chaves de topo da v1.2** (o teste `v12-modelo:353` fixa as chaves do flow). Só `source` ganha um campo:
  `"source": {"path": "~/Documentos/apps/digisac/.monitor/events.jsonl", "exists": true, "fixture": null, "project": "p81c0d2e94a17"}`.
- `source.path` passa a ser sempre `abbreviateHome(file, homeDir)` (no modo fixture/testes sem `homeDir` continua absoluto, então `server.test:79` passa). `app.source()` (log da CLI) continua absoluto.
- Sem `project`: vale o 1º de `/api/projects` (o mais recente). Multi sem projetos: `sessions: []` / flow vazio como hoje, com `source: {path: null, exists: false, fixture: null, project: null}`.
- `project` desconhecido (inclusive formato inválido): **404** `{"error": "projeto não encontrado"}` (sem ecoar o valor). Vale nos dois modos.
- `session` desconhecida continua 404 como hoje.

**SSE `/api/stream`** (um só)
- `event: update` / `data: {"ts": "...", "project": "<id>"}` — o arquivo daquela fonte mudou (inclui sumir). No modo único também leva o `project`.
- `event: projects` / `data: {"ts": "..."}` — o conjunto de ids mudou numa redescoberta (entrou ou saiu). Não é emitido por mudança de contagem (isso já vem como `update`).
- Clientes antigos: tratam `update` sem olhar `data` (recarregam o mais recente, que é o padrão sem `project`) e ignoram `projects`. Compatível.

### Watchers e timers (dev-backend)
| Modo | Com clientes SSE | Sem clientes |
|------|------------------|--------------|
| único | igual à v1.2: 1 `fs.watch` no diretório + polling `pollMs` + heartbeat | nada |
| multi | 1 timer de polling (`stat` de todas as fontes) + 1 timer de redescoberta (`rediscoverMs`) + heartbeat; **0** `fs.watch` | nada (a redescoberta acontece sob demanda no request) |
- Com 50+ projetos: sem limite de projetos; o custo é N `stat` por segundo e, a cada 30 s, `readdir` de `~/.claude/projects` + `stat` só das transcrições sem `cwd` em cache. Se o QA medir lentidão, o ajuste é aumentar `pollMs` no multi, não mudar o contrato.
- Fonte que some numa redescoberta: sai do registro; fonte que continua mantém o objeto (e o cache). `lastSig` por fonte.

### Segurança
- Nenhum caminho de `~/.claude` na API: candidatos dentro de `<homeDir>/.claude` são descartados; transcrições nunca aparecem; `warnings` do time já citam só o nome do arquivo.
- Todo caminho exposto (`projects[].path`, `source.path`) passa por `abbreviateHome`. Teste 32(g): serializar todas as respostas e conferir que não contêm `/.claude/` nem o `homeDir` absoluto.
- `~` real só pela CLI e nunca com `--fixture` (o `createApp` força `homeDir = null` e ignora `discover`/`files` no modo fixture).
- Nome do projeto vem do disco: o cliente escapa tudo (`esc`) e nunca usa `innerHTML` com `name`/`path` sem escapar.

### Cliente (dev-frontend; valores visuais da spec 29)
- Na subida: `GET /api/projects`. `mode === 'single'` -> seletor oculto e requests **sem** `project=` (iguais à v1.2). Servidor antigo (404 em `/api/projects`) -> trata como `single`.
- Estado novo: `state.projects`, `state.mode`, `state.project` (id), `state.followProject`. `localStorage['monitor.project']` = id da escolha manual; ausente = seguindo.
- `refreshOnce` (mantém single-flight + `seq`): projetos -> sessões -> flow, conferindo `seq` após cada `await`. Se seguindo ou se o id lembrado não está na lista: `state.project = projects[0]?.id` e volta a seguir (apaga o `localStorage`). 404 em sessions/flow por projeto = refaz a lista no próximo ciclo.
- Troca manual de projeto: `seq++` (via `refresh(true)`), grava `localStorage`, `followProject = false`, sessão volta a seguir (`state.follow = true`), fecha o painel lateral (`openId = null`).
- SSE: `update` com `data.project === state.project` (ou sem `project`, ou modo único) -> `scheduleRefresh()` como hoje. `update` de outro projeto ou `projects` -> `scheduleProjects()`: só refaz `/api/projects` (single-flight próprio, 50 ms de agrupamento), atualiza o seletor e o aviso de atividade, sem tocar no fluxo.
- "Em andamento" = `running > 0` vindo do servidor. O cliente importa `STALE_MS`/`isLiveSession` de `./stale.js` e apaga o `const STALE_MS` local.
- Preservar os trechos fixados por `test/v12-front.test.js` e `test/v13-front.test.js` (regex sobre `app.js`/`style.css`): `TITULO_MAX = 60`, `const id = cortar(nomeSessao(s))`, a linha do `<option>` da sessão, `el.sessao.title =`, `el.nova.title =`, `select{...max-width:420px...}`.

## Tasks
| # | Task | Responsável | Depende de | Arquivos | Pronto quando |
|---|------|-------------|------------|----------|---------------|
| B1 (plano 31) | Descoberta, nome, id e STALE único | dev-backend | - | `public/stale.js` (novo, **primeiro commit**), `src/events.js` (novo), `src/projects.js` (novo), `server.js` (só o reexport de `readEventLines` e o import de `STALE_MS`), `test/v13-projects.test.js` (novo) | Critérios 31(a)–(k) com `fs.mkdtempSync` (home falso `home/.claude/projects/<slug>/<id>.jsonl`). Mais: `.git` arquivo -> `pai · pasta`; desempate em 2 níveis; `projectId` estável e com o formato `^p[0-9a-f]{12}$`; `abbreviateHome` não abrevia `/home/xy` com `homeDir=/home/x`; candidato dentro de `home/.claude` descartado; 31(i) com `readHead` espião (2ª chamada não relê). `node --test` inteiro passa. |
| B2 (plano 32) | Servidor multi-projeto | dev-backend | B1 | `server.js`, `test/v13-server-multi.test.js` (novo) | Critérios 32(a)–(h) com `rediscoverMs` curto e `pollMs: 100`. 32(a) inclui `parseArgs` (repetição de `--events`). 32(f): espiar `fs.watch` (ou contar timers ativos via um getter de teste, ex. `app._debug()` com `{watchers, timers}`) com e sem cliente. 32(g) varrendo o JSON de `/api/projects`, `/api/sessions` e `/api/flow`. `test/server.test.js`, `v12-*` e `v13-*` sem mudança. |
| F1 (plano 33) | Seletor de projeto no cliente | dev-frontend | spec 29; contrato acima (pode começar já, com servidor falso ou após B2); `public/stale.js` de B1 | `public/app.js`, `public/index.html`, `public/style.css` | Critérios 33(a)–(f). Com `--events <1 arquivo>` e `--fixture`, nenhuma request leva `project=` e o seletor não existe visualmente. Pasta de projeto chamada `<img src=x onerror=alert(1)>` não executa. Console sem erros. |
| F2 | Teste estático do front v1.3 | dev-frontend | F1 | `test/v13-projetos-front.test.js` (novo) | Confere em `app.js`: import de `./stale.js` e nenhum `const STALE_MS` local; uso de `/api/projects`; chave `monitor.project`; tratamento do evento `projects`; `name`/`path` sempre passados por `esc(`. Em `index.html`: `<label for=...>` do seletor de projeto. |
| B3 (plano 34) | README | dev-backend | B2, F1 | `README.md` | Critério 34. Comandos executados: `npm start` (multi), `node server.js --events a --events b` (restrito), `--events .monitor/events.jsonl` (comportamento antigo), `--fixture`. |

**Separação de arquivos:** dev-backend: `src/`, `server.js`, `public/stale.js`, `README.md`, `test/v13-projects.test.js`, `test/v13-server-multi.test.js`. dev-frontend: `public/app.js`, `public/index.html`, `public/style.css`, `test/v13-projetos-front.test.js`. O único ponto de contato é `public/stale.js`: criado pelo backend no começo de B1 e só importado pelo frontend.

**Paralelismo:** B1 já. F1 assim que a spec 29 sair (em paralelo com B1/B2; só precisa do `public/stale.js`, que é o primeiro passo de B1). B2 depois de B1. F2 depois de F1. B3 por último.

### Testes existentes que mudam (30e)
| Teste | Mudança | Motivo |
|-------|---------|--------|
| `test/server.test.js` (todos), `test/v12-*.test.js`, `test/v13-titles.test.js`, `test/v13-qa-validacao.test.js`, `test/v13-front.test.js`, `test/v12-front.test.js` | **Sem mudança** | `createApp({file})`/`({fixture})`/`({})` continuam no modo único; as chaves de topo de `/api/flow` e `/api/sessions` não mudam; o SSE só ganhou `data.project` (os testes leem o nome do evento); `source.path` só é abreviado com `homeDir`, e o único teste que confere `source.path` (`server.test:79`) usa fixture; `readEventLines` continua exportado por `server.js`. |
| Demais (`model`, `edges`, `hook`, `qa-bordas`, `v11-*`) | Sem mudança | Não tocam no servidor nem no cliente. |

### Comandos de verificação
- **B1:** `node --test test/v13-projects.test.js`; `node --test` (174 + novos); `node -e "import('./src/projects.js').then(m=>console.log(m.discoverProjects({homeDir:require('os').homedir(),cwd:process.cwd()}).projects.map(p=>[p.name,p.path])))"` lista `digisac`, `digisac · SD-2476`, `monitor-execucao` (conferência manual, não vira teste).
- **B2:** `node --test test/v13-server-multi.test.js`; `npm start` + `curl -s localhost:4317/api/projects`; `curl -s "localhost:4317/api/sessions?project=<id>"`; `curl -s -o /dev/null -w '%{http_code}' "localhost:4317/api/flow?project=pzzz"` = 404; `curl -s localhost:4317/api/projects | grep -c '/.claude/'` = 0; `node server.js --events .monitor/events.jsonl` -> `mode: single`.
- **F1:** `npm start` no navegador com o caso real (3 projetos); anexar uma linha ao `events.jsonl` de outro projeto mostra o aviso sem trocar a tela; reload mantém a escolha; `node server.js --fixture fixtures/cenario-time-novo.jsonl` sem seletor; DevTools: nenhuma request com `project=` no modo único.
- **F2:** `node --test test/v13-projetos-front.test.js`.
- **B3:** cada comando do README.
- **Final:** `npm test` sem falhas.

## Riscos técnicos / Perguntas em aberto
- **Primeira descoberta síncrona.** ~300 transcrições x até 64 KB na subida (dezenas de MB no pior caso) bloqueiam o `createApp` por algumas centenas de ms. Aceito; as seguintes só leem transcrições novas. Se o QA medir > 2 s, B2 pode adiar a 1ª descoberta para logo após o `listen` sem mudar o contrato.
- **`cwd` depois de 64 KB.** Transcrição cujo primeiro `cwd` vem depois dos 64 KB não gera candidato (fica `cwd: null` em cache e só é relida se crescer). Comportamento documentado no README (critério 35 testa).
- **"Em andamento" envelhece sem evento.** `running` é calculado no instante da resposta; um projeto pode continuar marcado até o próximo `update`/`projects`. O cliente refaz `/api/projects` a cada evento; se a spec 29 exigir precisão, F1 pode refazer a lista a cada 60 s com a aba visível.
- **Arquivos explícitos sem sessões entram na lista** (decisão: quem passou `--events` quer ver o arquivo, mesmo vazio, como no modo único). A regra "sem sessões não aparece" (R21) vale só para os candidatos descobertos.
- **Id muda se o projeto mudar de lugar** (deriva do caminho real). A escolha lembrada cai e o painel volta a seguir, conforme a R24. Aceito.
- **Ruído de pastas de rascunho** (`chat-scratch`, etc.): aceito pela v1.3 (plano). Pastas dentro de `~/.claude` já são descartadas.
- Sem perguntas bloqueantes.

## Próximo passo recomendado
- **Agora:** dev-backend com B1 (começando por `public/stale.js`).
- **Quando a spec 29 sair:** dev-frontend com F1 (e depois F2), em paralelo com dev-backend em B2.
- **Depois:** dev-backend com B3; QA 35 (após B1, B2) e QA 36 (após F1, F2, B3).

---

# v1.4 — alerta de sessão aguardando

Tarefa 39 de `docs/plano.md`. Cobre as tarefas 40 a 45. Regras: R26 a R34 e as respostas do usuário de 2026-10-29 (`vezMinutos` 2; `Stop` sem pergunta gera alerta com "Dispensar"; o orquestrador aplica o hook global; nada de link ou execução do Orca). Base: v1.3 (fontes, `summary` por `statSig`, polling, SSE `update {ts, project}`/`projects`). A parte visual do cliente vem da spec 38 (seção 9 de `docs/design/fluxo.md`); aqui só o contrato e o comportamento.

## Visão técnica
- **Hook:** o mesmo arquivo ganha um ramo "espera" para os eventos novos da R26, com **lista branca** de campos; os eventos da v1 (`SubagentStart`, `SubagentStop`, `PreToolUse` de `Agent|Task`) passam pelo ramo atual sem mudança (40h). Volume: `PostToolUse*` só grava se existir um **marcador de espera aberta** da sessão em `.monitor/open/` (39b).
- **Módulo puro novo `src/waits.js`** (dev-backend): `scanWaits(lines)` (máquina de estados por sessão, sem relógio; cacheável por `statSig`) + `finalizeWaits(scan, {now, vezMs, expiraMs})` (aplica o relógio). `buildWaits` = os dois juntos. Testável sem disco.
- **API: endpoint próprio `GET /api/waits`, global e somente leitura.** Motivo: a faixa é independente do projeto selecionado, e assim `/api/projects` (contrato e testes da v1.3) não muda. **SSE: nenhum evento novo**; o cliente refaz `/api/waits` a cada `update` (de qualquer projeto) e a cada `projects`. Tempo ao vivo, cruzamento do limite da `vez` e expiração são calculados no cliente a partir de `since`, `vez_ms` e `expires_at`, sem refetch (44b).
- **R29 sai quase de graça:** `buildModel` já cria sessão para qualquer evento válido com `session_id` (`executions: 0`). A única mudança no modelo é **não correlacionar** `PreToolUse` de `AskUserQuestion` com `SubagentStart` (senão a pergunta vira "pré" de um subagente no FIFO de 5 s).
- **Config `alertas`:** módulo novo `src/alert-config.js` (não mexe em `team.js`, cujo `validateConfig` já ignora chaves desconhecidas).
- **Sem escrita nem execução (39d):** nenhuma rota nova além de `GET /api/waits`; o 405 para métodos não `GET/HEAD` continua; nenhum `child_process` novo (o único existente segue sendo o do resolvedor de títulos da v1.3). "Copiar nome" é `navigator.clipboard` no navegador.

## Contratos

### 39a — Payloads reais (captura de estrutura em `/tmp/monitor-hook-capture.jsonl`, 2026-10-29)
| Evento | Status | Estrutura (chaves) | Uso no hook |
|--------|--------|--------------------|-------------|
| `Stop` (sessão principal) | **Confirmado** | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort{level}`, `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `background_tasks[{id,type,status,description,agent_type}]`, `session_crons[]`; **sem `agent_id`** | `Stop` sem `agent_id` = sessão principal. `last_assistant_message` **não** é gravado. |
| `UserPromptSubmit` | **Confirmado** (captura 2026-10-29, 10 ocorrências) | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `prompt`; sem `agent_id` | grava só os comuns; `prompt` **não** é gravado |
| `PreToolUse`/`PostToolUse`/`PostToolUseFailure` `AskUserQuestion` | A confirmar | doc: comuns + `tool_name`, `tool_input{questions[{question, header, options[{label,description}], multiSelect}]}`, `tool_use_id`; Post: `tool_response`; Failure: `error` | `resumo` = `tool_input.questions[0].question` (fallback `header`), 120 chars |
| `PermissionRequest` | A confirmar (não dispara aqui: sessão com permissões liberadas) | doc: comuns + `permission_mode`, `tool_name`, `tool_input`, `permission_suggestions?`, `agent_id?`/`agent_type?` (em subagente) | `resumo` = `tool_name` |
| `Notification` | A confirmar | doc: comuns + `message`, `title?`, `notification_type` ∈ `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` | `resumo` = `notification_type` |
| `Elicitation` / `ElicitationResult` | A confirmar (depende de MCP) | doc: comuns + `mcp_server_name`, `message`, `requested_schema?` / `action`, `content?` | `resumo` = `mcp_server_name` |
| `StopFailure` | A confirmar | doc: comuns + tipo do erro (`error`/`error_type`: `rate_limit`, `authentication_failed`, `billing_error`, `invalid_request`, `server_error`, `max_output_tokens`, `unknown`) + detalhes | `resumo` = 1º de `error_type`/`error` que case `^[a-z_]{1,40}$`, senão `"erro"` (nunca a mensagem) |
| `SessionEnd` | A confirmar | doc: comuns + `reason` | grava só os comuns |

- O hook lê os campos de forma defensiva (tipo errado = campo ausente), então uma divergência de nome só zera o `resumo`, sem quebrar. O QA confirma o resto no teste real (47b) com `MONITOR_HOOK_DEBUG=1` (`raw_keys`); divergência vira bug do dev-backend.
- O orquestrador remove as entradas `monitor-capture-tmp.cjs` do `~/.claude/settings.json` depois da 47.

### Hook — linha gravada (ramo "espera", dev-backend)
Lista branca (40a). Chaves `undefined` somem, como hoje:
```json
{"ts":"…","event":"PreToolUse","session_id":"…","cwd":"…","transcript_path":"…","orca_session_id":"…",
 "agent_id":"…","tool_name":"AskUserQuestion","tool_use_id":"toolu_…","resumo":"Qual banco usar?"}
```
- `tool_name` só em `PreToolUse`/`PostToolUse*`/`PermissionRequest`; `tool_use_id` só em `PreToolUse`/`PostToolUse*`. São identificadores sem conteúdo, necessários para fechar a pergunta certa (acréscimo à lista da R26; ver Perguntas).
- `resumo`: string, sem caracteres de controle, cortada em 120 (só `AskUserQuestion`; os outros já são curtos). `MONITOR_HOOK_DEBUG=1` continua gravando `raw_keys` (só chaves).
- Qualquer `hook_event_name` fora da R26 segue o ramo atual (inalterado).

### Implementação B5/B7/B8 (dev-backend, 2026-10-29) — decisões e confirmações
- **Captura (`/tmp/monitor-hook-capture.jsonl`, 20 linhas até o fim da B8):** só `Stop` (10) e `UserPromptSubmit` (10), ambos confirmados e sem `agent_id`; `background_tasks` ora vazio, ora com itens `{id,type,status,description,agent_type}`. `PermissionRequest`, `Notification`, `Elicitation`, `StopFailure` e `AskUserQuestion` **não apareceram** (sessão de captura com permissões liberadas e sem pergunta): seguem "a confirmar" e o hook os lê de forma defensiva. A QA 47b confirma com `MONITOR_HOOK_DEBUG=1`.
- **Hook (`.claude/hooks/log-agent-event.js`):** ramo "espera" para os 11 eventos da R26; `PreToolUse` só entra nele se `tool_name === 'AskUserQuestion'` (o resto segue o ramo da v1, inalterado). `Stop` com `agent_id` (não é a sessão principal) não grava nada e nunca vai ao ramo antigo (que gravaria `last_message`). Evento sem `session_id` string não grava. `.monitor/.gitignore` (`*`) é criado só pelo ramo de espera, com `wx` (nunca sobrescreve). Exporta `buildWaitEvent`, `isWaitEvent`, `handleWait`, `markerName` para teste.
- **`resumo`:** `AskUserQuestion` = `tool_input.questions[0].question` (fallback `header`); `PermissionRequest` = `tool_name`; `Notification` = `notification_type` só se casar `^[a-z_]{1,40}$`; `Elicitation*` = `mcp_server_name`; `StopFailure` = `error_type`/`error` se casar a regex, senão `erro`. Tudo sem caracteres de controle, em até 120.
- **`src/waits.js`, escolhas além da tabela 39c:** (1) `Notification` só conta se `resumo` for `permission_prompt` (-> `permissao`) ou `elicitation_dialog` (-> `mcp`); (2) `Notification permission_prompt` com `pergunta` aberta do mesmo ator é ignorada (a pergunta já cobre; defensivo, porque o Claude Code pode notificar a própria `AskUserQuestion` sem `tool_name`); (3) `Notification` funde com a `permissao` aberta do mesmo ator (ou quando ela não traz `agent_id`), e `PermissionRequest` só com a do mesmo ator; (4) **BUG-1 corrigido:** `PostToolUse*` fecha a `permissao` só do mesmo ator (ambos sem `agent_id` incluídos); se a permissão e o Post têm `tool_use_id`, ele decide sozinho (igual fecha, diferente não); (2 revisado) `Notification permission_prompt` só é ignorada se a `pergunta` aberta for do mesmo ator; (5) `Notification` isolada deixa `resumo: null` (o tipo já está em `kind`) e o `resumo` vem do `PermissionRequest` que a funde; (6) a `vez` aberta pelo `SubagentStop` tem `agent_id: null`; (7) eventos sem `session_id` são ignorados; (8) `expires_at = último evento da sessão + expiraMs`, e `finalizeWaits` descarta se `now - last_t > expiraMs`.
- **`/api/waits`:** o `summary()` (cache por `statSig`) guarda `scan` e `hints`; a resposta só roda `finalizeWaits` e o `titleResolver`. Config via `readAlertConfig({homeDir, projectDir (só modo único), configPath})`; `warnings` da resposta = avisos da config (os avisos de linha inválida não entram, como em `/api/projects`). Sem `child_process` novo.
- **Testes novos:** `test/v14-hook.test.js` (inclui o pré-filtro em shell e a presença do comando no README/tecnico), `test/v14-waits.test.js`, `test/v14-server-waits.test.js`.

### Payloads confirmados no teste real (2026-10-29)
Hook global instalado (backup em `~/.claude/settings.json.bak-v14-20261029195749` e `~/.claude/hooks/log-agent-event.cjs.bak-v14-20261029195749`; 11 entradas acrescentadas, hooks do Orca preservados; hook de captura temporário removido). Teste 47b numa sessão no Orca, painel em modo multi (`http://127.0.0.1:4320`).
- **`PreToolUse` `AskUserQuestion`: confirmado.** A linha gravada traz `tool_name`, `tool_use_id`, `orca_session_id` e `resumo` (1ª pergunta, cortada em 120).
- **`PermissionRequest` com `tool_name: "AskUserQuestion"`:** o Claude Code o emite cerca de 80 ms depois do `PreToolUse`, e uma **`Notification` `permission_prompt`** cerca de 6 s depois. O modelo funde os três numa só espera, com `kind: "pergunta"` (correto).
- **`PostToolUse` `AskUserQuestion` com o mesmo `tool_use_id`: confirmado**, fecha a espera. `/api/waits` voltou vazio, o marcador em `.monitor/open/` foi apagado e `.monitor/.gitignore` contém `*`.
- Alerta visto pelo usuário no painel ("Apareceu e piscou").
- Já confirmados antes por captura: `Stop` (sessão principal, com `background_tasks`, sem `agent_id`) e `UserPromptSubmit` (`prompt` presente e **não** gravado).
- **Não verificados:** `PermissionRequest` de ferramenta real (a sessão roda com permissões liberadas), `Elicitation`/`ElicitationResult` (MCP), `StopFailure`, `SessionEnd`, a `vez` após 2 min, notificação do sistema e som com a permissão concedida, e latência (47e). Seguem lidos de forma defensiva; uma divergência vira bug do dev-backend.

### 39b — Marcador de espera aberta (volume da R26)
- Pasta `<root>/.monitor/open/`; arquivo `<sha256(session_id).hex.slice(0,16)>`, conteúdo `pergunta` ou `permissao`.
- **Cria** (e grava a linha): `PreToolUse AskUserQuestion` -> `pergunta`; `PermissionRequest` e `Notification permission_prompt` -> `permissao` (não sobrescreve um `pergunta`).
- **`PostToolUse`/`PostToolUseFailure`:** sem marcador -> **não grava nada** (só `{}`). Com marcador `permissao`, ou `pergunta` e `tool_name === 'AskUserQuestion'` -> grava a linha e apaga o marcador.
- **Apaga** (e grava a linha): `UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd`.
- Marcador órfão custa no máximo uma linha extra. Tudo em `try/catch` silencioso (40e). Ao criar `.monitor/`, o hook grava `.monitor/.gitignore` com `*` se não existir (a R29 faz o hook escrever em todo repositório onde houver conversa).

### 39e — Snippet de `settings.json` (só **acrescentar**; nunca remover as entradas existentes, como as do Orca)
Global (`~/.claude/settings.json`, comando `node "$HOME/.claude/hooks/log-agent-event.cjs"`). Para cada evento abaixo, **anexar** este objeto ao array já existente (ou criar o array se não houver):
```json
{
  "PreToolUse":         [{"matcher": "AskUserQuestion", "hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "PostToolUse":        [{"matcher": "*",               "hooks": [{"type": "command", "command": "d=\"${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open\"; if [ -n \"$(ls -A \"$d\" 2>/dev/null)\" ]; then node \"$HOME/.claude/hooks/log-agent-event.cjs\"; else echo '{}'; fi", "timeout": 5}]}],
  "PostToolUseFailure": [{"matcher": "*",               "hooks": [{"type": "command", "command": "d=\"${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open\"; if [ -n \"$(ls -A \"$d\" 2>/dev/null)\" ]; then node \"$HOME/.claude/hooks/log-agent-event.cjs\"; else echo '{}'; fi", "timeout": 5}]}],
  "PermissionRequest":  [{"matcher": "*",               "hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "Notification":       [{"matcher": "permission_prompt|elicitation_dialog", "hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "Elicitation":        [{"matcher": "*",               "hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "ElicitationResult":  [{"matcher": "*",               "hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "UserPromptSubmit":   [{"hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "Stop":               [{"hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "StopFailure":        [{"hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}],
  "SessionEnd":         [{"hooks": [{"type": "command", "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"", "timeout": 5}]}]
}
```
- **Pré-filtro em shell (decisão do orquestrador, desde o início):** só `PostToolUse` e `PostToolUseFailure` usam o comando acima. Ele só chama o `node` se `"${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open"` existir e tiver algum marcador; caso contrário imprime `{}` e sai 0. Assim nenhuma chamada de ferramenta abre um processo `node` em sessões sem espera aberta. Os marcadores são criados pelo hook (39b), então o filtro não muda o contrato. **Raiz:** `CLAUDE_PROJECT_DIR`, ou `$PWD` (cwd da sessão) se a variável não existir; o hook usa `CLAUDE_PROJECT_DIR`, depois o `cwd` do payload, depois `process.cwd()`. As duas raízes coincidem na prática (cwd da sessão), e a divergência só custa uma linha a menos/mais. Na opção de projeto, o mesmo comando com `node "$CLAUDE_PROJECT_DIR/.claude/hooks/log-agent-event.js"`. O README traz os blocos completos (testados por `test/v14-hook.test.js`).
- O `PreToolUse` `Agent|Task` existente fica como está (entrada separada, não editar o matcher).
- **Projeto** (`.claude/settings.json`, opção A do README): o mesmo bloco com `node "$CLAUDE_PROJECT_DIR/.claude/hooks/log-agent-event.js"`. Não instalar as duas opções ao mesmo tempo (linhas duplicadas; já documentado).
- Ordem do orquestrador: backup -> anexar -> copiar `.claude/hooks/log-agent-event.js` para `~/.claude/hooks/log-agent-event.cjs` **depois** da QA 46 aprovar a 40.

### Modelo — `src/model.js` (dev-backend, mudança mínima)
```js
// antes: evs.filter((e) => e.event === 'PreToolUse')
const pres = evs.filter((e) => e.event === 'PreToolUse' && (e.tool_name == null || e.tool_name === 'Agent' || e.tool_name === 'Task'));
```
As linhas da v1 não têm `tool_name`, então nada muda para elas. Sessões só com eventos de turno já entram em `sessions` com `executions: 0, running: 0` (R29).

### 39c — Função pura `src/waits.js` (dev-backend)
```js
export const VEZ_MS = 2 * 60e3;        // alertas.vezMinutos = 2
export const EXPIRA_MS = 24 * 3600e3;  // alertas.expiraHoras = 24
export const KINDS = ['pergunta', 'permissao', 'mcp', 'erro', 'vez'];

/** Sem relógio. Máquina de estados por sessão (eventos ordenados por t, line). Usa parseLines (R8). */
export function scanWaits(lines): { sessions: Map<string, ScanState>, warnings: string[] }
type ScanState = { open: {kind, since: string, resumo: string|null, agent_id: string|null} | null,
                   pendingVez: boolean, ended: boolean, last_ts: string }

/** Aplica o relógio. Ordem: urgent desc, since asc, session_id. */
export function finalizeWaits(scan, { now = Date.now(), vezMs = VEZ_MS, expiraMs = EXPIRA_MS } = {}): Wait[]
export function buildWaits(lines, opts) { return finalizeWaits(scanWaits(lines), opts); }

type Wait = { session_id, kind, since: string, resumo: string|null, agent_id: string|null,
              urgent: boolean,        // kind !== 'vez' || now - since >= vezMs
              expires_at: string }    // last_ts + expiraMs
```
Regras da máquina (R27/R28). "Ator" = `agent_id ?? null`. Subagente em background = `SubagentStart` sem `SubagentStop`, iniciado há no máximo `STALE_MS` (de `public/stale.js`) antes do evento corrente:
| Evento | Efeito |
|--------|--------|
| `PreToolUse` `AskUserQuestion` | `open = pergunta` (resumo da linha); `pendingVez = false` |
| `PermissionRequest`, `Notification permission_prompt` | se `open.kind` já é `permissao` do mesmo ator: mantém `since`, preenche `resumo` (`tool_name`) se nulo (**uma** espera); se `open` é `pergunta` e `tool_name === 'AskUserQuestion'`: ignora; senão `open = permissao` |
| `Elicitation`, `Notification elicitation_dialog` | mesma fusão, com `mcp` |
| `ElicitationResult` | fecha `mcp` |
| `PostToolUse*` | fecha `permissao`; fecha `pergunta` se `tool_name === 'AskUserQuestion'` (ou `tool_use_id` igual) |
| `StopFailure` | `open = erro` |
| `Stop` sem `agent_id` | há subagente em background -> `open = null`, `pendingVez = true`; senão `open = vez` (since = ts do `Stop`) |
| `SubagentStop` | se `pendingVez` e não sobrou subagente em background -> `open = vez` (since = ts deste `SubagentStop`), `pendingVez = false` |
| `UserPromptSubmit` | fecha qualquer espera; `pendingVez = false` |
| `SessionEnd` | fecha; `ended = true` (um evento posterior reabre a sessão: `ended = false`) |
| Outro evento do **mesmo ator** de uma `permissao` aberta (`PreToolUse`, `SubagentStart` etc.) | fecha `permissao`. Evento sem `agent_id` que não seja `Stop`/`Notification` também zera `pendingVez` |
| `Notification` de outro tipo, encerramento sem espera aberta, linha inválida | ignorado |

`finalizeWaits`: devolve `open` das sessões com `!ended` e `now - last_ts <= expiraMs` (R30).

Exemplos (`now` = 10:10:00, `vezMs` = 2 min):
```js
buildWaits([L('10:00:00','PreToolUse',{tool_name:'AskUserQuestion',resumo:'Qual banco?'})], o)
// [{session_id:'s1', kind:'pergunta', since:'…10:00:00…', resumo:'Qual banco?', agent_id:null, urgent:true, expires_at:'…+24h'}]
buildWaits([L('10:09:00','Stop')], o)                       // [{kind:'vez', urgent:false, …}]  (1 min < 2 min)
buildWaits([L('10:00:00','Stop')], o)                       // [{kind:'vez', urgent:true, …}]
buildWaits([L('10:00:00','PermissionRequest',{tool_name:'Bash'}), L('10:00:01','Notification',{resumo:'permission_prompt'})], o)
// 1 espera: {kind:'permissao', since:'…10:00:00…', resumo:'Bash'}
buildWaits([L('10:00:00','SubagentStart',{agent_id:'a'}), L('10:01:00','Stop'), L('10:05:00','SubagentStop',{agent_id:'a'})], o)
// [{kind:'vez', since:'…10:05:00…', urgent:true}]
buildWaits([L('10:00:00','Stop'), L('10:00:30','UserPromptSubmit')], o)   // []
buildWaits([L('2026-10-28T09:00:00Z','Stop')], o)                          // [] (expirou)
```

### Config — `src/alert-config.js` (dev-backend)
```js
export const ALERT_DEFAULTS = Object.freeze({ vezMinutos: 2, expiraHoras: 24, som: false });
/** Puro. raw = valor de `alertas`. Inválido (não número finito > 0, ou `som` não boolean) -> aviso + padrão, campo a campo. */
export function parseAlertas(raw, label, warn): { vezMinutos, expiraHoras, som }
/** Lê `alertas` de: <homeDir>/.claude/monitor.json -> <projectDir>/.claude/monitor.json (só modo único) -> configPath. Campo a campo, o último vence. Nunca lança; ausência é silenciosa; avisos sem caminho absoluto (mesmo rótulo de team.js). */
export function readAlertConfig({ homeDir = null, projectDir = null, configPath = null } = {}): { alertas, warnings: string[] }
```
- No modo multi a config é **global** (home + `--config`): a faixa é uma só, então o limite é um só. `vezMinutos` aceita fração (`0.5`), útil no teste 47c.

### API — `GET /api/waits` (novo, somente leitura)
```json
{
  "now": "2026-10-29T14:10:00.000Z",
  "config": {"vezMinutos": 2, "expiraHoras": 24, "som": false, "vez_ms": 120000},
  "waits": [
    {"id": "p3f9a1c2b7d4e:6f1c…:2026-10-29T14:09:41.000Z",
     "project": "p3f9a1c2b7d4e", "project_name": "digisac · SD-2476",
     "session_id": "6f1c…", "title": "Ajustar filtro de tickets", "titleSource": "orca",
     "kind": "pergunta", "since": "2026-10-29T14:09:41.000Z", "resumo": "Qual banco usar?",
     "agent_id": null, "urgent": true, "expires_at": "2026-10-30T14:09:41.000Z"}
  ],
  "warnings": []
}
```
- Todas as fontes atuais (single: a única; fixture: só a fixture; multi: todas, com a mesma redescoberta preguiçosa de `/api/projects`). Ordem global: `urgent` desc, `since` asc, `project`, `session_id`.
- `title`/`titleSource`: o mesmo `titleResolver.resolve(session_id, hints)` de `/api/sessions` (null => o cliente usa o código curto, exatamente como no seletor).
- `id`: chave estável da espera (`project:session_id:since`) para "Dispensar" (muda a cada espera nova; não muda quando a `vez` cruza o limite nem quando a permissão se funde).
- **Nunca** contém `transcript_path`, `cwd`, `/.claude/` nem o `homeDir` absoluto (só os campos acima). `resumo` vem do disco: o cliente escapa.
- Parâmetros desconhecidos são ignorados. Métodos não `GET/HEAD`: 405, como hoje.
- **Cache:** a entrada de `summary()` (por `statSig`) passa a guardar também `scanWaits(lines)` e `collectHints(lines)`; a resposta só roda `finalizeWaits` com o `now`. Sem relê de disco quando nada mudou.
- **Fixture:** as linhas já chegam deslocadas (`shiftLines`), então os tempos ficam estáveis.

### SSE (sem mudança de formato)
- `update {ts, project}` (qualquer projeto) e `projects {ts}` -> o cliente refaz `/api/waits` (single-flight próprio, agrupamento de 50 ms, independente do fluxo). Abrir/fechar uma espera em projeto não selecionado aparece em <= `pollMs` + fetch (< 2 s, 43b).

### Cliente (dev-frontend; valores visuais da spec 38)
- Módulo puro novo `public/alerts.js` (sem DOM; testável em Node): `sortWaits`, `isUrgent(w, now, vezMs)`, `escalation(w, now, vezMs)` (degraus da spec), `formatElapsed(ms)` (`mm:ss` até 59:59, depois `h:mm`), `isDismissed(w, store)`/`dismiss(w, store)`, `tabTitle(n, base)`.
- **Dispensar:** `localStorage['monitor.dismissed']` = `{"<project>:<session_id>": "<since>"}`; escondido se `since` guardado === `since` da espera; poda as chaves que não estão mais em `waits`.
- **Timer de 1 s** só re-renderiza tempo/urgência/expiração (`expires_at`) a partir dos dados em memória; cruzar o limite da `vez` dispara a notificação (uma vez por `id`, guardado em memória e em `sessionStorage`).
- Notificação: `Notification.requestPermission()` só no clique do botão; uma por `id` nova (para `vez`, só quando `urgent`); `onclick` -> `window.focus()` + seleciona projeto e sessão (mesmo caminho do clique no item: escolha manual de projeto da v1.3 e `state.follow = false` na sessão).
- Título da aba e favicon (canvas -> `link[rel=icon]`): N = itens visíveis (não dispensados) com `urgent`.
- "Sessão sem agentes": `/api/flow` com `session.executions === 0` (R29).
- Copiar nome: `navigator.clipboard.writeText(nomeExibido)`; falha -> seleciona o texto e mostra o aviso (R33). Nenhum `window.open`, `location` para fora ou esquema de URL.

## Tasks
| # | Task | Responsável | Depende de | Arquivos | Pronto quando |
|---|------|-------------|------------|----------|---------------|
| B5 (plano 40) | Hook: eventos de espera + marcador | dev-backend | 37 | `.claude/hooks/log-agent-event.js`, `test/v14-hook.test.js` (novo) | Critérios 40(a)–(h). (c) por asserção sobre a **string** da linha com valores-sentinela (`SEGREDO_PROMPT`, `rm -rf /x`, etc.). (d) inclui: Post sem marcador não grava; Post `Bash` com marcador `pergunta` não grava; Post `AskUserQuestion` com marcador `pergunta` grava e apaga. (f) mede `spawnSync` < 200 ms (mediana de 5). `.monitor/.gitignore` criado. `test/hook.test.js` sem mudança. |
| B6 (plano 41) | Fixture `fixtures/esperas.jsonl` | dev-backend | - (contrato acima) | `fixtures/esperas.jsonl` | 16 casos do critério 41, uma sessão cada, com `session_title`. O maior `ts` do arquivo é o "agora" do teste; a sessão 9 tem o `Stop` 60 s antes dele, a 10 há 5 min, a 14 com último evento há 25 h. |
| B7 (plano 42) | `src/waits.js` + filtro de `PreToolUse` no modelo | dev-backend | B6 | `src/waits.js` (novo), `src/model.js`, `test/v14-waits.test.js` (novo) | Critério 42 com `now = maior ts da fixture`. Mais: os 7 exemplos acima; `AskUserQuestion` 1 s antes de um `SubagentStart` não vira `label` do subagente; duas esperas seguidas (vale a última); `SessionEnd` seguido de `Stop` reabre. Testes de `model`/`edges`/`qa-bordas` sem mudança. |
| B8 (plano 43) | Servidor: `/api/waits` + config `alertas` | dev-backend | B7 | `server.js`, `src/alert-config.js` (novo), `test/v14-server-waits.test.js` (novo) | Critérios 43(a)–(f): 3 projetos tmp (multi restrito, `pollMs: 100`); anexar linha num projeto não selecionado -> `update` com o id dele em < 2 s e `/api/waits` reflete; `parseAlertas` com `0`, `-1`, `"2"`, `NaN`, `som: "sim"` -> aviso + padrão; varredura do JSON sem `transcript_path`/`cwd`/`/.claude/`/`homeDir`; `POST /api/waits` = 405; `grep child_process` em `server.js` e `src/` só acha `src/titles.js`. `--fixture fixtures/esperas.jsonl` devolve exatamente as esperas do 42. |
| F3 (plano 44) | Faixa de alertas e atenção fora do painel | dev-frontend | spec 38; contrato acima (pode começar com `/api/waits` simulado; integra após B8) | `public/alerts.js` (novo), `public/app.js`, `public/index.html`, `public/style.css` | Critérios 44(a)–(j). Com `node server.js --fixture fixtures/esperas.jsonl`: as 6 esperas, a 9 discreta e a 10 piscando; reduced-motion emulado sem animação; `resumo` `<img src=x onerror=alert(1)>` não executa; nenhum `requestPermission` fora de handler de clique; console sem erros. Preservar os trechos fixados por `v12-front`, `v13-front` e `v13-projetos-front`. |
| F4 | Teste do front v1.4 | dev-frontend | F3 | `test/v14-front.test.js` (novo) | Testa `public/alerts.js` em Node (`formatElapsed(59_999)='00:59'`, `3_600_000 -> '1:00'`; dispensar/voltar com `since` novo; ordem; degraus) e, por regex em `app.js`: `/api/waits`, `monitor.dismissed`, `requestPermission` só dentro de listener de clique, `resumo`/`title`/`project_name` passados por `esc(`, ausência de `window.open`. |
| B9 (plano 45) | README e instalação do hook | dev-backend | B5, B8, F3 | `README.md` | Critério 45 com o snippet 39e (opções A e B, "acrescentar"), o que o hook grava e não grava, o marcador `.monitor/open/` e o `.gitignore`, a config `alertas` e `GET /api/waits`. Cada comando executado. |

**Separação de arquivos:** dev-backend: `.claude/hooks/`, `fixtures/esperas.jsonl`, `src/`, `server.js`, `README.md`, `test/v14-hook|waits|server-waits.test.js`. dev-frontend: `public/alerts.js`, `public/app.js`, `public/index.html`, `public/style.css`, `test/v14-front.test.js`. Nenhum arquivo em comum; o ponto de contato é só o JSON de `/api/waits`. (`public/stale.js` é só lido pelos dois; ninguém o altera.)

**Paralelismo:** B6 já (só fixture). Depois da 37: B5 e B7 em paralelo; B8 após B7. F3 assim que a spec 38 sair, em paralelo com B5–B8. F4 após F3. B9 por último.

### Testes existentes que mudam (39g)
| Teste | Mudança | Motivo |
|-------|---------|--------|
| `test/hook.test.js` | Nenhuma | Eventos da v1 seguem o ramo atual; o caso `{"hook_event_name":1}` só confere saída 0 e `{}`. |
| `test/model.test.js`, `edges`, `qa-bordas`, `v11-*`, `v12-*` | Nenhuma | O filtro de `PreToolUse` só exclui linhas com `tool_name` diferente de `Agent`/`Task`, e nenhuma fixture atual tem `tool_name` (conferido). |
| `test/server.test.js`, `v13-server-multi`, `v13-projects`, `v13-qa-*`, `v13-titles` | Nenhuma | `/api/projects`, `/api/sessions` e `/api/flow` não mudam de forma; as fixtures não têm eventos de turno, então as contagens de sessão são as mesmas. |
| `v12-front`, `v13-front`, `v13-projetos-front` | Nenhuma | F3 preserva os trechos fixados. |
- **Efeito real (não é teste):** com o hook novo instalado, `/api/projects` passa a contar sessões só de conversa (R29) e a descobrir projetos sem subagentes. Os números do "caso real" da QA 35/36 (`digisac` 6 sessões) só valem antes de o orquestrador aplicar o hook global.

### Comandos de verificação (39h)
- **B5:** `node --test test/v14-hook.test.js test/hook.test.js`; `echo '{"hook_event_name":"UserPromptSubmit","session_id":"s","prompt":"SEGREDO"}' | CLAUDE_PROJECT_DIR=$(mktemp -d) node .claude/hooks/log-agent-event.js` imprime `{}` e a linha não contém `SEGREDO`.
- **B6/B7:** `node --test test/v14-waits.test.js test/model.test.js`.
- **B8:** `node --test test/v14-server-waits.test.js`; `node server.js --fixture fixtures/esperas.jsonl` + `curl -s localhost:4317/api/waits`; `curl -s -X POST -o /dev/null -w '%{http_code}' localhost:4317/api/waits` = 405; `curl -s localhost:4317/api/waits | grep -cE 'transcript_path|"cwd"|/\.claude/'` = 0.
- **F3:** navegador com `--fixture fixtures/esperas.jsonl` (DevTools: reduced-motion, console, notificação); `npm start` com 3 projetos, anexar uma linha `PreToolUse AskUserQuestion` ao `events.jsonl` de outro projeto -> item na faixa em < 2 s.
- **F4:** `node --test test/v14-front.test.js`.
- **B9:** cada comando do README.
- **Final:** `npm test` inteiro (211 + novos) sem falhas.

## Riscos técnicos / Perguntas em aberto
- **Payloads não confirmados** (39a): só o `Stop` foi capturado. Leitura defensiva limita o estrago a `resumo` nulo ou a um tipo de espera sem detecção; a 47 confirma. Se o Orca não disparar `PermissionRequest`, a `Notification permission_prompt` cobre sozinha.
- **Custo do `PostToolUse *`:** mitigado desde o início pelo pré-filtro em shell do 39e (só chama o `node` com marcador aberto). Resta um `sh` curto por chamada de ferramenta; a 47e mede.
- **Subagente sem `SubagentStop`** segura a `vez` por até `STALE_MS` (2 h). Alternativa mais precisa: gravar no `Stop` só a contagem de `background_tasks` com `status` running (sem conteúdo). Fica de fora por ser campo fora da R26.
- **`.monitor/` em todo repositório:** a R29 faz o hook escrever em qualquer pasta onde houve conversa. O `.monitor/.gitignore` evita sujar o `git status`.
- **Pergunta para o PM (não bloqueia):** aceitar `tool_name` e `tool_use_id` na lista de campos da R26 (identificadores sem conteúdo, necessários para fechar a pergunta certa e para o `resumo` de permissão). Se não, B5 tira o `tool_use_id` e a pergunta fecha só por `tool_name`.

## Próximo passo recomendado
- **Agora:** dev-backend com B6 (fixture). dev-frontend com F3 assim que a spec 38 sair, usando o contrato de `/api/waits`.
- **Depois da 37:** dev-backend com B5 e B7 (paralelos), depois B8; dev-frontend com F4. Por fim B9; QA 46 (após B5–B8) e QA 47 (após F3, F4, B9, com o orquestrador aplicando o snippet 39e e o hook global antes).
