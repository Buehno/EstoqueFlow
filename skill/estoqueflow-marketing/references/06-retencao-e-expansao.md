# Fase 6 — Retenção e Expansão

Cliente que fica vale mais que cliente novo, e é mais barato. Este arquivo cobre onboarding assistido,
health score, expansão, indicação e produção de case.

## Índice
1. Princípio de retenção
2. Playbook de onboarding assistido (dias 0 a 30)
3. Health score — composição e gatilhos
4. Playbooks de intervenção por gatilho
5. Campanhas de expansão
6. Programa de indicação
7. Coleta de case de cliente — roteiro de entrevista
8. Ritual de voz do cliente

---

## 1. Princípio de retenção

O EstoqueFlow retém quando vira **fonte de verdade da operação**. Enquanto o cliente mantém a planilha
paralela "para conferir", ele está a um mês de cancelar. O objetivo de toda ação de retenção é o mesmo:
fazer o número do sistema virar o número que o cliente usa para decidir.

Três marcos de irreversibilidade, em ordem:
1. **A transferência real acontece no sistema** (dia 1-7) — o produto entra na rotina
2. **O primeiro inventário cíclico fecha com divergência apurada** (dia 15-45) — o sistema vira auditor
3. **Um relatório do sistema entra em reunião de compra ou de resultado** (dia 30-90) — o sistema vira
   linguagem da empresa

Cliente que atingiu os três raramente sai. Toda a operação de CS existe para levar contas a esses marcos.

---

## 2. Playbook de onboarding assistido (dias 0 a 30)

Aplicar a 100% das contas pagas e às contas em teste com 2+ depósitos declarados.

### Dia 0 — Boas-vindas e agendamento
- E-mail 1 da sequência (ver `04-aquisicao-e-funil.md`) dispara automaticamente
- Mensagem humana (WhatsApp com opt-in ou e-mail direto) oferecendo 30 minutos de implantação
- Objetivo: agendar a call em até 48 horas

### Dia 1-2 — Call de implantação (45-60 min)
Roteiro:
1. **Diagnóstico (10 min):** quantos depósitos, quantos SKUs, com que frequência transferem, como é o
   inventário hoje, qual o pior problema atual. Anote nas propriedades da conta.
2. **Configuração ao vivo (20 min):** criar os depósitos reais, cadastrar 10-20 produtos da curva A,
   lançar os saldos iniciais.
3. **Primeira transferência real (10 min):** com mercadoria de verdade, não com dado de teste.
   Mostrar custo médio no destino antes e depois.
4. **Combinado (10 min):** quem na empresa vai operar, quando será a primeira contagem cíclica, e a data
   do próximo contato. Deixar isso por escrito no fim da call.

Erro comum: tentar cadastrar o catálogo inteiro na call. O objetivo é a primeira transferência real,
não completude.

### Dia 3-7 — Acompanhamento de uso
- Verificar eventos: `deposito_criado` (2+), `produto_criado` (20+), `transferencia_concluida` (1+)
- Se faltar algum critério de ativação, contato objetivo citando o critério faltante
- Convidar o segundo usuário da conta — conta com um usuário só é conta frágil

### Dia 8-15 — Primeiro inventário cíclico
- Sugerir contagem de 20 itens da curva A
- Acompanhar a apuração de divergência junto com o cliente na primeira vez
- Este é o momento em que o cliente costuma descobrir um problema real de operação — e é o momento em
  que o produto prova que vale a assinatura

### Dia 16-30 — Rotina e relatórios
- Call de 30 minutos revisando: valor em estoque por depósito, abaixo do mínimo, curva ABC, giro e cobertura
- Pergunta-chave: "qual decisão de compra você tomaria olhando isso?" — se ele responder, o marco 3 chegou
- Apresentar o espelho no Google Sheets para quem ainda mantém planilha paralela
- Definir a rotina permanente: dia da semana da contagem cíclica, dia do mês da revisão de mínimos

### Dia 30 — Marco de sucesso
Checklist de saída do onboarding: conta ativada (4 critérios), 1 inventário concluído, 2+ usuários,
transferência semanal recorrente, rotina de contagem definida. Contas que não passam entram no
playbook de risco (seção 4).

---

## 3. Health score — composição e gatilhos

Índice de 0 a 100, recalculado semanalmente.

| Componente | Peso | Como pontua |
|---|---|---|
| Transferências nos últimos 30 dias | 30 | 4+ = 30 · 2-3 = 20 · 1 = 10 · 0 = 0 |
| Movimentos totais nos últimos 7 dias | 20 | 20+ = 20 · 5-19 = 12 · 1-4 = 6 · 0 = 0 |
| Usuários ativos na conta | 15 | 3+ = 15 · 2 = 10 · 1 = 5 |
| Inventário cíclico nos últimos 60 dias | 15 | 2+ = 15 · 1 = 10 · 0 = 0 |
| Relatórios abertos nos últimos 30 dias | 10 | 4+ = 10 · 1-3 = 6 · 0 = 0 |
| Suporte: tickets críticos abertos | 10 | nenhum = 10 · 1 aberto = 5 · 2+ ou reincidente = 0 |

