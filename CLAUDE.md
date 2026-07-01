# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estrutura do projeto

Arquivo único: `index.html` (~3.015 linhas). Sem build, sem framework, sem backend. **Nunca criar arquivos separados de CSS/JS** — todo o código vive no `index.html`.

Há também um job de email diário em `scripts/` (Node.js, independente do painel).

Dependências via CDN (não instalar via npm):
- Chart.js 4.4.0 — gráficos de barras/linha
- PapaParse 5.4.1 — parsing de CSV do Google Sheets

## Desenvolvimento local

```bash
python3 -m http.server 8080
# acesse http://localhost:8080
```

Não abrir `index.html` direto no browser — o PapaParse precisa de servidor HTTP para fazer o download do CSV (CORS).

## Deploy

- GitHub: `demetriuslima-collab/painel-gestao-consultoria` (público)
- Vercel: deploy automático a cada push em `main`
- **Sempre passar a URL de produção** para usuários — URLs de preview do Vercel (`*-hash.vercel.app`) congelam na versão do deploy
- **Deployment Protection:** desativado — não reativar, bloqueia usuários após limparem cookies

## Fonte de dados

```js
const SHEET_ID = '1nBsorlQR29Ub_KFmr-QW2O2fi1lPKUuBIRvEKC1m8PU';
```

Lê **6 abas** via endpoint CSV do Google Sheets: `Leads`, `Reuniões`, `Vendas`, `Meta Captação`, `Meta Leads`, `Negociação`. A planilha precisa estar compartilhada como "qualquer pessoa com o link". O parâmetro `&_t=Date.now()` no `sheetURL` evita cache HTTP do browser.

A aba `Negociação` é carregada separadamente das outras 5 (fora do `Promise.all`), com try/catch próprio em `loadData()`: se ela não existir ou falhar, `RAW.negociacao` fica `[]` e o resto do painel carrega normalmente — só a aba Forecast fica vazia.

## Arquitetura do código (seções do script)

| Linha | Seção |
|-------|-------|
| ~683 | AUTH — array `USERS`, `setupLogin()`, `logout()` |
| ~728 | CONFIG — `SHEET_ID`, `sheetURL`, paletas de cores |
| ~738 | RUNTIME STATE — `RAW`, `SEL`, `F`, `STATE` |
| ~790 | UTILITIES — `normalizeKey`, `COL_ALIASES`, `normalizeRow`, `parseDate`, `parseNum`, `parsePatrimonio` |
| ~996 | DATA LOADING — `fetchSheet`, `loadData` |
| ~1097 | FILTERING — `filteredLeads`, `filteredReuniones`, `filteredVendas`, `filteredNegociacao` |
| ~1224 | MULTI-SELECT COMPONENT — `buildAllMS`, `populateAllFilters` |
| ~1467 | RENDER: FUNIL — cards de métricas + funil visual + **Funil Comparativo** (sub-aba `renderFunilComparativo`, compara meses/semanas pela data de criação) |
| ~1677 | RENDER: LEADS — tabela + gráfico stacked bar (breakdowns incluindo Patrimônio, toggle Diário/Mensal) |
| ~1833 | RENDER: VENDAS — Metas Captação/Origem + breakdowns (Source/Funil/Estratégia/Fonte/Closer) + toggle Diário/Mensal |
| ~2075 | RENDER: REUNIÕES — gráfico de volume por `data_atividade` (dia/semana/mês), empilhado por dimensão |
| ~2130 | RENDER: COHORT — análise de conversão por mês de entrada |
| ~2250 | RENDER: FORECAST — projeção por Prioridade sobre a base `Negociação` |
| ~2348 | RENDER: TABELA DINÂMICA (PIVOT) — `buildPivotTree`, hierarquia de dimensões clicável |
| ~2527 | CHART HELPERS — `buildDayAxis`, `buildTimeAxis` (dia/semana/mês) |
| ~2596 | RENDER DISPATCH — `render()` chama a seção ativa |
| ~2613 | IA CHAT — `buildDataContext`, `renderMarkdown`, `appendChatMsg`, `submitAI`, `clearAIChat` |
| ~2843 | EVENT BINDINGS — `bindEvents()` |
| ~2972 | INIT — `init()`, `refreshData()` |

