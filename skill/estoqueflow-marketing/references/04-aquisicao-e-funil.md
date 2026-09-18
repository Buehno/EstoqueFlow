# Fase 4 — Aquisição e Funil

Como o desconhecido vira lead, o lead vira teste e o teste vira cliente pagante.

## Índice
1. Mapa do funil TOFU / MOFU / BOFU
2. Sequência de onboarding — 7 e-mails
3. Sequência de reengajamento — 4 e-mails
4. Campanhas pagas — Google Search
5. Campanhas pagas — Meta
6. Estrutura de UTM
7. CAC, LTV e payback — fórmulas e leitura
8. Ritmo de otimização

---

## 1. Mapa do funil TOFU / MOFU / BOFU

| Estágio | Estado mental | Conteúdo | Canal | Conversão esperada | Métrica |
|---|---|---|---|---|---|
| **TOFU** | "Meu estoque não bate e eu não sei por quê" | Pautas 1, 3, 7, 9, 15, 17, 18, 27 | Blog/SEO, LinkedIn orgânico, Instagram, Shorts | Visitante → inscrito na lista | Sessões, inscritos, custo por inscrito |
| **MOFU** | "O problema é a transferência entre depósitos" | Comparativo planilha x sistema, checklist de inventário, modelo de romaneio, calculadora de valor parado | Newsletter, e-mail de nutrição, remarketing Meta | Inscrito → teste iniciado | Taxa de início de teste, MQL |
| **BOFU** | "Qual sistema eu escolho?" | Landing, página de preços, cases, demo de 7 min, FAQ de objeções | Google Search, e-mail de decisão, WhatsApp com opt-in | Teste → pagante | Conversão de teste, SQL, ciclo de venda |
| **Ativação** | "Isso funciona na minha operação" | Onboarding assistido, tutorial guiado, e-mails 1 a 7 | Produto + e-mail | Pagante → ativado | Taxa de ativação, TTV |

**Definição de MQL:** inscrito que declarou 2 ou mais depósitos **e** consumiu ao menos um material
MOFU (checklist, comparativo, calculadora) ou visitou a página de preços.

**Definição de SQL:** MQL que iniciou teste **e** cadastrou o segundo depósito. O segundo depósito é o
sinal mais forte do funil — sem ele, o produto não tem como provar valor.

**Regra de priorização:** contato sem segundo depósito não recebe esforço de venda humana. Recebe
conteúdo até declarar o segundo depósito ou sair. Isso protege o tempo do time comercial.

---

## 2. Sequência de onboarding — 7 e-mails

Dispara no cadastro do teste. Cada e-mail tem UMA ação. Se a ação já foi feita, o e-mail é pulado
(usar os eventos de `05-metricas.md` como condição de envio).

### E-mail 1 — Dia 0, imediato
**Assunto:** Comece pela transferência que mais te dá dor de cabeça
**Pré-cabeçalho:** Dois depósitos e um produto já bastam para o primeiro teste.
> Oi, [nome]. Sua conta do EstoqueFlow está de pé.
>
> Sugestão para os próximos 15 minutos: não tente cadastrar o estoque inteiro. Cadastre dois depósitos,
> uns 5 produtos e faça uma transferência de verdade entre eles.
>
> É nessa tela que você vai ver a diferença: a transferência é um movimento único e o custo médio vai
> junto com a mercadoria. Veja o custo no depósito de destino antes e depois — ele continua verdadeiro.
>
> O tutorial guiado abre sozinho no primeiro login e te leva por esse caminho.
>
> [Fazer minha primeira transferência]
**Ação:** login + primeira transferência.

### E-mail 2 — Dia 1
**Assunto:** Seu segundo depósito já está cadastrado?
> [nome], um aviso honesto: o EstoqueFlow só mostra do que é capaz com dois depósitos.
>
> Com um depósito só, ele é um controle de estoque comum. Com dois, ele vira o que você veio buscar:
> saldo e custo médio que continuam corretos nos dois lados depois da transferência.
>
> Leva dois minutos: Cadastros → Depósitos → Novo.
>
> [Cadastrar o segundo depósito]
**Ação:** criar segundo depósito. **Pular se:** já existem 2+ depósitos.

### E-mail 3 — Dia 3
**Assunto:** Parar de digitar código errado
> A maior parte da divergência de estoque nasce em digitação, não em furto.
>
> No EstoqueFlow você cadastra e movimenta por código de barras — na entrada, na saída, na
> transferência e na contagem. O produto certo entra no lugar certo.
>
> Se você ainda não tem leitor, o celular resolve para começar.
>
> [Ver como cadastrar com código de barras]
**Ação:** cadastrar/movimentar com código de barras.

