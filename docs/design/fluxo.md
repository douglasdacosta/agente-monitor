# Spec de UI: Fluxo de execução dos agentes (tarefa 5)

Mockup de referência: `docs/design/fluxo-mockup.html` (abra direto no navegador).
Dados de entrada: `nodes` e `edges` de `buildEdges()` em `src/edges.js` (cada nó já traz `batch`, base 1, denso) e `sessions` de `buildModel()`.

---

## Fluxo

1. O usuário abre `http://localhost:4317`. A tela mostra o estado **carregando** e depois o grafo da sessão mais recente.
2. Ele lê o fluxo da esquerda para a direita: Início, PM, (Designer ∥ Desenvolvedor), QA, e assim por diante. O nó em execução tem destaque forte e um timer que corre.
3. Quando o QA reprova, uma seta tracejada vermelha com o rótulo **"voltou"** sai por baixo do QA e entra no novo nó do Desenvolvedor, marcado como "2ª vez".
4. Com o SSE, o grafo se atualiza sozinho: novos nós aparecem, o timer para quando o Stop chega e o veredito aparece.
5. Ao clicar (ou dar Enter) num nó, abre um painel lateral com os detalhes e a `last_message`.
6. O usuário pode trocar de sessão no seletor e ligar "Ocultar outros".

---

## Telas / Componentes

Uma única tela com quatro partes: **Cabeçalho**, **Legenda**, **Canvas do grafo** e **Painel de detalhes** (que fica fechado por padrão).

```
+--------------------------------------------------------------------------------------+
| Monitor de execução   Sessão [a1b2c3d4 · hoje 14:02 · 6 exec ▾]  [o ] Ocultar outros (0) |
|                                          (●) Ao vivo        Duração total  22:00      |
+--------------------------------------------------------------------------------------+
| —▶ Avanço   - -▶ Voltou   ■ PM  ■ Designer  ■ Desenvolvedor  ■ QA  ■ Outro            |
+--------------------------------------------------------------------------------------+
|        ETAPA 1          ETAPA 2 · 2 EM PARALELO     ETAPA 3           ETAPA 4 · AGORA |
|                       +----------------+                                              |
|                  +--->| Designer       |---+                                          |
| (Início)  +------+    +----------------+   |   +--------------+    +================+ |
|   ( )---->|  PM  |                         +-->|  QA          |    # Desenvolvedor  # |
|           +------+    +----------------+   |   |  Reprovado   |    #  ● Em execução # |
|                  +--->| Desenvolvedor  |---+   +--------------+    #  04:40         # |
|                       +----------------+              |            +================+ |
|                                                       +----- voltou ------->^         |
+--------------------------------------------------------------------------------------+
```

### 1. Cabeçalho (`<header>`)
- Altura de 64px, fundo `#FFFFFF`, borda inferior de 1px `#E2E8F0`, padding horizontal de 24px. Fica fixo no topo (`position: sticky; top: 0; z-index: 10`).
- Usa flex com gap de 24px e quebra linha abaixo de 900px (`flex-wrap: wrap`; nesse caso a altura vira automática, com padding vertical de 12px). **No modo multi-projeto (v1.3), as regras de largura e quebra da seção 8.2 substituem esta.**
- Itens, da esquerda para a direita:
  1. **Título** "Monitor de execução" (`<h1>`, 18px/600, `#0F172A`).
  1b. **Seletor de projeto** (só no modo multi-projeto): veja a seção 8.
  2. **Seletor de sessão**: `<label for="sessao">Sessão</label>` (12px/600, `#475569`) + `<select id="sessao">` com altura de 36px, padding 0 12px, borda de 1px `#CBD5E1`, raio de 8px, fonte 14px e largura mínima de 280px.
     - Texto da opção: `<8 primeiros chars do id> · <data relativa> <HH:MM> · <n> execuções[ · em andamento]`. Exemplo: `a1b2c3d4 · hoje 14:02 · 6 execuções · em andamento`. A data relativa é "hoje", "ontem" ou `dd/mm`.
     - A ordem é a mesma de `/api/sessions` (a mais recente primeiro).
     - **Seguir automaticamente**: enquanto o usuário não escolher uma sessão manualmente, a tela segue a sessão mais recente. Depois de uma escolha manual, a seleção fica fixa, inclusive após um `update` do SSE. Se surgir uma sessão nova nesse modo, mostre ao lado do select o link-botão "Nova sessão · ver" (13px, `#1D4ED8`, sublinhado), que troca de sessão e volta para o modo de seguir.
     - Se só houver uma sessão, o select continua visível e habilitado, para manter a leitura consistente.
  3. **Toggle "Ocultar outros"**: um `<button role="switch" aria-checked="false">` com trilho de 36x20px (raio de 10px; desligado `#CBD5E1`, ligado `#1D4ED8`) e botão de 16px branco. O texto ao lado é "Ocultar outros (N)", em 14px `#334155`, onde N é a quantidade de nós `outro` na sessão. Começa desligado. Com N = 0, ganha `aria-disabled="true"`, opacidade de 0,5 e o title "Nenhum agente fora do time nesta sessão". O estado persiste em `localStorage` (`monitor.hideOthers`).
  4. **Espaçador** (`flex: 1`).
  5. **Indicador de conexão**: um ponto de 8px seguido de texto 13px/600 (veja "Estados globais"). Usa `role="status"` e `aria-live="polite"`.
  6. **Duração total**: o rótulo "Duração total" (12px `#475569`) fica acima do valor (20px/600 mono `#0F172A`). O valor vai do `start_ts` mais antigo da sessão ao `stop_ts` mais recente. Se houver algum nó `running`, usa `agora` e o valor avança a cada 1s. O title é "Do primeiro início ao último término".
  7. **Modo fixture** (opcional, só se a API expuser essa informação): um chip "Fixture: cenario-usuario.jsonl" com fundo `#FEF3C7`, texto `#92400E`, 12px/600 e raio de 999px.

### 2. Legenda
- Faixa de 40px, fundo `#F8FAFC`, borda inferior de 1px `#E2E8F0`, padding 0 24px, itens com gap de 20px e texto 12px `#475569`.
- Itens:
  - Uma amostra SVG de 28x10px de "Avanço" (linha sólida `#64748B` de 2px com seta) e outra de "Voltou" (linha tracejada `#B91C1C` de 2,5px com seta).
  - Para cada papel, um ícone de 16px na cor do papel seguido do nome. Itens e ordem da v1.1: seção 6.3 (R12).

### 3. Canvas do grafo
- É um container `<main>` com `overflow: auto` e fundo `#F8FAFC`, com uma grade de pontos (`radial-gradient(#E2E8F0 1px, transparent 1px)` e `background-size: 16px 16px`).
- Dentro dele fica o `<div class="grafo">`, com `position: relative` e largura/altura calculadas, que contém duas camadas:
  - um `<svg>` absoluto (inset 0) com as **arestas**, que leva `aria-hidden="true"`;
  - os **nós** como `<button>` HTML com posição absoluta, por cima do SVG. Essa escolha se deve ao foco, à quebra de texto e à acessibilidade, que são melhores em HTML do que em SVG.

#### 3.1 Layout (constantes, em px)

| Constante | Valor | Uso |
|---|---|---|
| `PAD` | 40 | Margem interna do grafo |
| `HEAD_H` | 32 | Faixa do rótulo de coluna ("ETAPA n") acima dos nós |
| `START_W` × `START_H` | 72 × 32 | Pílula "Início" |
| `NODE_W` × `NODE_H` | 272 × 128 | Cartão do nó (altura fixa) |
| `COL_GAP` | 88 | Espaço horizontal entre colunas (onde as setas passam) |
| `ROW_GAP` | 28 | Espaço vertical entre nós paralelos da mesma coluna |
| `RET_GAP` | 40 | Distância entre a base do nó mais baixo e o 1º canal de retorno |
| `RET_STEP` | 24 | Distância entre canais de retorno sucessivos |
| `RADIUS` | 12 | Raio das curvas das arestas de retorno |

**Direção**: da esquerda para a direita, com uma coluna por lote (`batch`).

**Posições:**
```
maxRows   = maior número de nós numa mesma coluna
mainH     = maxRows*NODE_H + (maxRows-1)*ROW_GAP
top       = PAD + HEAD_H                                  // y do topo da área dos nós
colX(b)   = PAD + START_W + COL_GAP + (b-1)*(NODE_W+COL_GAP)
colH(b)   = k*NODE_H + (k-1)*ROW_GAP                      // k = nós na coluna b
nodeY(b,i)= top + (mainH - colH(b))/2 + i*(NODE_H+ROW_GAP)  // coluna centralizada verticalmente
Início    : x = PAD, y = top + mainH/2 - START_H/2
retY(j)   = top + mainH + RET_GAP + j*RET_STEP            // j = índice da aresta de retorno (0..)
largura   = colX(último) + NODE_W + PAD
altura    = retY(nRet-1) + 16 + PAD   (sem retornos: top + mainH + PAD)
```
- **Ordem dentro da coluna** (lotes paralelos, empilhados de cima para baixo): primeiro pela ordem do papel (PM, Designer, Tech Lead, Desenvolvedor, Dev Backend, Dev Frontend, QA, Outro; ver seção 6 / R11) e depois por `start_ts`.
- **Rótulo de coluna**: aparece em `y = PAD`, centralizado em `colX + NODE_W/2`, em 11px/700, caixa alta, `letter-spacing: .06em`, cor `#64748B`. Os textos possíveis são:
  - "ETAPA n";
  - "ETAPA n · k EM PARALELO", quando k > 1;
  - "· AGORA" acrescentado, com cor `#1D4ED8`, quando a coluna tem um nó `running`.
- **Ocultar outros**: aplique o layout às `nodes` que já vieram filtradas, já que `batch` é denso e não deixa coluna vazia.
- **Rolagem**: no primeiro render, e sempre que aparecer um nó `running` novo, chame `scrollIntoView({inline: 'nearest', block: 'nearest'})` nesse nó. Use `behavior: 'smooth'`, ou `'auto'` se houver reduced-motion. Não force a rolagem nos updates seguintes se o usuário tiver rolado manualmente nos últimos 10s.

#### 3.2 Arestas

| | Avanço | Retorno ("voltou") |
|---|---|---|
| Traço | `#64748B`, 2px, sólido | `#B91C1C`, 2,5px, `stroke-dasharray: 7 5` |
| Seta (marker) | triângulo 10x10, `#64748B` | triângulo 10x10, `#B91C1C` |
| Saída / entrada | lateral direita do meio da origem → lateral esquerda do meio do destino | **base** da origem (centro) → **base** do destino (centro), com a seta apontando para cima |
| Forma | Bézier `M x1,y1 C x1+44,y1 x2-44,y2 x2,y2` | Ortogonal com cantos arredondados por um canal **abaixo de todos os nós** (veja abaixo) |
| Rótulo | nenhum | pílula "voltou" no meio do trecho horizontal |
| Hover / foco do nó ligado | traço `#334155` 3px | traço `#991B1B` 3,5px |

- **Roteamento do retorno, sem cruzar nós**:
  ```
  M sx,sBottom  V retY-RADIUS  Q sx,retY  sx±RADIUS,retY
  H tx∓RADIUS   Q tx,retY  tx,retY-RADIUS   V tBottom+2
  ```
  Aqui, `sx`/`tx` são os centros horizontais da origem e do destino, e os sinais seguem a direção (`±` = `+` quando `tx > sx`). O canal fica em `retY(j)`, que está abaixo de `top+mainH` e, portanto, abaixo de todos os nós de todas as colunas. Por isso ele nunca cruza um cartão, seja o destino à direita (caso normal, nó novo do Desenvolvedor) ou à esquerda. Cada retorno ganha seu próprio canal `j`, em ordem de `start_ts` do destino, para que não haja sobreposição.
- **Pílula "voltou"**: um `<g>` SVG centrado em `((sx+tx)/2, retY)`, com retângulo de 64x22px e raio de 11px, fundo `#FFFFFF`, borda de 1,5px `#B91C1C`, ícone ↩ de 12px (path SVG, não emoji) e o texto "voltou" em 12px/700 `#B91C1C`. O `<title>` diz "QA reprovou → volta para Desenvolvedor" (gerado como `"<papel origem> reprovou → volta para <papel destino>"`, ou "Voltou para <papel destino>" quando o motivo é só a ordem de papel).
- **Aresta avanço entre colunas não adjacentes** (raro, pode ocorrer com "ocultar outros"): use o mesmo roteamento ortogonal, mas por um canal **acima** de todos os nós (`y = top - 12`), em sólido cinza e sem rótulo.
- **Início**: desenhe arestas avanço da pílula "Início" para cada nó do lote 1.
- **Aresta que entra num nó `running`**: aplique uma animação de fluxo (`stroke-dashoffset` de 0 a -24 em 1s linear infinito). No avanço, use `dasharray 8 4` só enquanto o destino estiver rodando. Sob `prefers-reduced-motion`, não há animação.
- Ordem de desenho: primeiro avanço, depois retorno, para que o vermelho fique por cima.

