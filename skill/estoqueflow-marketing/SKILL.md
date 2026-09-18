---
name: estoqueflow-marketing
description: Marketing do EstoqueFlow, SaaS brasileiro de estoque multi-depósito (transferência atômica com custo médio, PDV, inventário cíclico, curva ABC, multi-empresa). Use sempre que o assunto for marketing de SaaS de estoque ou logística - posicionamento, ICP, personas, messaging, tagline, pitch, copy, headline, landing page, CTA, calendário editorial, pauta, blog, SEO, LinkedIn, Instagram, WhatsApp, newsletter, e-mail marketing, sequência de onboarding, reengajamento, funil, TOFU/MOFU/BOFU, lead, MQL, campanha, anúncio, Google Ads, Meta Ads, CAC, LTV, payback, churn, MRR, NRR, ativação, precificação SaaS, lançamento, beta, lista de espera, kit de imprensa, demo, release notes, case de cliente, indicação, retenção, expansão. Também em inglês - inventory SaaS go-to-market, positioning, landing page copy, email onboarding, funnel, paid ads, SaaS pricing, retention playbook. Acione mesmo sem a palavra "marketing" - pedidos como "escreve um post" ou "monta a página" sobre o EstoqueFlow entram aqui.
---

# Marketing do EstoqueFlow

Skill operacional para conduzir o marketing do EstoqueFlow do pré-lançamento à expansão de base.
Ela existe para que qualquer entrega de marketing saia consistente com o posicionamento do produto,
em PT-BR, com copy real e verificável — não genérica.

## O produto em uma tela (base factual — não invente além disso)

EstoqueFlow é um SaaS brasileiro de controle de estoque **multi-depósito**, para times de logística.

- Cadastro de produtos com código de barras
- Entrada, saída, **transferência entre depósitos** e ajuste
- Venda balcão (PDV)
- Inventário cíclico com apuração de divergências
- Relatórios: valor em estoque por depósito, produtos abaixo do mínimo, curva ABC, giro e cobertura em dias
- Multi-empresa (multi-tenant)
- Tutorial guiado no primeiro login
- Redundância dos dados em planilha Google Sheets espelho, somente-leitura
- Stack: Node/Fastify + Postgres + React, deploy em Railway

**Diferencial central (o eixo de toda a comunicação):** a plataforma é a responsável pela gestão
de estoque **entre dois depósitos** — transferência atômica, com o custo médio viajando junto com
a mercadoria. Nenhuma peça de copy deve terminar sem que esse eixo apareça, direta ou indiretamente.

**Público:** gestores de logística, donos de distribuidoras, e-commerces com CD + loja, pequenas
indústrias. Mercado: Brasil, PT-BR.

## Regras inegociáveis de qualidade

1. **Prova antes de promessa.** Toda afirmação de benefício vem acompanhada do mecanismo do produto
   que a sustenta ("transferência atômica" antes de "nunca mais perca mercadoria em trânsito").
2. **Sem número inventado.** Não cite estatística de mercado, participação ou pesquisa externa como
   fato. Benchmarks só entram rotulados: *"faixa de referência do setor — valide com seus próprios dados"*.
   Números do próprio cliente só entram se ele tiver fornecido; caso contrário, deixe o campo marcado
   como `[dado do cliente: ...]` com instrução explícita de onde buscar.
3. **PT-BR direto, sem jargão.** Nada de "solução inovadora", "revolucionar", "game changer",
   "potencializar". Escreva como um gerente de logística fala com outro.
4. **Nunca prometa o que o produto não faz.** Não há integração fiscal, WMS de endereçamento,
   roteirização, coletor próprio ou app mobile nativo declarados. Se o pedido exigir isso, sinalize
   como lacuna de produto em vez de escrever copy falsa.
5. **Toda entrega termina com métrica.** Diga o que medir e onde medir aquilo que foi produzido.

## As 6 fases do ciclo

Descubra em qual fase o pedido cai e leia **apenas** o arquivo correspondente. Não carregue tudo.

| Fase | Quando | Leia |
|---|---|---|
| 1. Posicionamento | ICP, personas, dor, concorrência, messaging, tagline, pitch, pricing | `references/01-posicionamento.md` |
| 2. Conteúdo e canais | pauta, calendário, blog/SEO, LinkedIn, Instagram, YouTube, WhatsApp, tom de voz | `references/02-conteudo-e-canais.md` |
| 3. Lançamento | beta, waitlist, landing page, demo, press kit, ondas de lançamento | `references/03-lancamento.md` |
| 4. Aquisição e funil | e-mails, sequências, anúncios, CAC/LTV, TOFU/MOFU/BOFU | `references/04-aquisicao-e-funil.md` |
| 5. Métricas | north star, dicionário de métricas, relatórios, instrumentação de eventos | `references/05-metricas.md` |
| 6. Retenção e expansão | onboarding assistido, health score, upsell, indicação, case de cliente | `references/06-retencao-e-expansao.md` |