## Quirks críticos de dados

### Normalização de colunas
`normalizeRow()` aplica `normalizeKey()` (lowercase, sem acentos, underscores) em cada chave, depois mapeia para chaves canônicas via `COL_ALIASES`. Ao adicionar suporte a uma nova coluna da planilha, adicionar o alias no objeto `COL_ALIASES`.

### Detecção de formato de data
O Google Sheets pode exportar datas em formato americano `M/D/YYYY` para a aba Vendas mesmo quando Leads usa `D/M/YYYY` brasileiro. Por isso há **dois detectores independentes**:
- `DATE_FMT` — detectado de leads/reuniões
- `VENDA_DATE_FMT` — detectado especificamente da coluna `data_venda`

Todo código que usa `data_venda` deve passar `VENDA_DATE_FMT` explicitamente: `parseDate(row.data_venda, VENDA_DATE_FMT)`.

### Patrimônio validado
Usar sempre `parsePatrimonio()`, nunca `parseNum()` direto:
```js
parsePatrimonio(v.adv_patrimonio_validado || v.patrimonio_validado)
```
`parsePatrimonio` multiplica por 1.000 valores < 10.000 (alguns registros estão abreviados, ex: `600` = R$ 600.000).

A coluna canônica é `adv_patrimonio_validado` (de `[ADV] Patrimônio validado` na planilha). O alias `patrimonio_validado` é fallback.

### Reuniões realizadas
`REUNIAO_STATUS_KEY` é detectado automaticamente em `detectReuniaoStatus()` — busca qual coluna da aba Reuniões contém valores como "concluido"/"realizada". Usar sempre `isRealizada(r)`, nunca comparar a coluna diretamente.

### Deduplicação de reuniões
`filteredReuniones()` deduplica por email (1 reunião por contato) — **exceto quando `tipo_reuniao` difere**: nesse caso a chave de dedup é `email|tipo_reuniao` (normalizado via `normVal()`), então o mesmo contato pode contar mais de uma vez se tiver reuniões de tipos diferentes. Sem a coluna Tipo de Reunião (`TIPO_IN_REUNIOES === false`), o comportamento permanece dedup só por email. Não afeta `emailsTipoRealizadas()` nem `renderReunioes()`, que já derivam direto de `RAW.reunioes` sem passar por esse dedup.

### Filtro Closer/SDR — assimetria intencional entre Leads e Reuniões
`passGlobal()` (base de `filteredLeads()`/`filteredReuniones()`) **não** filtra por Closer/SDR — esses dois são aplicados separadamente, de forma assimétrica:
- **SDR filtra desde os Leads**: `filteredLeads()` aplica `SEL.sdrResponsavel` diretamente (SDR já é atribuído na etapa de agendamento).
- **Closer só filtra a partir de Reuniões**: `passCloserSdrReuniao(row)` (Closer + SDR) é aplicado em `filteredReuniones()`, `renderReunioes()` e `emailsTipoRealizadas()` — nunca em `filteredLeads()`, porque Closer só é atribuído na fase de reunião; filtrar Leads por Closer zeraria a contagem de leads que ainda não passaram por essa etapa.
- `passGlobalVendas()`/`passGlobalNegociacao()` continuam com os próprios checks de Closer/SDR (Vendas/Negociação sempre têm Closer atribuído).

### Origem Base vs Origem Suno
`isOrigemBase(row)` retorna `true` quando `fonte_original_pipe` é `'prospeccao consultor'` (comparação normalizada, sem acentos).
MGM entra em **Origem Suno** (não é Origem Base).

### Aba Vendas tem campo `funil` próprio
A aba Vendas da planilha possui coluna `funil` diretamente — não fazer join por email com leads para obter o funil. `passGlobalVendas` filtra por `row.funil` e `buildDataContext()` usa `row.funil` no cross-tab mensal. Nunca usar email-join para derivar funil nas vendas; os números ficam incorretos.

