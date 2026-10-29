# Plano: monitor-execucao (painel do fluxo de agentes)

## Objetivo
Um app web local que lê `.monitor/events.jsonl` e desenha, para uma sessão, o fluxo entre os agentes do time (PM, Designer, Developer, QA): cada execução é um nó com o tempo (ao vivo se ainda estiver rodando) e as setas mostram quem passou para quem, inclusive as voltas (QA REPROVADO -> Developer -> QA).

## Decisões (já tomadas pelo usuário, mais as escolhas do PM)
- Node 20 sem framework: `http` + `fs` nativos. Testes com `node:test` (nada para instalar).
- Frontend em **HTML/JS puro + SVG**, sem build. Motivo: é uma única tela com um grafo simples, então React/Vite só trariam build e dependências sem ganho.
- Atualização ao vivo por **SSE**. O servidor observa o arquivo (`fs.watch`, com polling de 1s como fallback). O timer roda no cliente a partir do `start_ts`.
- Cada execução vira um nó. Execuções em paralelo ficam na mesma coluna, uma abaixo da outra. O layout é em camadas da esquerda para a direita.
- Filtro por `session_id`. O padrão é a sessão com o evento mais recente.
- Modo fixture: `node server.js --fixture <arquivo>` (ou a variável `MONITOR_FIXTURE`) lê um `.jsonl` de exemplo no lugar do arquivo real.

## Estrutura proposta
```
server.js                 # HTTP + API + SSE
src/parse.js              # linhas -> eventos válidos
src/model.js              # eventos -> execuções (correlação)
src/edges.js              # execuções -> arestas
public/index.html, app.js, style.css
fixtures/*.jsonl
test/*.test.js
```

## Regras do modelo (contrato entre developer e qa)

**R1. Execução.** Cada `SubagentStart` abre uma execução, identificada pelo `agent_id`. O `SubagentStop` com o mesmo `agent_id` a fecha. Os campos são `{id, session_id, role, label, start_ts, stop_ts|null, duration_ms|null, status: running|done, verdict: APROVADO|REPROVADO|null, last_message}`.

**R2. Correlação PreToolUse -> Start.**
- Se as duas linhas tiverem `tool_use_id`, o casamento é por esse campo.
- Sem `tool_use_id`, vale a ordem FIFO dentro da mesma sessão: cada Start casa com o PreToolUse mais antigo ainda não casado com `ts` até 5s antes.
- Um PreToolUse que não casa com nenhum Start em 5s é descartado (é chamada negada ou refeita, como a linha 1 do arquivo atual).

**R3. Papel (`role`).**
1. Se o `agent_type` do Start for do time (`project-manager|designer|developer|qa`), ele é o papel.
2. Senão, vale o `agent_type` do PreToolUse casado, se for do time.
3. Se nenhum dos dois for do time, o papel é `outro`.

O `label` é o `description` do PreToolUse ou, na falta dele, o `agent_type`.

**R4. Veredito.** O hook passa a gravar `verdict`, extraído da mensagem completa com `/Resultado:\s*\**\s*(APROVADO|REPROVADO)/i`. Para eventos antigos sem esse campo, o modelo aplica o mesmo regex ao `last_message`.

**R5. Arestas (lotes de disparo).**
- Ordene os eventos Start e Stop da sessão por `ts`.
- Um **lote** é uma sequência máxima de Starts sem nenhum Stop entre eles. Os agentes disparados juntos formam um lote, e isso cobre o paralelismo.
- Os predecessores de cada execução de um lote L são as execuções cujo Stop ocorreu entre o lote anterior e L.
- O primeiro lote não tem predecessor (nó implícito "Início").
- Uma execução cujo Stop não é seguido por nenhum lote é terminal.
- Exemplo: PM termina, Designer e Dev são disparados juntos (lote 2), ambos terminam e o QA é disparado. As arestas ficam PM->Designer, PM->Dev, Designer->QA e Dev->QA.

**R6. Tipo de aresta.**
- A aresta X->Y é do tipo `retorno` quando X é `qa` com `verdict = REPROVADO`, ou quando a ordem do papel de Y é menor que a de X (ordem: PM 1 < Designer 2 < Developer 3 < QA 4).
- Nos demais casos, a aresta é do tipo `avanço`.
- Os nós `outro` não geram `retorno`.