### E-mail 4 — Dia 5
**Assunto:** Contar o estoque sem parar o depósito
> Inventário geral trava a operação e mesmo assim dá divergência. A alternativa é contar por partes.
>
> No EstoqueFlow, o inventário cíclico deixa você contar um grupo de produtos por vez e apura a
> divergência automaticamente — por produto e por depósito. Você descobre onde o número quebrou, não
> só que ele quebrou.
>
> Comece por 20 itens da sua curva A.
>
> [Abrir minha primeira contagem]
**Ação:** iniciar inventário cíclico.

### E-mail 5 — Dia 8
**Assunto:** Os quatro relatórios que você leva para a reunião
> [nome], quando os movimentos começam a entrar, estes quatro passam a valer ouro:
>
> 1. Valor em estoque por depósito — quanto de dinheiro está parado em cada lugar
> 2. Produtos abaixo do mínimo — o que vai romper antes de você perceber
> 3. Curva ABC — os poucos itens que respondem pela maior parte do valor
> 4. Giro e cobertura em dias — o que sai rápido e por quantos dias o estoque atual segura
>
> O quarto costuma ser o que muda a próxima compra.
>
> [Ver meus relatórios]
**Ação:** abrir ao menos dois relatórios.

### E-mail 6 — Dia 12
**Assunto:** Seu estoque também vive numa planilha (só que atualizada)
> Sair da planilha assusta — e não precisa ser um salto no escuro.
>
> O EstoqueFlow mantém um espelho somente-leitura dos seus dados em uma planilha do Google Sheets.
> Você continua cruzando número do seu jeito, e o dado nunca fica preso aqui dentro.
>
> Se você trabalha com mais de um CNPJ, vale também ativar o multi-empresa: os saldos ficam separados,
> na mesma conta.
>
> [Ver meu espelho no Google Sheets]
**Ação:** abrir o espelho / ativar segunda empresa.

### E-mail 7 — Dia 14
**Assunto:** O que mudou no seu estoque em duas semanas
> [nome], seu teste está no fim. Antes de decidir, três perguntas:
>
> — A transferência entre depósitos ficou confiável?
> — Você conseguiu apurar uma divergência que antes ficaria sem explicação?
> — O valor em estoque por depósito bate com a sua realidade?
>
> Se as três respostas forem sim, continuar é só escolher o plano pelo número de depósitos.
> Se alguma for não, responda este e-mail dizendo qual — eu quero saber onde travou.
>
> [Escolher meu plano]
**Ação:** conversão para pagante. Se não converter, entra na sequência de reengajamento em 7 dias.

---

## 3. Sequência de reengajamento — 4 e-mails

Alvo: teste expirado sem conversão, ou conta ativa sem movimento há 21 dias.

### E-mail 1 — Dia 7 após o fim
**Assunto:** Travou onde?
> [nome], seu teste terminou e você não seguiu. Isso me interessa mais do que parece.
>
> Foi preço, foi tempo para cadastrar, foi falta de algo que a gente não tem, ou foi só a semana?
> Responda com uma palavra — leio todas.
**Objetivo:** diagnóstico, não venda.

### E-mail 2 — Dia 14
**Assunto:** A parte chata é o cadastro. Vamos fazer junto.
> Se o que travou foi o volume de cadastro, resolvemos isso em uma call de 30 minutos: a gente sobe
> seus produtos e saldos iniciais junto com você e deixa a primeira transferência real rodando.
>
> [Marcar 30 minutos]
**Objetivo:** remover o atrito mais comum (carga inicial).

### E-mail 3 — Dia 25
**Assunto:** O que mudou no EstoqueFlow desde que você saiu
> Resumo curto do que entrou: [3 itens reais das release notes].
>
> Se algum deles era justamente o que faltava para você, seu acesso volta com um clique — sem cadastrar
> nada de novo, seus dados continuam lá.
>
> [Reabrir minha conta]
**Objetivo:** reativar por novidade concreta. Só envie se houver release real.

### E-mail 4 — Dia 40
**Assunto:** Encerrando por aqui (com um presente)
> [nome], não vou insistir mais. Se um dia a transferência entre depósitos voltar a doer, você sabe
> onde estamos.
>
> Antes de sair, leva o material que mais ajuda quem fica na planilha: [Checklist de inventário cíclico]
> e [Modelo de romaneio de transferência].
>
> Se quiser parar de receber, o descadastro está aqui embaixo e funciona na hora.
**Objetivo:** encerrar com boa impressão e higienizar a lista.

