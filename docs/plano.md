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

---

# v1.2 — time dinâmico

## Objetivo
Parar de fixar o time no código. Os papéis, os nomes, as cores, os ícones, a ordem e a seta "voltou" passam a ser derivados dos agentes definidos no projeto monitorado e na máquina de quem roda o painel. Assim, cada pessoa do time pode usar o painel com o seu próprio conjunto de agentes, sem editar `src/roles.js`, `public/app.js`, CSS ou HTML.

## Contexto
- Hoje o time está fixo em `src/roles.js` (`ROLE_LEVEL`/`TEAM_ROLES`), `src/model.js:16` (veredito só para `qa`), `public/app.js:11-21` (`PAPEIS`: nome, ordem e ícone), `public/style.css` (`.papel-*`) e `public/index.html` (`<symbol id="i-...">` e legenda). Qualquer outro `agent_type` vira `outro`.
- `.monitor/` está no `.gitignore`, então a configuração compartilhável **não** pode ficar lá.
- As definições de agente usam o frontmatter `name`, `description`, `model` e `tools` (ver `.claude/agents/*.md`). A definição do `qa` traz o modelo de saída `## Resultado: APROVADO | REPROVADO`.

## Regras novas (substituem R3.1, R6.1, R10, R11 e R12; o resto continua valendo)

**R13. Descoberta das definições.**
- **Projeto monitorado**: se o arquivo de eventos estiver dentro de uma pasta chamada `.monitor`, o projeto é a pasta pai dela. Caso contrário, não há definições de projeto.
- **Fontes**: `<projeto>/.claude/agents/*.md` e `~/.claude/agents/*.md`. Se o mesmo `name` existir nas duas, vale a do projeto, como no Claude Code.
- **Leitura**: só o frontmatter (`name`, `description`, `model`) e uma busca textual no corpo (R16). O `name` ausente cai para o nome do arquivo sem `.md`. Arquivo ilegível, sem frontmatter ou com mais de 256 KB é ignorado com um aviso, sem quebrar nada.
- **Modo `--fixture`**: `~/.claude` não é lido. Assim, a mesma fixture renderiza igual em qualquer máquina. As definições de projeto valem se a fixture estiver em `<pasta>/.monitor/events.jsonl`.
- **Testes**: as funções de descoberta recebem os diretórios por parâmetro (`projectDir`, `homeDir`) e nunca leem o `~` real.

**R14. Papel do time (substitui R3.1).**
- Um `agent_type` é **nativo** se estiver na lista `general-purpose`, `Explore`, `Plan`, `statusline-setup`, `output-style-setup` ou `claude`, se contiver `:` (plugin) ou se estiver em `nativos` da config (R18).
- **Papel do time = qualquer `agent_type` não nativo**, tenha ou não uma definição encontrada. A precedência continua a da R3: primeiro o Start, depois o PreToolUse casado. Nativos continuam `outro`. O `role` sai sem normalização (`developer` continua `developer`).
- **Ajuste da direção combinada, com justificativa.** A direção era usar as definições como filtro e a heurística só como fallback. Proponho usar as definições só como **fonte de metadados** (descrição, modelo, validador), e não como filtro, por três motivos. (1) Este projeto não tem mais `developer.md`, mas o `.monitor/events.jsonl` real tem sessões com `developer`: com filtro, elas virariam "Outro", o que quebra o critério 17 da v1.1. (2) O mesmo arquivo de eventos aberto por duas pessoas com agentes diferentes desenharia nós diferentes. (3) Um agente renomeado ou removido apagaria o histórico. Com essa regra, os nós e as arestas dependem só dos eventos, e as definições só enriquecem a exibição.

**R15. Nível para "retorno" (substitui R6.1).**
- O **nível** de um papel é o número do **lote** (R5) em que ele aparece pela primeira vez na sessão. Papéis que estreiam no mesmo lote têm o mesmo nível. Isso preserva a regra de que "paralelos nunca geram retorno entre si" (backend e frontend, `developer` e `dev-backend`). O nível é calculado sobre todas as execuções do time, antes do `hideOthers`. Nós `outro` não têm nível.
- A aresta X->Y é `retorno` quando X é **validador** (R16) com `verdict = REPROVADO`, ou quando nível(Y) < nível(X). Nos demais casos, é `avanço`. Os nós `outro` continuam sem gerar `retorno`.
- **Override**: se os dois papéis tiverem `nivel` na config (R18), a comparação usa esses valores. Isso permite recuperar níveis fixos como os da R6.1.
- **Equivalência conferida.** Em `cenario-usuario`, PM=1, Designer e Developer=2 e QA=3, então QA1->Dev2 continua `retorno`. Em `cenario-time-novo` 0001, PM=1, Des=2, TL=3, BE/FE=4 e QA=5, então só QA1->FE2 é `retorno`. Na sessão 0002, o QA vem primeiro (nível 1), mas é REPROVADO, então as duas arestas continuam `retorno` pela regra do veredito. A seta final QA->PM é `retorno`, porque o PM tem nível 1, como hoje.
- **Diferença conhecida**: um papel que estreia depois de outro nunca recebe "voltou" vindo dele. Exemplo: em tech-lead -> dev-backend -> tech-lead -> designer, a seta tech-lead->designer passa a ser `avanço`, porque o designer estreou depois. Isso é inerente a não ter níveis fixos e pode ser corrigido com `nivel` na config.

**R15.1. Destino validador (acrescenta à R15; achada pelo golden de B3).** Ir para um papel **validador** (R16, pelo time, sem exigir que ele já tenha emitido veredito) é sempre `avanço` (dev passa ao QA de novo), exceto pela regra do veredito. Ordem em `edgeType`: (1) origem validador com `REPROVADO` = `retorno`; (2) os dois com `nivel` na config = compara os `nivel` (a config vence); (3) destino validador = `avanço`; (4) nível de estreia. Motivo: na sessão 0002 de `cenario-time-novo` o QA estreia primeiro (nível 1), e sem (3) `dev-backend/dev-frontend -> qa2` virariam `retorno`, quebrando a equivalência com a v1.1 (23g). Corrige a "equivalência conferida" da R15, que só olhou `qa1 -> dev`.

**R16. Validador (veredito, substitui o "só `qa`" da R4).** Um papel é validador conforme a primeira regra que se aplicar:
1. `validador: true|false` na config (R18);
2. existe definição (R13): é validador se o corpo dela contém o modelo de veredito (regex `Resultado:\s*\**\s*APROVADO\s*\|\s*REPROVADO`), como no `qa.md` atual;
3. não existe definição: é validador só se o `role` for `qa` (compatibilidade com eventos antigos e testes da v1).

Um papel que não é validador sempre recebe `verdict = null`, mesmo que o hook tenha gravado `verdict` ou a mensagem cite "Resultado: APROVADO". Isso mantém a correção da OBS-2 da v1. Para os validadores, a R4 continua igual: o campo do hook vence o regex no `last_message`.

**R17. Apresentação (substitui R10, R11 e R12).**
- **Nome**: o `name` é dividido por `-`, `_` e espaço, e cada palavra começa com maiúscula. Palavras com até 2 letras ficam todas em maiúsculas: `dev-backend` vira "Dev Backend", `project-manager` vira "Project Manager", `qa` vira "QA" e `revisor-seguranca` vira "Revisor Seguranca". A config pode trocar (`nome`).
- **Sigla (ícone)**: um monograma com as iniciais das 2 primeiras palavras, ou as 2 primeiras letras se for uma palavra só (`dev-backend` = DB, `qa` = QA, `dba` = DB). A config pode trocar (`sigla`). Siglas repetidas são aceitas, porque a cor e o nome também distinguem.
- **Cor**: um hash determinístico do `name` (por exemplo, FNV-1a de 32 bits) módulo o tamanho de uma paleta fixa definida pelo designer, com contraste AA. O mesmo nome dá a mesma cor em qualquer máquina e sessão. A config pode trocar (`cor`). `outro` continua cinza e fora da paleta.
- **Ordem vertical na coluna**: primeiro o `ordem` da config; depois o nível (R15); por fim o `start_ts`. `outro` fica por último.
- **Legenda**: os papéis presentes na sessão selecionada, na ordem de nível, mais "Outro" se a sessão tiver algum nó `outro`.

**R18. Arquivo de configuração (opcional).**
- **Locais**: `~/.claude/monitor.json` (pessoal) e `<projeto>/.claude/monitor.json` (versionável, ao lado dos agentes). O do projeto sobrescreve o pessoal, campo a campo. Há também `--config <arq>` na CLI, que vence os dois e serve para fixtures e testes. Escolhi não usar `.monitor/config.json` porque `.monitor/` está no `.gitignore`.
- **Formato**:
  ```json
  { "papeis": { "<name>": { "nome": "PM", "sigla": "PM", "cor": "#6D28D9", "ordem": 1, "nivel": 1, "validador": true } },
    "nativos": ["meu-agente-interno"] }
  ```
  Todos os campos são opcionais. JSON inválido ou campo de tipo errado é ignorado com um aviso (no log e em `warnings` da API), sem quebrar o painel.