**R7. Agentes fora do time.** Aparecem como nós `outro` em cinza e participam das arestas. Um toggle "ocultar outros" os remove e liga diretamente os predecessores aos sucessores deles. O toggle começa desligado.

**R8. Robustez.**
- Uma linha inválida (JSON quebrado, sem `ts` ou sem `event`) é ignorada com um aviso no log, sem quebrar o parse.
- Um Stop sem Start é ignorado.
- Um Start sem Stop fica `running`.

## Tarefas
| # | Tarefa | Responsável | Depende de | Critérios de aceite |
|---|--------|-------------|------------|---------------------|
| 1 | Ajustar `.claude/hooks/log-agent-event.js` | developer | - | (a) Grava `tool_use_id` quando presente no payload. (b) Grava `agent_transcript_path` no Stop quando presente. (c) Grava `verdict` conforme R4, calculado sobre a mensagem completa antes do corte de 500 chars. (d) Com `MONITOR_HOOK_DEBUG=1`, grava também `raw_keys` (lista das chaves do payload) para confirmar quais campos o Claude Code envia. (e) Continua sempre escrevendo `{}` no stdout e nunca falha. (f) Teste com payloads simulados via stdin cobre (a) a (e). |
| 2 | Fixtures em `fixtures/` | developer | - | `cenario-usuario.jsonl` traz: PM (concluído); Designer e Developer em paralelo; QA REPROVADO; Developer; QA APROVADO. Os papéis reais vêm misturados (um Start como `general-purpose` com PreToolUse `project-manager`). `edge-cases.jsonl` traz: PreToolUse sem Start, agente `Explore`, linha inválida, Stop órfão, execução em andamento, 2 sessões. `ao-vivo.jsonl` termina com um QA ainda rodando. |
| 3 | `src/parse.js` + `src/model.js` (R1 a R4, R8) | developer | 2 | Função pura `buildExecutions(lines)`. Testes `node:test` usando as fixtures provam: correlação por `tool_use_id` e por FIFO; papel correto no caso `general-purpose`; PreToolUse não casado descartado; `running` e `duration_ms` corretos; veredito extraído; linha inválida ignorada; separação por sessão. |
| 4 | `src/edges.js` (R5 a R7) | developer | 3 | Função pura `buildEdges(executions, {hideOthers})`. O teste de `cenario-usuario` gera exatamente as arestas PM->Des, PM->Dev, Des->QA1, Dev->QA1, QA1->Dev2 (`retorno`), Dev2->QA2. O teste de `hideOthers` confirma que a reconexão funciona. Os lotes são atribuídos a cada nó (usados como coluna no layout). |
| 5 | Spec de UI em `docs/design/fluxo.md` | designer | - (usa R1 a R7) | Define: layout em colunas por lote; cartão do nó (papel, label, tempo, status, veredito); destaque do nó `running` (pulso ou borda forte e timer `mm:ss` ao vivo); estilo diferente para `avanço` e `retorno` (curva por baixo, outra cor, rótulo "voltou"); cor por papel com contraste AA e sem depender só de cor; seletor de sessão; toggle "outros"; estados vazio, sem arquivo e erro; o que mostra o clique no nó (`last_message`). |
| 6 | `server.js` (API + SSE + fixture) | developer | 3, 4 | `GET /api/sessions` lista as sessões ordenadas pelo evento mais recente. `GET /api/flow?session=` devolve `{executions, edges}`, usando a mais recente quando o parâmetro é omitido. `GET /api/stream` (SSE) emite `update` em até 2s após um append no jsonl. `--fixture <arq>` funciona. Se o arquivo não existir, responde com lista vazia em vez de 500. Porta configurável (`PORT`, padrão 4317). Sem dependências npm. |
| 7 | Frontend `public/` | developer | 5, 6 | Implementa a spec (5). Os nós são desenhados em SVG com setas (marker). O timer do nó `running` avança a cada 1s sem refetch. O SSE atualiza o grafo sem recarregar a página e mantém a sessão selecionada. Com `cenario-usuario`, o grafo mostra 6 nós em 5 colunas e a aresta de retorno é visualmente distinta. |
| 8 | Validação do modelo e das arestas | qa | 3, 4 | Roda `node --test`. Cobre R1 a R8 contra as fixtures e acrescenta casos de borda próprios (Starts paralelos com Stops intercalados, sessão só com PreToolUse). Relatório no formato do QA. |
| 9 | Validação ponta a ponta | qa | 1, 6, 7 | Com `--fixture cenario-usuario`, a tela bate com a spec (5). Com `ao-vivo`, o timer corre. Um append manual de um Stop no jsonl reflete no navegador em até 2s. A troca de sessão funciona. O hook (1) é validado com payload simulado. |
| 10 | Revisão final e atualização deste plano | project-manager | 8, 9 | Plano atualizado com o status das tarefas e as pendências. |

