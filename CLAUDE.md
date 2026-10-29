# monitor-execucao

## Time de agentes
Os subagentes ficam em `.claude/agents/`:

| Agente | Modelo | Papel |
|--------|--------|-------|
| `project-manager` | Opus | Requisitos, quebra de tarefas, critérios de aceite, plano em `docs/plano.md` |
| `designer` | Opus | Fluxos, telas, componentes, acessibilidade, specs em `docs/design/` |
| `tech-lead` | Opus 5.5 | Planejamento técnico, contratos backend/frontend, tasks para os devs em `docs/tecnico.md` |
| `dev-backend` | Sonnet 5.5 | Servidor, APIs, regras de negócio, dados; testes unitários; correção de bugs de backend |
| `dev-frontend` | Sonnet 5.5 | Interface conforme a spec; testes; correção de bugs de frontend |
| `qa` | Sonnet | Validação contra critérios de aceite, testes, relatório de bugs |

## Fluxo de trabalho
1. **project-manager** recebe o pedido e produz o plano com tarefas e critérios de aceite.
2. **designer** especifica a UI das tarefas que envolvem interface.
3. **tech-lead** cria o planejamento técnico: contratos entre backend e frontend e tasks para cada dev.
4. **dev-backend** e **dev-frontend** implementam suas tasks (em paralelo quando o tech-lead indicar).
5. **qa** valida; se REPROVADO, cada bug volta para o dev da área (backend ou frontend) até aprovar.
6. **project-manager** revisa o resultado final e atualiza o plano.

Subagentes não acionam outros subagentes: a sessão principal faz a orquestração,
repassando a cada agente o contexto que ele precisa (plano, spec, relatório do QA).