- **Leitura**: a config e as definições são relidas a cada `load()`. Uma mudança aparece no próximo update ou reload, sem reiniciar o servidor. O cache por `mtime` é decisão do tech-lead.

**R19. API.** O `/api/flow` passa a devolver `roles`: `[{name, nome, sigla, cor, tint, nivel, ordem, validador, origem: 'projeto'|'global'|'inferido', description|null, model|null}]`, só com os papéis da sessão, na ordem de R17. O formato exato e onde se calculam a cor e o tint (servidor ou cliente) são decididos pelo tech-lead, mas deve existir **uma única fonte** dessas regras.

## Tarefas
| # | Tarefa | Responsável | Depende de | Critérios de aceite |
|---|--------|-------------|------------|---------------------|
| 19 | Spec do visual dinâmico (seção 7 de `docs/design/fluxo.md` + mockup) | designer | - | (a) Paleta fixa de no mínimo 10 cores, cada uma com `cor`, `tint` e `--role-rgb`, e contraste de pelo menos 4,5:1 sobre branco e sobre o próprio tint, com a razão anotada. Nenhuma cor da paleta pode ser confundida com o cinza do `outro`. (b) Monograma: tamanho, peso e contraste da sigla dentro do círculo; 1 ou 2 caracteres; o que fazer com 3 ou mais caracteres vindos da config. (c) Regra de corte do nome longo ("Revisor Seguranca · 2ª vez", "Project Manager · 3ª vez"): o "Nª vez" **nunca** é cortado (BUG-1 da v1), e o nome cortado tem `title` e `aria-label` completos. (d) Legenda dinâmica com 2, 6 e 12 papéis: quebra de linha, sem rolagem horizontal. (e) Como uma cor da config que falha no AA é tratada (aceitar com aviso ou ajustar). (f) Mockup com o time da fixture `time-diferente` (tarefa 21). |
| 20 | Planejamento técnico v1.2 em `docs/tecnico.md` | tech-lead | 19 (só a parte visual; o modelo pode começar já) | (a) Divide as tarefas 21 a 26 entre `dev-backend` e `dev-frontend`, com os arquivos de cada um e sem arquivos em comum na mesma rodada. (b) Contrato JSON de `roles` (R19) e de `warnings`, com exemplo. (c) Decide onde a cor e o tint são calculados e mantém uma fonte única: a tabela `PAPEIS` do cliente e o teste de sincronia `test/v11-front-sync.test.js` são removidos ou substituídos. (d) Assinaturas das funções puras (`discoverTeam({projectDir, homeDir, configPath})`, `buildModel(lines, {team})`, `buildEdges(execs, {hideOthers, team})` ou equivalentes) que permitam testar sem tocar o disco real. (e) Lista os testes existentes que mudam, com o motivo de cada um (ver "Testes substituídos" abaixo). (f) Comandos de verificação de cada tarefa. |
| 21 | Fixtures do time diferente | dev (área definida em 20) | - | **`fixtures/time-diferente/`** contém `.monitor/events.jsonl`, `.claude/agents/{arquiteto,revisor-seguranca,dba}.md` (só o `revisor-seguranca` traz o modelo `## Resultado: APROVADO \| REPROVADO`) e `.claude/monitor.json` (dá `sigla: "SEC"` ao revisor ou outro override visível). A sessão `sess-time-dif-0001` segue arquiteto -> (dba e `Explore` no mesmo lote) -> revisor-seguranca REPROVADO -> dba (2ª vez) -> revisor-seguranca APROVADO -> arquiteto (2ª vez). A última mensagem de um `dba` cita "Resultado: APROVADO". Pelo menos um Start vem como `general-purpose` com o papel real no PreToolUse. Nenhum `agent_type` do time atual aparece. **`fixtures/time-diferente-sem-definicoes.jsonl`** traz os mesmos eventos, fora de qualquer `.monitor/`. |
| 22 | Descoberta do time e config (R13, R14, R18) | dev (área definida em 20) | 20 | Testes com diretórios temporários provam que: (a) o projeto é a pasta pai de `.monitor`, e um arquivo fora de `.monitor` não tem projeto; (b) o projeto vence o global para o mesmo `name`; o `name` ausente cai para o nome do arquivo; um `.md` sem frontmatter, ilegível ou acima de 256 KB é ignorado com aviso; (c) os nativos da lista, os tipos com `:` e os `nativos` da config são `outro`; qualquer outro tipo é do time, com ou sem definição; (d) a config do projeto sobrescreve a global campo a campo, e `--config` vence as duas; JSON inválido gera um aviso e não derruba nada; (e) no modo `--fixture`, `~/.claude` não é lido; (f) nenhum teste lê o `~` real. |
| 23 | Modelo e arestas dinâmicos (R15, R16, R17 ordem, R19) | dev (área definida em 20) | 22 | (a) `src/roles.js` deixa de ter a lista fixa de papéis. Nenhum nome de papel do time aparece hardcoded em `src/` (só a lista de nativos e o fallback `qa` da R16.3). (b) Com `time-diferente`: 7 nós; as arestas e os tipos são exatamente arq->dba, arq->Explore, dba->rev1, Explore->rev1, rev1->dba2 (`retorno`), dba2->rev2 e rev2->arq2 (`retorno`), e as demais são `avanço`. O `verdict` é REPROVADO/APROVADO só no revisor; o `dba` que cita "Resultado: APROVADO" tem `verdict = null`. (c) Com `time-diferente-sem-definicoes`: os mesmos nós, papéis e arestas; o revisor tem `verdict = null` (sem definição e não se chama `qa`), e rev1->dba2 continua `retorno` pelo nível. (d) Com `--config` dando `validador: true` ao revisor na fixture sem definições, o veredito volta. (e) Com `nivel` na config, tech-lead->designer volta a ser `retorno` no cenário da v11-qa-bordas:71. (f) `/api/flow` devolve `roles` conforme o contrato da 20. (g) `cenario-usuario`, `cenario-time-novo` (0001 e 0002), `edge-cases` e `ao-vivo` geram as mesmas arestas e os mesmos tipos de antes. (h) `node --test` passa, e todo teste alterado está na lista da 20e. |
| 24 | Frontend dinâmico (R17, R19) | dev (área definida em 20) | 19, 20, 23 (contrato) | (a) `PAPEIS`, as classes `.papel-<nome>` por papel e os `<symbol id="i-<papel>">` por papel saem do código. O cartão usa o monograma e as variáveis de cor vindas de `roles`. O `outro` mantém o visual cinza. (b) O pulso do nó `running` funciona com qualquer cor da paleta. (c) A ordem vertical e a legenda seguem a R17. A legenda muda ao trocar de sessão. (d) Com `time-diferente`: os nomes "Arquiteto", "Dba" (ou o nome da config) e "Revisor Seguranca", a sigla da config aparece, "2ª vez" aparece em dba2, rev2 e arq2, e o painel lateral mostra "Reprovado" e "Aprovado" só no revisor. (e) Com `cenario-time-novo`, os 6 papéis aparecem com nomes humanizados e as setas "voltou" ficam iguais às da v1.1. (f) `aria-label`, a lista de resumo e os anúncios usam o nome de `roles`. (g) Nenhum `<use href>` aponta para um símbolo inexistente, e o console fica sem erros. |
| 25 | Config do próprio projeto e README | dev (área definida em 20) | 22, 24 | (a) `README.md` explica a descoberta (R13, R14), a regra de "voltou" (R15), o validador (R16), a humanização e a cor (R17), e o `monitor.json` com um exemplo completo e os locais e a precedência (R18). (b) `.claude/monitor.json` deste repositório restaura as siglas PM e QA e as cores da v1.1 para os papéis atuais, servindo de exemplo real. (c) Cada comando do README foi executado e funciona. |
| 26 | Validação do modelo e da descoberta v1.2 | qa | 21, 22, 23 | Roda `node --test` com tudo passando. Valida R13 a R19 contra `time-diferente`, `time-diferente-sem-definicoes`, `cenario-usuario` e `cenario-time-novo`. Confere que cada teste substituído (lista abaixo) mantém a intenção original. Casos de borda próprios: um papel que estreia no mesmo lote de outro (sem `retorno` entre eles); um agente chamado `qa` cuja definição **não** tem o modelo de veredito (sem veredito); uma definição com `name` diferente do nome do arquivo; o mesmo `name` no projeto e no global com descrições diferentes; uma config com `cor` inválida; o `.monitor/events.jsonl` real deste projeto com nós `developer` exibidos como papel do time e não como `outro`; dois nomes com a mesma cor pelo hash (documentado e não quebra). Relatório no formato do QA, com cada REPROVADO roteado ao dev da área. |
| 27 | Validação ponta a ponta v1.2 | qa | 24, 25, 26 | Com `--events fixtures/time-diferente/.monitor/events.jsonl`, a tela bate com a spec 19: monogramas, cores da paleta, legenda só com os 3 papéis mais "Outro", duas setas "voltou" e a sigla da config. Com `--fixture fixtures/time-diferente-sem-definicoes.jsonl`, os mesmos nós aparecem sem veredito. Com `cenario-usuario` e `cenario-time-novo`, as setas e os "Nª vez" ficam iguais aos da v1.1. Editar o `.claude/monitor.json` muda o nome ou a cor no próximo reload sem reiniciar o servidor. O console do navegador não tem erros. |
| 28 | Revisão final e atualização deste plano | project-manager | 26, 27 | A seção "Status da execução v1.2" foi acrescentada com o resultado de cada tarefa e as pendências. |