As tarefas paralelizáveis de início são 1, 2 e 5.

## Status da execução (revisão final, 2026-10-29)
| # | Status | Resultado |
|---|--------|-----------|
| 1 | Concluída | Hook grava `tool_use_id`, `agent_transcript_path`, `verdict` e `raw_keys` (debug). Coberto por testes com stdin simulado. |
| 2 | Concluída | `cenario-usuario`, `edge-cases` e `ao-vivo` em `fixtures/`. |
| 3 | Concluída | `src/parse.js` e `src/model.js` com testes. |
| 4 | Concluída | `src/edges.js` com testes. Arestas de `cenario-usuario` conferem com o critério. |
| 5 | Concluída | `docs/design/fluxo.md` e `docs/design/fluxo-mockup.html`. Atualizados após a rodada 1 do QA (cartão de 272px, "Nª vez" na linha 2, veredito só em QA). |
| 6 | Concluída | `server.js`: `/api/sessions` (devolve `{sessions, source}`), `/api/flow`, SSE `/api/stream`, `--fixture`, `--events`, `--port`, escuta em 127.0.0.1:4317. No modo fixture, os `ts` são deslocados para "agora", para que `ao-vivo` mostre o timer correndo. |
| 7 | Concluída, com verificação visual pendente | `public/{index.html,style.css,app.js}`. A lógica de modelo e de arestas fica no servidor. A correção do BUG-3 (`white-space:nowrap` no título do painel) foi aplicada depois da aprovação do QA e ainda não foi vista renderizada no navegador. |
| 8 | Aprovada (rodada 2) | O QA acrescentou `test/qa-bordas.test.js` com 23 casos. Suíte total: 61/61 passando. |
| 9 | Aprovada (rodada 2) | Rodada 1 REPROVADA por BUG-1 (papel truncado escondia "2ª vez"), BUG-2 (`ts` futuro na fixture `ao-vivo`, timer em 00:00), OBS-1 (aria "-1 minutos") e OBS-2 (veredito exibido em Developer). Todos foram corrigidos. A rodada 2 achou o BUG-3, que é cosmético e foi corrigido sem nova rodada de QA. |
| 10 | Concluída | Este registro. |

### Pendências após a v1 (em ordem de prioridade)
1. ~~Verificação visual do BUG-3~~ — resolvida: na v1.1 o QA confirmou o título "Dev Frontend · 2ª vez" do painel em uma linha (25px de altura, sem overflow).
2. Rodar uma sessão real com `MONITOR_HOOK_DEBUG=1` e conferir em `raw_keys` se `SubagentStart` traz `tool_use_id` e se `SubagentStop` traz `agent_transcript_path`. Se não trouxerem, o FIFO (R2) segue como caminho principal. Considerar desligar o debug depois.
3. Layout com 5 ou mais colunas: a largura de 1600px exige rolagem horizontal. Pedir ao designer uma decisão (rolagem com auto-scroll até o nó `running`, zoom para caber, ou compactar os cartões).
4. Execução "running" eterna: o estado "sem término" (2h sem eventos na sessão) já existe no cliente (`STALE_MS` em `public/app.js:6`); falta só torná-lo configurável e cobri-lo com teste.
5. Arestas inferidas por tempo, não por intenção: aceito para a v1. Reavaliar quando houver `tool_use_id` confiável ou um vínculo explícito no hook.

