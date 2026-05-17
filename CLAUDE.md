# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estrutura do projeto

Arquivo único: `index.html` (~1.961 linhas). Sem build, sem framework, sem backend. **Nunca criar arquivos separados de CSS/JS** — todo o código vive no `index.html`.

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

Lê **5 abas** via endpoint CSV do Google Sheets: `Leads`, `Reuniões`, `Vendas`, `Meta Captação`, `Meta Leads`. A planilha precisa estar compartilhada como "qualquer pessoa com o link". O parâmetro `&_t=Date.now()` no `sheetURL` evita cache HTTP do browser.

## Arquitetura do código (seções do script)

| Linha | Seção |
|-------|-------|
| ~413 | AUTH — array `USERS`, `setupLogin()`, `logout()` |
| ~460 | CONFIG — `SHEET_ID`, `sheetURL`, paletas de cores |
| ~470 | RUNTIME STATE — `RAW`, `SEL`, `F`, `STATE` |
| ~500 | UTILITIES — `normalizeKey`, `COL_ALIASES`, `normalizeRow`, `parseDate`, `parseNum`, `parsePatrimonio` |
| ~695 | DATA LOADING — `fetchSheet`, `loadData` |
| ~786 | FILTERING — `filteredLeads`, `filteredReuniones`, `filteredVendas` |
| ~854 | MULTI-SELECT COMPONENT — `buildAllMS` |
| ~940 | POPULATE FILTERS — `populateAllMS` |
| ~970 | RENDER DISPATCH — `render()` chama a seção ativa |
| ~1020 | FUNIL — cards de métricas + funil visual |
| ~1098 | DIÁRIA DE LEADS — tabela + gráfico stacked bar |
| ~1183 | DIÁRIA DE VENDAS — tabela Captação/Origem + gráfico |
| ~1270 | COHORT (SAFRA) — análise de conversão por mês de entrada |
| ~1438 | EVENT LISTENERS + INIT |
| ~1635 | IA CHAT — `buildDataContext`, `renderMarkdown`, `appendChatMsg`, `submitAI`, `clearAIChat` |

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
`filteredReuniones()` deduplica por email (1 reunião por contato). Comportamento intencional.

### Origem Base vs Origem Suno
`isOrigemBase(row)` retorna `true` quando `fonte_original_pipe` é `'prospeccao consultor'` (comparação normalizada, sem acentos).
MGM entra em **Origem Suno** (não é Origem Base).

### Aba Vendas tem campo `funil` próprio
A aba Vendas da planilha possui coluna `funil` diretamente — não fazer join por email com leads para obter o funil. `passGlobalVendas` filtra por `row.funil` e `buildDataContext()` usa `row.funil` no cross-tab mensal. Nunca usar email-join para derivar funil nas vendas; os números ficam incorretos.

## Email Diário Automático

Cron via GitHub Actions (`0 11 * * *` = 8h BRT). Script em `scripts/daily-email.js`.

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