**Faixas:**
- **80-100 — Saudável:** candidato a expansão, indicação e case
- **50-79 — Atenção:** contato de valor (não de venda), reforço de rotina
- **25-49 — Risco:** ligação do CS em até 48 horas
- **0-24 — Crítico:** ligação em 24 horas com o responsável da conta, plano de recuperação por escrito

**Gatilhos automáticos (independentes da faixa):**
1. Zero transferência em 21 dias → risco alto; o produto saiu da rotina
2. Queda de 50%+ nos movimentos semanais versus a média das 4 semanas anteriores
3. Único usuário ativo por 30 dias em conta com 2+ licenças
4. Nenhum relatório aberto em 45 dias → o dado não está virando decisão
5. Ticket crítico reaberto duas vezes
6. Falha de pagamento (cobrança recusada) → fluxo de recuperação de pagamento, não de churn
7. Queda de NPS ou resposta negativa em pesquisa
8. Troca do responsável pela conta (pessoa que implantou saiu da empresa) → reonboarding completo

O gatilho 8 é o mais subestimado: em empresa pequena, o sistema costuma pertencer a uma pessoa. Quando
ela sai, o sistema vira órfão e cancela três meses depois.

---

## 4. Playbooks de intervenção por gatilho

### Playbook A — Sem transferência há 21 dias
1. Verificar se houve mudança operacional (parou de transferir? mudou de responsável?)
2. Contato direto, uma pergunta: "vocês pararam de transferir entre os depósitos ou pararam de lançar aqui?"
3. Se pararam de lançar: descobrir o atrito, oferecer 20 minutos de ajuste de processo
4. Se pararam de transferir: reposicionar o valor nos relatórios e no inventário; a conta pode ser
   ICP fraco e isso precisa ser registrado

### Playbook B — Usuário único / conta órfã
1. Convite guiado do segundo usuário, com papel definido
2. Oferecer treinamento curto de 20 minutos para a equipe de depósito
3. Se o responsável saiu: reonboarding completo com o substituto, do dia 1

### Playbook C — Nenhum relatório aberto em 45 dias
1. Enviar o relatório pronto por e-mail, com uma leitura feita (não o link cru)
   > "Olhei seus números: [N] itens da curva A estão abaixo do mínimo, e a cobertura média do CD caiu
   > para [X] dias. Quer 15 minutos para revisar antes da próxima compra?"
2. Objetivo: mostrar que o dado dele já responde uma pergunta que ele tem

### Playbook D — Falha de pagamento
1. Aviso automático no dia 1, 3 e 7, com link de atualização de cartão
2. Contato humano no dia 7 — a maioria é cartão vencido, não intenção de sair
3. Não bloqueie o acesso ao dado antes do contato humano. Bloquear cedo transforma cobrança em churn.

### Playbook E — Conta saudável (80-100)
Não é playbook de risco, é de colheita:
1. Pedir indicação (seção 6)
2. Convidar para case (seção 7)
3. Avaliar expansão (seção 5)

---

## 5. Campanhas de expansão

Expansão no EstoqueFlow acontece por três eixos: **mais depósitos, mais empresas, mais usuários**.

### Campanha 1 — Novo depósito
**Gatilho:** conta atingiu o limite de depósitos do plano, ou o CS soube de abertura de filial.
**Mensagem (e-mail curto):**
> **Assunto:** Vocês abriram um depósito novo?
>
> [nome], vi que a conta está no limite de depósitos do plano.
>
> Se entrou filial nova, vale subir de plano antes de começar a movimentar — assim o saldo e o custo
> médio já nascem certos no depósito novo, sem ajuste depois.
>
> [Ver planos]

### Campanha 2 — Segunda empresa (multi-CNPJ)
**Gatilho:** cliente com mais de um CNPJ conhecido, ou pergunta sobre separar operações.
**Mensagem:**
> Se vocês operam com mais de um CNPJ, dá para trazer o segundo para a mesma conta sem misturar saldo.
> Cada empresa mantém seus depósitos, seus custos e seus relatórios — e você troca entre elas em um clique.

### Campanha 3 — Mais usuários
**Gatilho:** conta com 1 usuário ativo e volume de movimentos alto (sinal de gargalo em uma pessoa).
**Mensagem:**
> [nome], você está lançando praticamente tudo sozinho. Isso costuma virar erro em semana de pico.
>
> Vale colocar o pessoal do depósito lançando entrada e conferência direto no sistema — você fica com
> a transferência e os relatórios. São 20 minutos de treinamento.

### Campanha 4 — Profundidade de uso (sem receita imediata, mas reduz churn)
Alvo: contas que não usam PDV, inventário cíclico ou o espelho no Sheets. Sequência de 3 e-mails
educativos mostrando o recurso aplicado à operação daquele segmento.

**Regra de ouro da expansão:** só ofereça upgrade para conta com health score 70+. Vender mais para
cliente insatisfeito acelera o cancelamento e queima a relação.

---

## 6. Programa de indicação