## Riscos / Perguntas em aberto
- **Campos reais do hook.** Não está confirmado que `SubagentStart` traz `tool_use_id` nem que `SubagentStop` traz `agent_transcript_path`. Por isso a tarefa 1 inclui o modo debug, e o FIFO por tempo (R2) é obrigatório como fallback.
- **Dois PreToolUse do mesmo papel quase simultâneos sem `tool_use_id`.** O FIFO pode trocar os `label` entre eles. O impacto é baixo, porque o papel é o mesmo.
- **Execução "running" eterna.** Se a sessão morrer sem Stop, o nó fica rodando para sempre. Mitigação proposta: marcar como `sem término` se a sessão não tiver eventos há mais de 2h (limite configurável). Não bloqueia.
- **Veredito depende do formato do QA.** Se o QA não seguir `## Resultado:`, a aresta só vira `retorno` pela regra de ordem de papel (R6), o que ainda cobre QA->Developer.
- **Arestas são inferidas do tempo, não de intenção.** Se a sessão principal disparar um agente sem relação com o que acabou de terminar, aparece uma aresta "falsa". Isso é aceitável para a v1.
- Sem perguntas bloqueantes.

## Próximo passo recomendado
Acionar em paralelo:
- **developer**, com as tarefas 1 e 2 (hook e fixtures), passando as regras R1 a R8 e os critérios de aceite das tarefas 1 e 2.
- **designer**, com a tarefa 5, passando a seção "Regras do modelo" e o pedido literal do usuário.

Em seguida, developer com as tarefas 3 e 4, e depois as tarefas 6 e 7.

---

# v1.1 — time novo

## Objetivo
Fazer o painel reconhecer e desenhar o time novo (PM, Designer, Tech Lead, Dev Backend, Dev Frontend, QA), com as setas de "voltou" corretas para devs em paralelo, sem quebrar a leitura de sessões antigas que usam o papel `developer`.

## Contexto
- Fluxo novo (ver `CLAUDE.md`): PM -> designer -> tech-lead -> dev-backend e dev-frontend (em paralelo) -> qa. Se o QA reprovar, o trabalho volta ao dev da área. No fim, PM.
- Hoje os papéis estão fixos em 5 lugares: `src/model.js:4` (`TEAM_ROLES`), `src/edges.js:3` (`ROLE_ORDER`), `public/app.js:10-11` (`ORDER`, `NOME`), `public/style.css:77-80` (`.papel-*`) e `public/index.html` (`<symbol id="i-...">` nas linhas 13-17 e a legenda nas linhas 56-60). O hook, o `server.js` e o `src/parse.js` não citam papéis e não mudam.
- A divisão do trabalho de implementação entre `dev-backend` e `dev-frontend` é feita pelo tech-lead em `docs/tecnico.md`.

## Regras novas (complementam R1 a R8; o que não é citado continua valendo)

**R3.1. Papéis do time.** `TEAM_ROLES = project-manager, designer, tech-lead, dev-backend, dev-frontend, qa, developer`. O `developer` fica como **papel legado**: é reconhecido como papel do time pela mesma regra R3 (Start primeiro, depois o PreToolUse casado). O `role` é devolvido como veio no evento, sem nenhuma normalização. Um `developer` não vira `dev-backend`.

**R6.1. Nível para "retorno".**
| Papel | Nível |
|-------|-------|
| `project-manager` | 1 |
| `designer` | 2 |
| `tech-lead` | 3 |
| `dev-backend`, `dev-frontend`, `developer` | 4 |
| `qa` | 5 |

- A aresta X->Y é `retorno` quando X é `qa` com `verdict = REPROVADO`, ou quando nível(Y) < nível(X). Isso é a R6 original com a tabela nova.
- Papéis de mesmo nível nunca geram `retorno` por ordem. Ou seja, backend->frontend, frontend->backend e developer->dev-backend são `avanço`.
- Os nós `outro` continuam sem gerar `retorno`.
- Se o QA reprovar e a sessão principal disparar os dois devs no mesmo lote, a R5 já cria uma aresta QA->dev-backend e outra QA->dev-frontend. As duas são `retorno`, então cada uma ganha o rótulo "voltou".

**R9. "Nª vez".** A contagem é feita por `role` exato dentro da sessão, na ordem de `start_ts`. `dev-backend`, `dev-frontend` e `developer` têm contadores separados. Esse já é o comportamento de `vezes()` em `public/app.js:90`; a regra só fica registrada aqui.

**R10. Nomes de exibição** (o designer pode trocar o texto, desde que caiba no cartão de 272px junto com "2ª vez · ").
| `role` | Nome |
|--------|------|
| `project-manager` | PM |
| `designer` | Designer |
| `tech-lead` | Tech Lead |
| `dev-backend` | Dev Backend |
| `dev-frontend` | Dev Frontend |
| `developer` | Desenvolvedor |
| `qa` | QA |
| `outro` | Outro |

