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

## Time de agentes
Definições em `.claude/agents/`:

| Agente | Modelo | Papel |
|--------|--------|-------|
| `project-manager` | Opus | Requisitos e critérios de aceite (`docs/plano.md`) |
| `designer` | Opus | Especificação de UI (`docs/design/`) |
| `tech-lead` | Opus 5.5 | Planejamento técnico e tasks para os devs (`docs/tecnico.md`) |
| `dev-backend` | Sonnet 5.5 | Servidor, APIs, regras de negócio |
| `dev-frontend` | Sonnet 5.5 | Interface conforme a spec |
| `qa` | Sonnet | Validação; bugs voltam para o dev da área |

O fluxo de trabalho está em `CLAUDE.md`. Para usar o time em todos os projetos, copie
os arquivos para `~/.claude/agents/`.

## Testes
```bash
npm test
```

## Documentação
- `docs/plano.md` — plano e status
- `docs/tecnico.md` — planejamento técnico
- `docs/design/fluxo.md` — especificação de UI (mockup em `docs/design/fluxo-mockup.html`)