Podem começar em paralelo: **19** (designer), **21** (fixtures, não depende de código) e a parte de modelo da **20**.

### Testes do QA substituídos (com justificativa)
Os testes de `test/qa-bordas.test.js` continuam **sem mudança**. Todos usam `qa`, `developer` ou nativos (`Explore`, `Plan`) e continuam válidos pelas regras R14, R15 e R16.3. Em `test/v11-qa-bordas.test.js`:
- **:22** (developer, dev-backend e dev-frontend no mesmo lote): fica **sem mudança**. Ele passa porque o nível é o lote de estreia, e não a ordem de `start_ts`. Se o nível fosse a ordem de `start_ts`, d1 teria nível 2 e b1 nível 3, e b1->d2 viraria `retorno`.
- **:40**: fica sem mudança, porque o retorno vem do veredito.
- **:52**: o `security-reviewer` deixa de ser `outro` (R14). A intenção do teste ("um `outro` entre QA REPROVADO e os devs") é mantida trocando-o por `Explore`.
- **:71**: a seta `tl2 -> de` vira `avanço` (o designer estreia depois, ver R15). O teste é substituído por duas versões: (a) uma em que o designer estreia antes do tech-lead, e aí `tl2 -> de` é `retorno` pelo nível dinâmico; (b) uma com o mesmo cenário e `nivel` na config, que reproduz a R6.1. As outras quatro asserções ficam iguais.
- **:88**: `frontend-dev` passa a ser um papel do time próprio, e não `outro` (R14). A asserção de papéis vira `['dev-frontend', 'frontend-dev', 'dev-frontend']`. A contagem `{a:1, b:1, c:2}`, que é a intenção do teste (variação de nome conta separado), fica igual.
- Os testes de dev que fixam níveis isolados (`test/v11-papeis.test.js`, como "qa(APROVADO)->tech-lead é retorno" sem o tech-lead ter aparecido antes) e cores ou classes por papel (`test/v11-front-sync.test.js`) são reescritos ou removidos na tarefa 23/24, conforme a lista da 20e.

## Riscos / Perguntas em aberto (v1.2)
- **Perda de "voltou" fora de ordem.** Sem níveis fixos, voltar a um papel que estreou depois nunca é `retorno` (R15). No fluxo canônico isso não ocorre, e a config `nivel` resolve casos específicos. Fica aceito.
- **Colisão de cor.** Com uma paleta de cerca de 12 cores, dois papéis da mesma sessão podem receber a mesma cor pelo hash. O nome e o monograma ainda os distinguem (a regra "não depender só de cor" já é da v1), e a config resolve. Fica aceito. Trocar por cores "distintas por sessão" quebraria a estabilidade entre máquinas.
- **Validador sem definição.** Em eventos copiados de outra máquina, um validador que não se chama `qa` perde o veredito (a seta "voltou" continua pelo nível). Alternativa possível: aceitar o veredito de qualquer papel cuja mensagem **comece** com "Resultado:". Ela foi deixada de fora porque reabre a porta da OBS-2. Fica registrada, não bloqueia.
- **Leitura de arquivos fora do projeto.** O servidor passa a ler `~/.claude/agents` e `~/.claude/monitor.json`. Só o frontmatter e uma busca de texto são usados, e nada disso é exposto além de `description` e `model`. O servidor continua só em `127.0.0.1`.
- **Nome de agente igual a `outro`.** Colide com o valor sentinela. É improvável. O tech-lead decide se reserva o nome ou troca o sentinela no contrato.
- **Largura** (pendência 2 da v1.1): nomes humanizados mais longos ("Project Manager") pressionam o cartão de 272px. É coberto pelo critério 19c.
- **Decisão para o usuário confirmar (não bloqueia):** a R14 usa as definições como metadados, e não como filtro de quem é do time (ver a justificativa na R14). Se o usuário preferir o filtro, só a R14 e os critérios 22c e 26 mudam.

## Próximo passo recomendado (v1.2)
Acionar em paralelo:
- **designer** com a tarefa 19, passando a R17, a R18 (campos `cor` e `sigla`), a seção 6 de `docs/design/fluxo.md` e o pedido literal do usuário.
- **tech-lead** com a tarefa 20, passando esta seção v1.2 inteira. A parte visual da 20 é fechada quando a spec 19 sair.

Depois disso, os devs indicados pelo tech-lead fazem a 21 (que pode começar logo), a 22, a 23, a 24 e a 25. Em seguida o QA faz a 26 e a 27, e por fim o PM faz a 28.

## Status da execução v1.2

**Resultado geral: APROVADO.** `node --test` 152/152 (inclui 11 testes do QA em `test/v12-qa-validacao.test.js`), mantido após as correções finais.

| # | Status | Resultado |
|---|--------|-----------|
| 19 | Concluída | Seção 7 de `docs/design/fluxo.md` (paleta de 12 cores, FNV-1a com vetores conferidos, monograma, legenda dinâmica, regras da config) e `docs/design/fluxo-v12-mockup.html`. |
| 20 | Concluída | Seção v1.2 de `docs/tecnico.md`: o servidor calcula nome, sigla, cor e tint e devolve `roles` em `/api/flow`; o cliente não tem tabela de papéis (fonte única); tasks B1–B4 (dev-backend) e F1–F2 (dev-frontend). `test/v11-front-sync.test.js` removido. |
| 21 | Concluída | `fixtures/time-diferente/` (com definições e `monitor.json`) e `fixtures/time-diferente-sem-definicoes.jsonl`. |
| 22 | Concluída | `src/team.js` (descoberta R13/R14 e config R18); `.gitignore` com `/.monitor/`. |
| 23 | Concluída | `src/palette.js`; `roles`/`model`/`edges` dinâmicos; `server.js` com `--config`/`MONITOR_CONFIG` (`~` só pela CLI e nunca em `--fixture`); golden de equivalência com a v1.1. Conflito R15 x 23(g) resolvido pela **R15.1**. |
| 24 | Concluída | `public/` dinâmico (monograma, cor por variáveis CSS, legenda a partir de `roles`); verificação visual por CDP sem divergências. |
| 25 | Concluída | README ("Time dinâmico" e "Configuração dos papéis") e `.claude/monitor.json` do repositório reproduzindo o visual da v1.1 (+ `nivel` da R6.1). |
| 26 | Aprovada | Paridade de arestas e vereditos com a v1.1 em todas as fixtures e no `.monitor/events.jsonl` real (0 diferenças). A observação de que `--config validador:true` não devolvia o veredito na fixture sem definições foi conferida e **não procede** (o veredito volta em `--fixture` e `--events`). |
| 27 | Aprovada | Projeto de "outra pessoa" em `/tmp` funcionou sem alterar código; XSS sem execução; o `~` real não é lido em testes nem em `--fixture`. |
| 28 | Concluída | Esta seção. |

**Bugs do QA (baixos), todos tratados:**
- BUG-1 favicon 404: corrigido com `<link rel="icon" href="data:,">` em `public/index.html`.
- BUG-2 chaves `__proto__`/`constructor`/`prototype` descartadas sem aviso: corrigido, `src/team.js` emite o aviso "nome reservado".
- BUG-3 symlinks em `agents/` são seguidos: informativo, documentado no README.

**Diferenças aceitas em relação à v1.1:**
- Os ícones SVG por papel viraram monogramas.
- As fixtures não leem o `monitor.json` do repositório, então `developer` aparece como "Developer" nelas.
- O tint do Dev Frontend é calculado (`#F5EAE2` em vez de `#FFEDD5`).
- Sem config, o hash pode dar a mesma cor a papéis diferentes (risco já aceito).

**Pendências:**
- Nada foi commitado. A v1.2 inteira está só na árvore de trabalho.
- O push inicial para `github.com/douglasdacosta/agente-monitor` está pendente por falta de credencial.
- A decisão da R14 (definições como metadados, e não como filtro) segue sem confirmação explícita do usuário. Ela não bloqueia.

---

# v1.3 — vários projetos

## Objetivo
Fazer o painel mostrar as sessões de **todos** os projetos em que o hook gravou eventos, sem cadastro. Ao lado do seletor de sessão, entra um seletor de projeto. O caso que motivou a mudança: as sessões de `~/Documentos/apps/digisac` (6) e da worktree do Orca `~/orca/workspaces/digisac/SD-2476` (1) não apareciam, porque o servidor lê um único arquivo.