#### 3.3 Nó (cartão de execução)

`<button class="no" data-id>` com 272x128px, padding 12px 14px 12px 18px, fundo `#FFFFFF`, borda de 1px `#CBD5E1`, raio de 10px, sombra `0 1px 2px rgba(15,23,42,.06)` e uma **barra lateral esquerda de 4px na cor do papel** (`box-shadow: inset 4px 0 0 <cor>`). O texto fica alinhado à esquerda.

```
+--+------------------------------------------+
|▌ [ícone] Desenvolvedor        [● Em execução]|  linha 1: 24px
|▌ 2ª vez · Corrigir bugs apontados pelo QA   |  linha 2: label, 14px/20px, 2 linhas
|▌ no parser e no SSE                         |           (line-clamp 2, title = texto completo)
|▌ rodando há  04:40              início 14:06|  linha 3: 24px
+--+------------------------------------------+
```
- **Linha 1**:
  - Ícone do papel: 24x24px, um círculo com fundo na tinta do papel e um glifo SVG de 14px na cor do papel.
  - Nome do papel: 13px/600 na cor do papel, com `white-space: nowrap`.
  - O nome nunca é truncado no cartão (por isso o cartão tem 272px); o `label` aparece na linha 2.
  - Para `outro`, o nome no cartão é só "Outro" (o `label` está na linha 2); "Outro · <agent_type ou label curto>" fica no painel de detalhes e no `aria-label`.
  - O marcador de repetição "2ª vez", "3ª vez" (n-ésima execução do mesmo papel, n ≥ 2) **não fica na linha 1**: abre a linha 2 como prefixo "2ª vez · " (12px/600, cor do papel), antes do `label`. No painel e no `aria-label` continua como sufixo do nome.
  - O **badge de status** fica à direita (veja 3.4).
- **Linha 2** (`label`): 14px/20px `#1E293B`, com `-webkit-line-clamp: 2` e 8px de margem acima e abaixo.
- **Linha 3**:
  - À esquerda, o prefixo (12px `#475569`): "levou" (concluído) ou "rodando há" (running). Logo depois vem a duração, em 20px/600 mono `#0F172A` com `font-variant-numeric: tabular-nums`.
  - À direita, "início HH:MM", 12px `#64748B`.

**Papéis** (o ícone e o nome garantem que a cor não seja a única pista):

| Papel (`role`) | Nome exibido | Cor (texto/borda) | Tinta (fundo do ícone) | Contraste da cor sobre `#FFF` | Glifo (SVG 14px) |
|---|---|---|---|---|---|
| `project-manager` | PM | `#6D28D9` | `#EDE9FE` | 7,1:1 | prancheta com lista |
| `designer` | Designer | `#BE185D` | `#FCE7F3` | 6,0:1 | pena/caneta de desenho |
| `tech-lead` | Tech Lead | `#4338CA` | `#E0E7FF` | 7,9:1 | bifurcação (divide o trabalho) — v1.1, seção 6 |
| `developer` (legado) | Desenvolvedor | `#1D4ED8` | `#DBEAFE` | 6,7:1 | `</>` |
| `dev-backend` | Dev Backend | `#3F6212` | `#ECFCCB` | 7,1:1 | banco de dados (cilindro) — v1.1 |
| `dev-frontend` | Dev Frontend | `#AD4E0A` | `#FFEDD5` | 5,4:1 | janela com cabeçalho e barra lateral — v1.1 |
| `qa` | QA | `#0F766E` | `#CCFBF1` | 5,5:1 | escudo com check |
| `outro` | Outro · X | `#475569` | `#E2E8F0` | 7,6:1 | três pontos / chip |

Os paths dos glifos estão no mockup (`<symbol id="i-pm">` etc.). O nó `outro` usa ainda borda **tracejada** de 1px `#94A3B8` e fundo `#F8FAFC`.

#### 3.4 Estados do nó

| Estado | Condição | Badge (altura 20px, padding 0 8px, raio 999px, 11px/700) | Cartão | Duração |
|---|---|---|---|---|
| **Em execução** | `status=running` e sessão ativa | fundo `#0F172A`, texto `#FFFFFF`, ponto de 6px `#4ADE80` piscando: "Em execução" | **borda de 2px na cor do papel** + **anel pulsante** (abaixo) + fundo `#FFFFFF` | "rodando há" + `mm:ss` ao vivo |
| **Concluído** | `done`, sem veredito | fundo `#F1F5F9`, texto `#334155`, ícone ✓ SVG: "Concluído" | padrão | "levou" + formato humano |
| **Aprovado** | `done`, `verdict=APROVADO` | fundo `#DCFCE7`, texto `#166534`, ícone ✓: "Aprovado" | borda de 1px `#86EFAC` | "levou" + formato humano |
| **Reprovado** | `done`, `verdict=REPROVADO` | fundo `#FEE2E2`, texto `#991B1B`, ícone ✕: "Reprovado" | borda de 1px `#FCA5A5` | "levou" + formato humano |
| **Sem término** | `running` e sem eventos na sessão há mais de 2h (`now - session.last_ts > 2h`) | fundo `#FEF3C7`, texto `#92400E`, ícone de ampulheta: "Sem término" | borda de 1px **tracejada** `#D97706` e opacidade de 0,85, sem pulso | "rodando há" + duração congelada em `last_ts - start_ts`, seguida de "+" (ex.: `2h 14m+`) |
| Hover | | | borda `#94A3B8` (ou mais escura no papel) e sombra `0 4px 12px rgba(15,23,42,.10)`; cursor pointer | |
| Foco (`:focus-visible`) | | | `outline: 3px solid #1D4ED8; outline-offset: 3px` | |
| Selecionado (painel aberto) | | | borda de 2px `#0F172A` | |

**Ênfase do "Em execução"**, que precisa ser forte, porque é "onde estamos agora":
- `border: 2px solid var(--role)`.
- Anel pulsante via `::after` (inset −2px, raio 12px): `@keyframes pulso { 0% { box-shadow: 0 0 0 0 rgba(<role>, .45) } 70% { box-shadow: 0 0 0 10px rgba(<role>, 0) } 100% { box-shadow: 0 0 0 0 rgba(<role>, 0) } }`, com duração de 1,6s, `ease-out`, infinito.
- Ponto do badge: `opacity` 1 → .3 → 1 em 1,2s, infinito.
- Timer em 20px/700 na **cor do papel**, em vez de `#0F172A`.
- Rótulo de coluna com "· AGORA".
- **`prefers-reduced-motion: reduce`**: sem pulso e sem piscar. No lugar, use um halo estático `box-shadow: 0 0 0 4px <tinta do papel>` e o ponto fixo. O timer continua contando, porque é só texto.

#### 3.5 Formato de duração

| Situação | Formato | Exemplos |
|---|---|---|
| Timer ao vivo (running, cabeçalho) | `mm:ss`; a partir de 1h, `h:mm:ss` | `00:07`, `04:40`, `1:02:09` |
| Concluído | humano, com no máximo 2 unidades | `<1s`, `45s`, `3m 12s`, `1h 05m` |
| Sem término | humano com "+" | `2h 14m+` |

- Arredondamento: trunque para segundos inteiros. Um valor de 0 a 999ms aparece como `<1s`.
- O timer é calculado no cliente a cada 1s a partir de `Date.now() - Date.parse(start_ts)`, com um único `setInterval` global que atualiza todos os timers. O valor nunca fica negativo (`Math.max(0, …)`).
- Hora de início em `HH:MM`, ou `HH:MM:SS` no painel, no fuso local (`toLocaleTimeString('pt-BR')`).

### 4. Painel de detalhes (clique no nó)
- Um `<aside role="dialog" aria-modal="false" aria-labelledby="painel-titulo">` à direita, com 420px de largura e altura total abaixo do cabeçalho, fundo `#FFFFFF`, borda esquerda de 1px `#E2E8F0`, sombra `-8px 0 24px rgba(15,23,42,.08)` e padding de 24px.
  - Abaixo de 1024px, vira overlay com largura `min(420px, 100vw)`.
  - A entrada é `transform: translateX(100%) → 0` em 200ms; sem animação sob reduced-motion.
- **Conteúdo**:
  1. Topo: ícone do papel (32px), título `<h2 id="painel-titulo">` com o nome do papel e o sufixo "2ª vez" (18px/600), o badge de status e o botão "Fechar" (ícone ✕, 32x32px, `aria-label="Fechar detalhes"`).
  2. `<dl>` em duas colunas (rótulo de 12px/600 `#475569`, valor de 14px `#0F172A`):
     - Tarefa: o `label` completo;
     - Início: `dd/mm HH:MM:SS`;
     - Término: o horário, ou "—" se ainda estiver em execução;
     - Duração: o timer ao vivo ou o formato humano;
     - Veredito: "Aprovado", "Reprovado" ou "—";
     - Veio de: links-botão para os nós predecessores (ex.: "QA (reprovou)"), ou "Início";
     - Seguiu para: links-botão para os sucessores, ou "—";
     - ID: o `agent_id` em mono 12px, com o botão "Copiar" (que vira "Copiado" por 2s).
  3. **"Última mensagem"** (`<h3>`, 14px/600) seguida de um bloco `<pre>` com `white-space: pre-wrap`, fonte 13px/20px mono, fundo `#F8FAFC`, borda de 1px `#E2E8F0`, raio de 8px, padding de 12px e `max-height: 50vh` com `overflow: auto`.
     - Se for nula e o nó estiver em execução: "O agente ainda está em execução. A mensagem aparece quando ele terminar." (texto 14px `#475569`, sem bloco).
     - Se for nula e o nó estiver concluído: "Nenhuma mensagem registrada."
     - Se o texto tiver 500 chars (o corte do hook), acrescente a nota "Mensagem truncada em 500 caracteres pelo registro.", em 12px `#64748B`.
- **Comportamento**:
  - Ao abrir, o foco vai para o botão Fechar.
  - `Esc`, o botão Fechar ou um clique no mesmo nó fecham o painel. Ao fechar, o foco volta para o nó de origem.
  - Os links "Veio de" e "Seguiu para" movem o foco e trocam o painel para o nó clicado.
  - O painel se atualiza ao vivo com o SSE. Se o nó deixar de existir (por exemplo, por causa de ocultar outros), o painel fecha.

### 5. Estados globais (área do canvas)
Todos ficam centralizados no canvas, em uma caixa com largura máxima de 440px, texto centralizado, ícone de 40px `#94A3B8`, título 16px/600 `#0F172A`, texto 14px/20px `#475569` e botão secundário (36px, borda de 1px `#CBD5E1`, raio de 8px, 14px/600 `#0F172A`).

| Estado | Quando | Título | Texto | Ação |
|---|---|---|---|---|
| Carregando | 1º fetch em andamento | — | Esqueleto: pílula Início + 3 cartões de 272x128px `#E2E8F0` em colunas, com shimmer (sem shimmer sob reduced-motion). `aria-busy="true"` no canvas e texto sr-only "Carregando fluxo…" | — |
| Vazio (sem sessões) | `/api/sessions` retorna `[]` | "Nenhuma execução registrada ainda" | "Quando um agente do time for acionado, o fluxo aparece aqui automaticamente. Os eventos são lidos de `.monitor/events.jsonl`." | — (segue ouvindo o SSE) |
| Sem arquivo | a API indica que o arquivo não existe (veja as notas) | "Arquivo de eventos não encontrado" | "Ainda não existe `.monitor/events.jsonl`. Ele é criado pelo hook na primeira execução de um agente." | — |
| Sessão sem agentes (v1.4) | sessão só com esperas/turnos (R29) | ver 9.9 | | |
| Sessão sem execuções | a sessão existe, mas `nodes` está vazio (só PreToolUse, por exemplo) | "Esta sessão ainda não tem execuções" | "Houve chamadas, mas nenhum agente chegou a iniciar." | — |
| Todos ocultos | `hideOthers` ligado e nada restou | "Só há agentes fora do time nesta sessão" | — | "Mostrar outros" (desliga o toggle) |
| Erro | o fetch falhou ou houve resposta não 2xx | "Não foi possível carregar o fluxo" | "Verifique se o servidor está rodando (`node server.js`). Detalhe: <status ou mensagem>" | "Tentar novamente" |