**R11. Ordem vertical dentro da coluna.** Quando há nós em paralelo na mesma coluna, eles ficam nesta ordem: PM, Designer, Tech Lead, Desenvolvedor, Dev Backend, Dev Frontend, QA, Outro. Em empate, vale o `start_ts`. Com isso, o backend fica sempre acima do frontend.

**R12. Legenda.** A legenda fixa mostra o time atual: PM, Designer, Tech Lead, Dev Backend, Dev Frontend, QA e Outro. O item "Desenvolvedor" só aparece quando a sessão selecionada tem algum nó `developer`.

## Tarefas
| # | Tarefa | Responsável | Depende de | Critérios de aceite |
|---|--------|-------------|------------|---------------------|
| 11 | Spec visual dos papéis novos (acréscimo em `docs/design/fluxo.md` e no mockup) | designer | - | (a) Cor, tom de fundo (`tint`), `--role-rgb` e ícone definidos para `tech-lead`, `dev-backend` e `dev-frontend`. `developer` mantém o visual atual. (b) Contraste da cor do papel sobre branco e sobre o `tint` é de pelo menos 4,5:1, com a razão anotada na tabela. (c) Os 6 papéis do time e o `developer` legado se distinguem sem depender de cor: os ícones são diferentes entre si e o nome aparece no cartão. Backend e frontend podem ter tons próximos, mas não o mesmo ícone. (d) O nome mais longo, com "2ª vez · ", cabe em uma linha do cartão de 272px e no título do painel lateral. (e) A legenda segue a R12. (f) Diz se a largura com 7 colunas (cenário da tarefa 14) muda alguma coisa na pendência 3 da v1. Se não mudar, registra isso. |
| 12 | Planejamento técnico em `docs/tecnico.md` | tech-lead | 11 (só para a parte visual; a parte de modelo pode começar já) | (a) Divide as tarefas 13 a 15 entre `dev-backend` e `dev-frontend`, com os arquivos de cada um. (b) Decide se a lista de papéis e níveis continua duplicada entre o servidor e o `public/app.js` ou se vira fonte única (por exemplo, exportada pela API). A decisão vem com justificativa e com o contrato de JSON, se mudar. (c) Fixa que o `role` na API sai sem normalização (R3.1). (d) Lista os comandos de verificação de cada tarefa. |
| 13 | Modelo e arestas: R3.1 e R6.1 (`src/model.js`, `src/edges.js`) + testes | dev (área definida em 12) | 12 | (a) Start com `agent_type` `tech-lead`, `dev-backend` ou `dev-frontend` recebe esse papel. Start `general-purpose` com PreToolUse `dev-frontend` recebe `dev-frontend`. (b) Start `developer` continua com `role = developer`, sem virar `outro` e sem ser normalizado. (c) Testes novos: dev-backend->dev-frontend é `avanço`, dev-frontend->dev-backend é `avanço`, developer->dev-backend é `avanço`, tech-lead->designer é `retorno`, qa(APROVADO)->tech-lead é `retorno`, dev-backend->tech-lead é `retorno`. (d) Teste em que QA REPROVADO é seguido de um lote com dev-backend e dev-frontend gera exatamente 2 arestas `retorno`, uma para cada dev. (e) Os 61 testes atuais continuam passando sem alteração, e `node --test` termina sem falha. |
| 14 | Fixture `fixtures/cenario-time-novo.jsonl` | dev (área definida em 12) | - | **Sessão `sess-time-novo-0001`:** PM -> Designer -> Tech Lead -> (dev-backend e dev-frontend no mesmo lote) -> QA1 REPROVADO -> dev-frontend (2ª vez) -> QA2 APROVADO. Pelo menos um Start vem como `general-purpose` com o papel real no PreToolUse, e pelo menos um par usa `tool_use_id`. Resultado esperado em teste: 8 nós, 7 colunas e exatamente as arestas PM->Des, Des->TL, TL->BE, TL->FE, BE->QA1, FE->QA1, QA1->FE2 (`retorno`) e FE2->QA2. As demais arestas são `avanço`. **Sessão `sess-time-novo-0002`** (mais antiga): QA REPROVADO -> dev-backend e dev-frontend no mesmo lote -> QA APROVADO, gerando 2 arestas `retorno` saindo do QA. O teste dessa fixture fica junto com a tarefa 13. |
| 15 | Frontend: papéis novos (`public/app.js`, `public/style.css`, `public/index.html`) | dev (área definida em 12) | 11, 12 | (a) `NOME` segue a R10 e a ordem vertical segue a R11. (b) Classes `.papel-tech-lead`, `.papel-dev-backend` e `.papel-dev-frontend` com `--role`, `--tint` e `--role-rgb` da spec 11. O pulso do nó `running` funciona nos papéis novos. (c) `<symbol>` `i-tech-lead`, `i-dev-backend` e `i-dev-frontend` existem. Nenhum `<use href="#i-...">` aponta para um símbolo inexistente. (d) A legenda segue a R12. (e) Com `--fixture fixtures/cenario-time-novo.jsonl`, o "2ª vez" aparece só em Dev Frontend (FE2) e em QA2, e não em Dev Backend. (f) Com `--fixture fixtures/cenario-usuario.jsonl`, a tela fica igual à v1: o rótulo "Desenvolvedor" aparece, o visual é o atual, o item "Desenvolvedor" está na legenda e a aresta "voltou" está presente. (g) Os textos para leitor de tela (`aria-label` do nó e lista de resumo) usam os nomes da R10. |
| 16 | Validação do modelo e das arestas v1.1 | qa | 13, 14 | Roda `node --test` com tudo passando. Valida R3.1, R6.1 e R9 contra `cenario-time-novo` e `cenario-usuario`. Acrescenta casos de borda próprios: sessão misturando `developer` e `dev-backend` no mesmo lote (sem `retorno` entre eles, contagens separadas); QA REPROVADO -> só dev-backend, seguido mais tarde de dev-frontend (só a primeira aresta é `retorno` pela regra do veredito); `hideOthers` com um `outro` entre o QA REPROVADO e os dois devs (as duas arestas religadas viram `retorno`). Relatório no formato do QA, com o REPROVADO roteado para o dev da área afetada. |
| 17 | Validação ponta a ponta v1.1 | qa | 15, 16 | Com `cenario-time-novo`, a tela bate com a spec 11: 8 nós, backend acima do frontend na mesma coluna, uma seta "voltou" QA1->Dev Frontend, "2ª vez" em Dev Frontend e QA2, e a legenda conforme a R12. A sessão 0002 mostra duas setas "voltou" distintas. Com `cenario-usuario` e com o `.monitor/events.jsonl` real deste projeto, os nós `developer` aparecem como "Desenvolvedor" e não como "Outro". O console do navegador não tem erros. |
| 18 | Revisão final e atualização deste plano | project-manager | 16, 17 | A seção "Status da execução v1.1" foi acrescentada com o resultado de cada tarefa e as pendências. |