## Contexto
- O hook global grava em `<CLAUDE_PROJECT_DIR ou cwd>/.monitor/events.jsonl` (`~/.claude/hooks/log-agent-event.cjs:46`). Cada projeto tem o seu arquivo.
- `server.js` lê um único arquivo (`--events`, `MONITOR_EVENTS` ou `<repo>/.monitor/events.jsonl`). `discoverTeam` já recebe o `projectDir` (R13). `createTitleResolver` já lê `~/.claude/projects` só quando recebe `homeDir`.
- As transcrições `~/.claude/projects/<slug>/<id>.jsonl` trazem o campo `cwd` nas linhas. O `slug` não é reversível (`/`, `.` e `@` viram `-`), então o `cwd` precisa ser lido do conteúdo. A pasta `<id>/subagents/` também tem `.jsonl` e deve ser ignorada.

## Regras novas (complementam R1 a R19)

**R20. Modos do servidor.**
- **Multi-projeto** (padrão): `npm start` ou `node server.js` sem `--events`/`MONITOR_EVENTS` e sem `--fixture`.
- **Projeto único**: exatamente um `--events` (ou `MONITOR_EVENTS`), ou `--fixture`. O comportamento é idêntico ao da v1.2: sem descoberta e sem seletor de projeto visível.
- **Vários `--events`** (a flag é repetível): multi-projeto **restrito** a esses arquivos, sem descoberta automática. Serve para testes e para quem quer limitar a lista.
- `--fixture` nunca faz descoberta e nunca lê o `~` (mantém a R13).

**R21. Descoberta dos projetos (só no modo multi-projeto, só com `homeDir` vindo da CLI).**
- **Candidatos**: (a) cada `cwd` distinto lido das transcrições `<homeDir>/.claude/projects/*/*.jsonl` (só o primeiro nível, ignora `subagents/`); (b) o `process.cwd()` do servidor; (c) a pasta do próprio repositório do monitor (o padrão atual). Um candidato é projeto se `<candidato>/.monitor/events.jsonl` existir.
- **Leitura barata**: de cada transcrição, só o início do arquivo (por exemplo, os primeiros 64 KB) é lido para achar o `cwd`. O resultado fica em cache por arquivo (o início de um `.jsonl` só cresce no fim, então não muda). Os arquivos novos de uma redescoberta são os únicos lidos de novo.
- **Redescoberta periódica**: a lista é refeita no máximo a cada 30 s (e na subida). Projetos novos aparecem sem reiniciar o servidor. Um projeto cujo arquivo sumiu sai da lista na redescoberta seguinte.
- **Mesmo projeto, um só item**: os caminhos são normalizados (`path.resolve` e `realpath` quando possível) antes de deduplicar.
- **Sem sessões**: um arquivo de eventos que existe, mas não tem nenhuma sessão válida, não aparece na lista.
- **Testes**: a descoberta recebe `homeDir`, `cwd` e a lista de arquivos por parâmetro. Nenhum teste lê o `~` real. Os testes montam uma estrutura falsa em pasta temporária (`fs.mkdtempSync`).

**R22. Nome e identificação do projeto.**
- **Nome**: o nome da pasta do projeto. Se o projeto é uma **worktree de git** (`<projeto>/.git` é um **arquivo**, e não um diretório), o nome é `<pasta pai> · <pasta>`. Exemplos: `digisac`, `digisac · SD-2476` (para `~/orca/workspaces/digisac/SD-2476`), `monitor-execucao`. A regra é geral e não depende do Orca.
- **Nomes repetidos**: se dois projetos ficarem com o mesmo nome, os dois recebem um sufixo com a pasta pai (`app (clientes)` e `app (interno)`). Se ainda houver colisão, o tech-lead define o desempate.
- **Arquivo fora de `.monitor`** (só via `--events`): o nome é a pasta do arquivo, e o projeto não tem definições de time (R13 continua igual).
- **Id**: um id opaco e estável, derivado do caminho absoluto (por exemplo, um hash curto). É o id que vai nas URLs da API e no `localStorage`.
- **Caminho exibido**: o caminho do **projeto** é exibido abreviado com `~` (`~/orca/workspaces/digisac/SD-2476`) como dica (tooltip) e para desempate. Nenhum caminho de `~/.claude` (transcrições, agentes ou config) aparece na API.

**R23. Time e títulos por projeto.**
- Cada projeto usa o seu `.claude/agents` e o seu `.claude/monitor.json`, mais os globais (`discoverTeam({projectDir})` com o projeto selecionado). Um `--config` explícito vale para todos os projetos (continua vencendo, como na R18).
- Os títulos de sessão (src/titles.js) continuam valendo, com uma única instância do resolvedor compartilhada entre os projetos.

**R24. Seletor de projeto (cliente).**
- **Opção**: nome do projeto, número de sessões e, se houver, a indicação de "em andamento" (por exemplo, `digisac · SD-2476 — 1 sessão · em andamento`). O texto exato é do designer.
- **Em andamento**: o projeto tem pelo menos uma sessão com um nó `running` que ainda não está "sem término" (mesmo STALE_MS da R7). A fonte única desse limite é decisão do tech-lead.
- **Ordem**: pela atividade mais recente (último `ts` do projeto), da mais nova para a mais antiga.
- **Padrão**: segue automaticamente o projeto mais recente, como o seletor de sessão já faz. Uma escolha manual é lembrada (`localStorage`) e desliga o seguir. Se outro projeto tiver atividade mais nova, aparece um aviso no mesmo estilo de "Nova sessão · ver", que volta a seguir. Se o projeto lembrado sumir, o painel volta a seguir o mais recente.
- **Troca de projeto**: a sessão selecionada volta para a mais recente do novo projeto (seguindo), e o painel lateral fecha.
- **Modo projeto único**: o seletor fica oculto. A tela é a mesma da v1.2.
- **Sem "Todos os projetos"** no seletor de sessão na v1.3: as sessões são por projeto.

**R25. API e SSE (o formato exato é do tech-lead).**
- Novo `GET /api/projects`: `{mode: 'single'|'multi', projects: [{id, name, path, sessions, running, last_ts}]}`, na ordem da R24.
- `/api/sessions` e `/api/flow` aceitam `project=<id>`. Sem o parâmetro, valem para o projeto mais recente (compatível com clientes da v1.2). Um id desconhecido devolve 404.
- O SSE é um só (`/api/stream`). O evento `update` passa a dizer qual projeto mudou (`{ts, project}`), e uma mudança na lista de projetos (entrou ou saiu) também é avisada. O cliente só recarrega o fluxo se o projeto alterado for o selecionado, e sempre atualiza a lista de projetos.
- **Sem watchers demais**: a detecção de mudança continua ligada só enquanto há clientes. O custo é proporcional ao número de projetos: stat em polling de no máximo 1 s, e no máximo um `fs.watch` por projeto (ou nenhum, se o tech-lead preferir só polling). Nada observa `~/.claude/projects` continuamente: a redescoberta é periódica (R21).
- O parse dos arquivos de eventos de todos os projetos (para as contagens de `/api/projects`) fica em cache pela assinatura do arquivo (`ino:size:mtime`).

**Hooks:** nenhuma mudança.