**Conexão (SSE), no indicador do cabeçalho**:

| Estado | Ponto | Texto (13px/600) | Extra |
|---|---|---|---|
| Ao vivo | `#16A34A`, com pulso lento de 2s (estático sob reduced-motion) | "Ao vivo", em `#166534` | — |
| Reconectando | `#D97706` | "Reconectando…", em `#92400E` | aparece após `onerror`; o `EventSource` tenta sozinho |
| Desconectado | `#DC2626` | "Desconectado", em `#991B1B` | após 15s sem reconectar. Mostra uma faixa abaixo do cabeçalho (fundo `#FEF2F2`, borda inferior `#FECACA`, 14px `#991B1B`, altura de 40px) com o texto "Sem conexão com o servidor. Os dados podem estar desatualizados; os timers seguem contando localmente." e o botão "Reconectar". O grafo continua visível. |

### 6. Papéis do time novo (v1.1, tarefa 11)

Complementa a tabela de papéis de 3.3. O resto da spec não muda.

> **v1.2: substituído pela seção 7.** Nada desta seção (nem da tabela de papéis de 3.3) fica no código. O que sobrevive vira **valores padrão via config** em `.claude/monitor.json` deste repositório (tarefa 25b):
> - **Vira config**: nomes curtos (`project-manager` → "PM"), siglas, cores de 6.1 e ordem de 6.2. Seis das sete cores já estão na paleta da seção 7.1 e por isso herdam o tint exato daqui. A exceção é `#AD4E0A` (dev-frontend): ela fica fora da paleta por ser vizinha do âmbar de "Sem término", mas é aceita via config (5,4:1 sobre branco; 4,6:1 sobre o tint derivado `#F5EAE2`).
> - **Sai**: os glifos SVG por papel (`<symbol id="i-pm">` etc.), as classes `.papel-<role>`, os tokens `--pm`/`--des`/`--tl`/`--be`/`--fe`/`--qa`, o `ORDER` fixo e a legenda fixa de 6.3. Ficam `--dev` (azul de destaque) e `--out`/`--out-tint` (outro).
> - **Continua valendo**: 6.4 (cálculo de largura) como base da regra de corte da 7.4 e 6.5.

#### 6.1 Cores, nomes e ícones

| `role` | Nome (R10) | `--role` | `--tint` | `--role-rgb` | Contraste sobre `#FFF` | Contraste sobre o tint | Ícone |
|---|---|---|---|---|---|---|---|
| `project-manager` | PM | `#6D28D9` | `#EDE9FE` | `109 40 217` | 7,1:1 | 6,0:1 | prancheta (sem mudança) |
| `designer` | Designer | `#BE185D` | `#FCE7F3` | `190 24 93` | 6,0:1 | 5,1:1 | pena (sem mudança) |
| **`tech-lead`** | Tech Lead | `#4338CA` (índigo) | `#E0E7FF` | `67 56 202` | 7,9:1 | 6,4:1 | bifurcação: um nó embaixo que se divide em dois |
| `developer` (legado) | Desenvolvedor | `#1D4ED8` (azul) | `#DBEAFE` | `29 78 216` | 6,7:1 | 5,5:1 | `</>` (sem mudança) |
| **`dev-backend`** | Dev Backend | `#3F6212` (oliva) | `#ECFCCB` | `63 98 18` | 7,1:1 | 6,5:1 | banco de dados (cilindro) |
| **`dev-frontend`** | Dev Frontend | `#AD4E0A` (laranja queimado) | `#FFEDD5` | `173 78 10` | 5,4:1 | 4,7:1 | janela com cabeçalho e barra lateral |
| `qa` | QA | `#0F766E` | `#CCFBF1` | `15 118 110` | 5,5:1 | 4,9:1 | escudo com check (sem mudança) |
| `outro` | Outro | `#475569` | `#E2E8F0` | `71 85 105` | 7,6:1 | 6,1:1 | três pontos (sem mudança) |

- **Legado `developer`**: mantém exatamente o visual da v1 (azul `#1D4ED8`, `</>`). Ele não é "um dos devs novos": é o papel antigo, reconhecível em sessões antigas.
- **Por que essas cores.** Matizes aproximados: PM 263°, Tech Lead 243°, Desenvolvedor 224°, QA 175°, Dev Backend 86°, Dev Frontend 25°, Designer 333°. Backend (verde-oliva) e frontend (laranja) ficam em lados opostos do círculo, então se distinguem mesmo lado a lado na mesma coluna e para daltonismo vermelho-verde (oliva é escuro, L≈0,10; laranja é médio, L≈0,14, e os ícones diferem). Evitei: verde puro (colide com "Aprovado" `#166534`), ciano (colide com QA), vermelho (colide com a seta "voltou" `#B91C1C`) e âmbar `#92400E/#D97706` (colide com "Sem término"). O ponto mais fraco é Tech Lead × PM × Desenvolvedor (família azul-violeta), aceitável porque nunca ficam na mesma coluna no fluxo normal, o PM está sempre na etapa 1 e o `developer` só aparece em sessões antigas; os ícones e os nomes separam os três.
- Sem depender de cor (critério c): os 8 ícones são diferentes entre si e o nome sempre aparece no cartão, no painel e na legenda.

**Ícones** (`<symbol>` para `public/index.html`, mesmo estilo dos atuais: viewBox 24, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, pontas e junções arredondadas):

```html
<symbol id="i-tech-lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/><path d="M6 7.5v1.5a3 3 0 003 3h6a3 3 0 003-3V7.5M12 12v4.5"/></symbol>
<symbol id="i-dev-backend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></symbol>
<symbol id="i-dev-frontend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></symbol>
```

**CSS** (acrescentar em `public/style.css`, tokens no `:root` e classes junto das `.papel-*` atuais):

```css
--tl:#4338CA;--tl-tint:#E0E7FF;--be:#3F6212;--be-tint:#ECFCCB;--fe:#AD4E0A;--fe-tint:#FFEDD5;

.papel-tech-lead{--role:var(--tl);--tint:var(--tl-tint);--role-rgb:67 56 202}
.papel-dev-backend{--role:var(--be);--tint:var(--be-tint);--role-rgb:63 98 18}
.papel-dev-frontend{--role:var(--fe);--tint:var(--fe-tint);--role-rgb:173 78 10}
```
O pulso, o halo de reduced-motion, a barra lateral e o timer já usam `--role`/`--tint`/`--role-rgb`, então funcionam sem outra mudança. `.papel-developer` fica como está. O `--dev` continua sendo também o azul de destaque (switch, links, "· AGORA"); não troque esses usos.

#### 6.2 Ordem de empilhamento na coluna (R11)

`ORDER = { 'project-manager':1, designer:2, 'tech-lead':3, developer:4, 'dev-backend':5, 'dev-frontend':6, qa:7, outro:8 }`, empate por `start_ts`. Backend fica sempre acima do frontend. Papel desconhecido cai em `outro` (8).

#### 6.3 Legenda (R12)

Ordem fixa: Avanço, Voltou, PM, Designer, Tech Lead, **[Desenvolvedor]**, Dev Backend, Dev Frontend, QA, Outro.
- O item "Desenvolvedor" fica no HTML com `data-papel="developer"` e `hidden`. O app tira o `hidden` quando a sessão selecionada (depois do filtro "Ocultar outros", que não afeta `developer`) tem pelo menos um nó `developer`, e o recoloca ao trocar para uma sessão sem esse papel. Posição: entre Tech Lead e Dev Backend, igual à R11.
- Com 10 itens a legenda mede ~950px. Abaixo disso ela quebra linha: troque `height:40px` por `min-height:40px; padding:8px 24px` em `.legenda`, senão a 2ª linha vaza.

#### 6.4 Largura dos nomes (critério d)

Cartão de 272px: área útil da linha 1 = 240px (238px no estado "Em execução", por causa da borda de 2px). Descontando ícone 24 + gap 8 + gap 8 + badge "Em execução" ≈ 96px (padding 16 + ponto 6 + gap 4 + texto 11px/700 ≈ 70), sobram **≈ 102px** para o nome (13px/600, system-ui):

| Nome | Largura estimada | Folga |
|---|---|---|
| Tech Lead | ≈ 61px | 41px |
| Dev Backend | ≈ 78px | 24px |
| Dev Frontend | ≈ 80px | 22px |
| Desenvolvedor (v1, já validado) | ≈ 95px | 7px |

Os nomes novos são mais curtos que "Desenvolvedor", que já cabia. Os demais badges ("Sem término", "Reprovado", "Concluído", "Aprovado") são do mesmo tamanho ou menores. O "2ª vez · " fica na linha 2 (line-clamp), então não disputa a linha 1. A `.nome` mantém `text-overflow: ellipsis` só como rede de segurança.

**Painel lateral** (420px − 48 de padding): ícone 32 + Fechar 32 + badge ≈ 96 + 3 gaps de 12 deixam ≈ 176px para o `<h2>`. "Dev Frontend" a 18px ≈ 111px + " · 2ª vez" a 14px ≈ 58px = **≈ 169px, cabe em uma linha**. "Dev Backend · 2ª vez" ≈ 166px e "Tech Lead · 2ª vez" ≈ 146px também cabem. ("Desenvolvedor · 2ª vez" ≈ 190px já quebrava na v1; o `<h2>` pode quebrar em 2 linhas, não deve truncar.)

#### 6.5 Largura com 7 colunas (critério f)

`largura = colX(7) + 272 + 40 = 200 + 6·360 + 312 = 2672px` (5 colunas da v1: 1952px). Altura não muda (no máximo 2 nós por coluna, como na v1). **Não muda a natureza da pendência 3 da v1**: o canvas já rola na horizontal e a regra de auto-scroll até o nó `running` (3.1) continua sendo o que mantém "onde estamos agora" visível. Só aumenta a distância de rolagem (≈ 2 telas de 1440px). A decisão de layout (zoom para caber, cartões compactos ou minimapa) continua em aberto, sem bloquear a v1.1.

### 7. Time dinâmico (v1.2, tarefa 19)

Os papéis chegam em `roles` (R19) com `name`, `nome`, `sigla`, `cor`, `tint`. Esta seção define como `cor`, `tint`, `--role-rgb` e `sigla` são gerados e como o cartão, o painel e a legenda se comportam com qualquer nome. Ela substitui a seção 6 e a tabela de papéis de 3.3. `outro` continua como está (cinza `#475569`/`#E2E8F0`, borda tracejada `#94A3B8`, fundo `#F8FAFC`) e **fica fora da paleta**.

#### 7.1 Paleta fixa (12 cores, ordem faz parte do contrato)

| Índice | Nome | `cor` | `tint` | `--role-rgb` | Contraste sobre `#FFF` | Contraste sobre o tint |
|---|---|---|---|---|---|---|
| 0 | violeta | `#6D28D9` | `#EDE9FE` | `109 40 217` | 7,1:1 | 6,0:1 |
| 1 | oliva | `#3F6212` | `#ECFCCB` | `63 98 18` | 7,1:1 | 6,5:1 |
| 2 | rosa | `#BE185D` | `#FCE7F3` | `190 24 93` | 6,0:1 | 5,1:1 |
| 3 | celeste | `#0369A1` | `#E0F2FE` | `3 105 161` | 5,9:1 | 5,2:1 |
| 4 | índigo | `#4338CA` | `#E0E7FF` | `67 56 202` | 7,9:1 | 6,4:1 |
| 5 | verde-azulado | `#0F766E` | `#CCFBF1` | `15 118 110` | 5,5:1 | 4,9:1 |
| 6 | fúcsia | `#A21CAF` | `#FAE8FF` | `162 28 175` | 6,3:1 | 5,4:1 |
| 7 | marinho | `#1E3A8A` | `#BFDBFE` | `30 58 138` | 10,4:1 | 7,3:1 |
| 8 | azul | `#1D4ED8` | `#DBEAFE` | `29 78 216` | 6,7:1 | 5,5:1 |
| 9 | ameixa | `#701A75` | `#F5D0FE` | `112 26 117` | 10,0:1 | 7,3:1 |
| 10 | petróleo | `#155E75` | `#CFFAFE` | `21 94 117` | 7,3:1 | 6,5:1 |
| 11 | roxo | `#7E22CE` | `#F3E8FF` | `126 34 206` | 7,0:1 | 5,9:1 |