Pedidos amplos ("monta o go-to-market") tocam várias fases: leia 01 primeiro (tudo se apoia nele),
depois só as fases que o entregável realmente exige.

## Fluxo de trabalho padrão

Siga esta sequência em qualquer pedido. Ela evita a entrega genérica.

**1. Enquadre o pedido.** Identifique fase, entregável e canal. Se o usuário pediu algo vago
("preciso divulgar o EstoqueFlow"), pergunte no máximo duas coisas: qual fase do produto (pré-lançamento,
lançamento, base ativa) e qual persona é o alvo. Não faça questionário longo — assuma o padrão
(Gestor de Logística, base ativa pequena) e diga a suposição que fez.

**2. Ancore na persona.** Abra `references/01-posicionamento.md` e escolha UMA persona por peça.
Copy que fala com três personas ao mesmo tempo não fala com ninguém. Registre no início da entrega:
`Persona: Gestor de Logística | Estágio: MOFU | Canal: LinkedIn`.

**3. Escolha o ângulo.** Todo material do EstoqueFlow nasce de um destes cinco ângulos:
- **Trânsito entre depósitos** — a mercadoria que "some" entre CD e loja (ângulo principal)
- **Custo médio verdadeiro** — o valor em estoque que não bate porque o custo não viaja junto
- **Divergência de inventário** — contar o estoque sem parar a operação (inventário cíclico)
- **Decisão com dado** — curva ABC, giro, cobertura em dias, abaixo do mínimo
- **Planilha como rede de segurança** — o espelho em Google Sheets, para quem tem medo de sair do Excel

**4. Escreva.** Use os templates em `assets/templates/` como esqueleto:
`landing-page.md`, `email-onboarding.md`, `post-linkedin.md`, `release-notes.md`.
Templates são ponto de partida — adapte, não preencha mecanicamente.

**5. Passe o checklist.** Antes de entregar, rode o checklist de publicação da seção final de
`references/02-conteudo-e-canais.md`.

**6. Feche com medição.** Diga qual métrica a peça move e como conferir (evento no app, UTM, coluna
no relatório semanal). O dicionário está em `references/05-metricas.md`.

## Ancoragem de linguagem

Termos que o público usa e que devem aparecer na copy: depósito, CD, filial, loja, transferência,
custo médio, saldo, ruptura, inventário, divergência, giro, cobertura, curva ABC, ponto de pedido,
estoque mínimo, PDV, balcão, romaneio, conferência.

Termos a evitar: "solução completa", "plataforma inovadora", "ecossistema", "sinergia",
"transformação digital", "otimizar processos", "empoderar", "unlock", "leverage".

Grafia: **EstoqueFlow** sempre em CamelCase, sem espaço, sem hífen. Nunca "Estoque Flow" ou "EstoqueFLOW".

## Padrão de saída

Entregue sempre em Markdown, pronto para copiar e colar no destino. Estrutura:

```
Persona: <persona> | Estágio: <TOFU/MOFU/BOFU/retenção> | Canal: <canal> | Ângulo: <um dos cinco>

<a peça em si, texto final, sem comentários no meio>

---
Variações: <2 headlines/assuntos alternativos para teste A/B>
Medição: <métrica que a peça move + onde conferir>
```

Quando o pedido for um plano (calendário, funil, lançamento) em vez de uma peça, entregue tabela
com colunas de responsável, prazo e critério de pronto. Plano sem critério de pronto não é plano.

## Erros comuns a evitar

- **Vender "controle de estoque" genérico.** Existem dezenas. O EstoqueFlow vende o *trânsito entre
  depósitos*. Se a copy funcionaria para qualquer sistema de estoque, ela está errada.
- **Falar de tecnologia para o comprador.** Node, Fastify, Postgres e Railway não entram em copy de
  marketing — entram, no máximo, em página técnica ou material para investidor.
- **Prometer implantação instantânea.** Migração de saldo e custo médio dá trabalho; a promessa
  honesta é "primeira transferência real no primeiro dia", não "estoque inteiro migrado em 5 minutos".
- **Tratar o espelho no Google Sheets como funcionalidade menor.** Para o público que veio da
  planilha, é o argumento que derruba a objeção de risco. Use como redutor de atrito, não como enfeite.
- **Escrever para "empresas".** Escreva para uma pessoa com um problema na terça-feira de manhã.

## Quando o pedido sair do escopo

Se pedirem algo que a skill não cobre (identidade visual, script de vendas outbound, contrato,
política de descontos, material jurídico), diga isso e ofereça o mais próximo que existe aqui.
Não improvise plano de mídia com verba que o usuário não informou — pergunte a verba antes.