## Tarefas
| # | Tarefa | Responsável | Depende de | Critérios de aceite |
|---|--------|-------------|------------|---------------------|
| 29 | Spec do seletor de projeto (seção 8 de `docs/design/fluxo.md` + mockup) | designer | - | (a) Posição ao lado do seletor de sessão, com rótulos visíveis ("Projeto", "Sessão") e o comportamento em telas estreitas (sem rolagem horizontal até 1024 px). (b) O texto da opção (nome, contagem com singular e plural, "em andamento") e a dica com o caminho `~/...`; o corte de nomes longos (`digisac · SD-2476-nome-muito-longo-de-branch`) mantém a contagem visível. (c) Estados: carregando; um único projeto (decidir: mostrar desabilitado ou ocultar); nenhum projeto ("nenhum projeto com eventos encontrado" + dica de configurar o hook); projeto lembrado que sumiu; modo projeto único (oculto). (d) O aviso "atividade em outro projeto" e a relação dele com o "Nova sessão · ver" (não podem competir pelo mesmo espaço sem regra). (e) Acessibilidade: `label` associado, navegação por teclado, anúncio em `aria-live` ao trocar ou ao seguir outro projeto automaticamente, e nada que dependa só de cor. (f) Mockup com os 3 projetos do caso real. |
| 30 | Planejamento técnico v1.3 em `docs/tecnico.md` | tech-lead | 29 (só a parte de cliente; a de servidor pode começar já) | (a) Contrato JSON de `/api/projects`, do parâmetro `project` em `/api/sessions` e `/api/flow` e dos eventos SSE (R25), com exemplos. (b) Assinaturas puras e testáveis: por exemplo, `discoverProjects({homeDir, cwd, repoDir, files, cache})` e `projectName(dir)`, sem ler o `~` real. (c) Decisões: o hash do id, o tamanho do início lido da transcrição, o intervalo da redescoberta, polling ou `fs.watch`, a fonte única do STALE_MS e o desempate de nomes. (d) Divide as tarefas 31 a 34 entre `dev-backend` e `dev-frontend`, sem arquivos em comum na mesma rodada. (e) Lista os testes existentes que mudam, com o motivo (por exemplo, testes que montam o `createApp` com um arquivo só devem passar sem mudança). (f) Comandos de verificação de cada tarefa. |
| 31 | Descoberta e nome dos projetos (R21, R22) | dev-backend | 30 | Testes com estrutura falsa em `fs.mkdtempSync`, contendo um `home/.claude/projects/<slug>/<id>.jsonl` cujas linhas têm `cwd` apontando para pastas do próprio tmp, provam que: (a) um `cwd` com `.monitor/events.jsonl` vira projeto, e um sem arquivo não; (b) `subagents/*.jsonl` é ignorado; (c) um `cwd` que aparece só depois da linha 1 (ex.: na 3ª linha) é encontrado, e uma linha inválida ou parcial não quebra; (d) um `cwd` que não existe mais é ignorado sem aviso fatal; (e) o mesmo projeto vindo da transcrição, do `cwd` do servidor e de um caminho com `..` ou symlink aparece uma vez só; (f) uma pasta com `.git` **arquivo** recebe o nome `<pai> · <pasta>`, e uma com `.git` diretório (ou sem `.git`) recebe só `<pasta>`; (g) nomes repetidos são desambiguados (R22); (h) um arquivo de eventos sem sessões válidas não entra; (i) uma segunda chamada com um projeto novo criado no tmp o encontra, e uma transcrição já lida não é relida (provado com contador ou espião); (j) sem `homeDir`, só os candidatos (b), (c) e os arquivos explícitos valem; (k) nenhum teste lê o `~` real. |
| 32 | Servidor multi-projeto (R20, R23, R25) | dev-backend | 30, 31 | (a) `node server.js` sem `--events` entra no modo multi; um `--events` (ou `MONITOR_EVENTS`) e `--fixture` mantêm o modo único, e os testes da v1.2 passam sem mudança. Vários `--events` dão o modo multi restrito, sem descoberta. (b) `/api/projects` segue o contrato da 30, na ordem da atividade mais recente, com `sessions` e `running` corretos (testado com um projeto com nó `running` recente, um com `running` velho e um encerrado). (c) `/api/sessions?project=` e `/api/flow?project=` devolvem só as sessões daquele projeto; sem o parâmetro, valem para o mais recente; um id desconhecido devolve 404. (d) O time vem do `.claude/` do projeto selecionado: com dois projetos tmp com definições diferentes para o mesmo `agent_type`, o `roles` difere entre eles. (e) Escrever no arquivo de eventos do projeto B dispara o SSE `update` com o id de B em até 2 s; criar um projeto novo faz ele aparecer em `/api/projects` em até a janela da redescoberta (R21) e avisa a lista pelo SSE. (f) Sem clientes SSE, nenhum timer ou watcher fica ligado; com clientes, o número de watchers é no máximo o número de projetos. (g) Nenhuma resposta da API contém `/.claude/` nem o caminho absoluto do `homeDir` (o `path` vem abreviado com `~`). (h) `--fixture` não faz descoberta nem lê o `~` (teste com `homeDir` tmp contendo transcrições: nada dela aparece). |
| 33 | Seletor de projeto no cliente (R24) | dev-frontend | 29, 30, 32 (contrato) | (a) O seletor aparece conforme a spec 29 e fica oculto no modo único. (b) Ao abrir, segue o projeto mais recente; a escolha manual fica no `localStorage` e sobrevive a um reload; se o projeto lembrado sumir, volta a seguir. (c) A troca de projeto recarrega as sessões, seleciona a mais recente, fecha o painel lateral e atualiza a legenda e o time. (d) Um `update` de outro projeto não recarrega o fluxo atual, mas atualiza as contagens e mostra o aviso de atividade (29d); um `update` do projeto atual se comporta como na v1.2. (e) Os anúncios, os `aria-label` e o resumo citam o projeto quando ele muda. (f) O console fica sem erros, e todo texto vindo da API é escapado (nome de pasta com `<script>` não executa). |
| 34 | README e documentação | dev (área definida em 30) | 32, 33 | (a) O `README.md` explica os modos (R20), a descoberta sem cadastro (R21), o nome das worktrees (R22) e que cada projeto usa o seu time (R23). As seções "Rodando o painel" 2 e 3 refletem que `npm start` já mostra todos os projetos. (b) Cada comando citado foi executado e funciona. |
| 35 | Validação de descoberta e API v1.3 | qa | 31, 32 | `node --test` passa inteiro. Valida R20 a R25 com uma estrutura falsa própria em pasta temporária (pelo menos 3 projetos, uma worktree com `.git` arquivo, um `cwd` morto, uma transcrição em `subagents/`, um projeto sem sessões). Bordas próprias: nome de pasta com espaço, acento e `@`; dois projetos com o mesmo nome; arquivo de eventos apagado com o servidor rodando; transcrição com mais de 64 KB antes do primeiro `cwd` (comportamento documentado, sem quebrar). **Caso real** (sem mexer em config nem no hook): `npm start` a partir do repositório lista `digisac` (6 sessões), `digisac · SD-2476` (1 sessão) e `monitor-execucao`, e as contagens batem com uma contagem independente dos `session_id` de cada `events.jsonl`. Relatório no formato do QA, com cada REPROVADO roteado ao dev da área. |
| 36 | Validação ponta a ponta v1.3 | qa | 33, 34, 35 | No navegador, com o caso real: o seletor mostra os 3 projetos na ordem de atividade, com a dica do caminho `~/...`; trocar para `digisac` mostra as sessões com títulos e o time do `digisac`; abrir uma sessão nova em outro projeto (ou anexar um evento ao `events.jsonl` dele) mostra o aviso sem trocar a tela, e clicar no aviso troca. A escolha manual sobrevive ao reload. Com `--events <um arquivo>` e com `--fixture`, a tela é igual à da v1.2 e não há seletor. A tela bate com a spec 29, o teclado funciona e o console não tem erros. |
| 37 | Revisão final e atualização deste plano | project-manager | 35, 36 | A seção "Status da execução v1.3" foi acrescentada com o resultado de cada tarefa e as pendências. |

Podem começar em paralelo: **29** (designer) e a parte de servidor da **30** (tech-lead). A **31** não depende de UI e pode ir para o dev-backend logo que a 30 fechar as assinaturas.

## Riscos / Perguntas em aberto (v1.3)
- **Ruído na lista.** Qualquer pasta em que um subagente rodou com o hook ativo vira projeto, incluindo as pastas de rascunho do Claude Desktop e do Orca (`~/.config/Claude/scratch...`, `chat-scratch`). Proposta: aceitar na v1.3 (a ordem por atividade já empurra essas pastas para baixo). Se incomodar, a v1.4 pode ter uma lista `ignorar` no `~/.claude/monitor.json`. Não bloqueia.
- **Custo da descoberta.** São centenas de transcrições (mais de 300 hoje), algumas grandes. Por isso a leitura é só do início do arquivo e fica em cache por arquivo. A primeira descoberta é a mais cara: o critério 32 pode ganhar um limite de tempo se o QA medir lentidão.
- **`cwd` de um subdiretório.** Se a sessão começou num subdiretório do repositório, o hook grava em `<subdiretório>/.monitor` (`CLAUDE_PROJECT_DIR` é a pasta de abertura). Isso vira um projeto à parte, e é o comportamento correto, porque é onde está o arquivo.
- **Transcrições apagadas.** Se o Claude Code limpar as transcrições antigas, um projeto com eventos, mas sem transcrição, deixa de ser descoberto. Ele continua acessível com `--events`. Fica aceito.
- **Privacidade.** O caminho abreviado do projeto passa a ir para o navegador. O servidor continua só em `127.0.0.1`, e nenhum caminho de `~/.claude` é exposto.
- **Compatibilidade.** `npm start` muda de "este projeto" para "todos os projetos". Quem quer o comportamento antigo usa `--events .monitor/events.jsonl`. Isso fica documentado no README (34).

Sem perguntas bloqueantes.

## Próximo passo recomendado (v1.3)
Acionar em paralelo:
- **designer** com a tarefa 29, passando a R22, a R24 e o `renderHeader` atual de `public/app.js` (seletor de sessão e o aviso "Nova sessão · ver").
- **tech-lead** com a tarefa 30, passando esta seção v1.3 inteira, `server.js`, `src/team.js` e `src/titles.js`. A parte de cliente da 30 é fechada quando a spec 29 sair.

Depois, o dev-backend faz a 31 e a 32, o dev-frontend faz a 33 e o dev indicado faz a 34. Em seguida o QA faz a 35 e a 36, e por fim o PM faz a 37.

## Status da execução v1.3 (revisão final, 2026-10-29)

**Resultado geral: APROVADO.** `node --test` 224/224 (inclui `test/v13-qa-descoberta.test.js` do QA), depois da correção do BUG-1.