### Filtro "Tipo de Reunião" — coluna só existe em Reuniões
A coluna real é `Tipo de chamada e reunião` (alias canônico `tipo_reuniao`), presente **só na aba Reuniões**. Detecção defensiva via `TIPO_IN_REUNIOES` (algum valor não vazio) e `TIPO_REUNIAO_TOTAL` (nº de tipos distintos).
- **Leads nunca são filtrados por tipo** (a coluna não existe lá).
- **Reuniões filtram direto**: `passTipoReuniao(row)`, aplicado dentro de `filteredReuniones()` antes do dedup por e-mail.
- **Vendas filtram por cruzamento de e-mail**, via `emailsTipoRealizadas()`: pega e-mails de reuniões REALIZADAS do(s) tipo(s) selecionado(s) direto de `RAW.reunioes`, **sem usar `filteredReuniones()`** (o dedup-por-e-mail desse último mantém a primeira linha por contato, que pode não ser a realizada — derivar de `RAW.reunioes` direto evita esse falso-negativo).
- **"Todos" selecionado ⇒ sem restrição**: a condição é `SEL.tipoReuniao.size > 0 && SEL.tipoReuniao.size < TIPO_REUNIAO_TOTAL`, não só `> 0` — senão selecionar todos os tipos ativaria o cruzamento e mostraria *menos* vendas que com o filtro vazio.
- `emailsTipoRealizadas()` é reaproveitado por `filteredVendas()` e `filteredNegociacao()` (aba Forecast).

### Aba Reuniões — gráfico usa volume bruto, sem dedup
`renderReunioes()` usa `RAW.reunioes.filter(passGlobal).filter(passTipoReuniao)` diretamente, **sem** o dedup-por-e-mail de `filteredReuniones()` — o objetivo é mostrar o volume real de atividades (uma reunião remarcada 3x conta 3x), diferente da contagem "1 por contato" usada no Funil/Diária. Eixo X é `data_atividade` (coluna `Data da atividade`), não `data_criacao`.

### Patrimônio (faixas) — ordenação fixa, não por contagem
A coluna `Patrimônio Investido - Grupo` (alias `patrimonio_investido_grupo`) tem valores em **faixas de texto** (ex: `"Entre R$ 300.000 a R$ 1.000.000"`), não números — não dá para ordenar alfabeticamente nem por contagem. A constante `PATRIMONIO_ORDER` fixa a ordem crescente correta; usar `orderLeadGroups()` (tabela/gráfico de Leads) ou `orderPivotChildren()` (Pivot) para essa dimensão, nunca um `.sort()` genérico.

### Tabela Dinâmica — ordenação por clique no header
Colunas numéricas do header (`.pv-sort`, `data-sort` = `L`/`LM`/`M`/`MR`/`R`/`RV`/`V`/`LV`) são clicáveis: `STATE.pivotSortCol`/`STATE.pivotSortDir` guardam a coluna/direção ativa, alternando asc/desc a cada clique na mesma coluna (nova coluna sempre começa em `desc`). `orderPivotChildren()` usa o mapa `PIVOT_SORT_COLS` para essa ordenação, mas **preserva a prioridade das ordenações especiais** de `patrimonio_investido_grupo` (faixas fixas) e `__data__` (cronológica) — essas duas dimensões não são reordenáveis por clique. Clique dispara `renderPivot()` completo (não só `renderPivotTable()`) para atualizar a seta ▲/▼ no header.

### Aba Forecast — base `Negociação`, sem `data_venda`
A base `Negociação` é estruturalmente parecida com Vendas mas **sem coluna de contratação** (o negócio ainda não foi fechado) — por isso `filteredNegociacao()`/`passGlobalNegociacao()` usam só `data_criacao`, sem o equivalente a `applyVendaDate`. Os fatores de conversão por Prioridade (`STATE.forecastFactors`, default 60/25/5%) são editáveis via input numérico e recalculam só a projeção (`computeAndRenderForecast()`), sem rebuildar os chips de Etapa do Negócio. O filtro de Etapa (`STATE.forecastEtapa`, chips em `forecast-etapa-chips`) usa `data-idx` apontando para o array `FORECAST_ETAPAS` — **não** embute a string da etapa num atributo `data-*` — para evitar bugs de mismatch de string/encoding entre o que é renderizado e o que é lido no clique.