---

## 4. Campanhas pagas — Google Search

Google Search é o canal BOFU do EstoqueFlow: quem busca "sistema de controle de estoque multi
depósito" já sabe o que quer.

**Estrutura de conta:**

| Campanha | Grupo de anúncio | Palavras-chave (frase/exata) | Página de destino |
|---|---|---|---|
| BR-Search-Marca | Marca | estoqueflow, estoque flow sistema | Home |
| BR-Search-Categoria | Multi-depósito | sistema de controle de estoque multi depósito, sistema estoque várias filiais, controle de estoque duas lojas | Landing multi-depósito |
| BR-Search-Categoria | Genérico | sistema de controle de estoque, software de controle de estoque, programa de controle de estoque | Landing principal |
| BR-Search-Dor | Transferência | transferência de estoque entre filiais, controle de transferência entre depósitos | Landing multi-depósito |
| BR-Search-Dor | Inventário | sistema para inventário cíclico, controle de divergência de inventário | Landing inventário |
| BR-Search-Substituto | Planilha | planilha de controle de estoque, substituir planilha de estoque | Comparativo planilha x sistema |
| BR-Search-Segmento | Distribuidora | sistema de estoque para distribuidora, controle de estoque para distribuidora | Landing distribuidora |
| BR-Search-Segmento | E-commerce | controle de estoque e-commerce e loja física, estoque cd e loja | Landing e-commerce |

**Negativas obrigatórias:** grátis, gratuito, download, excel, planilha pronta, curso, apostila,
concurso, o que é, significado, estágio, vaga, emprego, tcc, monografia, código fonte, github.

**Copy de anúncio — grupo Multi-depósito**
- Títulos: `Estoque em 2 Depósitos ou Mais` | `Transferência Sem Perder Saldo` | `Custo Médio Que Viaja Junto` | `EstoqueFlow — Multi-Depósito`
- Descrições:
  - "Transferência atômica entre depósitos: saldo e custo médio se movem no mesmo lançamento. Teste com sua operação."
  - "Valor em estoque por depósito, abaixo do mínimo, curva ABC, giro e cobertura. Multi-empresa."

**Copy de anúncio — grupo Transferência**
- Títulos: `Transferência Entre Filiais` | `O Que Sai Chega Igual` | `Sem Mercadoria em Limbo` | `Controle Multi-Depósito`
- Descrições:
  - "A transferência é um movimento único. Nada fica sem dono entre a origem e o destino."
  - "Histórico auditável por produto e por depósito. Comece com dois depósitos hoje."

**Copy de anúncio — grupo Planilha**
- Títulos: `Sua Planilha Chegou no Limite?` | `De Excel Para Multi-Depósito` | `Seu Dado Espelhado no Sheets` | `Sem Ficar Refém do Sistema`
- Descrições:
  - "A planilha aguenta um depósito. Na transferência, ela exige dois lançamentos e erra o custo médio."
  - "Espelho somente-leitura no Google Sheets: você sai da planilha sem largar a planilha."

**Extensões:** sitelinks para preços, demo, comparativo e case; frases de destaque com
"Multi-empresa", "Inventário cíclico", "Curva ABC", "PDV integrado".

---

## 5. Campanhas pagas — Meta

Meta é canal de MOFU e remarketing. Prospecção fria em Meta funciona melhor para Sandra
(dono de distribuidora), que não busca ativamente no Google.

| Campanha | Objetivo | Público | Criativo | Destino |
|---|---|---|---|---|
| Meta-Frio-Isca | Leads | Interesses: gestão de estoque, logística, distribuidoras; cargos de proprietário; 25-60 | Carrossel "3 sinais de que seu estoque some no caminho" | Página da isca (checklist) |
| Meta-Frio-Video | Alcance/Vídeo | Igual acima + lookalike de clientes | Vídeo de 45s da transferência na tela | Landing multi-depósito |
| Meta-Remarketing-Site | Conversão | Visitantes de 30 dias que não iniciaram teste | Estático com a tabela planilha x EstoqueFlow | Landing principal |
| Meta-Remarketing-Video | Conversão | Quem viu 50%+ do vídeo | Depoimento de cliente em vídeo | Página de preços |
| Meta-Remarketing-Teste | Conversão | Iniciou teste, não cadastrou 2º depósito | Estático "seu segundo depósito muda tudo" | Deep link para cadastro de depósito |