| # | Status | Resultado |
|---|--------|-----------|
| 29 | Concluída | Seção 8 de `docs/design/fluxo.md` (seletor de projeto, estados, aviso de atividade, acessibilidade) e mockup. |
| 30 | Concluída | Seção v1.3 de `docs/tecnico.md`. Decisões aprovadas pelo orquestrador: o arquivo de `--events` é sempre listado, mesmo sem sessões; "em andamento" é calculado na resposta. A chave do `localStorage` foi corrigida no documento para `monitor.project`. |
| 31 | Concluída | `src/projects.js` (descoberta R21 com cache por transcrição e nome R22) e `src/events.js`; `public/stale.js` como fonte única do STALE_MS. |
| 32 | Concluída | `server.js` multi-projeto (R20, R23, R25) com polling e nenhum `fs.watch`. Descoberta: 70 ms na primeira, 5 ms com cache. |
| 33 | Concluída | Seletor de projeto no cliente: seguir/manual em `localStorage` (`monitor.project`), aviso de atividade em outro projeto, `--header-h`. |
| 34 | Concluída | README (modos, descoberta, worktrees, time por projeto), feita pelo dev-backend. |
| 35 | Aprovada | Descoberta e API validadas com estrutura falsa e com o caso real: `digisac` 6, `digisac · SD-2476` 1, `monitor-execucao` 2, mais `scratch-2026-10-09-2ef47b` 1 (o ruído previsto nos riscos). |
| 36 | Aprovada no reteste | REPROVADO na 1ª rodada por **BUG-1 (baixo)**: o select de projeto ficava vazio, sem a opção "Nenhum projeto" (`public/app.js:422`). Corrigido pelo dev-frontend; o reteste foi APROVADO. |
| 37 | Concluída | Esta seção. |

**Observações do QA (não são bugs, ficam registradas):**
- O `last_message` dos nós pode conter caminhos absolutos escritos pelo próprio agente. A R22 cobre só os caminhos que o servidor gera.
- Um projeto fora do home aparece com o caminho absoluto (não dá para abreviar com `~`).
- Como o repositório do monitor é sempre candidato (R21c), nesta instalação a lista nunca fica vazia. O estado "nenhum projeto" só aparece em outra instalação ou nos testes.
- Um projeto novo aparece em cerca de 28 s (dentro da janela de 30 s da R21).

**Pendências:**
- Nada foi commitado: a v1.2 e a v1.3 estão só na árvore de trabalho, misturadas com os primeiros artefatos da v1.4 (`fixtures/esperas.jsonl`, `test/v14-fixture.test.js`, `docs/design/fluxo-v14-mockup.html` e as seções v1.4 dos documentos).
- O push para `github.com/douglasdacosta/agente-monitor` continua pendente por falta de credencial.
- A lista `ignorar` (ruído de pastas de rascunho) foi só cogitada e ainda não tem tarefa nem decisão do usuário.
- A tarefa 37 está concluída, então a implementação da v1.4 (40 em diante) está desbloqueada.

---

# v1.4 — alerta de sessão aguardando

## Objetivo
Quando uma sessão do Claude Code para esperando o Arquiteto (a pessoa que conduz as sessões), o painel mostra um alerta que chama a atenção (pisca, título da aba, notificação do sistema), com o nome do projeto, o nome da sessão e o tempo de espera ao vivo. O alerta diz em qual sessão e em qual projeto o Arquiteto deve responder ("Verifique no orquestrador"), sem depender de nenhum orquestrador específico. O objetivo é que nenhuma sessão fique parada por muito tempo sem ninguém ver.

## Contexto
- O hook (`.claude/hooks/log-agent-event.js`, com cópia global em `~/.claude/hooks/log-agent-event.cjs`) hoje escuta só `SubagentStart`, `SubagentStop` e `PreToolUse` (`Agent|Task`). Ele já grava `transcript_path` e `orca_session_id`.
- O `~/.claude/settings.json` do usuário já tem hooks do Orca nesses mesmos eventos. As nossas entradas são **acrescentadas**, sem remover as do Orca.
- **Decisão do usuário: não ficar amarrado ao Orca.** O painel não abre nenhum app nem sessão: sem `xdg-open`/`orca open`, sem endpoint que execute comandos, sem template de deep link e sem "Copiar comando `claude --resume`" (fora do escopo). O título da sessão continua vindo do resolvedor atual (Orca, depois Claude Code, depois o código curto), que é só leitura e tem fallback.
- A v1.3 (vários projetos) está em implementação. A v1.4 é construída em cima dela: a faixa de alertas cobre **todos** os projetos de `/api/projects`.
- "Pergunta" no texto (por exemplo, "quer que eu faça o commit?") não gera evento próprio: aparece como um `Stop` comum.

## Regras novas (complementam R1 a R25)

**R26. Eventos gravados pelo hook (mínimo necessário).**
- Eventos novos: `PreToolUse` com `tool_name = AskUserQuestion`, `PermissionRequest`, `Notification`, `Elicitation`, `ElicitationResult`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `Stop`, `StopFailure` e `SessionEnd`.
- Campos gravados: `ts`, `event`, `session_id`, `cwd`, `transcript_path`, `orca_session_id`, `agent_id` (quando houver) e um `resumo` curto:
  - `AskUserQuestion`: o texto da 1ª pergunta, cortado em 120 caracteres;
  - permissão: só o `tool_name`;
  - `Elicitation`: só o nome do servidor MCP;
  - `Notification`: só o `notification_type`;
  - `StopFailure`: o tipo do erro, sem a mensagem.
- **Nunca são gravados**: o texto do prompt (`UserPromptSubmit`), o `tool_input` de permissão (comandos e caminhos), o `message` da notificação, a resposta do usuário nem o `last_assistant_message` do `Stop` da sessão principal.
- **Volume**: um `PostToolUse` ou `PostToolUseFailure` só é gravado se fechar uma espera aberta daquela sessão (pergunta ou permissão). Não pode virar uma linha por chamada de ferramenta. O mecanismo é decidido pelo tech-lead (por exemplo, um marcador por sessão em `.monitor/`).
- O contrato do hook continua o mesmo: sai sempre com código 0, imprime `{}`, nunca toma decisão de permissão, termina em menos de 5 s (timeout 5) e engole qualquer erro.

**R27. Estados de espera e o que os encerra.**
| Tipo | Começa em | Termina em | Urgência |
|------|-----------|------------|----------|
| `pergunta` | `PreToolUse` `AskUserQuestion` | `PostToolUse`/`PostToolUseFailure` dessa ferramenta, `UserPromptSubmit` ou `SessionEnd` | imediata |
| `permissao` | `PermissionRequest` (ou `Notification` de permissão; os dois juntos contam como **uma** espera) | `PostToolUse`/`PostToolUseFailure`, `UserPromptSubmit`, qualquer evento de atividade posterior da sessão ou `SessionEnd` | imediata |
| `mcp` | `Elicitation` | `ElicitationResult`, `UserPromptSubmit` ou `SessionEnd` | imediata |
| `erro` | `StopFailure` | `UserPromptSubmit` ou `SessionEnd` | imediata |
| `vez` (vez do Arquiteto) | `Stop` da sessão principal | `UserPromptSubmit` ou `SessionEnd` | escalonada (R28) |
- Uma sessão tem no máximo uma espera ativa: a mais recente. O tempo de espera conta a partir do `ts` do evento que abriu essa espera.
- Um evento de encerramento sem espera aberta é ignorado. Linhas inválidas seguem a R8.

**R28. "Vez do Arquiteto".**
- Ela só conta se a sessão **não** tem subagente `running` (que não esteja "sem término"). Se houver subagente em background, a espera começa no último `SubagentStop`, desde que não tenha chegado nenhum evento de atividade da sessão principal depois dele.
- Até `vezMinutos` (R32), mostra um indicador discreto, sem piscar e sem notificação. Depois disso, passa a piscar e notifica uma vez. O tempo aparece ao vivo e a cor escala com a espera (o designer define os degraus, por exemplo 1x, 3x e 6x o limite).

**R29. Sessões sem subagentes.** Uma sessão que só tem eventos de espera ou de turno passa a ser válida (R21) e aparece no seletor de sessão do seu projeto. O grafo mostra um estado vazio próprio ("Sessão sem agentes"), e a sessão também aparece na faixa de alertas. Consequência: um projeto em que só houve conversa (sem subagentes) também passa a ser descoberto pela v1.3.

**R30. Expiração.** Uma espera some da faixa com `SessionEnd`, ou quando a sessão fica sem nenhum evento por mais de `expiraHoras` (R32, padrão 24). Isso cobre o Claude Code fechado sem `SessionEnd`.

**R31. Faixa global de alertas (cliente).**
- Fica no topo e é independente do projeto e da sessão selecionados. Mostra todas as esperas ativas de todos os projetos: primeiro as de urgência imediata e as de `vez` acima do limite; dentro de cada grupo, a que espera há mais tempo vem primeiro.
- Cada item mostra o nome do projeto, o nome da sessão (o mesmo título do seletor, que no Orca bate com o `conversationName`), o tipo em texto, o `resumo`, o tempo de espera ao vivo e as ações (R33). Clicar no item seleciona aquele projeto e aquela sessão no painel.
- **Dispensar**: esconde o item até a próxima espera nova da mesma sessão, e fica lembrado no `localStorage`. Serve para o `Stop` em que a tarefa simplesmente acabou.
- Com `prefers-reduced-motion`, nada pisca: o destaque é estático (borda forte e ícone). A piscada respeita o limite de 3 por segundo (WCAG 2.3.1). O alerta não depende só de cor e é anunciado em `aria-live`.

