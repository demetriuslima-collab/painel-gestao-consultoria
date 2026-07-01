# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estrutura do projeto

Arquivo único: `index.html` (~2.900 linhas). Sem build, sem framework, sem backend. **Nunca criar arquivos separados de CSS/JS** — todo o código vive no `index.html`.

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

Lê **6 abas** via endpoint CSV do Google Sheets: `Leads`, `Reuniões`, `Vendas`, `Meta Captação`, `Meta Leads` (as 5 obrigatórias, carregadas em `Promise.all`) e **`Negociação`** (base do Forecast, carregada de forma **defensiva** com `try/catch` próprio — se a aba não existir, o painel segue sem ela). A planilha precisa estar compartilhada como "qualquer pessoa com o link". O parâmetro `&_t=Date.now()` no `sheetURL` evita cache HTTP do browser.

`RAW = { leads, reunioes, vendas, metaCaptacao, metaLeads, negociacao }`.

## Arquitetura do código (seções do script)

Números de linha mudam a cada edição — **buscar pelo nome da função**. Ordem no arquivo:

- **AUTH** — `USERS`, `setupLogin()`, `logout()`
- **CONFIG** — `SHEET_ID`, `sheetURL`, `PALETTE`, `FUNNEL_CLR`
- **RUNTIME STATE** — `RAW` (6 bases), `SEL` (filtros globais multi-select), `F` (datas), `STATE` (aba ativa, sub-views, toggles de tempo, `forecastFactors`, `forecastEtapa`, `pivotDims/pivotSort/…`)
- **Flags auto-detectadas** — `DATE_FMT`, `VENDA_DATE_FMT`, `META_DATE_FMT`, `REUNIAO_STATUS_KEY`, `SDR_IN_LEADS`, `SDR_IN_REUNIOES`, `CLOSER_IN_REUNIOES`, `TIPO_IN_REUNIOES`, `TIPO_REUNIAO_TOTAL`
- **UTILITIES** — `normalizeKey`, `COL_ALIASES`, `normalizeRow`, `parseDate`, `parseNum`, `parsePatrimonio`, `monthKey/monthLabel`
- **DATA LOADING** — `fetchSheet`, `loadData` (6ª aba `Negociação` defensiva)
- **DETECÇÃO** — `detectDateFormat` (DATE/VENDA/META), `detectReuniaoStatus`, `detectSdrCloserColumns`
- **FILTERING** — `passGlobal` (leads/reuniões), `passSdrCloser` (SDR/Closer/Tipo, defensivo), `passGlobalVendas`, `passGlobalNegociacao`, `emailsTipoRealizadas`, `filteredLeads/Reuniones/Vendas/Negociacao`
- **MULTI-SELECT** — `MS_CFG`, `buildAllMS`, `populateAllFilters`
- **RENDER DISPATCH** — `render()` → funil / leads / vendas / cohort / reunioes / forecast / pivot / ia
- **FUNIL** — `renderFunil` (dispatcher Geral/Comparativo), `renderFunilGeral`, `renderFunilComparativo`
- **DIÁRIA DE LEADS** — `PATRIMONIO_ORDER`, `orderLeadGroups`, `renderLeads/Table/Chart`
- **DIÁRIA DE VENDAS** — `renderVendas` (dispatcher), `renderVendasCaptacao/Origem/Breakdown`, `renderVendasChart/BreakdownChart`, `VENDAS_BREAKDOWNS`
- **REUNIÕES** — `renderReunioes` (eixo `data_da_atividade`; dedup por email+tipo)
- **FORECAST** — `FORECAST_PRIOS`, `prioKey`, `renderForecast/computeAndRenderForecast/renderForecastEtapaChips`
- **COHORT** — `renderCohort`
- **CHART HELPERS** — `buildDayAxis`, `buildTimeAxis` (dia/semana/mês), `chartOpts`, `destroyChart`
- **TABELA DINÂMICA (pivot)** — `PIVOT_DIMS`, `PIVOT_DIM_SEL_KEY`, `PIVOT_SORT_VAL`, `buildPivotTree`, `orderPivotChildren`, `renderPivot/renderPivotArea/renderPivotRows`, `togglePivotDim`
- **EVENT LISTENERS + INIT** — `bindEvents`, `init`, `refreshData`
- **IA CHAT** — `buildDataContext`, `renderMarkdown`, `appendChatMsg`, `submitAI`, `clearAIChat`

## Quirks críticos de dados

### Normalização de colunas
`normalizeRow()` aplica `normalizeKey()` (lowercase, sem acentos, underscores) em cada chave, depois mapeia para chaves canônicas via `COL_ALIASES`. Ao adicionar suporte a uma nova coluna da planilha, adicionar o alias no objeto `COL_ALIASES`.

### Detecção de formato de data
Bases diferentes vêm em formatos diferentes (o Google Sheets exporta MDY em algumas, e as abas de Metas são preenchidas manualmente em DMY). Por isso há **três detectores independentes** (em `detectDateFormat`, heurística: dígito `>12` desambigua):
- `DATE_FMT` — detectado de leads/reuniões (MDY nesta planilha)
- `VENDA_DATE_FMT` — específico da coluna `data_venda`
- `META_DATE_FMT` — específico da coluna `data` das abas de Metas (**DMY**; fallback DMY)

Sempre passar o formato certo no `parseDate`: `parseDate(row.data_venda, VENDA_DATE_FMT)` e `parseDate(m.data, META_DATE_FMT)`. ⚠️ Esquecer o `META_DATE_FMT` faz as metas caírem no mês errado (bug já corrigido — a linha de meta e a "meta até a data" dependem disso). `data_da_atividade` (Reuniões) vem em `YYYY-MM-DD HH:MM`, sem ambiguidade.