**Copy modelo — Meta, público frio, persona Sandra:**
> Sai 40 do CD, chega 38 na loja. E ninguém sabe explicar as 2 unidades.
>
> Não é sempre furto. Quase sempre é o jeito como a transferência é lançada: uma saída aqui, uma
> entrada ali, e um vão no meio.
>
> No EstoqueFlow a transferência é um movimento só, e o custo médio vai junto com a mercadoria. O que
> sai de um depósito chega igual no outro — no saldo e no valor.
>
> Controle de estoque multi-depósito, multi-empresa, com espelho somente-leitura no Google Sheets.
>
> [Quero ver na minha operação]

**Regras de criativo:** tela real do produto vence ilustração; texto na imagem em no máximo 8 palavras;
primeiro segundo do vídeo mostra o problema, não a marca.

---

## 6. Estrutura de UTM

Padronize desde o primeiro link — remendar depois é impossível.

```
utm_source   = google | meta | linkedin | instagram | youtube | newsletter | whatsapp | indicacao
utm_medium   = cpc | organico | email | social | referral
utm_campaign = <onda ou tema>-<mes/ano>   ex.: lancamento-set25, waitlist-ago25
utm_content  = <criativo ou peça>          ex.: carrossel-3sinais, anuncio-transferencia-v2
utm_term     = <palavra-chave>             (só em busca paga)
```

Toda peça produzida entrega o link já com UTM. Link sem UTM é dado perdido.

---

## 7. CAC, LTV e payback — fórmulas e leitura

**Fórmulas**

```
CAC = (investimento em mídia + custo de time de marketing e vendas) / novos clientes pagantes no período

Ticket médio (ARPA) = MRR total / clientes ativos

Margem bruta % = (receita - custo de servir) / receita
  custo de servir = infraestrutura (Railway, Postgres) + suporte + taxas de pagamento

Churn de receita mensal % = (MRR perdido - MRR de expansão) / MRR do início do mês

LTV = (ARPA x margem bruta %) / churn de receita mensal %

Payback de CAC (meses) = CAC / (ARPA x margem bruta %)

Razão LTV/CAC = LTV / CAC
```

**Como ler os números**

- **LTV/CAC** abaixo de 1 significa que cada venda destrói caixa. Perto de 1 a 2, o negócio existe mas
  não escala com mídia paga. Acima de 3 costuma ser lido como saudável — *faixa de referência do setor,
  valide com seus próprios dados.*
- **Payback** é a métrica que decide o quanto você pode acelerar mídia com o caixa que tem. Payback
  longo com caixa curto quebra empresa lucrativa no papel. *Faixas de 12 a 18 meses são citadas como
  referência em SaaS B2B — trate como referência, não como meta importada.*
- **Churn** no público de distribuidora pequena tende a ser mais sensível a sazonalidade de caixa do que
  a insatisfação de produto. Separe churn voluntário de churn por inadimplência antes de tirar conclusão.
- **Não use LTV com menos de 6 meses de histórico.** Com base pequena, o número oscila tanto que
  qualquer decisão em cima dele é chute com casas decimais.

**Segmentação obrigatória:** calcule CAC e LTV por canal (busca, social, indicação) e por persona.
A média esconde que a indicação tem CAC baixíssimo e o social frio tem CAC alto — e é essa diferença
que orienta a realocação de verba.

**Alavancas quando o CAC sobe:**
1. Melhorar conversão da landing (mais barato que comprar mais tráfego)
2. Reforçar a qualificação por número de depósitos (menos lead ruim entrando)
3. Aumentar a taxa de ativação (mais teste virando pagante)
4. Programa de indicação (ver `06-retencao-e-expansao.md`)
5. Só então: aumentar verba

---

## 8. Ritmo de otimização

**Semanal:** revisar termos de busca e adicionar negativas; pausar criativo com desempenho fraco
depois de volume mínimo relevante; conferir a taxa de "iniciou teste → cadastrou 2º depósito".

**Quinzenal:** um teste A/B por vez — headline da landing, assunto do e-mail 1 ou criativo principal.
Testar três coisas ao mesmo tempo com volume pequeno não gera aprendizado, gera ruído.

**Mensal:** recalcular CAC, LTV e payback por canal; realocar verba; revisar as pautas SEO que entraram
em página 2 e melhorar em vez de escrever novas.

**Trimestral:** revisar ICP com base em quem realmente ficou (não em quem comprou). Se as contas que
ficam têm 4+ depósitos, o ICP mudou e todo o funil precisa acompanhar.