**R32. Atenção fora do painel.**
- O título da aba alterna para `(N) Aguardando — Monitor`, onde N é o número de esperas que já piscam, e o favicon mostra o contador.
- Notificação do navegador: a permissão é pedida **uma vez**, por um gesto do usuário (um botão), e nunca ao carregar a página. Sai uma notificação por espera nova (para `vez`, só ao passar do limite). Clicar na notificação foca o painel com aquela sessão selecionada.
- Som opcional, **desligado** por padrão.
- Config em `monitor.json` (R18), bloco `alertas`: `{ "vezMinutos": 2, "expiraHoras": 24, "som": false }`. Os valores inválidos geram um aviso e voltam ao padrão.

**R33. Como o Arquiteto chega à sessão.**
- Cada alerta mostra a mensagem **"Verifique no orquestrador"**, o **nome da sessão** (o mesmo título do seletor: Orca, depois Claude Code, depois o código curto) e o **nome do projeto** (R22).
- Botão **"Copiar nome"**: copia o nome da sessão com a área de transferência do navegador e confirma ("Nome copiado"). Se a cópia falhar, o nome fica selecionável e aparece um aviso.
- O painel não abre apps, não executa comandos e não monta links para orquestradores. Não existe endpoint novo de escrita ou de execução no servidor.

**R34. API.** O servidor calcula as esperas (uma função pura sobre as linhas de eventos, testável sem disco) para todas as fontes da v1.3, e as devolve com tipo, `ts` de início, projeto, sessão, título e `resumo`. O formato (endpoint próprio, como `/api/alerts`, ou um campo em `/api/projects`) e o evento SSE de mudança são decididos pelo tech-lead. O `transcript_path`, o `cwd` e caminhos de `~/.claude` nunca aparecem na API (R22). No modo `--fixture`, só a fixture é considerada. A API continua somente leitura.

## Tarefas
**Pré-requisito da implementação: a v1.3 aprovada (tarefa 37).** A spec (38) e o planejamento (39) podem começar antes.

| # | Tarefa | Responsável | Depende de | Critérios de aceite |
|---|--------|-------------|------------|---------------------|
| 38 | Spec da faixa de alertas (seção 9 de `docs/design/fluxo.md` + mockup) | designer | - | (a) Faixa no topo com 0, 1, 3 e 12 itens (o que fazer quando não cabe: recolher com "+N"), sem rolagem horizontal até 1024 px. (b) Item: projeto, sessão, tipo em texto e ícone, `resumo` cortado com `title` completo, tempo ao vivo (`mm:ss` e depois `h:mm`), a mensagem "Verifique no orquestrador" e as ações "Copiar nome" e "Dispensar" (R31, R33). (c) Visual de cada urgência: piscar imediato; `vez` discreta antes do limite e os degraus de escalonamento depois dele; a alternativa estática para `prefers-reduced-motion`; piscada abaixo de 3 Hz. (d) Título da aba, favicon com contador e o botão que pede a permissão de notificação. (e) O estado "Sessão sem agentes" no grafo (R29). (f) Os textos de feedback de "Copiar nome" (sucesso e falha) e de "Dispensar". (g) Acessibilidade: `aria-live` sem repetir o anúncio a cada segundo do timer, foco por teclado nas ações e nada que dependa só de cor. |
| 39 | Planejamento técnico v1.4 em `docs/tecnico.md` | tech-lead | 38 (só a parte de cliente); v1.3 estável | (a) Uma **verificação prévia** (feita por um dev, com `MONITOR_HOOK_DEBUG=1` numa sessão real no Orca) dos payloads reais de `PermissionRequest`, `Notification` (valores de `notification_type`), `Elicitation`, `StopFailure` e `AskUserQuestion` (onde fica a 1ª pergunta). O resultado fica registrado no documento. (b) O mecanismo da R26 para não gravar todo `PostToolUse`. (c) A assinatura da função pura de esperas (por exemplo, `buildWaits(lines, {now, vezMs, expiraMs, running})`) e o contrato da API e do SSE (R34), com exemplos. (d) Confirma que a v1.4 não cria endpoint de escrita nem de execução. (e) O snippet exato de `settings.json` (projeto e global) que **acrescenta** as entradas sem remover as do Orca. (f) A divisão das tarefas 40 a 45 entre `dev-backend` e `dev-frontend`, sem arquivos em comum na mesma rodada. (g) Os testes existentes que mudam, com o motivo (por exemplo, se a R29 muda contagens de sessão em `/api/projects`). (h) Os comandos de verificação. |
| 40 | Hook: eventos de espera (R26) | dev (área definida em 39) | 37, 39 | Testes com payload simulado via stdin provam que: (a) cada evento da R26 gera uma linha com só os campos permitidos; (b) a pergunta é cortada em 120 caracteres; (c) o prompt do `UserPromptSubmit`, o `tool_input` da permissão, o `message` da notificação e o `last_assistant_message` do `Stop` principal **não** aparecem na linha (asserção sobre a string gravada); (d) um `PostToolUse` sem espera aberta não grava nada, e um que fecha uma espera grava; (e) stdin vazio, JSON quebrado, `.monitor` sem permissão de escrita e campos com tipos errados terminam com código 0 e `{}` no stdout; (f) a execução leva menos de 200 ms por evento no teste; (g) um `PermissionRequest` não imprime nada além de `{}`; (h) os eventos de subagente da v1 continuam idênticos. |
| 41 | Fixture `fixtures/esperas.jsonl` | dev (área definida em 39) | 39 | Uma sessão por caso, com nome no `session_title`: (1) pergunta aberta; (2) pergunta respondida (`PostToolUse`); (3) pergunta encerrada por `UserPromptSubmit`; (4) permissão aberta (com `PermissionRequest` e `Notification` juntos); (5) permissão encerrada por `PostToolUseFailure`; (6) MCP aberto; (7) MCP encerrado por `ElicitationResult`; (8) erro (`StopFailure`) aberto; (9) `vez` antes do limite; (10) `vez` depois do limite; (11) `vez` encerrada por `UserPromptSubmit`; (12) `Stop` com um subagente ainda `running` (sem alerta); (13) espera encerrada por `SessionEnd`; (14) espera expirada (último evento há mais de 24 h); (15) sessão **sem nenhum subagente**, só com turnos; (16) linha inválida no meio. Os `ts` são relativos ao deslocamento do modo fixture, para os tempos ficarem estáveis. |
| 42 | Modelo de esperas (R27, R28, R30) | dev (área definida em 39) | 39, 41 | A função pura, testada com a fixture 41 e `now` fixo, devolve exatamente: as sessões 1, 4, 6, 8, 9 e 10 com espera ativa, com o tipo e o `ts` de início corretos; a 9 como `vez` abaixo do limite e a 10 acima; e nenhuma espera para as sessões 2, 3, 5, 7, 11, 12, 13 e 14. Além disso: a 4 dá uma só espera; trocar `vezMs` muda a classificação da 9 e da 10; a 16 não quebra nada; e a sessão 15 aparece em `sessions` com zero execuções (R29). Os testes atuais de modelo e de arestas passam sem mudança. |
| 43 | Servidor: esperas de todos os projetos e config (R32, R34) | dev (área definida em 39) | 40, 42 | (a) Com 3 projetos tmp (v1.3, modo multi restrito), as esperas dos 3 aparecem no contrato da 39, com o título da sessão (e o código curto quando não há título). (b) Anexar uma linha que abre ou fecha uma espera num projeto **não** selecionado reflete na API e no SSE em até 2 s. (c) A config `alertas` é lida com os padrões da R32, e um valor inválido gera aviso. (d) Nenhuma resposta contém `transcript_path`, `cwd`, `/.claude/` ou o `homeDir` absoluto. (e) O servidor continua sem rotas de escrita: qualquer `POST` responde 404 ou 405, e nenhum `child_process` novo é usado (conferido no código). (f) `node --test` inteiro passa. |
| 44 | Cliente: faixa de alertas e atenção fora do painel (R29, R31 a R33) | dev (área definida em 39) | 38, 43 (contrato) | (a) A faixa segue a spec 38 e mostra os alertas de todos os projetos, inclusive com outro projeto selecionado. (b) O tempo corre a cada 1 s sem refetch. (c) Com `--fixture fixtures/esperas.jsonl`, aparecem exatamente as esperas do critério 42, a 9 aparece discreta e a 10 pisca. (d) Com `prefers-reduced-motion` emulado, nada anima. (e) O título da aba e o favicon mostram o contador e voltam ao normal quando a faixa esvazia. (f) A permissão de notificação só é pedida pelo botão; uma espera nova gera uma única notificação, e clicar nela foca o painel na sessão. (g) "Dispensar" sobrevive ao reload e volta a alertar numa espera nova da mesma sessão. (h) Cada item mostra "Verifique no orquestrador", o nome da sessão e o do projeto; "Copiar nome" copia exatamente o nome exibido e confirma, e a falha da cópia mostra o aviso da R33. (i) A sessão 15 mostra "Sessão sem agentes". (j) Todo texto vindo da API é escapado (um `resumo` com `<img onerror>` não executa) e o console fica sem erros. |
| 45 | README e instalação do hook | dev (área definida em 39) | 40, 43, 44 | (a) O README explica os tipos de espera, a urgência, a config `alertas`, como achar a sessão (nome da sessão e do projeto, "Copiar nome") e o que o hook grava e o que **não** grava (privacidade). (b) Os snippets das opções A e B incluem os eventos novos e dizem para **acrescentar** sem remover os hooks já existentes (como os do Orca). (c) Cada comando citado foi executado. |
| 46 | Validação do hook, do modelo e da API v1.4 | qa | 40, 41, 42, 43 | `node --test` passa inteiro. Valida R26 a R30 e R34 com a fixture 41 e com bordas próprias: duas esperas seguidas na mesma sessão (vale a última); permissão de um subagente (com `agent_id`); `Stop` logo depois de um `SubagentStop` em background; `UserPromptSubmit` sem espera aberta; arquivo de eventos com 10 mil linhas (o tempo de resposta é medido e anotado); e varredura de privacidade nas linhas gravadas (nenhum prompt, comando ou mensagem). Confere que a API segue somente leitura (nenhum `POST` aceito). Relatório no formato do QA, com cada REPROVADO roteado ao dev da área. |
| 47 | Validação ponta a ponta v1.4, com teste manual real | qa | 44, 45, 46 | (a) Com a fixture, a tela bate com a spec 38, inclusive com reduced-motion, teclado e leitor de tela. (b) **Teste real**: com o hook instalado conforme o README (sem remover os hooks do Orca), abrir uma sessão no Orca, pedir ao agente que use `AskUserQuestion`, e ver o alerta piscar no painel em até 2 s, com o nome da sessão igual ao do Orca, o título da aba mudando e uma notificação. Responder no Orca e ver o alerta sumir em até 2 s. Repetir com um pedido de permissão (por exemplo, um comando Bash não liberado). (c) Terminar um turno com uma pergunta no texto, ver o indicador discreto, e ver que ele pisca depois de `vezMinutos` (use 1 min na config do teste). (d) "Copiar nome" e colar na busca do Orca encontra a sessão. Numa sessão do Claude Code fora do Orca, o alerta mostra o título do Claude Code ou o código curto. (e) Os hooks do Orca continuam funcionando, e nenhum turno do Claude Code fica mais lento de forma perceptível. (f) O console fica sem erros. |
| 48 | Revisão final e atualização deste plano | project-manager | 46, 47 | A seção "Status da execução v1.4" foi acrescentada com o resultado de cada tarefa e as pendências. |