Tarefas que podem começar em paralelo: **11** (designer), **14** (fixture, porque não depende do código) e a parte de modelo da **12**.

## Riscos / Perguntas em aberto (v1.1)
- **Largura.** O cenário completo tem 7 colunas e já passa dos 1600px, o que agrava a pendência 3 da v1 (rolagem horizontal). A tarefa 11 só registra o impacto. A decisão de layout continua separada, para não travar a v1.1.
- **Duplicação de papéis.** A lista de papéis existe hoje no servidor e no cliente. Se continuar duplicada, um papel novo no futuro exige mexer nos dois lados. Quem decide é o tech-lead (tarefa 12b).
- **Retorno a um dev disparado depois.** Se a sessão principal disparar o segundo dev depois que o primeiro terminar (e não no mesmo lote), a aresta do primeiro dev para o segundo é `avanço` (mesmo nível), e não `retorno`, mesmo que a causa seja a reprovação do QA. É uma limitação conhecida das arestas inferidas por tempo (R5). Fica aceita.
- **Agente `developer` ainda chamado por engano.** Como o papel legado continua válido, uma chamada nova a `developer` não é sinalizada como erro, só aparece como "Desenvolvedor". Isso é aceitável.
- **Tech Lead fora de ordem.** Se o tech-lead for chamado de novo para resolver um bloqueio de um dev, a aresta dev->tech-lead é marcada como `retorno` (nível 4 -> 3). É o comportamento desejado, mas o rótulo visual continua "voltou".
- Sem perguntas bloqueantes.