## Email Diário Automático

Cron via GitHub Actions com 3 tentativas (`43 8,10,12 * * *` UTC = 05:43/07:43/09:43 BRT), pois o agendamento `schedule` do GitHub Actions tem atraso variável (~1h30 a 7h+, observado). A primeira tentativa mira entrega por volta das 09h BRT — não é uma garantia exata. Um job `guard` consulta a API de Actions e pula as tentativas seguintes se uma anterior já enviou o e-mail de hoje com sucesso, evitando duplicidade. Script em `scripts/daily-email.js`.

**Arquitetura:**
```
GitHub Actions → scripts/daily-email.js
  ├── fetchSheets()        — lê as 5 abas do Google Sheets via PapaParse (Node)
  ├── aggregateYesterday() — filtra pelo dia anterior, agrega métricas
  ├── generateAnalysis()   — Claude Haiku gera análise (fetch direto, sem SDK)
  └── sendEmail()          — SendGrid API v3 (fetch direto, sem SDK)
```

**Secrets no GitHub** (nunca hardcoded):
- `ANTHROPIC_KEY` — mesma usada no Vercel
- `SENDGRID_API_KEY` — permissão Mail Send
- `EMAIL_FROM` — remetente verificado no SendGrid
- `EMAIL_RECIPIENTS` — lista separada por vírgula

**Testar manualmente:** Actions → Daily Commercial Summary → Run workflow → campo `yesterday_override: YYYY-MM-DD`

**Dependências:** apenas `papaparse` npm (em `scripts/package.json`). Anthropic e SendGrid via `fetch` nativo do Node 24.

**Quirks:**
- `YESTERDAY_OVERRIDE` env var permite sobrescrever a data para testes
- Utilities (`normalizeKey`, `COL_ALIASES`, `parseDate`, `parsePatrimonio`, etc.) são portadas de `index.html` — manter em sincronia se houver mudanças críticas
- Erro no Anthropic → email enviado sem seção de análise (não bloqueia)
- Erro no SendGrid → `process.exit(1)` (Actions marca o job como falha)

## Aba Pergunte à IA

- Chamada via proxy Vercel `api/ask.js` — evita CORS browser → Anthropic
- Modelo: `claude-haiku-4-5-20251001`; max_tokens: 1500
- **API key em variável de ambiente Vercel** (`ANTHROPIC_KEY`) — **nunca hardcoded** no código ou git (Anthropic revoga automaticamente chaves expostas em repos públicos)
- `AI_CHAT[]` mantém histórico multi-turn; limpo pelo botão "✕ Limpar conversa"
- `buildDataContext()` envia ao modelo: totais por dimensão + cross-tabs mensais e diários (leads, reuniões, vendas) — **não envia linhas brutas** para evitar 413 no Vercel
- `submitAI()` tem guard: se `RAW.leads`, `RAW.reunioes` e `RAW.vendas` estiverem todos vazios, exibe aviso "dados carregando" sem chamar a API
- `renderMarkdown()` converte markdown da IA para HTML nas bolhas do chat
- System prompt inclui: data de hoje/ontem via JS, contexto Suno (ICP, funis, regras), instrução de resposta direta

## Multi-select dropdowns

O painel permanece aberto ao selecionar opções — isso é intencional. Implementado com `panel.addEventListener('click', e => e.stopPropagation())`. Não remover.

## Painel de debug

Clicar no ícone 🔧 no header mostra diagnóstico: formato de data detectado (leads e vendas separados), amostra de datas parseadas, coluna de reunião detectada, totais de patrimônio. Usar para diagnosticar problemas de parsing antes de alterar código.

## Autenticação

Credenciais hardcoded em `USERS` (~linha 685). Sessão via `sessionStorage` (chave `suno_dash_auth`). Limitação conhecida e aceita para uso interno.

## Design system

- Cor primária: `#C82526` (vermelho Suno), variável CSS `--red`
- Fundo: `#F5F7FA`, cards brancos com borda `#E8E8E8`
- Sidebar: 220px, sticky abaixo do header
- Responsivo: media query `max-width: 900px` → 2 colunas nos metric cards
