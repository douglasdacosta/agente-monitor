# agente-monitor

Painel web que desenha o fluxo de execução de um time de subagentes do Claude Code:
cada execução de agente vira um nó com o tempo que levou (ou timer ao vivo, se ainda
estiver rodando), e as setas mostram quem passou para quem — inclusive quando o QA
reprova e o trabalho **volta** para o desenvolvedor. Agentes que rodaram em paralelo
aparecem lado a lado na mesma etapa.

## Como funciona
1. Um hook do Claude Code (`.claude/hooks/log-agent-event.js`) grava os eventos
   `PreToolUse` (ferramenta Agent), `SubagentStart` e `SubagentStop` em
   `.monitor/events.jsonl` do projeto em que você está trabalhando.
2. `server.js` lê esse arquivo, monta as execuções e as setas (`src/`) e atualiza o
   navegador ao vivo via SSE sempre que o arquivo muda.

## Pré-requisitos
- Node.js 20 ou superior (`node -v`)
- Claude Code (para gerar eventos reais; para só ver o painel, os dados de exemplo bastam)

Não há dependências npm — não é preciso rodar `npm install`.

## Rodando o painel

```bash
git clone https://github.com/douglasdacosta/agente-monitor.git
cd agente-monitor
```

### 1. Com dados de exemplo (para conhecer o painel)
```bash
node server.js --fixture fixtures/cenario-time-novo.jsonl
```
Abra http://127.0.0.1:4317.

Fixtures disponíveis em `fixtures/`:

| Arquivo | Cenário |
|---------|---------|
| `cenario-time-novo.jsonl` | PM → Designer → Tech Lead → Dev Backend ∥ Dev Frontend → QA reprova → Dev Frontend → QA aprova (e uma 2ª sessão em que o QA devolve para os dois devs) |
| `cenario-usuario.jsonl` | PM → Designer ∥ Developer → QA reprova → Developer → QA aprova |
| `ao-vivo.jsonl` | Fluxo com um QA ainda em execução (timer correndo) |
| `edge-cases.jsonl` | Casos de borda: agente fora do time, linhas inválidas, várias sessões |
| `time-diferente-sem-definicoes.jsonl` | Time com outros nomes (`arquiteto`, `dba`, `revisor-seguranca`), sem arquivos de agentes |
| `time-diferente/.monitor/events.jsonl` | O mesmo time, com definições e config em `time-diferente/.claude/` (use com `--events`) |

No modo fixture os horários são deslocados para "agora", então o timer de quem está
em execução corre normalmente.

### 2. Com dados reais deste projeto
```bash
npm start
```
Lê `.monitor/events.jsonl` da pasta atual.

### 3. Com dados reais de outro projeto
```bash
node server.js --events /caminho/do/projeto/.monitor/events.jsonl
```

### Opções

| Opção | Variável de ambiente | Padrão | Descrição |
|-------|---------------------|--------|-----------|
| `--events <arquivo>` | `MONITOR_EVENTS` | `.monitor/events.jsonl` | Arquivo de eventos a ler |
| `--fixture <arquivo>` | `MONITOR_FIXTURE` | — | Usa um arquivo de exemplo (horários deslocados para agora) |
| `--config <arquivo>` | `MONITOR_CONFIG` | — | Config de papéis extra; vence as outras duas (ver "Configuração dos papéis") |
| `--no-titles` | `MONITOR_TITLES=0` | ligado | Não busca nomes de sessão no `~` (ver "Nome das sessões") |
| `--port <n>` | `PORT` | `4317` | Porta HTTP |
| — | `MONITOR_HOST` | `127.0.0.1` | Endereço em que o servidor escuta |

O painel só lê o arquivo de eventos; nunca escreve nele. Se o arquivo ainda não
existir, a tela avisa e passa a mostrar os dados assim que ele for criado.

## Registrando eventos do Claude Code

Para que os seus agentes apareçam no painel, configure o hook.

### Opção A — só em um projeto
Copie `.claude/hooks/log-agent-event.js` e `.claude/hooks/package.json` para o
`.claude/hooks/` do projeto e adicione ao `.claude/settings.json` dele:

```json
{
  "hooks": {
    "SubagentStart": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/log-agent-event.js\"", "timeout": 5 }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/log-agent-event.js\"", "timeout": 5 }] }
    ],
    "PreToolUse": [
      { "matcher": "Agent|Task", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/log-agent-event.js\"", "timeout": 5 }] }
    ]
  }
}
```

### Opção B — em todos os projetos
```bash
mkdir -p ~/.claude/hooks
cp .claude/hooks/log-agent-event.js ~/.claude/hooks/log-agent-event.cjs
```
E adicione ao `~/.claude/settings.json` (mantendo os hooks que já existirem) as mesmas
entradas da opção A, trocando o comando por:

```
node "$HOME/.claude/hooks/log-agent-event.cjs"
```

Não use as duas opções ao mesmo tempo: cada evento seria gravado duas vezes.

Os eventos vão para `.monitor/events.jsonl` de cada projeto — adicione `.monitor/` ao
`.gitignore` deles. Para inspecionar quais campos o Claude Code envia, rode com
`MONITOR_HOOK_DEBUG=1`.

Os hooks são lidos quando a sessão do Claude Code começa: abra uma sessão nova depois
de configurar.

## Nome das sessões

O seletor mostra o nome da sessão em vez do código (`session_id`). O nome vem, nesta ordem, de:

1. **Orca** (`conversationName`): lido, somente leitura, de `agent-session-journal.db` em
   `$ORCA_USER_DATA_PATH` ou `~/.config/orca/` (no macOS também `~/Library/Application Support/orca/`).
   A leitura usa o `python3` (módulo `sqlite3` da biblioteca padrão); **o `python3` é opcional**: sem ele, ou sem o Orca,
   o painel segue para os próximos itens e avisa uma vez no terminal.
2. **Título renomeado no Claude Code** (`custom-title` da transcrição em `~/.claude/projects/`).
3. **Título gerado pelo Claude Code** (`ai-title`, mesma transcrição).
4. Campo `session_title` de algum evento da sessão (usado nos dados de exemplo).
5. Sem nome: o painel mostra o código.

Caminhos nunca aparecem na API. Com `--fixture` só vale o item 4. Para desligar a busca no `~`:
`--no-titles` ou `MONITOR_TITLES=0`. O hook passa a gravar `transcript_path` e, quando existir,
`ORCA_AGENT_SESSION_ID` (como `orca_session_id`) para facilitar essa busca.

## Time dinâmico: quem aparece e como

O painel não tem uma lista fixa de papéis: o time é o que aparece nos eventos.

**Quem é do time.** Todo `agent_type` é um papel do time, **exceto** os nativos do Claude Code
(`general-purpose`, `Explore`, `Plan`, `statusline-setup`, `output-style-setup`, `claude`), os de
plugin (com `:`, como `plugin:agente`) e os listados em `nativos` na config. Os nativos aparecem
como "Outro" (cinza) e podem ser ocultados com "Ocultar outros". Ter ou não um arquivo de definição
não muda quem é do time; assim, o histórico não some se um agente for renomeado ou removido.

**De onde vêm as definições.** São só metadados (descrição, modelo e se o papel é validador):
- `<projeto>/.claude/agents/*.md`, onde o projeto é a pasta pai de `.monitor/` do arquivo de eventos
  (com `--events /meu/projeto/.monitor/events.jsonl`, é `/meu/projeto`);
- `~/.claude/agents/*.md`. Se o mesmo `name` existir nas duas, vale a do projeto.

O `name` vem do frontmatter; sem ele, vale o nome do arquivo. Arquivo ilegível, sem frontmatter ou com
mais de 256 KB é ignorado com um aviso. Com `--fixture`, `~/.claude` **não** é lido (a mesma fixture
fica igual em qualquer máquina); só valem as definições se a fixture estiver em `<pasta>/.monitor/`.

**Validador (quem emite APROVADO/REPROVADO).** Vale a primeira regra que se aplicar:
1. `validador: true|false` na config do papel;
2. se há definição, o papel é validador quando o corpo dela contém o modelo `Resultado: APROVADO | REPROVADO`;
3. sem definição, só o papel chamado `qa`.