- **Contraste**: todas as cores passam de 4,5:1 sobre branco e sobre o próprio tint (a menor é 4,9:1). Por isso valem para texto de 13px (nome), 11px/700 (sigla) e 12px (prefixo "Nª vez"). Sobre `#F8FAFC` (legenda e canvas) a queda é de cerca de 4%, e todas continuam acima de 4,5:1.
- **Fora da paleta, de propósito**: vermelho e vinho (matiz de 345° a 15°, por causa do "voltou" `#B91C1C`), laranja, âmbar e marrom (de 15° a 50°, por causa do "Sem término" `#92400E`/`#D97706`), verde puro (de 100° a 160°, por causa do "Aprovado" `#166534`) e cinzas ou cores dessaturadas (por causa do `outro`). Todas as 12 têm saturação alta e nenhuma se lê como o cinza-ardósia do `outro`.
- **Pares mais próximos** (aceitos, porque o nome e a sigla sempre aparecem): azul × índigo × marinho, violeta × roxo, fúcsia × ameixa e verde-azulado × petróleo × celeste. Em cada família, os tons diferem em luminosidade (marinho e ameixa são bem escuros).
- **Colisão**: com 12 cores, há cerca de 22% de chance de 6 papéis terem todas as cores distintas, ou seja, colisões são comuns. Isso já foi aceito no plano, e a config resolve casos específicos.
- **Regra de versão**: mudar a ordem ou o tamanho da paleta muda a cor de todos. Só faça isso numa versão nova, documentada no README.

#### 7.2 Hash nome → índice (idêntico em qualquer máquina)

```js
// entrada: o `name` do papel (agent_type), e não o nome humanizado
function paletteIndex(name, N = 12) {
  const bytes = new TextEncoder().encode(name.trim().toLowerCase()); // UTF-8
  let h = 0x811c9dc5;                         // FNV-1a 32 bits, offset basis
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;       // FNV prime, mantém unsigned 32 bits
  }
  return h % N;
}
```
- O hash é calculado sobre o `name` em minúsculas e sem espaços nas pontas, nunca sobre `nome` ou `sigla`. Assim, trocar o `nome` na config não muda a cor.
- **Vetores de teste obrigatórios** (padrão FNV-1a): `""` → `0x811c9dc5`, `"a"` → `0xe40c292c` (índice 4) e `"foobar"` → `0xbf9cf968` (índice 4).
- **Valores da fixture `time-diferente`**, calculados à mão. O teste deve confirmá-los, e se houver divergência vale o algoritmo, com a spec corrigida:

| `name` | hash (decimal) | índice | cor |
|---|---|---|---|
| `dba` | 3293360390 | 2 | rosa `#BE185D` |
| `arquiteto` | 2935227989 | 5 | verde-azulado `#0F766E` |
| `revisor-seguranca` | 2660791859 | 11 | roxo `#7E22CE` |

- Uma única fonte: a função vive num só lugar (onde o tech-lead decidir, na tarefa 20c). O cliente não reimplementa o hash se `roles` já trouxer `cor`, `tint` e `rgb`.

#### 7.3 Monograma (substitui os ícones SVG por papel)

- **Sigla automática (R17)**: o `name` é dividido por `-`, `_` e espaço, e as partes vazias são descartadas. Com 2 palavras ou mais, a sigla é a 1ª letra das duas primeiras. Com uma palavra só, são as 2 primeiras letras. Com um nome de 1 caractere, é 1 letra. O resultado vai para `toUpperCase()`. Exemplos: `dev-backend` → DB, `revisor-seguranca` → RS, `especialista-em-acessibilidade` → EE, `qa` → QA, `dba` → DB, `arquiteto` → AR, `x` → X. A sigla conta caracteres visíveis (grafemas), e não bytes.
- **Círculo**: `background: var(--tint)`, texto `color: var(--role)`, `font-family: var(--font)`, `font-weight: 700`, `line-height: 1`, centralizado (`display:grid; place-items:center`), `letter-spacing: -0.02em`, `aria-hidden="true"` (o nome está ao lado).

| Onde | Diâmetro | 1–2 caracteres | 3 caracteres |
|---|---|---|---|
| Cartão (linha 1) | 24px | 11px/700 | 9px/700 |
| Painel (topo) | 32px | 14px/700 | 12px/700 |

  O contraste é o da coluna "sobre o tint" de 7.1 (≥ 4,9:1). Uma cor da config é ajustada para ≥ 4,5:1 (ver 7.6).
- **Sigla da config**: aceita de 1 a 3 grafemas depois do `trim()`, exibidos como vieram, sem forçar caixa alta (ex.: `"SEC"`). Com 4 ou mais, usa os 3 primeiros e gera o aviso `papel "<name>": sigla "<valor>" tem mais de 3 caracteres; usando "<3 primeiros>"`. Vazia ou de tipo errado: ignorada com aviso, e vale a sigla automática.
- **Siglas repetidas** (`dba` e `dev-backend` = DB) são aceitas, como diz a R17.
- **Ícones SVG via config: não na v1.2.** Os 7 glifos da v1.1 saem do código, e o `outro` passa a usar o glifo de três pontos como único `<symbol>` restante (`i-outro`), sem monograma. Aceitar SVG da config abriria uma injeção de markup no painel, e um conjunto fechado de ícones embutidos não resolve o problema de "cada pessoa tem agentes diferentes". Um campo `icone` na config é ignorado sem aviso, como qualquer campo desconhecido. Uma evolução futura possível seria `"icone": "<id de um conjunto embutido>"`, que fica fora do escopo.

#### 7.4 Nome longo no cartão (272px)

Linha 1 = `[monograma 24] gap 8 [nome] gap 8 [badge]`. A estrutura já existe em `public/style.css:86-91`:
- `.nome`: `flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis` (13px/600, `var(--role)`).
- Badge e monograma: `flex: none`. **O badge nunca encolhe e nunca é cortado.** Quem cede espaço é só o nome.
- Espaço para o nome por estado (área útil de 240px − 24 − 8 − 8 − badge): "Em execução" ≈ 102px (100px com a borda de 2px), "Sem término" ≈ 106px, "Reprovado" ≈ 112px, "Concluído" ≈ 114px e "Aprovado" ≈ 118px.

| Nome (13px/600) | Largura ≈ | Em execução | Aprovado |
|---|---|---|---|
| Arquiteto | 62px | inteiro | inteiro |
| Project Manager | 106px | "Project Manag…" | inteiro |
| Revisor Seguranca | 114px | "Revisor Segura…" | "Revisor Seguranca" (justo) |
| Especialista Em Acessibilidade | 200px | "Especialista E…" | "Especialista Em…" |

- **"Nª vez" nunca na linha 1.** Ele continua sendo o primeiro filho da linha 2 (`<span class="vez">2ª vez · </span>` antes do `label`). Como o `line-clamp: 2` só corta o fim, o prefixo nunca some (BUG-1 da v1).
- **Nome completo sempre acessível**: `title="<nome completo>"` no `<span class="nome">` (sempre, e não só quando corta). O `aria-label` do `<button>` começa com o nome completo ("Revisor Seguranca, 2ª vez. …"). O painel mostra o nome inteiro no `<h2>`, que pode quebrar em 2 linhas e nunca é truncado. A legenda também mostra o nome inteiro (7.5).
- Não reduza a fonte nem quebre o nome em 2 linhas no cartão, porque a altura de 128px é fixa. Para nomes longos, a recomendação no README é `nome` na config (ex.: "Acessibilidade").

#### 7.5 Legenda dinâmica

- **Estrutura**: `<ul class="legenda" aria-label="Legenda">` com `display:flex; flex-wrap:wrap; gap:8px 20px; min-height:40px; padding:8px 24px; overflow:visible`. A regra atual de `public/style.css:50` já serve. Cada `<li>` usa `display:inline-flex; gap:6px; white-space:nowrap`, então um item nunca se parte: a quebra é sempre entre itens. **Nunca há rolagem horizontal.**
- **Ordem**: Avanço, Voltou, um separador (`<li aria-hidden="true">` com 1×16px `#CBD5E1`), os papéis da sessão na ordem de `roles` (R17: `ordem` da config, nível e `start_ts`) e "Outro" por último, só se a sessão tiver nó `outro` antes do filtro "Ocultar outros".
- **Item de papel**: um círculo de 12px preenchido com `var(--role)` (objeto gráfico, ≥ 5:1 sobre `#F8FAFC`) e o nome completo em 12px `#475569`. A legenda não usa monograma, porque 16px é pequeno demais para texto, e o nome está ao lado. Nome com mais de 32 caracteres: `max-width: 240px; overflow:hidden; text-overflow:ellipsis` com `title`. "Outro": círculo de 12px com fundo `#E2E8F0` e borda tracejada de 1,5px `#475569`.
- **Troca de sessão**: a legenda é recriada a partir de `roles` da nova sessão.
- **Comportamento medido** (item de papel ≈ 12 + 6 + nome + 20 de gap; Avanço e Voltou ≈ 170px):

| Papéis | Largura ≈ | 1440px | 1024px | 768px |
|---|---|---|---|---|
| 2 (Arquiteto, Dba) + Outro | 420px | 1 linha | 1 linha | 1 linha |
| 6 (time da v1.1 com os nomes humanizados) | 900px | 1 linha | 1 linha | 2 linhas |
| 12 (nomes de 10 a 18 caracteres) | 1600px | 2 linhas | 2 linhas | 3 linhas |

  A faixa cresce para baixo (por isso `min-height` e não `height`), e o canvas desce junto.

#### 7.6 Config sobrescrevendo (R18)

| Campo | Aceita | Inválido | Efeito |
|---|---|---|---|
| `nome` | string não vazia depois do `trim()` | ignorado com aviso; vale o nome humanizado | cartão (com o corte de 7.4), painel, legenda, `aria-label`, resumo e anúncios. Não muda a cor (o hash usa o `name`). |
| `sigla` | de 1 a 3 grafemas | ver 7.3 | monograma do cartão e do painel |
| `cor` | `#RGB` ou `#RRGGBB`, sem diferença de caixa | formato inválido: ignorado com aviso; vale a cor do hash | `cor`, `tint` e `rgb` |
| `ordem` | número finito | ignorado com aviso | ordenação: `(ordem ?? +∞, nivel, start_ts)`, ou seja, papéis com `ordem` vêm antes dos sem `ordem` |

- **Tint de uma cor da config**: se a cor for exatamente uma cor da paleta, usa o tint da tabela 7.1. Se não for, mistura 12% da cor com o branco: `tint = round(255 − (255 − c) × 0,12)` por canal.
- **Cor que falha no AA: ajustar e avisar.** Uma cor válida em formato precisa de ≥ 4,5:1 sobre `#FFFFFF` **e** sobre o próprio tint. Quando falha, escurece em passos de 5% (`c' = round(c × (1 − 0,05k))`, k = 1, 2, …, recalculando o tint a cada passo) até passar nas duas, e gera o aviso `papel "<name>": cor <original> tem contraste <x,x>:1; ajustada para <nova>`. Escolhi ajustar em vez de só aceitar com aviso, porque assim a garantia de AA vale para qualquer config, e o aviso mostra o que mudou. Exemplo: `#F59E0B` (2,1:1) vira um âmbar escuro legível.
- A cor da config **não** é validada quanto ao matiz. Uma cor vermelha ou verde é aceita, mas o README recomenda evitar vermelho, verde e âmbar, porque têm significado de estado.
- `outro` e os nativos não podem ser reestilizados: uma chave `papeis.outro` ou com o nome de um nativo é ignorada com aviso.

#### 7.7 Mockup

`docs/design/fluxo-v12-mockup.html` (estático, sem JS) mostra a sessão `sess-time-dif-0001` da fixture `time-diferente`, com as cores do hash, a sigla "SEC" da config no revisor, a 2ª vez em dba2, rev2 e arq2, o corte de um nome longo em execução e a legenda com 2, 6 e 12 papéis. O mockup da v1 (`fluxo-mockup.html`) não foi alterado e continua valendo para o layout do grafo e das arestas.

### 8. Vários projetos (v1.3, tarefa 29)

Regras de origem: R20 a R25 de `docs/plano.md`. O que não é citado aqui continua como nas seções 1 a 7.

#### 8.1 Fluxo
1. O usuário roda `npm start`. O cabeçalho mostra **Projeto** e **Sessão**, e o painel abre no projeto com a atividade mais recente, na sessão mais recente dele (seguindo os dois).
2. Enquanto segue, se outro projeto passar a ter a atividade mais recente, o painel troca sozinho de projeto, e o anúncio sai no `aria-live`.
3. Quando o usuário escolhe um projeto no select, a escolha fica fixa (`localStorage`). Se depois houver atividade nova em outro projeto, aparece o aviso **"Atividade em <projeto> · ver"**. Clicar no aviso troca para aquele projeto e volta a seguir.
4. Na troca de projeto, a sessão volta a seguir a mais recente do novo projeto, o painel lateral fecha e a legenda e o time são recarregados.

