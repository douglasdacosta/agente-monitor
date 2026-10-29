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
- Usa flex com gap de 24px e quebra linha abaixo de 900px (`flex-wrap: wrap`; nesse caso a altura vira automática, com padding vertical de 12px).
- Itens, da esquerda para a direita:
  1. **Título** "Monitor de execução" (`<h1>`, 18px/600, `#0F172A`).
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