Quem não é validador nunca mostra veredito, mesmo que cite "Resultado: APROVADO" na mensagem.

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
  a config resolve. A ordem da paleta faz parte do contrato: mudá-la muda a cor de todos.
- Ordem na coluna e na legenda: `ordem` da config, depois o nível de estreia, depois o horário.

**O que o servidor lê.** Só `*.md` de `.claude/agents/` (até 256 KB, sem subpastas) e
`monitor.json` (até 64 KB). Links simbólicos em `.claude/agents/` são seguidos, como faz o
Claude Code: o frontmatter (nome, descrição, modelo) do arquivo apontado pode aparecer na API.
O servidor escuta só em `127.0.0.1` e não expõe na API caminhos de `~/.claude`, das transcrições nem do banco do Orca (só o caminho do próprio arquivo de eventos, em `source.path`).

## Configuração dos papéis (`monitor.json`)

Opcional. Locais, do mais fraco para o mais forte (campo a campo, por papel):
1. `~/.claude/monitor.json` (pessoal);
2. `<projeto>/.claude/monitor.json` (versionável, ao lado dos agentes);
3. `--config <arquivo>` ou `MONITOR_CONFIG=<arquivo>`.

`nativos` é a união das três fontes. A config é relida a cada atualização do painel (sem reiniciar o
servidor); a mudança aparece no próximo evento ou ao recarregar a página.

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
  "nativos": ["meu-agente-interno"]
}
```

| Campo | Aceita | Efeito |
|-------|--------|--------|
| `nome` | texto, 1 a 40 caracteres | Nome exibido. Não muda a cor. Nomes longos são cortados no cartão (ex.: use "Acessibilidade"). |
| `sigla` | 1 a 3 caracteres | Monograma do cartão. Com 4 ou mais, usa os 3 primeiros e avisa. |
| `cor` | `#RRGGBB` ou `#RGB` | Cor do papel. Abaixo de 4,5:1 de contraste (sobre branco e sobre o fundo claro), é escurecida e avisa. Evite vermelho, verde e âmbar: têm significado de estado. |
| `ordem` | número | Posição na coluna e na legenda; papéis com `ordem` vêm antes dos sem. |
| `nivel` | número | Nível para "voltou"; só vale se os **dois** papéis da seta têm `nivel`. |
| `validador` | `true`/`false` | Força o papel a emitir (ou não) veredito. |
| `nativos` (raiz) | lista de textos | `agent_type`s tratados como "Outro". |

JSON inválido ou campo de tipo errado é ignorado com um aviso (em `warnings` de `/api/flow`), sem
quebrar o painel. Chaves de nativos e `outro` não podem ser reestilizadas. O campo `icone` não existe.

Este repositório usa `.claude/monitor.json` para manter o visual da v1.1 (nomes PM, Designer, Tech
Lead, Dev Backend, Dev Frontend, QA e Desenvolvedor, com as cores e a ordem de antes).

## Time de agentes deste projeto
Definições em `.claude/agents/`:

| Agente | Modelo | Papel |
|--------|--------|-------|
| `project-manager` | Opus | Requisitos e critérios de aceite (`docs/plano.md`) |
| `designer` | Opus | Especificação de UI (`docs/design/`) |
| `tech-lead` | Opus 5.5 | Planejamento técnico e tasks para os devs (`docs/tecnico.md`) |
| `dev-backend` | Sonnet 5.5 | Servidor, APIs, regras de negócio |
| `dev-frontend` | Sonnet 5.5 | Interface conforme a spec |
| `qa` | Sonnet | Validação; bugs voltam para o dev da área |

O fluxo de trabalho está em `CLAUDE.md`. O painel mostra qualquer time, não só este. Para usar o time em todos os projetos, copie
os arquivos para `~/.claude/agents/`.

## Testes
```bash
npm test
```

## Documentação
- `docs/plano.md` — plano e status
- `docs/tecnico.md` — planejamento técnico
- `docs/design/fluxo.md` — especificação de UI (mockup em `docs/design/fluxo-mockup.html`)