#### 8.2 Layout do cabeçalho (só no modo multi; o `<header>` ganha a classe `multi`)

Ordem no DOM (que também é a ordem do foco): `h1` → **Projeto** → **Sessão** → aviso (slot único) → toggle → chip fixture → espaço → **botão Alertas (v1.4, 9.8)** → conexão → duração. A faixa de alertas (9.3) vem logo depois do `<header>`.

```
1600px (uma linha)
| Monitor de execução  Projeto                      Sessão                               Ocultar outros (0)       (●) Ao vivo   Duração total |
|                      [digisac — 6 sessões ▾]      [Ajuste do login · hoje 14:02 · 4 … ▾] Atividade em monitor-execucao · ver        12:40       |

1280px (uma linha, h1 só para leitor de tela)
| Projeto                              Sessão                                   Atividade em digisac · ver  [o ] Ocultar outros (0)  (●) Ao vivo  Duração total |
| [digisac · SD-2476 — 1 sessão · e…▾] [Corrigir filtro · hoje 14:… ▾]                                                                         12:40         |

1024px (duas linhas)
| Projeto                                Sessão                                    Atividade em digisac · ver |
| [digisac · SD-2476 — 1 sessão · em andamento ▾] [Corrigir filtro · hoje 14:02 · 3 execuç… ▾]              |
| [o ] Ocultar outros (0)                                                    (●) Ao vivo   Duração total 12:40 |
```

Dropdown aberto (caso real, ordem por atividade):
```
Projeto
[digisac · SD-2476 — 1 sessão · em andamento  ▾]
 | digisac · SD-2476 — 1 sessão · em andamento |   title: "digisac · SD-2476\n~/orca/workspaces/digisac/SD-2476"
 | monitor-execucao — 9 sessões                |   title: "monitor-execucao\n~/Documentos/apps/monitor-execucao"
 | digisac — 6 sessões                         |   title: "digisac\n~/Documentos/apps/digisac"
```

Larguras:

| Item | Regra |
|---|---|
| `select#projeto` | `flex: 0 1 380px; min-width: 280px; max-width: 380px` |
| `select#sessao` | `flex: 0 2 420px; min-width: 240px; max-width: 420px` (no modo multi, o `min-width: 280px` da seção 1 cai para 240px) |
| Aviso (slot) | `max-width: 240px`, uma linha, `white-space: nowrap`; o nome do projeto dentro dele é cortado em 16 grafemas com "…" |
| `gap` do cabeçalho | continua 24px; entre o select de sessão e o aviso, 12px (`.campo-linha`) |

O que cede primeiro, nesta ordem:
1. **Os selects encolhem** até o `min-width`. O de sessão encolhe primeiro (`flex-shrink: 2`), porque os títulos de sessão são longos e têm tooltip; o de projeto, por último.
2. **Abaixo de 1536px**, o `<h1>` vira `sr-only` (continua sendo o título da página para o leitor de tela e no `<title>`). Ele ocupa ~175px, que é exatamente o espaço do aviso.
3. **Abaixo de 1280px**, o cabeçalho tem duas linhas: a linha 1 tem Projeto, Sessão e o aviso; a linha 2 tem o toggle, o espaço, a conexão e a duração. Implementação: um `<div class="quebra" aria-hidden="true">` com `flex-basis: 100%; height: 0` depois do slot de aviso, visível só nessa faixa. Padding vertical de 12px e `row-gap: 8px`.
4. **Abaixo de 720px** (fora do escopo, mas sem rolagem): cada select ocupa 100% da linha.

O `flex-wrap: wrap` continua ligado como rede de segurança: se uma combinação de textos não couber, quebra, mas nunca vaza nem cria rolagem horizontal. Em 1024px não há rolagem horizontal com nenhum estado (com aviso, com "em andamento", com nome cortado).

**Modo projeto único** (`mode: 'single'`, `--events` único ou `--fixture`): o campo Projeto tem `hidden`, o `<header>` não tem a classe `multi` e tudo fica igual à v1.2 (h1 visível, quebra abaixo de 900px).

#### 8.3 Texto da opção de projeto

`<nome> — <n> sessão|sessões[ · em andamento]`

- **Nome**: o `name` da API (R22), cortado em **22 grafemas** com "…" no fim (`cortar(nome, 22)`). O corte é no JS, e não só por CSS, para que a contagem continue visível no select fechado. Exemplo: `digisac · SD-2476-nome-muito-longo-de-branch` vira `digisac · SD-2476-nome…  — 1 sessão`.
- **Contagem**: `1 sessão`, `2 sessões` (0 não acontece, porque R21 tira o projeto da lista).
- **"em andamento"**: quando `running` for verdadeiro (R24). Com o select na largura mínima (280px), nome + contagem sempre cabem; o "em andamento" pode ser cortado pela reticência do select fechado, mas aparece inteiro na lista aberta, no tooltip e no `aria-label` do anúncio.
- O separador é o travessão "—", para não confundir com o "·" que já existe dentro do nome de worktree.
- **Tooltip** (`title` da `<option>` e do `<select>` com o projeto selecionado): `<nome completo>\n<path>`, onde `path` já vem abreviado com `~` da API. Nunca montar o caminho no cliente.
- **Ordem**: a da API (`last_ts` mais novo primeiro). O texto não mostra horário.
- **Atualização ao vivo**: as contagens mudam a cada `update`. Atualize o `textContent` e o `title` das `<option>` existentes, em vez de refazer o `innerHTML`, enquanto o select estiver com foco (refazer fecha a lista aberta em alguns navegadores). Só reconstrua a lista quando um projeto entrar ou sair, ou quando a ordem mudar e o select não estiver com foco.

#### 8.4 Seguir, escolha manual e o aviso

- **Seguir** (padrão, sem `monitor.project` no `localStorage`): o selecionado é sempre `projects[0]`. Quando ele muda, o painel troca de projeto (8.1, passo 4).
  - **Exceção**: com o painel lateral aberto, a troca automática fica **adiada** (para não fechar o painel enquanto o usuário lê). Nesse meio-tempo, o aviso aparece. Ao fechar o painel, se ainda estiver seguindo, a troca acontece.
- **Escolha manual**: o `change` do select grava `monitor.project = <id>` e marca `escolhidoEm = Date.now()` (só em memória; no reload, vale a hora do carregamento).
- **Quando o aviso aparece** (`!seguindo` e `projects[0].id !== selecionado` e `Date.parse(projects[0].last_ts) > escolhidoEm`): ou seja, só para atividade **nova** depois da escolha, e não para um projeto que já era mais recente.
- **Microcopy**: o link-botão `Atividade em <nome cortado em 16> · ver`, no mesmo estilo de "Nova sessão · ver" (13px, `#1D4ED8`, sublinhado, `.link-nova`). O `title` é `Ver o projeto <nome completo> (<path>)`, e o `aria-label` é `Atividade nova no projeto <nome>. Ver`.
- **Clique**: troca para `projects[0]`, apaga `monitor.project` (volta a seguir) e devolve o foco ao `select#projeto`.
- **Some quando**: o usuário clica no aviso; escolhe qualquer projeto no select (o `escolhidoEm` é renovado); ou o projeto selecionado volta a ser o mais recente.
- **Relação com "Nova sessão · ver"** (critério d): os dois usam o **mesmo slot**, depois do select de sessão, e **só um aparece por vez**. A prioridade é do **"Nova sessão · ver"** (é do projeto que está na tela). Quando ele some (clique ou escolha), o aviso de projeto aparece no lugar, se ainda valer. Assim o slot nunca passa de 240px e as selects não pulam de posição.

#### 8.5 Estados

| Estado | Select de projeto | Select de sessão | Canvas |
|---|---|---|---|
| **Carregando a lista** | `disabled`, opção única "Carregando projetos…" | `disabled`, "Carregando…" | esqueleto atual (seção 5); `aria-busy="true"` |
| **Um só projeto** | **visível e habilitado** (mesma regra do select de sessão na seção 1: mostra em que projeto se está e dá o caminho no tooltip; um select desabilitado sai da ordem de foco e perde contraste) | normal | normal |
| **Nenhum projeto** (`projects: []`) | `disabled`, "Nenhum projeto" | `disabled`, "Nenhuma sessão" | caixa vazia (ícone `i-vazio`), título **"Nenhum projeto com eventos encontrado"**; texto: "O painel procura `.monitor/events.jsonl` nas pastas em que o Claude Code acionou subagentes. Confira se o hook `~/.claude/hooks/log-agent-event.cjs` está configurado no `~/.claude/settings.json` (veja o README) e acione um agente. A lista é atualizada sozinha." Sem botão. |
| **Projeto sem sessões válidas** | não aparece na lista (R21). Se o selecionado ficar sem sessões entre duas redescobertas, vale a linha abaixo, ou o canvas mostra "Nenhuma execução registrada neste projeto" (variação do estado "vazio" da seção 5) até a lista ser atualizada. | `disabled`, "Nenhuma sessão" | estado vazio |
| **Projeto lembrado sumiu** (fora da lista, ou `/api/sessions?project=` devolveu 404) | apaga `monitor.project`, volta a seguir `projects[0]` | segue a mais recente | troca de projeto; no slot de aviso, um texto **não clicável** "<nome> saiu da lista" (13px, `#475569`) por 10s ou até a próxima interação com os selects. Ele cede o slot para os outros dois avisos. Anúncio: ver 8.6. |
| **Erro em `/api/projects`** | mantém a última lista | sem mudança | sem mudança; o indicador de conexão da seção 5 cobre o caso. No primeiro carregamento, vale o estado de erro da seção 5. |
| **Modo projeto único** | `hidden` | igual à v1.2 | os estados "vazio" e "sem arquivo" mantêm o texto da v1.2 |

#### 8.6 Acessibilidade
- [ ] `<label for="projeto">Projeto</label>` visível (12px/600, `#475569`), no mesmo `.campo` do select de sessão.
- [ ] O caminho do projeto selecionado também vai para o leitor de tela: `aria-describedby="projeto-caminho"`, um `<span class="sr-only" id="projeto-caminho">Pasta: ~/...</span>` (o `title` sozinho não é confiável).
- [ ] Foco: Projeto → Sessão → aviso → toggle (ordem do DOM). Nenhum `tabindex` positivo. O aviso é `<button>`, e Enter ou Espaço ativam. Depois de uma troca, o foco não pula sozinho, exceto quando o usuário clica no aviso (o foco vai para `select#projeto`).
- [ ] Com a lista fechada, as setas disparam um `change` a cada tecla (Chrome/Firefox no Linux). Aplique a troca de projeto com debounce de 300ms (o select de sessão hoje não tem debounce, e não precisa mudar).
- [ ] Anúncios em `#anuncios` (`aria-live="polite"`), uma frase por troca:
  - manual: "Projeto digisac: 6 sessões. Mostrando a sessão <título>."
  - automático (seguindo): "Seguindo o projeto digisac · SD-2476, que tem a atividade mais recente."
  - o aviso aparece: "Atividade nova no projeto digisac." (uma vez por aparição, sem repetir a cada `update`)
  - projeto sumiu: "O projeto <nome> não está mais na lista. Mostrando <novo>."
- [ ] "Em andamento" é texto, e não só cor ou ícone. O aviso tem texto e sublinhado, sem depender da cor.
- [ ] O `aria-label` do canvas e o título do resumo passam a citar o projeto no modo multi: "Fluxo da sessão <título>, projeto <nome>".
- [ ] Todo texto vindo da API (nome, path) entra por `textContent` ou `esc()`.
- [ ] Contraste: os tokens são os da seção 1 (`#1D4ED8` sobre `#FFF` 6,7:1; `#475569` sobre `#FFF` 7,6:1).

#### 8.7 Notas para o dev-frontend
- Chaves de `localStorage`: `monitor.project` (id; ausente = seguir). A escolha manual de sessão continua só em memória, como na v1.2, e é zerada na troca de projeto.
- Painel lateral em overlay (≤1024px): hoje usa `top: 64px`. Com o cabeçalho em duas linhas, use uma variável `--header-h` medida com `ResizeObserver` no `<header>`.
- Os textos dos estados "vazio" e "sem arquivo" da seção 5 que citam `.monitor/events.jsonl` continuam valendo no modo único. No modo multi, troque "Os eventos são lidos de `.monitor/events.jsonl`" por "Os eventos deste projeto são lidos de `<path>/.monitor/events.jsonl`".
- Mockup: os diagramas ASCII de 8.2 (caso real com 3 projetos) servem de referência. Os mockups HTML da v1 e da v1.2 não mudaram.

