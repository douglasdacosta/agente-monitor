# agente-monitor

Painel web, ao vivo, que mostra **o que o seu time de subagentes do Claude Code está fazendo**:
quem rodou, em que ordem, quanto tempo levou, quem passou o trabalho para quem — e quando o QA
reprovou e o trabalho **voltou** para o desenvolvedor. Também avisa quando alguma sessão do
Claude Code está **parada esperando você** (uma pergunta, uma permissão, um erro).

Funciona com qualquer time de agentes (os nomes, cores e papéis são descobertos sozinhos), em
vários projetos ao mesmo tempo, sem dependências npm e sem enviar nada para fora da sua máquina.

- [Início rápido](#início-rápido)
- [Como ler o painel](#como-ler-o-painel)
- [Como funciona](#como-funciona)
- [Instalando o hook](#instalando-o-hook)
- [Rodando o painel](#rodando-o-painel)
- [Alertas de sessão aguardando](#alertas-de-sessão-aguardando)
- [Nome das sessões](#nome-das-sessões)
- [Time dinâmico: quem aparece e como](#time-dinâmico-quem-aparece-e-como)
- [Personalizando os papéis (`monitor.json`)](#personalizando-os-papéis-monitorjson)
- [Privacidade: o que é gravado](#privacidade-o-que-é-gravado)
- [API](#api)
- [Problemas comuns](#problemas-comuns)
- [Desenvolvimento](#desenvolvimento)

## Início rápido

**Pré-requisitos:** Node.js 20 ou superior (`node -v`) e, para dados reais, o Claude Code.
Não é preciso `npm install`.

**1. Veja o painel com dados de exemplo** (não precisa configurar nada):
```bash
git clone https://github.com/douglasdacosta/agente-monitor.git
cd agente-monitor
node server.js --fixture fixtures/cenario-time-novo.jsonl
```
Abra http://127.0.0.1:4317. Você verá um fluxo PM → Designer → Tech Lead → devs em paralelo → QA
reprova → dev corrige → QA aprova.

**2. Instale o hook** que grava os eventos dos seus agentes — uma vez só, vale para todos os projetos:
```bash
mkdir -p ~/.claude/hooks
cp .claude/hooks/log-agent-event.js ~/.claude/hooks/log-agent-event.cjs
```
Depois acrescente as entradas de [Instalando o hook](#instalando-o-hook) ao `~/.claude/settings.json`.

**3. Rode o painel e use o Claude Code normalmente:**
```bash
npm start
```
Abra uma **sessão nova** do Claude Code (os hooks só são lidos no início da sessão) em qualquer
projeto e peça algo que use subagentes. O projeto aparece sozinho no seletor **Projeto** em até ~30 s,
e o fluxo é desenhado conforme os agentes rodam.

## Como ler o painel

| Elemento | O que significa |
|----------|-----------------|
| **Cartão (nó)** | Uma execução de um agente: nome do papel, sigla, cor, tarefa e duração. Se ainda está rodando, mostra **Em execução** com um timer ao vivo. |
| **Colunas (etapas)** | A ordem do fluxo, da esquerda para a direita. Agentes que rodaram **em paralelo** aparecem empilhados na mesma etapa. |
| **Seta cinza contínua** | **Avanço**: o trabalho seguiu de um agente para o próximo. |
| **Seta vermelha tracejada** | **Voltou**: o trabalho retornou para uma etapa anterior (ex.: o QA reprovou e devolveu para o dev). |
| **Selo ✔ / ✖** | Veredito de um agente validador (QA): APROVADO ou REPROVADO. |
| **Sem término** (ampulheta) | O agente está marcado como rodando, mas a sessão está há mais de 2 h sem eventos — provavelmente foi interrompido. |
| **Total** (no topo) | Tempo do primeiro início ao último término da sessão. |
| **Faixa de alertas** (topo) | Sessões de **qualquer projeto** esperando você. Ver [Alertas](#alertas-de-sessão-aguardando). |

Interações:
- **Clique em um cartão** para abrir os detalhes: tarefa, início/término, duração, veredito, de quem
  veio, para quem seguiu e a **última mensagem** do agente (até 500 caracteres).
- **Projeto** e **Sessão** (no topo) escolhem o que ver. O painel segue sozinho o projeto mais recente
  até você escolher um manualmente; quando há atividade nova em outro projeto ou surge uma sessão nova,
  aparece um aviso para ir até ela.
- **Ocultar outros** esconde agentes que não são do time (os nativos do Claude Code, como `Explore` ou
  `general-purpose`, que aparecem em cinza como "Outro").
- **Sino**: ativa notificações do navegador e som para novos alertas.
- **Ver como lista**: o mesmo fluxo em formato de texto (útil com leitor de tela).

## Como funciona

```
 Claude Code ──hook──▶ <projeto>/.monitor/events.jsonl ──▶ server.js ──SSE──▶ navegador
 (cada evento de      (uma linha JSON por evento,          (monta execuções,   (redesenha ao
  agente/espera)       só no seu disco)                     setas e esperas)    vivo)
```

1. Um **hook** do Claude Code (`log-agent-event.js`) é chamado quando um subagente é disparado
   (`PreToolUse` da ferramenta Agent), começa (`SubagentStart`) e termina (`SubagentStop`), e também
   nos eventos de **espera** (pergunta, permissão, fim de turno, erro). Ele acrescenta uma linha em
   `.monitor/events.jsonl` na pasta do projeto em que a sessão roda. Na primeira vez, cria
   `.monitor/.gitignore` com `*`, então o `git status` do projeto continua limpo.
2. O **servidor** (`server.js`, código em `src/`) lê esses arquivos — nunca escreve neles —, monta as
   execuções e as setas e avisa o navegador via SSE sempre que um arquivo muda.
3. No modo padrão, o servidor **descobre os projetos sozinho** olhando as transcrições do Claude Code em
   `~/.claude/projects/`: toda pasta onde o hook gravou eventos vira um projeto no seletor.

## Instalando o hook

Escolha **uma** das duas formas (usar as duas grava cada evento duas vezes).

### Em todos os projetos (recomendado)
```bash
mkdir -p ~/.claude/hooks
cp .claude/hooks/log-agent-event.js ~/.claude/hooks/log-agent-event.cjs
```
A extensão `.cjs` é necessária: o hook é CommonJS e a pasta `~/.claude/hooks` não tem `package.json`.

Em seguida, **acrescente** as entradas abaixo ao `~/.claude/settings.json`. Se ele já tiver hooks
(por exemplo, os do Orca), **não remova nada**: anexe cada objeto ao array do evento correspondente
(ou crie o array, se o evento ainda não existir).

<details>
<summary>Entradas do <code>settings.json</code> (clique para expandir)</summary>

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Agent|Task",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      },
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "d=\"${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open\"; if [ -n \"$(ls -A \"$d\" 2>/dev/null)\" ]; then node \"$HOME/.claude/hooks/log-agent-event.cjs\"; else echo '{}'; fi",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "d=\"${CLAUDE_PROJECT_DIR:-$PWD}/.monitor/open\"; if [ -n \"$(ls -A \"$d\" 2>/dev/null)\" ]; then node \"$HOME/.claude/hooks/log-agent-event.cjs\"; else echo '{}'; fi",
            "timeout": 5
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt|elicitation_dialog",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "Elicitation": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "ElicitationResult": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/log-agent-event.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

</details>

### Só em um projeto
Copie `.claude/hooks/log-agent-event.js` e `.claude/hooks/package.json` (que marca a pasta como
CommonJS) para o `.claude/hooks/` do projeto e acrescente ao `.claude/settings.json` **dele** as mesmas
entradas acima, trocando o caminho do comando:

| Onde aparece | Troque | Por |
|--------------|--------|-----|
| todas as entradas | `$HOME/.claude/hooks/log-agent-event.cjs` | `$CLAUDE_PROJECT_DIR/.claude/hooks/log-agent-event.js` |

### Depois de instalar
- **Abra uma sessão nova** do Claude Code: os hooks são lidos quando a sessão começa.
- **Por que `PostToolUse` tem um `if`:** esse evento dispara a cada chamada de ferramenta. O comando só
  executa o `node` quando existe um marcador em `<projeto>/.monitor/open/` (uma pergunta ou permissão
  aberta); sem marcador, imprime `{}` e sai, sem custo. A raiz do projeto é `${CLAUDE_PROJECT_DIR:-$PWD}`.
- O hook nunca bloqueia nem decide nada: sempre imprime `{}` e sai com código 0.
- Para ver quais campos o Claude Code envia ao hook, rode com `MONITOR_HOOK_DEBUG=1`.

## Rodando o painel

### Modos
| Comando | Para quê | Seletor de projeto |
|---------|----------|--------------------|
| `npm start` / `node server.js` | **Padrão.** Todos os projetos em que o hook gravou eventos, descobertos sozinhos | sim |
| `node server.js --events <projeto>/.monitor/events.jsonl` | Um projeto só, sem descoberta | oculto |
| `node server.js --events <a> --events <b> ...` | Só os projetos escolhidos, sem descoberta (aparecem mesmo vazios ou ainda inexistentes) | sim |
| `node server.js --fixture <arquivo>` | Dados de exemplo; nunca lê o `~` | oculto |

Com `npm`, passe as opções depois de `--`: `npm start -- --events .monitor/events.jsonl`.
Se o arquivo de eventos ainda não existir, a tela avisa e passa a mostrar os dados assim que ele for criado.

### Opções
| Opção | Variável de ambiente | Padrão | Descrição |
|-------|---------------------|--------|-----------|
| `--events <arquivo>` | `MONITOR_EVENTS` | — (multi-projeto) | Arquivo de eventos; repetível (ver "Modos") |
| `--fixture <arquivo>` | `MONITOR_FIXTURE` | — | Usa um arquivo de exemplo (horários deslocados para agora) |
| `--config <arquivo>` | `MONITOR_CONFIG` | — | Config de papéis extra; vence as outras (ver [`monitor.json`](#personalizando-os-papéis-monitorjson)) |
| `--no-titles` | `MONITOR_TITLES=0` | ligado | Não busca nomes de sessão no `~` (ver [Nome das sessões](#nome-das-sessões)) |
| `--port <n>` | `PORT` | `4317` | Porta HTTP |
| — | `MONITOR_HOST` | `127.0.0.1` | Endereço em que o servidor escuta |

### Dados de exemplo
Arquivos em `fixtures/`, para conhecer o painel ou testar mudanças. No modo fixture os horários são
deslocados para "agora", então o timer de quem está em execução corre normalmente.

| Arquivo | Cenário |
|---------|---------|
| `cenario-time-novo.jsonl` | PM → Designer → Tech Lead → Dev Backend ∥ Dev Frontend → QA reprova → Dev Frontend → QA aprova (e uma 2ª sessão em que o QA devolve para os dois devs) |
| `cenario-usuario.jsonl` | PM → Designer ∥ Developer → QA reprova → Developer → QA aprova |
| `ao-vivo.jsonl` | Fluxo com um QA ainda em execução (timer correndo) |
| `edge-cases.jsonl` | Casos de borda: agente fora do time, linhas inválidas, várias sessões |
| `esperas.jsonl` | 16 casos de sessões aguardando (faixa de alertas) |
| `time-diferente-sem-definicoes.jsonl` | Time com outros nomes (`arquiteto`, `dba`, `revisor-seguranca`), sem arquivos de agentes |
| `time-diferente/.monitor/events.jsonl` | O mesmo time, com definições e config em `time-diferente/.claude/` (use com `--events`) |

### Descoberta de projetos (modo padrão)
- O servidor lê o início (primeiros 64 KB) de cada transcrição `~/.claude/projects/*/*.jsonl` para achar a
  pasta (`cwd`) em que a sessão rodou; também considera a pasta de onde você iniciou o servidor e a
  pasta deste repositório. As pastas `<sessão>/subagents/` são ignoradas.
- Uma pasta vira projeto se tiver `.monitor/events.jsonl` **com pelo menos uma sessão válida**.
  Pastas dentro de `~/.claude` e `cwd` que já não existe são descartados.
- Um projeto novo aparece em até ~30 s (a lista é refeita periodicamente). O resultado fica em cache:
  a primeira leitura é a mais lenta; as seguintes só leem transcrições novas.
- Se o primeiro `cwd` de uma transcrição vier depois dos 64 KB, ela não indica projeto (os outros
  caminhos continuam valendo).
- **Nome do projeto:** o da pasta (`agente-monitor`). Em uma **worktree git** (`.git` é um arquivo),
  `pasta-pai · pasta` (`digisac · SD-2476`). Nomes repetidos ganham a pasta pai (`app (clientes)`).
  O caminho completo, abreviado com `~`, aparece como dica da opção.
- **Ordem:** atividade mais recente primeiro. A escolha manual de projeto fica lembrada no navegador.
  "Em andamento" = há um agente rodando e a sessão não está "sem término" (mais de 2 h sem eventos).
- **Ruído:** qualquer pasta em que um subagente rodou com o hook ativo vira projeto, inclusive pastas de
  rascunho do Claude Desktop e do Orca (`~/.config/Claude/scratch-workspaces/...`, `chat-scratch`).
  Elas ficam no fim da lista. Para uma lista enxuta, use `--events`.

## Alertas de sessão aguardando

Uma faixa no topo do painel mostra, para **todos os projetos** (independente do projeto selecionado), as
sessões do Claude Code que estão esperando por você. Cada item traz o tipo de espera, há quanto tempo, o
nome da sessão e do projeto, e o botão **Copiar nome** — para você achar a sessão no seu terminal ou
orquestrador. O painel **não abre apps, não executa comandos e não monta links**.

| Tipo | Quando aparece | Quando some | Urgência |
|------|----------------|-------------|----------|
| `pergunta` | O Claude fez uma pergunta (`AskUserQuestion`) | Você respondeu, mandou outro prompt ou a sessão terminou | imediata |
| `permissao` | Pedido de permissão para uma ferramenta | A ferramenta rodou (ou falhou), outro evento do mesmo agente, novo prompt ou fim da sessão | imediata |
| `mcp` | Um servidor MCP pediu informação (`Elicitation`) | Resposta enviada, novo prompt ou fim da sessão | imediata |
| `erro` | O turno terminou com erro (`StopFailure`, ex.: `rate_limit`) | Novo prompt ou fim da sessão | imediata |
| `vez` (sua vez) | A sessão principal terminou o turno (`Stop`) | Novo prompt ou fim da sessão | só depois de `vezMinutos` |

- Cada sessão tem no máximo uma espera: a mais recente. O tempo conta desde o evento que a abriu.
- `Stop` nem sempre é uma pergunta (a tarefa pode só ter acabado): a `vez` aparece discreta, passa a
  piscar depois do limite, e o item tem **Dispensar** (lembrado no navegador até uma espera nova da sessão).
- Se a sessão ainda tem subagente rodando em background, a `vez` só começa no último `SubagentStop`
  (e só se a sessão principal não tiver feito nada depois). Subagente sem `SubagentStop` há mais de 2 h não conta.
- **Limitação:** a `vez` aberta no último `SubagentStop` não é cancelada por atividade da sessão principal que
  o hook não grava (ex.: chamadas de ferramenta comuns), então pode surgir uma `vez` curta antes do `Stop` real.
  Ela some no próximo `Stop`/`UserPromptSubmit`; use **Dispensar**.
- Uma espera some com `SessionEnd`, ou quando a sessão fica sem evento algum por mais de `expiraHoras`.
- Sessões que só conversaram (sem subagentes) também aparecem no seletor ("Sessão sem agentes").

### Configurando os alertas
No `monitor.json` (ver [locais](#personalizando-os-papéis-monitorjson)). No modo multi-projeto vale só a
config global (`~/.claude/monitor.json` e `--config`), porque a faixa é uma só.

```json
{ "alertas": { "vezMinutos": 2, "expiraHoras": 24, "som": false } }
```
`vezMinutos` e `expiraHoras` aceitam número maior que 0 (inclusive fração, como `0.5`); `som` é `true`/`false`.
Valor inválido vira aviso e volta ao padrão acima.

## Nome das sessões

O seletor mostra o nome da sessão em vez do código (`session_id`). O nome vem, nesta ordem, de:

1. **Orca** (`conversationName`): lido, somente leitura, de `agent-session-journal.db` em
   `$ORCA_USER_DATA_PATH` ou `~/.config/orca/` (no macOS também `~/Library/Application Support/orca/`).
   Usa o `python3` (módulo `sqlite3`); **o `python3` é opcional**: sem ele, ou sem o Orca, o painel segue
   para os próximos itens e avisa uma vez no terminal.
2. **Título renomeado no Claude Code** (`custom-title` da transcrição em `~/.claude/projects/`).
3. **Título gerado pelo Claude Code** (`ai-title`, mesma transcrição).
4. Campo `session_title` de algum evento da sessão (usado nos dados de exemplo).
5. Sem nome: o painel mostra o código.

Com `--fixture` só vale o item 4. Para desligar a busca no `~`: `--no-titles` ou `MONITOR_TITLES=0`.

## Time dinâmico: quem aparece e como

O painel não tem uma lista fixa de papéis: **o time é o que aparece nos eventos.** Você não precisa
cadastrar nada; os ajustes abaixo são opcionais.

**Quem é do time.** Todo `agent_type` é um papel do time, **exceto** os nativos do Claude Code
(`general-purpose`, `Explore`, `Plan`, `statusline-setup`, `output-style-setup`, `claude`), os de
plugin (com `:`, como `plugin:agente`) e os listados em `nativos` na config. Os nativos aparecem
como "Outro" (cinza) e podem ser ocultados com **Ocultar outros**. Ter ou não um arquivo de definição
não muda quem é do time; assim, o histórico não some se um agente for renomeado ou removido.

**De onde vêm as definições** (só metadados: descrição, modelo e se o papel é validador):
- `<projeto>/.claude/agents/*.md`, onde o projeto é a pasta pai de `.monitor/` do arquivo de eventos;
- `~/.claude/agents/*.md`. Se o mesmo `name` existir nas duas, vale a do projeto.

O `name` vem do frontmatter; sem ele, vale o nome do arquivo. Arquivo ilegível, sem frontmatter ou com
mais de 256 KB é ignorado com um aviso. Com `--fixture`, `~/.claude` **não** é lido (a mesma fixture
fica igual em qualquer máquina).

**Validador (quem emite APROVADO/REPROVADO).** Vale a primeira regra que se aplicar:
1. `validador: true|false` na config do papel;
2. se há definição, o papel é validador quando o corpo dela contém o modelo `Resultado: APROVADO | REPROVADO`;
3. sem definição, só o papel chamado `qa`.

Para que o veredito apareça, a mensagem final do validador deve conter `Resultado: APROVADO` ou
`Resultado: REPROVADO`. Quem não é validador nunca mostra veredito, mesmo que cite essas palavras.

**"Voltou" (seta tracejada vermelha).** A seta X→Y é "voltou" quando:
1. X é validador e reprovou (REPROVADO); ou
2. X e Y têm `nivel` na config e o de Y é menor; ou
3. (senão) o destino **não** é validador e Y estreou na sessão em um lote anterior ao de X.

Ir para um validador (por exemplo, dev → QA de novo) é sempre "avanço". Papéis que estreiam juntos
(em paralelo) nunca geram "voltou" entre si. Limitação: um papel que estreia depois de outro nunca
recebe "voltou" vindo dele; use `nivel` na config para esses casos.

**Nome, sigla e cor automáticos.**
- Nome: `dev-backend` vira "Dev Backend"; palavras de até 2 letras ficam em maiúsculas (`qa` vira "QA").
- Sigla: iniciais das duas primeiras palavras (`dev-backend` = DB) ou as 2 primeiras letras (`dba` = DB).
- Cor: uma das 12 cores da paleta, escolhida por hash (FNV-1a) do `name`; o mesmo nome tem a mesma
  cor em qualquer máquina. Nomes diferentes podem cair na mesma cor (a sigla e o nome distinguem);
  a config resolve.
- Ordem na coluna e na legenda: `ordem` da config, depois o nível de estreia, depois o horário.

## Personalizando os papéis (`monitor.json`)

Opcional. Locais, do mais fraco para o mais forte (campo a campo, por papel):
1. `~/.claude/monitor.json` (pessoal);
2. `<projeto>/.claude/monitor.json` (versionável, ao lado dos agentes);
3. `--config <arquivo>` ou `MONITOR_CONFIG=<arquivo>`.

A config é relida a cada atualização (sem reiniciar o servidor); a mudança aparece no próximo evento ou
ao recarregar a página. `nativos` é a união das três fontes.

```json
{
  "papeis": {
    "revisor-seguranca": {
      "nome": "Segurança",
      "sigla": "SEC",
      "cor": "#7E22CE",
      "ordem": 3,
      "nivel": 3,
      "validador": true
    }
  },
  "nativos": ["meu-agente-interno"],
  "alertas": { "vezMinutos": 2, "expiraHoras": 24, "som": false }
}
```

| Campo | Aceita | Efeito |
|-------|--------|--------|
| `nome` | texto, 1 a 40 caracteres | Nome exibido. Não muda a cor. Nomes longos são cortados no cartão. |
| `sigla` | 1 a 3 caracteres | Monograma do cartão. Com 4 ou mais, usa os 3 primeiros e avisa. |
| `cor` | `#RRGGBB` ou `#RGB` | Cor do papel. Abaixo de 4,5:1 de contraste, é escurecida e avisa. Evite vermelho, verde e âmbar: têm significado de estado. |
| `ordem` | número | Posição na coluna e na legenda; papéis com `ordem` vêm antes dos sem. |
| `nivel` | número | Nível para "voltou"; só vale se os **dois** papéis da seta têm `nivel`. |
| `validador` | `true`/`false` | Força o papel a emitir (ou não) veredito. |
| `nativos` (raiz) | lista de textos | `agent_type`s tratados como "Outro". |
| `alertas` (raiz) | objeto | Ver [Configurando os alertas](#configurando-os-alertas). |

JSON inválido ou campo de tipo errado é ignorado com um aviso (em `warnings` de `/api/flow`), sem
quebrar o painel. Chaves de nativos e `outro` não podem ser reestilizadas.

## Privacidade: o que é gravado

Tudo fica na sua máquina: o hook grava só no `.monitor/` do projeto e o servidor escuta em `127.0.0.1`.

O hook grava apenas `ts`, `event`, `session_id`, `cwd`, `transcript_path`, `orca_session_id`, `agent_id`
(quando há), `tool_name` e `tool_use_id` (identificadores, sem conteúdo) e um `resumo` curto:

| Evento | `resumo` |
|--------|----------|
| `PreToolUse` `AskUserQuestion` | 1ª pergunta, sem caracteres de controle, até 120 caracteres |
| `PermissionRequest` | só o `tool_name` |
| `Notification` | só o `notification_type` |
| `Elicitation`/`ElicitationResult` | só o nome do servidor MCP |
| `StopFailure` | o tipo do erro (`rate_limit` etc.); outro formato vira `erro` |
| `UserPromptSubmit`, `Stop`, `SessionEnd`, `PostToolUse*` | nenhum |

Nos eventos de subagente são gravados também o tipo do agente, a descrição da tarefa e o início da
última mensagem (até 500 caracteres), que aparecem nos detalhes do cartão.

**Nunca são gravados:** o texto do seu prompt, o `tool_input` (comandos e caminhos), a resposta da
ferramenta, o `message` da notificação, a resposta que você deu a uma pergunta e o `last_assistant_message`
do `Stop`.

**O que o servidor lê:** os arquivos de eventos, `*.md` de `.claude/agents/` (até 256 KB, sem subpastas,
seguindo links simbólicos como o Claude Code), `monitor.json` (até 64 KB), o início das transcrições em
`~/.claude/projects/` e, opcionalmente, o banco do Orca. A API não expõe caminhos de `~/.claude`, das
transcrições nem do banco do Orca (só o do próprio arquivo de eventos, em `source.path`).

**Marcador `.monitor/open/`.** Para não gravar uma linha por chamada de ferramenta, o hook cria um
arquivo-marcador por sessão em `.monitor/open/<sha256(session_id), 16 caracteres>` quando abre uma
`pergunta` ou `permissao`. `PostToolUse`/`PostToolUseFailure` só são gravados se houver marcador que eles
fecham; `UserPromptSubmit`, `Stop`, `StopFailure` e `SessionEnd` gravam e apagam o marcador. Um marcador
órfão custa no máximo uma linha extra.

## API

Todas somente leitura, em `http://127.0.0.1:4317`.

| Rota | Retorna |
|------|---------|
| `GET /api/projects` | Projetos (`id`, `name`, `path`, `sessions`, `running`, `last_ts`) |
| `GET /api/sessions?project=<id>` | Sessões do projeto |
| `GET /api/flow?project=<id>` | Execuções e setas do fluxo, mais `warnings` da config |
| `GET /api/waits` | Esperas de **todos** os projetos (com `--fixture`, só a fixture) |
| `GET /api/stream` | SSE: `update` (com o `project` que mudou) e `projects` (a lista mudou) |

Sem `?project=`, `/api/sessions` e `/api/flow` valem para o projeto mais recente; id desconhecido devolve 404.
`/api/waits` responde 405 para outros métodos e ignora parâmetros desconhecidos:

```json
{
  "now": "2026-10-29T14:10:00.000Z",
  "config": {"vezMinutos": 2, "expiraHoras": 24, "som": false, "vez_ms": 120000},
  "waits": [
    {"id": "p3f9a1c2b7d4e:6f1c...:2026-10-29T14:09:41.000Z",
     "project": "p3f9a1c2b7d4e", "project_name": "digisac · SD-2476",
     "session_id": "6f1c...", "title": "Ajustar filtro de tickets", "titleSource": "orca",
     "kind": "pergunta", "since": "2026-10-29T14:09:41.000Z", "resumo": "Qual banco usar?",
     "agent_id": null, "urgent": true, "expires_at": "2026-10-30T14:09:41.000Z"}
  ],
  "warnings": []
}
```
Ordem: `urgent` primeiro, depois `since` mais antigo, `project`, `session_id`. `urgent` é `false` só para uma `vez`
ainda abaixo de `vez_ms`. `title` é o mesmo nome do seletor (`null` = o cliente mostra o código curto). A resposta
nunca traz `transcript_path`, `cwd` nem caminhos do `~`. O `resumo` vem do disco: escape-o ao exibir.

Para testar: `node server.js --fixture fixtures/esperas.jsonl` e `curl -s localhost:4317/api/waits`.

## Problemas comuns

| Sintoma | O que verificar |
|---------|-----------------|
| Nenhum projeto aparece | Abriu uma **sessão nova** do Claude Code depois de configurar o hook? Algum subagente já rodou? Existe `<projeto>/.monitor/events.jsonl`? Espere até ~30 s pela descoberta. |
| Cada agente aparece duplicado | O hook está configurado no `~/.claude/settings.json` **e** no do projeto. Use só um. |
| O hook não grava nada | Confira o caminho no `command` e a extensão (`.cjs` na instalação global). Rode com `MONITOR_HOOK_DEBUG=1` para ver o que o Claude Code envia. |
| Cartão "Sem término" | O agente começou mas não há `SubagentStop` e a sessão está há mais de 2 h sem eventos (sessão interrompida). |
| QA não mostra veredito | A mensagem final precisa ter `Resultado: APROVADO` ou `Resultado: REPROVADO`, e o papel precisa ser validador (ver [Time dinâmico](#time-dinâmico-quem-aparece-e-como)). |
| Lista de projetos com pastas de rascunho | É esperado (ver "Ruído" em [Descoberta](#descoberta-de-projetos-modo-padrão)). Use `--events` para escolher os projetos. |
| Sessões aparecem só com o código | Sem Orca/`python3` e sem título no Claude Code, não há nome a mostrar (ver [Nome das sessões](#nome-das-sessões)). |
| Porta 4317 ocupada | `node server.js --port 4400` (ou `PORT=4400`). |

## Desenvolvimento

```bash
npm test      # node --test test/
```

Estrutura:
- `server.js` — servidor HTTP, SSE e descoberta de projetos
- `src/` — leitura dos eventos, modelo do fluxo, setas, papéis, esperas, títulos
- `public/` — painel (HTML/CSS/JS puro, sem build)
- `.claude/hooks/log-agent-event.js` — o hook
- `fixtures/` — dados de exemplo usados nos testes e na demonstração

Documentação de projeto:
- `docs/plano.md` — plano e status
- `docs/tecnico.md` — planejamento técnico
- `docs/design/fluxo.md` — especificação de UI (mockups em `docs/design/*.html`)

### Time de agentes deste projeto
Este repositório é desenvolvido por um time de subagentes (definições em `.claude/agents/`, fluxo em
`CLAUDE.md`) — que também serve de exemplo para o seu:

| Agente | Modelo | Papel |
|--------|--------|-------|
| `project-manager` | Opus | Requisitos e critérios de aceite (`docs/plano.md`) |
| `designer` | Opus | Especificação de UI (`docs/design/`) |
| `tech-lead` | Opus 5.5 | Planejamento técnico e tasks para os devs (`docs/tecnico.md`) |
| `dev-backend` | Sonnet 5.5 | Servidor, APIs, regras de negócio |
| `dev-frontend` | Sonnet 5.5 | Interface conforme a spec |
| `qa` | Sonnet | Validação; bugs voltam para o dev da área |

Para usar esse time em todos os projetos, copie os arquivos para `~/.claude/agents/`. O
`.claude/monitor.json` deste repositório fixa os nomes, cores e ordem desses papéis no painel.
