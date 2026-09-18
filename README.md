<div align="center">

# EstoqueFlow

**SaaS de controle de estoque multi-depósito para times de logística.**
Entrada · Saída · Transferência entre depósitos · Venda balcão (PDV) · Inventário cíclico

Aplicação no ar → **https://estoqueflow-production.up.railway.app**
`demo@estoqueflow.app` / `estoque2026`

</div>

---

## O que esta plataforma é

**A plataforma é a responsável pela gestão de estoque entre os dois depósitos da operação.**
Nada de saldo solto: todo número no sistema é sempre `produto × depósito`, e toda mudança de
saldo nasce de um **movimento** com autor, data, motivo e documento. A transferência entre
depósitos é atômica — a baixa na origem e a entrada no destino acontecem na mesma transação,
levando junto o custo médio da mercadoria.

Ao logar pela primeira vez o usuário recebe um **tutorial de 11 passos servido pelo próprio
sistema**, que aponta cada tela e cada formulário na ordem em que precisam ser usados.

---

## Como o estoque é identificado

**Não há etiqueta nem código impresso nas mercadorias.** O produto é encontrado pela
**descrição** — a busca aceita palavras soltas, em qualquer ordem, e casa também com
tamanho, unidade e código interno. O `SKU` continua existindo como chave técnica (gerado
automaticamente quando não informado) e o código de barras é só um atalho opcional para
quem tiver leitor. Nenhum dos dois é obrigatório em nenhum fluxo.

---

## Menu

A navegação foi enxugada para a operação de logística — o balcão vem primeiro:

```
Saída Balcão                     ← tela inicial depois do login (PDV)
Entrada de Estoque
Saída de Estoque
Transferência entre Depósitos
Movimentação de Estoque          ← histórico completo

▾ Cadastros e gestão             ← grupo recolhido
   Painel · Produtos · Depósitos · Inventário · Relatórios · Integrações · Equipe
```

---

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Produtos** | Descrição, **unidade**, **tamanho/bitola**, **metragem**, custo, preço, estoque mínimo, categoria, fornecedor. Código interno e código de barras são **opcionais** — o sistema gera o código sozinho. |
| **Busca de balcão** | O operador digita qualquer palavra ("tubo 20 marrom") e escolhe na lista, já com o saldo de cada depósito. Quem tiver leitor pode bipar no mesmo campo. |
| **Depósitos** | Nascem dois: **DEP-1 · Depósito 1 · Superior** e **DEP-2 · Depósito 2 · Inferior**. Saldo, valor e alertas por unidade. |
| **Entrada** | Compra/devolução/produção. Recalcula o **custo médio ponderado** do depósito. |
| **Saída** | Consumo, perda, devolução. **Bloqueia saldo negativo** antes de gravar. |
| **Transferência** | Origem → destino em transação única. O custo médio viaja com a mercadoria. |
| **Ajuste** | Define o saldo real contado; gera movimento de acerto rastreável. |
| **Estorno** | Desfaz qualquer movimento gerando o lançamento inverso (nunca apaga histórico). |
| **PDV · Venda balcão** | Leitor de código de barras, desconto, forma de pagamento, troco, cupom, cancelamento com devolução ao estoque. |
| **Inventário cíclico** | Abre contagem por depósito, bipa produtos, apura divergências com impacto financeiro e aplica os ajustes. |
| **Relatórios** | Posição por depósito, abaixo do mínimo, curva ABC, giro e cobertura em dias. Exportação CSV. |
| **Multi-empresa** | Isolamento total por `company_id` — pronto para vender como SaaS. |
| **Papéis** | OWNER, ADMIN, ESTOQUISTA, VENDEDOR, LEITURA. |
| **Tutorial** | Onboarding guiado no primeiro login, refazível a qualquer momento. |
| **Redundância Sheets** | Réplica de tudo numa planilha espelho **somente-leitura**. |
| **Auditoria** | `movements` + `audit_logs` guardam a trilha completa. |

---

## Stack

```
React 18 + Vite + TypeScript + Tailwind        ← frontend (design system próprio)
Fastify 5 + TypeScript + Zod                   ← API
Prisma 5 + PostgreSQL 16                       ← banco (schema versionado em migrations)
googleapis                                     ← replicação para o Google Sheets
Docker (multi-stage) → Railway                 ← deploy
```

