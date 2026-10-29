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