**Por que existe:** no público de distribuidora e logística, a decisão passa por conversa entre pares.
Indicação tende a ser o canal de menor CAC e maior taxa de fechamento — meça o seu, não importe número
de fora (*faixa de referência do setor — valide com seus próprios dados*).

**Mecânica sugerida:**
- Quem indica ganha crédito equivalente a um mês de assinatura quando o indicado completa o segundo mês pago
- Quem é indicado entra com condição especial no primeiro mês
- Sem limite de indicações; crédito acumula
- O crédito só é liberado após o segundo mês pago do indicado — evita indicação de baixa qualidade

**Quando pedir:** health score 80+, e logo após um momento de sucesso concreto (inventário fechado,
primeira transferência de um depósito novo, elogio espontâneo no suporte).

**Como pedir (mensagem):**
> [nome], vocês fecharam o inventário com [N] divergências apuradas e resolvidas — isso é resultado
> de processo, não de sorte.
>
> Você conhece alguém que também toca dois ou mais depósitos e sofre com isso? Se indicar e a pessoa
> ficar, você ganha um mês de crédito e ela entra com condição especial.
>
> Basta me passar o nome e a empresa que eu falo com ela, dizendo que veio de você.

**O que não fazer:** pedir indicação em e-mail automático de massa, oferecer prêmio genérico sem
relação com o produto, e pedir antes do cliente ter tido resultado.

---

## 7. Coleta de case de cliente — roteiro de entrevista

**Critérios de escolha:** health score 80+, 90 dias ou mais de uso, resultado com número que o próprio
cliente consiga sustentar, e segmento que ainda não tenha case publicado.

**Antes da entrevista:** peça autorização por escrito (uso de nome, logotipo e números), envie os temas
com antecedência para o cliente levantar os dados, e reserve 45 minutos.

### Roteiro (45 minutos)

**Bloco 1 — Antes (10 min)**
1. Como era o controle de estoque de vocês antes do EstoqueFlow?
2. Quantos depósitos, quantos produtos, quantas pessoas mexiam no estoque?
3. Qual foi a última vez em que o estoque não bateu e isso deu problema de verdade? Conte o episódio.
4. Quanto tempo o time gastava por mês com contagem e conferência?
5. O que vocês já tinham tentado antes? Por que não funcionou?

**Bloco 2 — A decisão (8 min)**
6. O que aconteceu que fez vocês procurarem um sistema naquele momento?
7. O que vocês avaliaram além do EstoqueFlow?
8. Qual foi a maior dúvida antes de assinar? O que resolveu essa dúvida?
9. Quem mais participou da decisão?

**Bloco 3 — A implantação (8 min)**
10. Como foram os primeiros 30 dias, honestamente?
11. O que foi mais difícil? (a resposta honesta aqui é o que dá credibilidade ao case)
12. Como o time do depósito reagiu?

**Bloco 4 — Depois (12 min)**
13. O que mudou na rotina de vocês? Descreva um dia normal hoje.
14. Que número mudou? (acuracidade, divergência, tempo de contagem, ruptura, valor parado)
15. Qual recurso vocês usam todo dia sem pensar?
16. Teve algum resultado que vocês não esperavam?
17. O que ainda incomoda ou falta?

**Bloco 5 — Fechamento (7 min)**
18. Se um colega seu com dois depósitos perguntasse, o que você diria a ele?
19. Podemos usar seu nome, cargo, empresa e esses números?
20. Tem alguém que você indicaria para a gente conversar?

### Estrutura do case publicado

```
Título: <resultado concreto> — como a <empresa> <verbo> <número>
Ficha: segmento · nº de depósitos · nº de SKUs · tempo de uso
1. O contexto (3 parágrafos) — a operação antes, com a cena do problema
2. O ponto de virada — o episódio que motivou a busca
3. A implantação — o que foi feito nos primeiros 30 dias, incluindo o que foi difícil
4. O resultado — números do cliente, sempre atribuídos a ele ("segundo a empresa...")
5. Citação em destaque — a frase mais direta da entrevista, sem edição de sentido
6. O que vem agora — próximo passo da operação
CTA: uma linha para quem tem o mesmo problema
```

**Regras:** nenhum número sem atribuição ao cliente e sem autorização por escrito. Nenhuma edição que
mude o sentido de uma fala. O cliente revisa antes de publicar — sempre. Publicar sem revisão é a forma
mais rápida de perder um cliente bom e ganhar um problema jurídico.

---

## 8. Ritual de voz do cliente

- **Toda semana:** ler os tickets de suporte da semana e listar as três reclamações mais repetidas
- **Todo mês:** 2 conversas de 20 minutos com clientes ativos, sem pauta comercial
- **Todo trimestre:** pesquisa curta na base (uma pergunta de recomendação + uma aberta: "o que mais
  te atrapalha hoje?")
- **Sempre que alguém cancelar:** conversa de saída de 15 minutos, com motivo registrado em campo
  padronizado, não em texto livre

O produto e a copy do EstoqueFlow devem usar as palavras que aparecem nessas conversas. A melhor headline
raramente é escrita pelo marketing — ela costuma ser transcrita de um cliente falando do problema dele.