### Patrimônio validado
Usar sempre `parsePatrimonio()`, nunca `parseNum()` direto:
```js
parsePatrimonio(v.adv_patrimonio_validado || v.patrimonio_validado)
```
`parsePatrimonio` multiplica por 1.000 valores < 10.000 (alguns registros estão abreviados, ex: `600` = R$ 600.000).

A coluna canônica é `adv_patrimonio_validado` (de `[ADV] Patrimônio validado` na planilha). O alias `patrimonio_validado` é fallback.

### Reuniões realizadas
`REUNIAO_STATUS_KEY` é detectado automaticamente em `detectReuniaoStatus()` — busca qual coluna da aba Reuniões contém valores como "concluido"/"realizada". Usar sempre `isRealizada(r)`, nunca comparar a coluna diretamente.

### Deduplicação de reuniões (dois modos, intencionais)
- **Funil / demais views** (`filteredReuniones()`): deduplica por **email** (1 reunião por contato). Consequência: ao filtrar por Tipo de Reunião, um contato com reuniões de tipos diferentes é contado só uma vez (absorvido) — não é bug.
- **Aba Reuniões** (`renderReunioes`): deduplica por **email + tipo** (conta o mesmo contato de novo quando o tipo de chamada/reunião difere). Não usa `filteredReuniones` (que dedupla só por email).

### Origem Base vs Origem Suno
`isOrigemBase(row)` retorna `true` quando `fonte_original_pipe` é `'prospeccao consultor'` (comparação normalizada, sem acentos).
MGM entra em **Origem Suno** (não é Origem Base).

### Aba Vendas tem campo `funil` próprio
A aba Vendas da planilha possui coluna `funil` diretamente — não fazer join por email com leads para obter o funil. `passGlobalVendas` filtra por `row.funil` e `buildDataContext()` usa `row.funil` no cross-tab mensal. Nunca usar email-join para derivar funil nas vendas; os números ficam incorretos.

## Filtros

**Globais** (topo, valem em todas as abas) — multi-select via `SEL` + `MS_CFG`: Source, Estratégia, Funil, Patrimônio (`patrimonio_investido_grupo`), Fonte Orig., Canal Orig., Closer, SDR, Tipo de Reunião. Mais o range de data de **criação** (`F.di/F.df` sobre `data_criacao`).

**Detecção defensiva** (`detectSdrCloserColumns`): filtros de colunas que podem não existir em todas as bases só "ligam" onde a coluna existe (flags `*_IN_*`), sem quebrar antes de a coluna ser adicionada. Regras (via `passSdrCloser` / `passGlobalVendas`):
- **SDR**: filtra leads + reuniões + vendas.
- **Closer**: filtra reuniões + vendas, **nunca leads** (regra de negócio — closer só atua da reunião em diante, mesmo que a coluna exista em leads). No Funil, ao filtrar closer os **Leads ficam cheios** e só marcadas/realizadas/vendas caem (intencional).
- **Tipo de Reunião** (`tipo_reuniao` = coluna "Tipo de chamada e reunião", só em Reuniões): filtra reuniões direto; **vendas por cruzamento de e-mail** (`emailsTipoRealizadas`) — só vendas cujo e-mail bate com reunião REALIZADA do(s) tipo(s). "Todos" selecionado = sem restrição (`size < TIPO_REUNIAO_TOTAL`). E-mails montados de `RAW.reunioes` **sem dedup**.

**Específicos de aba**: Diária de Vendas → range de data de **venda** (`F.vdi/F.vdf`); Forecast → **Etapa do negócio** (`STATE.forecastEtapa`, chips).

## Abas / Views

- **Funil**: sub-abas "Visão Geral" e "Comparativo por Período" (mês/semana por data de criação, tendência ▲/▼).
- **Diária de Leads**: metas + gráfico stacked; breakdown por Funil/Estratégia/Source/Fonte/Canal/**Patrimônio** (faixas em ordem monetária); toggle Diário/Mensal.
- **Diária de Vendas**: sub-views Metas Captação / Origem (Suno claro, Base escuro) / breakdowns (Source/Funil/Estratégia/Fonte/Closer); toggle Diário/Mensal.
- **Reuniões**: volume por `data_da_atividade`; toggle Dia/Semana/Mês; empilhamento por 7 parâmetros; dedup email+tipo.
- **Cohort (Safra)**: conversão por mês de criação.
- **Tabela Dinâmica (pivot)**: funil L→M→R→V por parâmetros hierárquicos (drilldown), data mês/semana/dia. Cabeçalho **ordenável por clique** (desc↔asc, `PIVOT_SORT_VAL`). Filtro global restringe a dimensão correspondente (`PIVOT_DIM_SEL_KEY`).
- **Forecast**: projeção de `RAW.negociacao` — conta clientes e soma patrimônio por **Prioridade** (Alta/Média/Baixa) × **fatores editáveis** (`STATE.forecastFactors`, padrão 60/25/5%). Duas tabelas (qtd e patrimônio) + cards. Prioridade fora do padrão → "(Sem prioridade)" com fator 0.

**Toggles de tempo dos gráficos**: `buildTimeAxis(dates, di, df, mode)` — `'dia'` (cap 180d), `'semana'` (segunda a domingo, cap 53), `'mes'` (cap 24m). Linha de Meta somada por bucket.

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

Credenciais hardcoded em `USERS` (~linha 416). Sessão via `sessionStorage` (chave `suno_dash_auth`). Limitação conhecida e aceita para uso interno.

## Design system

- Cor primária: `#C82526` (vermelho Suno), variável CSS `--red`
- Fundo: `#F5F7FA`, cards brancos com borda `#E8E8E8`
- Sidebar: 220px, sticky abaixo do header
- Responsivo: media query `max-width: 900px` → 2 colunas nos metric cards