### 9. Alerta de sessão aguardando (v1.4, tarefa 38)

Regras de origem: R26 a R34 de `docs/plano.md` e as respostas do usuário (limite `vezMinutos` = 2; `Stop` sem pergunta formal também alerta; nenhum link ou botão para abrir o orquestrador). "Arquiteto" é a pessoa que conduz as sessões; na interface o texto fala direto com ela ("Sua vez", "aguardando você"). Mockup: `docs/design/fluxo-v14-mockup.html` (estático, sem JS).

#### 9.1 Fluxo
1. Uma sessão de qualquer projeto para e espera o Arquiteto. Em até 2 s aparece um item na **faixa de alertas** logo abaixo do cabeçalho, com o tipo, a sessão, o projeto, o resumo e o tempo correndo.
2. Para tipos imediatos (pergunta, permissão, MCP, erro) o item já nasce piscando, o título da aba e o favicon mostram o contador e sai uma notificação (se permitida). Para "Sua vez" o item nasce **discreto** e só passa a piscar e notificar depois de `vezMinutos`.
3. O Arquiteto lê "Verifique no orquestrador", usa **Copiar nome** e procura a sessão no orquestrador que estiver usando. Opcionalmente, clica no item para ver aquela sessão no painel.
4. Quando ele responde, a espera é encerrada pelo evento correspondente (R27) e o item some em até 2 s. Se o `Stop` era só "tarefa acabou", ele usa **Dispensar**.

#### 9.2 Degraus de urgência e cor

`L` = `vezMinutos` (padrão 2 min). Os degraus usam múltiplos de `L` para os dois grupos, então mudar a config escala tudo junto.

| Degrau | Imediatos (pergunta, permissão, MCP, erro) | "Sua vez" | Item | Pílula do tipo | Movimento | Tempo |
|---|---|---|---|---|---|---|
| **D0 discreto** | — | `< L` (0 a 2 min) | fundo `#FFFFFF`, borda 1px `#CBD5E1`, textos `#0F172A`/`#475569` | fundo `#F1F5F9`, texto `#334155` | nenhum | 13px/600 mono `#475569` |
| **D1 aguardando** | `< 3L` (0 a 6 min) | `L` a `3L` (2 a 6 min) | fundo `#334155`, sem borda | **invertida** (fundo `#FFFFFF`, texto `#0F172A`) | pílula pisca a **0,5 Hz** | 14px/600 mono `#FFFFFF` |
| **D2 demorando** | `3L` a `6L` (6 a 12 min) | `3L` a `6L` | fundo `#1E293B` | invertida | pílula pisca a **1 Hz** | 14px/700 mono `#FFFFFF` |
| **D3 parada** | `≥ 6L` (12 min ou mais) | `≥ 6L` | fundo `#0F172A` + **faixa lateral esquerda de 6px `#FFFFFF`** | invertida | pílula pisca a 1 Hz | 14px/700, precedido do texto "parada há" (11px/600 `#CBD5E1`) |

**Decisão de cor: nenhum matiz novo.** Vermelho (voltou, reprovado, desconectado), verde (aprovado, ao vivo) e âmbar (sem término, reconectando) já têm dono, e a paleta de papéis (7.1) ocupa praticamente todos os outros matizes (azul, violeta, rosa, fúcsia, verde-azulado, oliva). Qualquer cor nova seria lida como "um papel" ou como um estado que já existe. Por isso o alerta usa o eixo de **luminosidade**: ele é a única superfície **escura e larga** da tela (o resto é claro), e os degraus escurecem do ardósia médio ao quase preto. O "erro" (`StopFailure`) também **não** usa vermelho: é distinguido pelo ícone de triângulo e pelo texto "Erro". A cor nunca é a única pista: o degrau também aparece no ritmo da piscada, no peso do tempo e no texto "parada há" (D3).

Contraste (todos AA):

| Par | Razão |
|---|---|
| `#FFFFFF` sobre `#334155` (D1) | 10,4:1 |
| `#CBD5E1` sobre `#334155` (texto secundário D1) | 7,1:1 |
| `#FFFFFF` sobre `#0F172A` (D3) | 17,9:1 |
| `#CBD5E1` sobre `#0F172A` | 12,1:1 |
| `#0F172A` sobre `#FFFFFF` (pílula invertida) | 17,9:1 |
| `#334155` sobre `#F1F5F9` (pílula D0) | 9,3:1 |
| Item D1 (`#334155`) contra o fundo da faixa `#F1F5F9` (objeto gráfico, 3:1) | 9,3:1 |
| Item D0: borda `#CBD5E1` contra `#F1F5F9` é fraca (1,3:1), por isso o D0 tem fundo `#FFFFFF` **e** sombra `0 1px 2px rgba(15,23,42,.08)`; o item continua identificável pelo texto, não pela borda | — |

#### 9.3 Faixa global de alertas (`<section id="alertas">`)

- **Posição**: no DOM, logo **depois do `<header>`** e antes da `.faixa-erro` e da legenda. Fica fora do cabeçalho de propósito: o cabeçalho é do projeto/sessão selecionados, a faixa é global (todos os projetos). Não fica acima do cabeçalho para que os selects não pulem de posição quando um alerta entra ou sai. Como o `body` é flex em coluna e quem rola é o `<main>`, a faixa fica sempre visível, sem `position: sticky`.
- **Container**: fundo `#F1F5F9`, borda inferior 1px `#CBD5E1`, padding `8px 24px`, `<ul>` em coluna com `gap: 6px`. Com 0 alertas visíveis (nenhum ou todos dispensados): `hidden`, sem espaço reservado.
- **Altura do item**: 52px fixos (duas linhas de texto). A faixa nunca rola na horizontal: todo texto variável tem `min-width: 0` e reticência.

**Empilhamento e "+N"** (regra: cabem até 3 itens; a partir de 4, mostra 2 e uma linha de resumo):

| Alertas visíveis | O que aparece | Altura da faixa |
|---|---|---|
| 0 | faixa `hidden` | 0 |
| 1 | 1 item | 8 + 52 + 8 + 1 = **69px** |
| 3 | 3 itens | 8 + 3×52 + 2×6 + 8 + 1 = **185px** (teto da faixa recolhida) |
| 10 | 2 itens + linha "+8" | 8 + 2×52 + 2×6 + 32 + 8 + 1 = **165px** |
| 12 | 2 itens + linha "+10" | 165px |

- **Linha "+N"** (32px, fundo transparente, 13px `#334155`): `+10 aguardando · 4 Pergunta · 3 Permissão · 3 Sua vez` seguido do botão `.btn.peq` **"Ver todos (12)"** (`aria-expanded="false"`, `aria-controls="alertas-lista"`). As contagens por tipo seguem a ordem Pergunta, Permissão, MCP, Erro, Sua vez e omitem tipos com 0. Se algum dos ocultos estiver em D1 ou acima, o "+N" vem em 13px/700.
- **Expandida**: mostra todos, com `max-height: min(60vh, 8 itens)` e `overflow-y: auto` (só vertical). O botão vira **"Mostrar menos"**. Volta a recolher sozinha quando o total cai para 3 ou menos. O estado expandido fica só em memória.
- **Ordem** (R31): grupo A = imediatos (qualquer degrau) e "Sua vez" com `≥ L`; grupo B = "Sua vez" em D0. Dentro de cada grupo, a espera mais antiga (menor `ts` de início) primeiro. A ordem é recalculada a cada update e a cada mudança de degrau, mas o DOM é **reconciliado por chave** (`session_id + ts de início`) para não reiniciar a piscada nem perder o foco.

```
1024px, 3 alertas (D3, D1, D0)
+------------------------------------------------------------------------------------------------+
| [cabeçalho da v1.3: Projeto / Sessão em duas linhas]                                            |
+------------------------------------------------------------------------------------------------+
| ▌[▲ Erro     ] Corrigir filtro · digisac · SD-2476        parada há 14:03  [Copiar nome][Dispensar]|
|  Verifique no orquestrador · O turno parou com erro: rate_limit                                  |
| [? Pergunta  ] Ajuste do login · digisac                            03:12  [Copiar nome][Dispensar]|
|  Verifique no orquestrador · "Quer que eu crie a migração agora ou depois do deploy?"            |
| [… Sua vez   ] Spec da faixa · monitor-execucao                     01:05  [Copiar nome][Dispensar]|
|  Verifique no orquestrador · Turno encerrado. Pode haver uma pergunta no texto.                  |
+------------------------------------------------------------------------------------------------+
| legenda ...                                                                                      |
```

#### 9.4 Anatomia do item

`<li class="alerta d1" data-key>` com `display: grid; grid-template-columns: 1fr auto auto; align-items: center; column-gap: 12px; padding: 6px 8px 6px 12px; border-radius: 10px`.

```
+-----------------------------------------------------------------------------------------------+
| [ícone Tipo]  <Nome da sessão>  ·  <projeto>                      <tempo>  [Copiar nome] [Dispensar] |
|  Verifique no orquestrador · <resumo>                                                         |
+-----------------------------------------------------------------------------------------------+
 \______________ <button class="alerta-ir"> (coluna 1) _____________/ coluna 2   coluna 3 (ações)
```

- **Coluna 1, `<button class="alerta-ir">`** (área clicável principal; sem fundo nem borda, texto à esquerda, `min-width: 0`):
  - **Linha 1** (20px): pílula do tipo (altura 22px, padding 0 8px, raio 999px, 11px/700 caixa alta, `letter-spacing: .04em`, ícone 14px + gap 4) · **nome da sessão** (14px/600, cor principal do degrau, `max-width: 360px`, reticência, `title` com o nome completo) · separador "·" · **projeto** (13px, cor secundária, `max-width: 220px`, reticência, `title` = nome completo; cortado em 22 grafemas como em 8.3). No modo projeto único, o projeto mostra o `name` que a API devolver; se não houver, o separador e o projeto somem.
  - **Linha 2** (18px, 12px): **"Verifique no orquestrador"** em 12px/600 + " · " + **resumo** (12px, cor secundária, uma linha, reticência, `title` com o texto completo). Se a sessão do alerta é a que está na tela, acrescente " · na tela" no fim (antes da reticência, num `<span>` próprio que não é cortado).
- **Coluna 2, tempo** (`<span class="alerta-tempo" aria-hidden="true">`, mono, `tabular-nums`, alinhado à direita, `min-width: 56px`): `mm:ss` até 59:59; depois `h:mm` com sufixo " h" (ex.: `1:05 h`), para não confundir com `mm:ss`. Em D3, o prefixo "parada há". Atualizado pelo `setInterval` global de 1 s (seção "Notas", item 4), sem refetch.
- **Coluna 3, ações** (`display: flex; gap: 8px`), botões `.btn.peq` (28px de altura; em itens escuros: fundo transparente, borda 1px `#94A3B8`, texto `#FFFFFF`; hover fundo `rgb(255 255 255 / .12)`):
  - **"Copiar nome"** (ícone de cópia 14px + texto). Copia **exatamente** o nome da sessão exibido (título do Orca, do Claude Code ou o código curto), sem o projeto.
  - **"Dispensar"** (ícone ✕ 14px + texto).
- **Tipos** (ícone SVG 24-viewBox, mesmo estilo de traço dos `<symbol>` atuais; texto sempre presente):

| Tipo (`tipo`) | Pílula | Ícone (`<symbol>`) | Resumo (montado no cliente a partir do `resumo` da API) |
|---|---|---|---|
| `pergunta` | Pergunta | `i-al-pergunta`: círculo com "?" | `“<resumo>”` (já vem cortado em 120 pelo hook) |
| `permissao` | Permissão | `i-al-permissao`: cadeado | `Pede permissão para usar <tool_name>` |
| `mcp` | MCP | `i-al-mcp`: plugue | `O servidor MCP <nome> pede uma resposta` |
| `erro` | Erro | `i-al-erro`: triângulo com "!" | `O turno parou com erro: <tipo do erro>` (sem tipo: `O turno parou com erro`) |
| `vez` | Sua vez | `i-al-vez`: balão com reticências | `Turno encerrado. Pode haver uma pergunta no texto.` |

```html
<symbol id="i-al-pergunta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17v.01"/></symbol>
<symbol id="i-al-permissao" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></symbol>
<symbol id="i-al-mcp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 01-12 0zM12 17v5"/></symbol>
<symbol id="i-al-erro" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20z"/><path d="M12 10v4M12 17v.01"/></symbol>
<symbol id="i-al-vez" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/></symbol>
<symbol id="i-copiar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></symbol>
<symbol id="i-sino" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16v-5a6 6 0 0112 0v5l2 2H4z"/><path d="M10 21h4"/></symbol>
```