## Próximo passo recomendado (v1.1)
Acionar em paralelo:
- **designer** com a tarefa 11, passando as regras R10 a R12 e a tabela de cores atual de `docs/design/fluxo.md`.
- **tech-lead** com a tarefa 12, passando esta seção v1.1 inteira. A parte visual da 12 é fechada quando a spec 11 sair.

Depois disso, os devs indicados pelo tech-lead fazem as tarefas 13 e 14 (que podem começar logo) e a 15. Em seguida o QA faz a 16 e a 17, e por fim o PM faz a 18. *(Executado: ver "Status da execução v1.1" abaixo.)*

## Status da execução v1.1 (revisão final, 2026-10-29)
| # | Status | Resultado |
|---|--------|-----------|
| 11 | Concluída | Seção 6 de `docs/design/fluxo.md` e mockup: tech-lead `#4338CA`, dev-backend `#3F6212`, dev-frontend `#AD4E0A`, developer legado `#1D4ED8` (sem mudança), ícones distintos, ordem vertical e legenda conforme a R12. |
| 12 | Concluída | `docs/tecnico.md`: `src/roles.js` vira a fonte única no servidor; a API não muda de formato; o cliente tem a tabela `PAPEIS`, protegida por um teste de sincronia. Tarefas B1/B2 (dev-backend) e F1/F2 (dev-frontend) sem arquivos em comum. Observação: rodou como `general-purpose` seguindo `.claude/agents/tech-lead.md`, porque o tipo ainda não estava carregado na sessão. |
| 13 | Concluída | `src/roles.js`, `src/model.js` e `src/edges.js` (R3.1, R6.1), com `test/v11-papeis.test.js`. Os 61 testes da v1 continuam passando. |
| 14 | Concluída | `fixtures/cenario-time-novo.jsonl` (sessões 0001 e 0002) e `test/v11-cenario.test.js`. Suíte com 73 testes. |
| 15 | Concluída | `PAPEIS`, `renderLegenda`, tokens, classes e símbolos dos papéis novos, com `test/v11-front-sync.test.js`. Suíte com 85 testes. |
| 16 | Aprovada | O QA acrescentou `test/v11-qa-bordas.test.js`. Suíte total: 90/90 passando. |
| 17 | Aprovada (com reteste) | Tela conforme a spec 11. A "tela presa no esqueleto" vista nas capturas era um artefato do Chrome headless `--screenshot`, que captura no load (~1,2 s). A investigação achou o **BUG-1** (média, já existia na v1): `refresh()` descartava a resposta em voo, e updates SSE a cada 80 ms ou menos deixavam o esqueleto para sempre. O dev-frontend corrigiu (refresh single-flight com repetição final; `seq` só invalida em ações do usuário). Reteste APROVADO: a rajada renderiza em 445 a 592 ms, a troca de sessão e o toggle em voo funcionam, e um erro com `dirty` não trava a tela. |
| 18 | Concluída | Este registro. |

### Pendências após a v1.1 (em ordem de prioridade)
1. **Teste automatizado do `refresh()`** (single-flight, rajada SSE, troca de sessão em voo). Hoje a correção do BUG-1 só foi validada por um script CDP em `/tmp`, que não está no projeto. Sem esse teste, uma regressão passa sem ser notada.
2. **Rolagem horizontal** (pendência 3 da v1, agravada): o cenário completo agora tem 7 colunas, cerca de 2672px. Precisa de uma decisão do designer (auto-scroll até o nó `running`, zoom ou cartões compactos).
3. **Confirmar os campos reais do hook** (pendência 2 da v1): rodar com `MONITOR_HOOK_DEBUG=1` e conferir se `SubagentStart` traz `tool_use_id`.
4. **Estado "sem término"** (pendência 4 da v1): tornar `STALE_MS` configurável e cobrir com teste.
5. ~~Atualizar a tabela de agentes no `CLAUDE.md`~~ — já feito (projeto e `~/.claude/CLAUDE.md` listam tech-lead, dev-backend e dev-frontend). Os tipos novos já estão carregados; o desvio da tarefa 12 só ocorreu porque foram criados no meio da sessão.

Continua valendo da v1: as setas inferidas por tempo (pendência 5).