Podem começar já: **38** (designer) e **39** (tech-lead, incluindo a verificação prévia dos payloads). A **41** pode sair logo depois da 39. A **40** e as seguintes só começam depois da **37**.

## Riscos / Perguntas em aberto (v1.4)
- **Payloads reais não confirmados.** Os nomes de campo de `PermissionRequest`, `Notification`, `Elicitation` e `StopFailure`, e a estrutura do `tool_input` do `AskUserQuestion`, precisam ser confirmados (39a) antes da 40. Se o Orca rodar o Claude Code de um jeito que não dispara algum desses hooks, aquele tipo de espera fica sem detecção, e isso é registrado.
- **`Stop` sem pergunta.** Nem todo `Stop` é uma pergunta: muitas vezes a tarefa só acabou. A mitigação é a urgência escalonada (R28) e o "Dispensar" (R31). Ainda pode haver ruído.
- **Ruído na lista de projetos.** A R29 faz qualquer pasta onde houve uma conversa (com o hook global) virar projeto, e não só as pastas com subagentes. Isso agrava o risco de ruído da v1.3. A mitigação possível é a lista `ignorar` já cogitada para a v1.4.
- **Volume do `events.jsonl`.** Agora cada turno grava pelo menos `UserPromptSubmit` e `Stop`. O volume é baixo por linha, mas o parse completo por mudança (v1.3) cresce. O QA mede na 46.
- **Ida até a sessão é manual.** Por decisão do usuário, o painel não abre o orquestrador: o Arquiteto procura a sessão pelo nome. Se dois títulos forem iguais, o nome do projeto e o tempo de espera ajudam a distinguir. Um link direto fica fora do escopo.
- **Esperas fantasmas.** Uma sessão morta sem `SessionEnd` fica alertando até `expiraHoras`. O "Dispensar" resolve no caso a caso.
- **Concorrência com os hooks do Orca.** Os dois rodam no mesmo evento. O nosso tem que ser rápido e silencioso (critérios 40e/f e 47e).

**Respostas do usuário (2026-10-29) — perguntas encerradas:**
1. Limite padrão da "vez do Arquiteto": **2 minutos** (`alertas.vezMinutos: 2`).
2. Turno encerrado sem pergunta formal (`Stop`) **gera alerta**, discreto no início, piscando após o limite, com "Dispensar".
3. O orquestrador **aplica** as entradas novas no `~/.claude/settings.json` e o hook global (backup antes, só acrescentar, sem tocar nos hooks do Orca).
4. Não amarrar ao Orca: sem link/botão para abrir o Orca; alerta mostra "Verifique no orquestrador" + nome da sessão + "Copiar nome".

## Próximo passo recomendado (v1.4)
Depois das respostas às 3 perguntas, acionar em paralelo:
- **designer** com a tarefa 38, passando as R27 a R33, a seção 8 de `docs/design/fluxo.md` (seletor da v1.3) e o pedido literal do usuário.
- **tech-lead** com a tarefa 39, passando esta seção v1.4 inteira, a seção v1.3 de `docs/tecnico.md`, `.claude/hooks/log-agent-event.js` e a seção "Nome das sessões" do README. A verificação 39a pode ser delegada a um dev antes do resto.

A implementação (40 a 45) só começa depois da tarefa 37 (v1.3 aprovada). Depois vêm o QA (46 e 47) e a revisão do PM (48).

## Status da execução v1.4 (revisão final, 2026-10-29)

**Resultado geral: APROVADO, com pendências de verificação no uso real.** `node --test` 316/316 em 3 rodadas (inclui `test/v14-qa-validacao.test.js` do QA), depois da correção do BUG-1 e do BUG-2.

| # | Status | Resultado |
|---|--------|-----------|
| 38 | Concluída | Seção 9 de `docs/design/fluxo.md` e `docs/design/fluxo-v14-mockup.html`. |
| 39 | Concluída | Seção v1.4 de `docs/tecnico.md`. Por decisão do orquestrador, `PostToolUse`/`PostToolUseFailure` usam desde o início um pré-filtro em shell (só chamam o `node` se houver marcador em `.monitor/open/`). |
| 40 | Concluída | Hook com o ramo de espera (R26), marcador em `.monitor/open/` e `.monitor/.gitignore` com `*`. |
| 41 | Concluída | `fixtures/esperas.jsonl` com os 16 casos. |
| 42 | Concluída | `src/waits.js` (função pura de esperas). |
| 43 | Concluída | `src/alert-config.js` e `GET /api/waits` (somente leitura; nenhum `POST`, nenhum `child_process` novo). |
| 44 | Concluída | `public/alerts.js`: faixa, degraus D0 a D3, piscada de até 1 Hz, reduced-motion, título e favicon, sino com notificações, "Copiar nome", "Dispensar"/"Desfazer" e "Sessão sem agentes". |
| 45 | Concluída | README com tipos de espera, config `alertas`, privacidade e os snippets. Limitação registrada: uma `vez` curta pode aparecer antes do `Stop` real quando há subagentes em background. |
| 46 | Aprovada no reteste | REPROVADO na 1ª rodada por **BUG-1 (médio)**: um `PostToolUse` de outro ator fechava a permissão pendente (`src/waits.js`). Corrigido pelo dev-backend. |
| 47 | Aprovada em parte (a, c, d, f no QA; b feita pelo orquestrador) | REPROVADO na 1ª rodada por **BUG-2 (baixo)**: o Esc não fechava o popover do sino depois de "Ativar notificações" (`public/app.js`). Corrigido pelo dev-frontend. **47b real** (sessão no Orca, `AskUserQuestion`): o alerta apareceu e piscou, e sumiu ao responder (`/api/waits` vazio, marcador removido). Os payloads confirmados estão em `docs/tecnico.md` ("Payloads confirmados no teste real"). A 47e (latência) não foi medida. |
| 48 | Concluída | Esta seção. |

**Instalação:** hook global e `~/.claude/settings.json` atualizados pelo orquestrador, com backup (`*.bak-v14-20261029195749`). Foram acrescentadas 11 entradas, os hooks do Orca foram preservados e o hook de captura temporário foi removido.

**Pendências (o usuário verifica no uso):**
- Um pedido de permissão real de ferramenta (a sessão de teste roda com permissões liberadas).
- `Elicitation` (MCP), `StopFailure` e `SessionEnd`.
- A `vez` acendendo depois de 2 min e escalando nos degraus.
- A notificação do sistema e o som com a permissão concedida, e o clique na notificação focando a sessão.
- A latência percebida nos turnos e nos hooks do Orca (47e).
- Nada da v1.3 nem da v1.4 foi commitado. O push por SSH já funciona.
- A lista `ignorar` (ruído de projetos, agravado pela R29) continua sem tarefa nem decisão.