**Largura em 1024px** (área útil 1024 − 48 − 20 = 956px): ações ≈ 112 + 100 + 8 = 220px; tempo ≈ 64px (D3 com "parada há" ≈ 120px); gaps 24px. Sobram ≈ 530 a 650px para a coluna 1: pílula ≤ 104px ("PERMISSÃO") + sessão até 360px + projeto até 220px. Com nomes longos, quem corta primeiro é o projeto (`flex-shrink: 2`), depois a sessão. Nenhuma combinação cria rolagem horizontal. Abaixo de 720px (fora do escopo, sem rolagem): a coluna 3 desce para uma 3ª linha e o item vira `height: auto`.

**Estados das ações:**

| Ação | Estado | Visual e texto | Duração |
|---|---|---|---|
| Copiar nome | padrão | ícone de cópia + "Copiar nome" | — |
| | sucesso | ícone ✓ + **"Copiado"**; `aria-live`: "Nome copiado: <nome da sessão>." | 2 s, depois volta |
| | falha (`navigator.clipboard` ausente ou rejeitado) | o botão volta ao padrão; a linha 2 do item é trocada por **"Não foi possível copiar. O nome está selecionado: use Ctrl+C."** e o `<span>` do nome recebe a seleção (`Selection.selectAllChildren`). O nome tem `user-select: text`. `aria-live`: o mesmo texto. | 8 s ou até o próximo clique |
| Dispensar | clique | o item é trocado, no mesmo lugar, por uma linha de 32px: **"Alerta de <sessão> dispensado. Ele volta se a sessão parar de novo."** + botão **"Desfazer"**. O foco vai para "Desfazer". | 6 s; depois a linha some e, se o foco estava nela, vai para o `alerta-ir` do item seguinte (ou o anterior; sem itens, para `select#sessao`) |
| | desfazer | o item volta na sua posição; foco no "Dispensar" dele | — |

- **Dispensar** grava em `localStorage` `monitor.dispensados` um mapa `{ "<session_id>": "<ts de início da espera>" }`. Um item é oculto quando a chave e o `ts` batem; uma espera nova da mesma sessão tem outro `ts` e volta a aparecer. Entradas cujo `session_id` não está mais em nenhuma espera ativa são limpas a cada update. Dispensados não contam na faixa, no título, no favicon nem nos marcadores do seletor.
- **Clique no item** (`alerta-ir`): seleciona o projeto e a sessão como **escolha manual** (grava `monitor.project`, como em 8.4; a sessão fica fixa), fecha o painel lateral, rola o canvas como no 1º render e anuncia "Mostrando a sessão <nome>, projeto <projeto>." O foco fica no item (o usuário pode copiar o nome em seguida). O alerta continua na faixa até a espera terminar.
- **Hover** do `alerta-ir`: sublinhado no nome da sessão e cursor pointer. **Foco**: o anel padrão (`outline: 3px solid #1D4ED8`) fica invisível sobre o fundo escuro; nos itens D1 a D3 use `outline-color: #FFFFFF` com `outline-offset: 2px` **e** um `box-shadow: 0 0 0 5px #1D4ED8` externo (o anel branco contra o item e o azul contra a faixa clara).

#### 9.5 Piscar e `prefers-reduced-motion`

- **O que pisca**: só a **pílula do tipo** (≈ 100×22px), alternando entre invertida (fundo `#FFFFFF`, texto `#0F172A`) e vazada (fundo transparente, borda 1,5px `#FFFFFF`, texto `#FFFFFF`). O item inteiro não pisca: uma área grande alternando claro e escuro é desconfortável e não ajuda mais do que a pílula.
- `@keyframes al-piscar { 0%, 50% { background:#FFFFFF; color:#0F172A } 50.01%, 100% { background:transparent; color:#FFFFFF } }`
  - D1: `animation: al-piscar 2s steps(1, end) infinite` (1 troca a cada 1 s, 0,5 ciclo/s).
  - D2 e D3: `1s` (1 ciclo/s).
  - Ambos ficam bem abaixo de 3 flashes por segundo (WCAG 2.3.1), e a área que pisca é menor que o limiar de área de flash.
- **Sincronia**: todas as pílulas do mesmo período piscam juntas. Ao criar o elemento, aplique `animation-delay: -(Date.now() % período)ms`. Não recrie o elemento nos updates (a reconciliação por chave mantém a animação).
- **D0**: nada anima.
- **`prefers-reduced-motion: reduce`**: nada pisca. A pílula fica **fixa invertida** e os itens D1 a D3 ganham `box-shadow: inset 0 0 0 2px #FFFFFF` (borda forte); D3 mantém a faixa lateral de 6px. O título da aba e o favicon também param de alternar (ficam no estado com contador). O tempo continua contando, porque é só texto.

#### 9.6 Marcadores no seletor de projeto e de sessão

`<option>` não aceita estilo confiável, então o marcador é **texto**:
- **Projeto** com ao menos uma espera em D1 ou acima: prefixo `⚠︎ ` (U+26A0 + U+FE0E, para forçar a forma de texto e não de emoji) e sufixo ` · <k> aguardando`, antes de " · em andamento". Ex.: `⚠︎ digisac — 6 sessões · 2 aguardando · em andamento`. Só esperas em D0: sem prefixo, sufixo ` · sua vez`. O prefixo garante a pista mesmo quando o select fechado corta o fim.
- **Sessão** com espera ativa: prefixo `⚠︎ ` (D1 ou acima) e sufixo ` · aguardando: <Tipo>` (ex.: ` · aguardando: Pergunta`). Em D0: sem prefixo, sufixo ` · sua vez`.
- O texto **não** inclui o tempo, para não reescrever as `<option>` a cada segundo (regra de 8.3: só `textContent` e `title` mudam, e só quando a espera entra, sai ou muda de degrau).
- Dispensados não marcam.

#### 9.7 Título da aba e favicon

- **Título**: com N ≥ 1 esperas em D1 ou acima (não dispensadas), alterna a cada 1 s entre `(N) ⚠︎ Aguardando — Monitor` e `Monitor de execução`. Com a aba visível (`document.visibilityState === 'visible'`) ou com reduced-motion, **não alterna**: fica fixo em `(N) ⚠︎ Aguardando — Monitor`. Só D0: título normal. N = 0: `Monitor de execução`.
- **Favicon** (troca o `<link rel="icon" href="data:,">` por um SVG em data URL; Chrome e Firefox aceitam):
  - **Normal** (32×32): quadrado arredondado `#0F172A` com o glifo de fluxo branco (um nó à esquerda que se divide em dois).
  - **Com contador**: o mesmo quadrado `#0F172A` e o número **N** em branco, 700, ocupando a altura (legível em 16px). N > 9 vira `9+`.
  - **Fase alternada** (acompanha o título, mesma cadência de 1 s): quadrado `#FFFFFF` com borda 2px `#0F172A` e o número em `#0F172A`. Sem alternância nos mesmos casos do título.

```html
<!-- normal -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0F172A"/><path d="M11 16l9-6M11 16l9 6" stroke="#fff" stroke-width="2.5"/><circle cx="9" cy="16" r="4" fill="#fff"/><circle cx="23" cy="9" r="4" fill="#fff"/><circle cx="23" cy="23" r="4" fill="#fff"/></svg>
<!-- contador (fase A); fase B: rect fill #fff stroke #0F172A stroke-width 2 e text fill #0F172A -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0F172A"/><text x="16" y="24" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-weight="700" font-size="22" fill="#fff">3</text></svg>
```
  Para `9+`, `font-size="17"`.

#### 9.8 Notificações do navegador e som

- **Botão "Alertas"** no cabeçalho: ícone `i-sino` em botão de 32×32 (`.btn` sem texto, `aria-label="Alertas: notificações e som"`, `aria-haspopup="dialog"`, `aria-expanded`). Posição: depois do `.espaco` e antes da conexão (vale para 8.2: `… espaço → **alertas** → conexão → duração`). Quando a permissão está `default` e há ao menos um alerta, mostra um ponto de 8px `#1D4ED8` no canto (decorativo; o texto do popover explica).
- **Popover** (`role="dialog"`, `aria-label="Alertas"`, 320px, ancorado abaixo do botão, fecha com `Esc` ou clique fora e devolve o foco ao botão):
  - Título "Alertas" (14px/600).
  - Linha de notificações, conforme `Notification.permission`:
    - `default`: texto "Receba um aviso do sistema quando uma sessão começar a esperar por você." + botão **"Ativar notificações"**. O `Notification.requestPermission()` só é chamado no clique desse botão, nunca ao carregar.
    - `granted`: "Notificações ativas neste navegador." (com ícone ✓).
    - `denied`: "Notificações bloqueadas pelo navegador. Para ativar, libere nas configurações do site (ícone ao lado do endereço)." Sem botão.
    - API indisponível: "Este navegador não oferece notificações."
  - Checkbox **"Tocar um som quando surgir um alerta"**. Valor inicial = `alertas.som` da config (padrão desligado); a escolha do usuário fica em `localStorage` `monitor.som` e prevalece.
  - Nota 12px `#475569`: "“Sua vez” passa a alertar depois de <L> min sem resposta. Ajuste em `alertas.vezMinutos` no `monitor.json`."
- **Quando dispara**: uma vez por espera (chave `session_id + ts`), quando ela entra em D1: na chegada, para os imediatos; ao cruzar `L`, para "Sua vez". Não dispara de novo em D2/D3. As chaves já notificadas ficam em `localStorage` `monitor.notificados` (limpas como os dispensados), para um reload ou uma 2ª aba não repetir. `tag` = a chave, para o sistema agrupar duplicatas. Esperas dispensadas não notificam. As esperas que já existem quando a página abre também notificam uma vez (se ainda não estiverem em `monitor.notificados`).
- **Texto**:
  - Título: `<Tipo>: <nome da sessão>` — ex.: `Pergunta: Ajuste do login`, `Sua vez: Spec da faixa`.
  - Corpo: `Projeto <projeto>. Verifique no orquestrador.` + quebra de linha + o resumo da tabela de 9.4, cortado em 100 caracteres.
  - Ícone: o favicon com contador, renderizado em PNG 64×64 via `<canvas>` (SVG em notificação não é confiável em todos os sistemas).
- **Clique na notificação**: `window.focus()`, seleciona a sessão como no clique do item (9.4) e fecha a notificação.
- **Som**: se ligado, toca na mesma hora da notificação (mesma regra: uma vez por espera, ao entrar em D1). Dois bipes curtos gerados por Web Audio (880 Hz e 660 Hz, 120 ms cada, ganho 0,15), sem arquivo de áudio. Se o navegador bloquear o áudio (sem gesto prévio na página), falha em silêncio. Nunca repete em loop.

#### 9.9 Estado "Sessão sem agentes" no canvas (R29)

Novo estado da tabela da seção 5, mesmo layout de caixa (ícone `i-al-vez` de 40px `#94A3B8`):

| Estado | Quando | Título | Texto | Ação |
|---|---|---|---|---|
| Sessão sem agentes | a sessão é válida (R29) e não tem nenhuma execução de subagente | "Sessão sem agentes" | "Nesta sessão o Claude Code conversou sem acionar subagentes, então não há fluxo para desenhar." | — |

- Se essa sessão tiver espera ativa, abaixo do texto aparece um **cartão de espera** (largura 100% da caixa, mesmo visual e degrau do item da faixa, sem "Dispensar" e sem clique de navegação): pílula do tipo, "Aguardando você há <tempo>", "Verifique no orquestrador" e "Copiar nome". Assim quem chega pelo clique no alerta vê o motivo no centro da tela.
- Cabeçalho: "Duração total" mostra `--:--`; o toggle "Ocultar outros (0)" fica desabilitado como já é com N = 0; a legenda mostra só Avanço e Voltou.
- O estado "Sessão sem execuções" da seção 5 continua para o caso antigo (só `PreToolUse`, sem esperas nem turnos).

#### 9.10 Acessibilidade