Um único serviço serve a API **e** o frontend compilado — o build do Vite é servido
estaticamente pelo Fastify, com fallback de SPA.

---

## Como rodar localmente

```bash
git clone <este-repo> && cd estoqueflow
cp .env.example .env          # ajuste DATABASE_URL e JWT_SECRET

npm install
npx prisma migrate deploy     # cria o schema
node prisma/seed.mjs          # empresa demo + 2 depósitos + 12 produtos

npm run dev                   # API :8080  ·  Web :5173
```

Produção local:

```bash
npm run build && npm start
```

### Testes

```bash
BASE=http://localhost:8080 node scripts/smoke.mjs
```

26 testes end-to-end cobrindo login, catálogo, os quatro tipos de movimento, bloqueio de
saldo negativo, PDV, cancelamento, inventário completo, relatórios, autorização e isolamento
multi-tenant.

---

## Deploy no Railway

O repositório já vem pronto: `Dockerfile`, `railway.json`, `nixpacks.toml` e o entrypoint
`scripts/entrypoint.sh` (aplica as migrations e sobe a API, publicando um diagnóstico de boot
caso algo falhe).

**Automático, de ponta a ponta:**

```bash
RAILWAY_TOKEN=<seu-token> \
GOOGLE_SHEET_ID=<id-da-planilha> \
node scripts/railway-deploy.mjs
```

O script cria o projeto, provisiona o Postgres com volume persistente, cria o serviço da
aplicação, publica as variáveis, envia o código e gera o domínio público.

**Manual:** conecte o repositório no Railway, adicione o plugin Postgres e defina as
variáveis do `.env.example`. O `railway.json` cuida do resto.

> ⚠️ Dois detalhes que custam horas se passarem despercebidos no Railway:
> 1. `deploy.startCommand` do `railway.json` **sobrescreve o `CMD` do Dockerfile`.
> 2. A rede privada é **IPv6**. A aplicação escuta em `::` (dual-stack) com fallback
>    automático para `0.0.0.0` — veja `listenResilient()` em `apps/api/src/server.ts`.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|:--:|---|
| `DATABASE_URL` | ✅ | String de conexão do Postgres |
| `JWT_SECRET` | ✅ | Segredo dos tokens (mín. 16 caracteres) |
| `PORT` / `HOST` | — | Padrão `8080` / `::` |
| `CORS_ORIGIN` | — | `*` ou lista separada por vírgula |
| `GOOGLE_SHEET_ID` | — | ID da planilha espelho |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | JSON da Service Account (uma linha) |
| `SHEET_SYNC_ENABLED` | — | `true` / `false` |
| `SEED_DEMO` | — | Cria a empresa demo no primeiro boot |

---

## Redundância em Google Sheets

**Regra de ouro: o Postgres é a fonte da verdade; a planilha é espelho.**

```
Postgres ──► sync_outbox ──► worker (30s) ──► Google Sheets
    ▲                                              │
    └──────── guardião (5min) ─── compara ─────────┘
              e reverte edições feitas à mão
```

- Toda gravação enfileira um evento em `sync_outbox` dentro da mesma transação do movimento.
- O worker envia em lote para as abas `Produtos`, `Estoque`, `Movimentacoes` e `Vendas`.
- O **guardião** relê a planilha, compara linha a linha com o banco e **reescreve qualquer
  célula alterada manualmente**, registrando o antes/depois em `sheet_guard_logs`.
- Compartilhe a planilha como **Leitor** para a equipe: só a Service Account escreve.

Passo a passo de configuração em [`docs/GOOGLE-SHEETS.md`](docs/GOOGLE-SHEETS.md).

---

## Modelo de dados

```
companies ─┬─ users            (papéis, progresso do tutorial)
           ├─ warehouses ──┐
           ├─ products ────┼─ stock_items      (saldo + custo médio por depósito)
           │               └─ movements        (ENTRADA/SAIDA/TRANSFERENCIA/AJUSTE/VENDA/ESTORNO)
           ├─ sales ── sale_items
           ├─ inventory_counts ── inventory_count_items
           ├─ sync_outbox / sheet_guard_logs   (replicação e guardião)
           ├─ audit_logs
           └─ counters                          (numeração sequencial por empresa)
```

Schema completo, comentado, em [`prisma/schema.prisma`](prisma/schema.prisma).

---

## API

Base: `/api` · autenticação `Authorization: Bearer <token>`

```
POST   /auth/register              cria empresa + OWNER + 2 depósitos
POST   /auth/login                 autentica
GET    /auth/me                    sessão atual
PATCH  /auth/me/tutorial           avança/conclui o onboarding
GET    /tutorial                   passos + checklist real do progresso

GET    /products                   lista/busca            POST /products
GET    /products/barcode/:code     leitura por código     POST /products/bulk
GET    /warehouses                 depósitos              POST /warehouses
GET    /stock                      posição consolidada

POST   /movements/entrada          entrada
POST   /movements/saida            saída
POST   /movements/transferencia    transferência entre depósitos
POST   /movements/ajuste           ajuste de saldo
POST   /movements/:id/estorno      estorno
GET    /movements                  histórico com filtros

POST   /sales                      venda balcão
POST   /sales/:id/cancel           cancela e devolve ao estoque

POST   /counts                     abre contagem
PATCH  /counts/:id/items           lança quantidade contada
POST   /counts/:id/apurar          apura divergências
POST   /counts/:id/aplicar         aplica os ajustes

GET    /reports/dashboard          KPIs do painel
GET    /reports/abc                curva ABC
GET    /reports/giro               giro e cobertura
GET    /reports/kardex/:productId  extrato do produto
GET    /reports/export/:tipo       CSV

GET    /sync/status                estado da planilha espelho
POST   /sync/run | /sync/guard | /sync/full
```

---

## Estrutura

```
estoqueflow/
├── prisma/               schema, migrations e seed
├── apps/
│   ├── api/src/
│   │   ├── routes/       auth · catalog · stock · sales · counts · reports · tutorial
│   │   ├── services/     stock · sales · reports · sync (Google Sheets)
│   │   └── lib/          prisma · auth · errors
│   └── web/src/
│       ├── pages/        Login · Dashboard · Produtos · Depósitos · Movimentar · PDV ·
│       │                 Inventário · Relatórios · Integrações · Equipe
│       ├── components/   Shell · Tour (tutorial guiado)
│       └── lib/          api · ui (design system)
├── scripts/              smoke · entrypoint · railway-deploy
├── skill/                skill de marketing que acompanha o produto
└── docs/
```

---

## Importar uma planilha de estoque existente

```bash
npm install                       # o importador usa a lib xlsx
DRY_RUN=1 node scripts/importar-estoque.mjs "ESTOQUE - 2023.xlsx"   # confere o mapeamento
node scripts/importar-estoque.mjs "ESTOQUE - 2023.xlsx"             # importa de verdade
```

O script acha sozinho a linha de cabeçalho e reconhece as colunas por sinônimos
(`código`, `descrição`, `un`, `qtd`, `custo`, `venda`, `mínimo`). Se a planilha tiver
colunas separadas por depósito — `SUPERIOR` e `INFERIOR` —, ele lança a entrada em cada
um; senão, joga tudo no depósito de `DEPOSITO=DEP-1`.

Cada linha vira uma **ENTRADA rastreável**, com motivo e documento: nada entra "por fora"
do sistema. Variáveis: `BASE`, `EMAIL`, `SENHA`, `ABA`, `DEPOSITO`, `DRY_RUN`.

---

## Skill de marketing

Junto do produto vai a skill **`estoqueflow-marketing`** (`skill/estoqueflow-marketing.skill`),
que cobre o ciclo completo: posicionamento e ICP, calendário editorial de 12 semanas, plano de
lançamento em 4 ondas, funil e sequências de e-mail, métricas com definição própria de
"usuário ativado", e playbook de retenção e expansão — com templates prontos de landing page,
onboarding, LinkedIn e release notes.

---

<div align="center">
<sub>iAgentics · Ronaldo Bueno · 2026</sub>
</div>