- [ ] Estrutura: `<section id="alertas" aria-labelledby="alertas-titulo">` com `<h2 id="alertas-titulo" class="sr-only">Sessões aguardando você: N</h2>` e `<ul id="alertas-lista">`. **Não** usar `role="alert"` na faixa (o conteúdo muda a cada segundo).
- [ ] Anúncio só quando **entra** um alerta em D1 (chegada de imediato ou "Sua vez" cruzando `L`), numa região própria `<div id="anuncios-alerta" class="sr-only" aria-live="assertive">`. Texto: "Aguardando você: Pergunta na sessão Ajuste do login, projeto digisac." Vários no mesmo update viram uma frase: "3 sessões novas aguardando você. A primeira: Pergunta na sessão Ajuste do login, projeto digisac." Ao carregar a página com alertas já ativos: um anúncio `polite` (em `#anuncios`) "N sessões aguardando você." Nunca anunciar ticks do tempo, mudança D1→D2→D3, reordenação, nem um alerta que **sai** (a saída é consequência de uma ação do próprio Arquiteto). D0 não é anunciado.
- [ ] `aria-label` do `alerta-ir`, em frase completa e atualizado **por minuto**: "Pergunta. Sessão Ajuste do login, projeto digisac. Aguardando há 3 minutos. “Quer que eu crie a migração…”. Ver esta sessão no painel." O tempo visível tem `aria-hidden="true"`.
- [ ] Os botões de ação têm nome que identifica o item: `aria-label="Copiar o nome da sessão Ajuste do login"` e `aria-label="Dispensar o alerta da sessão Ajuste do login"` (o texto visível fica curto).
- [ ] Ordem de foco: cabeçalho (inclusive o botão Alertas) → faixa (por item: `alerta-ir` → Copiar nome → Dispensar) → "Ver todos" → toggle "Ocultar outros"… Sem `tabindex` positivo. Um alerta que entra **não** rouba o foco. Se o item com foco sumir (espera encerrada), o foco vai para o próximo `alerta-ir`, ou para `select#sessao` se a faixa esvaziou.
- [ ] Nada depende só de cor: tipo em texto + ícone; degrau em ritmo, peso e texto ("parada há"); D0 se distingue pelo fundo claro e pela ausência de "⚠︎" nos seletores.
- [ ] Alvos: botões de 28px de altura (≥ 24×24); o `alerta-ir` tem 40px de altura útil.
- [ ] Zoom de 200%: a faixa cresce em altura (itens viram `height: auto`) e o recolhimento "+N" continua valendo; sem rolagem horizontal.
- [ ] Todo texto vindo da API (sessão, projeto, resumo, tool_name, nome do MCP, tipo do erro) entra por `textContent` ou `esc()`, inclusive no `title`, no `aria-label`, no título da aba e na notificação.

#### 9.11 Notas para o dev-frontend

- **Degrau é calculado no cliente** a cada tick a partir de `now − ts` e de `L` (vindo da config pela API, conforme o contrato do tech-lead). A mudança de degrau só troca a classe (`d0`…`d3`) do item existente.
- **Chaves de `localStorage`**: `monitor.dispensados`, `monitor.notificados` e `monitor.som`. As duas primeiras são mapas limitados às esperas ativas (limpas a cada update).
- **Tick único**: o `setInterval` de 1 s existente passa a atualizar também os tempos da faixa, o degrau, o título e o favicon (só reescreva o `href` do favicon quando N ou a fase mudar).
- **Sem orquestrador**: nenhum `href`, `window.open`, protocolo customizado ou texto de comando nos alertas (R33). "Verifique no orquestrador" é texto puro.
- **Ícones**: os 7 `<symbol>` de 9.4 entram no `<svg>` de `index.html`.
- Tokens novos em "Tokens e estilos" (`--al-*`).

---

## Tokens e estilos

```css
:root {
  /* Superfícies e texto */
  --bg: #F8FAFC;  --surface: #FFFFFF;  --border: #E2E8F0;  --border-strong: #CBD5E1;
  --text: #0F172A;  --text-2: #334155;  --text-muted: #475569;  --text-subtle: #64748B; /* 4,8:1 sobre #FFF */
  --focus: #1D4ED8;

  /* Papéis */
  --pm: #6D28D9;   --pm-tint: #EDE9FE;
  --des: #BE185D;  --des-tint: #FCE7F3;
  --tl: #4338CA;   --tl-tint: #E0E7FF;   /* v1.1 tech-lead */
  --dev: #1D4ED8;  --dev-tint: #DBEAFE;  /* developer legado; também é o azul de destaque (switch, links, "· AGORA") */
  --be: #3F6212;   --be-tint: #ECFCCB;   /* v1.1 dev-backend */
  --fe: #AD4E0A;   --fe-tint: #FFEDD5;   /* v1.1 dev-frontend */
  --qa: #0F766E;   --qa-tint: #CCFBF1;
  --out: #475569;  --out-tint: #E2E8F0;

  /* Status */
  --ok-bg: #DCFCE7;   --ok-fg: #166534;   --ok-border: #86EFAC;
  --fail-bg: #FEE2E2; --fail-fg: #991B1B; --fail-border: #FCA5A5;
  --warn-bg: #FEF3C7; --warn-fg: #92400E; --warn-border: #D97706;
  --done-bg: #F1F5F9; --done-fg: #334155;
  --run-bg: #0F172A;  --run-fg: #FFFFFF;  --run-dot: #4ADE80;

  /* Alertas (v1.4, seção 9): eixo de luminosidade, sem matiz novo */
  --al-faixa: #F1F5F9;  --al-faixa-borda: #CBD5E1;
  --al-d0: #FFFFFF;  --al-d1: #334155;  --al-d2: #1E293B;  --al-d3: #0F172A;
  --al-txt: #FFFFFF; --al-txt-2: #CBD5E1;  --al-btn-borda: #94A3B8;

  /* Arestas */
  --edge: #64748B;  /* 4,8:1 — atende os 3:1 de objetos gráficos */
  --edge-back: #B91C1C;

  /* Tipografia */
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace;

  /* Espaçamento (base 4) */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;
  --r-sm: 8px; --r-md: 10px; --r-pill: 999px;
}
```
- **Escala tipográfica**: 11 (rótulo de coluna, badge), 12 (meta), 13 (papel, conexão), 14 (corpo), 16, 18 (h1/h2) e 20 (timer/duração). Line-height de 1,4 para texto e 1 para o timer.
- Todos os pares de texto acima têm contraste ≥ 4,5:1 sobre o seu fundo; os badges ficam entre ~6,5 e 7:1. O ponto verde `#4ADE80` é decorativo, porque o texto "Em execução" carrega o significado.

---

## Microcopy (pt-BR)

| Chave | Texto |
|---|---|
| Título | Monitor de execução |
| Seletor | Sessão |
| Toggle | Ocultar outros (N) |
| Nova sessão | Nova sessão · ver |
| Conexão | Ao vivo / Reconectando… / Desconectado / Reconectar |
| Total | Duração total |
| Legenda | Avanço / Voltou |
| Coluna | ETAPA n / · k EM PARALELO / · AGORA |
| Início | Início |
| Status | Em execução / Concluído / Aprovado / Reprovado / Sem término |
| Duração | levou / rodando há / início HH:MM |
| Repetição | · 2ª vez |
| Seta de retorno | voltou (title: "QA reprovou → volta para Desenvolvedor") |
| Painel | Tarefa / Início / Término / Duração / Veredito / Veio de / Seguiu para / ID / Copiar / Copiado / Última mensagem / Fechar detalhes |
| Estados | veja a tabela de estados globais |
| Alertas (v1.4) | Pergunta / Permissão / MCP / Erro / Sua vez / Verifique no orquestrador / Copiar nome / Copiado / Dispensar / Desfazer / Ver todos (N) / Mostrar menos / +N aguardando / parada há / na tela / Ativar notificações / Sessão sem agentes — textos completos em 9.4, 9.8 e 9.9 |
| Título da aba | (N) ⚠︎ Aguardando — Monitor |

---

## Acessibilidade

- [ ] Os nós são `<button>`, com tab order por coluna (esquerda para a direita) e, dentro dela, de cima para baixo, ou seja, a mesma ordem do DOM. `Enter`/`Espaço` abrem o painel.
- [ ] Setas do teclado (opcional, recomendado): `→` vai para o 1º sucessor, `←` para o 1º predecessor e `↑`/`↓` para o vizinho na mesma coluna.
- [ ] `aria-label` de cada nó, em frase completa, por exemplo: "Desenvolvedor, 2ª vez. Corrigir bugs apontados pelo QA. Em execução há 4 minutos. Veio de QA, que reprovou." Atualize o rótulo a cada **minuto**, não a cada segundo.
- [ ] O timer dentro do nó tem `aria-hidden="true"`, porque o tempo já vai no aria-label. O timer do cabeçalho usa `role="timer"` e `aria-live="off"`.
- [ ] **Texto alternativo do fluxo**: o SVG fica `aria-hidden`. Abaixo do canvas, um `<section aria-labelledby="resumo-titulo">` com `<h2 class="sr-only">Resumo do fluxo</h2>` e uma `<ol>` gerada a partir dos nós, com uma linha por etapa. Exemplo:
  1. "Etapa 1: PM, Criar o plano, concluído em 4m 12s."
  2. "Etapa 2, em paralelo: Designer, Especificar UI, concluído em 6m 30s; Desenvolvedor, Backend, concluído em 9m 05s."
  3. "Etapa 3: QA, Validar, reprovado em 3m 55s."
  4. "Etapa 4: voltou para Desenvolvedor (2ª vez), Corrigir bugs, em execução."

  Ela fica visualmente oculta (`.sr-only`), mas um botão "Ver como lista" no canto do canvas pode exibi-la.
- [ ] Use `aria-live="polite"` (região sr-only única) **só para mudanças de estado**: "PM concluiu em 4m 12s.", "QA reprovou. Voltou para Desenvolvedor.", "Desenvolvedor iniciou." Nunca anuncie os ticks do timer.
- [ ] O foco é visível em todos os controles (`outline: 3px solid #1D4ED8; outline-offset: 2–3px`) e nunca recebe `outline: none` sem um substituto.
- [ ] A cor nunca é a única pista: o papel tem ícone e nome, o status tem texto no badge, o retorno tem tracejado e o rótulo "voltou", o nó `outro` tem borda tracejada e "Sem término" tem ampulheta, texto e borda tracejada.
- [ ] `prefers-reduced-motion: reduce` desliga o pulso, o piscar, o fluxo das arestas, o shimmer, a rolagem suave e o slide do painel.
- [ ] O switch usa `role="switch"` e `aria-checked`, e o select tem um `<label>` associado.
- [ ] O painel recebe o foco ao abrir e devolve o foco ao fechar. `Esc` fecha.
- [ ] Alvos clicáveis têm no mínimo 24x24px (os botões do cabeçalho e o Fechar têm 32–36px).
- [ ] Zoom de 200%: o cabeçalho quebra linha e o canvas rola. Nenhum texto do nó é cortado além do line-clamp, que tem o `title` com o texto completo.

---

## Notas para o developer

1. **Dados**: use `nodes[].batch` como coluna. Calcule no cliente a "n-ésima vez" (contagem por papel em ordem de `start_ts`), o "sem término" (`now - Date.parse(session.last_ts) > 2h`, constante `STALE_MS = 2*3600e3`) e a duração total.
2. **Sem arquivo vs. vazio**: o plano diz que a API devolve lista vazia quando o arquivo não existe. Para diferenciar esses estados, sugiro que `/api/sessions` responda `{sessions, source: {path, exists, fixture}}`. Se isso não for feito, use só o estado "Vazio", cujo texto já cita o arquivo.
3. **Render**: um único `render(state)` que recalcula o layout e reescreve SVG e nós é suficiente, porque o grafo é pequeno. Para não perder o foco no update do SSE, reconcilie por `data-id`: reutilize o `<button>` existente e só atualize classes e textos. Assim o foco e o painel aberto sobrevivem ao update.
4. **Timers**: um `setInterval(tick, 1000)` atualiza apenas os elementos `[data-start]` dos nós running e o total do cabeçalho, sem refetch e sem re-render.
5. **Markers SVG**: use dois `<marker>` (`seta-avanco` e `seta-retorno`) com `markerUnits="userSpaceOnUse"`, `markerWidth=10`, `markerHeight=10`, `refX=9`, `refY=5` e `orient="auto"`. O fim da linha deve parar 1px antes da borda do cartão.
6. **Cores do pulso**: defina `--role` e `--role-rgb` (ex.: `29 78 216`) por classe de papel (`.papel-developer` etc.) e use `rgb(var(--role-rgb) / .45)` no keyframe.
7. **Sessão selecionada**: guarde `selectedSession` e `followLatest` (bool). Em cada `update`, refaça o fetch de `/api/sessions` e de `/api/flow?session=<selecionada>`.
8. O mockup usa um JS inline mínimo, só para posicionar, contar o timer e abrir o painel. As constantes de layout e o roteamento de retorno dele são os mesmos desta spec e podem ser copiados.
