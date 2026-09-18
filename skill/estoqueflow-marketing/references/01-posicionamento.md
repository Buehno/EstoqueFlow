# Fase 1 — Posicionamento, ICP e Messaging

Base de tudo. Nenhuma peça de copy do EstoqueFlow deve ser escrita sem passar por aqui primeiro.

## Índice
1. ICP — perfil de cliente ideal
2. As três personas
3. Anti-persona (quem NÃO é cliente)
4. Mapa de dores por persona
5. Matriz de posicionamento
6. Messaging house
7. Tagline e variações
8. Elevator pitches
9. Objeções e respostas
10. Notas de precificação

---

## 1. ICP — perfil de cliente ideal

O cliente ideal do EstoqueFlow tem **mais de um lugar onde a mercadoria fica parada**. Esse é o
critério de corte. Empresa com um único depósito compra qualquer sistema; empresa com dois ou mais
tem um problema específico que quase nenhum sistema de baixo custo resolve direito.

Sinais de encaixe (quanto mais, melhor):
- 2 a 8 depósitos/filiais/lojas com transferência interna recorrente
- 300 a 20.000 SKUs ativos
- 5 a 60 pessoas na operação, sendo 1 a 3 que "cuidam do estoque"
- Faturamento em que uma divergência de inventário dói, mas não há verba para ERP grande
- Já usa planilha compartilhada ou sistema de PDV que não fala com o estoque
- Faz contagem de estoque com a operação parada (ou não faz)
- Alguém na empresa sabe dizer "esse produto sumiu no caminho entre o CD e a loja"

Sinais de desencaixe: depósito único sem transferência, necessidade de WMS com endereçamento e
picking por onda, exigência de emissão fiscal integrada, operação com coletor de rádio-frequência
dedicado, indústria com ficha técnica/ordem de produção complexa.

---

## 2. As três personas

### Persona A — Marcelo, Gestor de Logística
**Cargo:** coordenador ou gerente de logística/suprimentos. 32-48 anos. Reporta ao diretor de operações.
**Empresa:** distribuidora ou indústria pequena, 2-5 depósitos, 30-80 funcionários.
**Dia a dia:** cobra conferência de recebimento, aprova transferências, apaga incêndio de ruptura,
monta o inventário do fim do mês, responde por divergência na reunião de resultado.
**Como ele mede sucesso:** acuracidade de inventário, ruptura zero nos itens A, transferência que
chega igual saiu.
**O que ele teme:** ser cobrado por um número que ele não controla. Divergência que aparece depois de
três meses e ninguém sabe onde nasceu.
**Onde ele está:** LinkedIn (segue páginas de logística e supply chain), grupos de WhatsApp do setor,
YouTube buscando "como fazer inventário rotativo".
**Gatilho de compra:** um inventário que fechou com divergência grande o suficiente para virar assunto
de diretoria.
**Linguagem que funciona:** técnica e específica. Ele conhece "custo médio ponderado", "cobertura em
dias", "curva ABC". Não simplifique demais — soa amador.
**Objeção principal:** "meu time não vai usar; já tentei implantar sistema antes."

### Persona B — Sandra, Dona de Distribuidora
**Cargo:** sócia-proprietária. 40-60 anos. Decide sozinha, paga do próprio bolso.
**Empresa:** distribuidora de 8-40 funcionários, um CD e uma ou duas lojas/pontos de venda.
**Dia a dia:** olha caixa, cobra vendedor, aprova compra, e nas horas vagas tenta entender por que o
estoque no papel não bate com o que ela vê na prateleira.
**Como ela mede sucesso:** dinheiro parado em estoque, margem, e não levar prejuízo com produto perdido.
**O que ela teme:** furto e desorganização interna. Dependência de um sistema que ela não entende.
Ficar refém de um fornecedor de software.
**Onde ela está:** Instagram, WhatsApp, indicação de contador ou de outro dono. Raramente lê blog.
**Gatilho de compra:** perceber valor parado em estoque muito acima do esperado, ou perder uma venda
por não saber que tinha o produto na outra loja.
**Linguagem que funciona:** dinheiro e simplicidade. "Quanto tem parado em cada depósito", "o que
está abaixo do mínimo", "o que não gira há 90 dias".
**Objeção principal:** "e se eu quiser sair? meus dados ficam presos aí dentro?" — responder com o
espelho em Google Sheets somente-leitura.

### Persona C — Diego, Operador de e-commerce com CD + loja
**Cargo:** head de operações ou sócio-operador de e-commerce. 26-40 anos.
**Empresa:** e-commerce com centro de distribuição próprio e uma ou mais lojas físicas, 10-50 pessoas.
**Dia a dia:** equilibra estoque entre o CD (que atende o site) e a loja (que atende o balcão),
transfere mercadoria conforme a demanda vira, e sofre com venda de item que não existe mais.
**Como ele mede sucesso:** pedido cancelado por falta, tempo de separação, giro por canal.
**O que ele teme:** vender no site o que a loja já vendeu no balcão. Overselling.
**Onde ele está:** LinkedIn, YouTube, newsletters de e-commerce, comunidades de sellers.
**Gatilho de compra:** pico de vendas (data sazonal) em que o descasamento entre canais gerou
cancelamento e reclamação.
**Linguagem que funciona:** velocidade e canal. "Saldo por depósito em tempo real", "PDV que baixa do
mesmo saldo", "transferência que não fica em limbo".
**Objeção principal:** "integra com minha plataforma de e-commerce?" — hoje a resposta honesta é que o
EstoqueFlow é a fonte de verdade do estoque físico, com espelho em planilha; não prometa integração
que não existe.

---

## 3. Anti-persona

Não gaste verba nem conteúdo com:
- Empresa de depósito único sem transferência interna (a dor central não existe)
- Quem precisa de emissão fiscal dentro da ferramenta
- Operação de e-commerce que quer marketplace hub / integração multicanal pronta
- Indústria com necessidade de ordem de produção e explosão de estrutura de produto
- Empresa que já tem ERP grande implantado e satisfeito — o custo de troca vence o argumento

Escrever para esses perfis gera lead que não fecha e churn precoce, que é pior que não vender.

---

## 4. Mapa de dores por persona

| Dor | Marcelo | Sandra | Diego | Mecanismo do EstoqueFlow que responde |
|---|---|---|---|---|
| Mercadoria some entre dois depósitos | alta | alta | alta | Transferência atômica: saída e entrada no mesmo movimento, sem estado intermediário perdido |
| Custo médio errado depois da transferência | alta | média | média | Custo médio viaja junto com a mercadoria no movimento de transferência |
| Inventário só fecha com a operação parada | alta | média | média | Inventário cíclico com apuração de divergências por contagem parcial |
| Não sei quanto tenho parado em cada lugar | média | alta | média | Relatório de valor em estoque por depósito |
| Ruptura em item que vende | alta | alta | alta | Relatório de produtos abaixo do mínimo |
| Estoque encalhado consumindo caixa | média | alta | alta | Curva ABC + giro + cobertura em dias |
| Venda no balcão não baixa do saldo | baixa | alta | alta | PDV integrado ao mesmo saldo |
| Digitação errada de produto | média | alta | média | Cadastro e leitura por código de barras |
| Várias empresas/CNPJ na mesma gestão | média | alta | baixa | Multi-empresa (multi-tenant) |
| Medo de largar a planilha | baixa | alta | baixa | Espelho somente-leitura em Google Sheets |
| Time não aprende sistema novo | alta | alta | média | Tutorial guiado no primeiro login |

Use esta tabela para escolher o gancho: **a dor de maior intensidade na persona escolhida vira a
primeira linha da copy.**

---

## 5. Matriz de posicionamento

| Critério | Planilha (Excel/Sheets) | ERP grande | Sistema de PDV simples | **EstoqueFlow** |
|---|---|---|---|---|
| Custo de entrada | zero | alto | baixo | baixo |
| Tempo até funcionar | imediato | meses | dias | dias |
| Transferência entre depósitos | manual, dois lançamentos soltos | existe, complexa de operar | inexistente ou frágil | **atômica, com custo médio junto** |
| Custo médio confiável | depende da fórmula de alguém | sim | raramente | **sim, por movimento** |
| Inventário cíclico | manual | sim, pesado | não | **sim, com apuração de divergência** |
| Curva ABC / giro / cobertura | precisa montar | sim | não | **pronto** |
| Multi-empresa | arquivos separados | sim | limitado | **nativo** |
| Curva de aprendizado | zero | alta | baixa | **baixa, com tutorial guiado** |
| Risco de travar dado | zero | alto | médio | **baixo — espelho em Sheets** |

**Posicionamento em uma frase:** o EstoqueFlow fica exatamente entre a planilha (que não aguenta dois
depósitos) e o ERP grande (que custa e demora demais para quem tem dois depósitos).

**Frame de categoria:** não competimos como "sistema de estoque". Competimos como **"o sistema que
cuida do estoque entre os seus depósitos"**. Essa é a categoria que queremos ocupar na cabeça do
comprador.

---

## 6. Messaging house

### Promessa central
**"O que sai de um depósito chega igual no outro — com valor, saldo e histórico intactos."**

### Pilar 1 — Transferência que não perde nada no caminho
- Prova: transferência atômica — saída e entrada acontecem no mesmo movimento; não existe mercadoria
  em limbo entre um depósito e outro.
- Prova: o custo médio viaja junto com a mercadoria, então o valor em estoque continua correto no
  destino.
- Prova: histórico do movimento fica registrado e auditável por produto e por depósito.
- Frase de apoio: "Transferir deixa de ser dois lançamentos torcendo para bater."

### Pilar 2 — Contagem sem parar a operação
- Prova: inventário cíclico — conta uma parte do estoque por vez, com apuração automática de divergências.
- Prova: divergência apurada por produto e por depósito, então dá para achar onde nasceu o erro.
- Prova: leitura por código de barras reduz erro de digitação na contagem.
- Frase de apoio: "Inventário vira rotina de terça-feira, não evento de fim de ano."

### Pilar 3 — Decisão com número, não com achismo
- Prova: valor em estoque por depósito, produtos abaixo do mínimo, curva ABC, giro e cobertura em dias.
- Prova: PDV lança no mesmo saldo, então o número do relatório é o número da prateleira.
- Prova: espelho somente-leitura em Google Sheets para quem precisa cruzar dado do próprio jeito.
- Frase de apoio: "Você para de perguntar 'quanto tem?' e passa a perguntar 'o que faço com o que tem?'."

### Provas transversais (usar em qualquer pilar)
- Multi-empresa nativo: mais de um CNPJ na mesma conta, sem misturar saldo.
- Tutorial guiado no primeiro login: o time começa sem treinamento formal.
- Espelho em Google Sheets somente-leitura: o dado nunca fica trancado.

### Como usar a messaging house
Uma peça = uma promessa + um pilar + no mínimo uma prova. Nunca cite pilar sem prova; é isso que
separa a copy do EstoqueFlow de anúncio genérico de software.

---

## 7. Tagline e variações

**Tagline principal:** *EstoqueFlow — o estoque entre os seus depósitos, sob controle.*

Variações por contexto:
- Curta (assinatura, rodapé): *Controle de estoque multi-depósito.*
- Anúncio/performance: *Transfira entre depósitos sem perder saldo nem custo.*
- Venda para Sandra (dono): *Saiba quanto tem, onde tem e quanto vale — em cada depósito.*
- Venda para Diego (e-commerce): *Um saldo só para CD, loja e balcão.*
- Institucional: *Feito para quem tem mercadoria em mais de um lugar.*

Regra: a tagline nunca aparece sozinha em material de conversão. Ela vem sempre seguida da linha de
mecanismo ("transferência atômica com custo médio junto").

---

## 8. Elevator pitches

**10 segundos (evento, conversa de corredor):**
"EstoqueFlow é um controle de estoque para quem tem mais de um depósito. A transferência entre eles é
atômica: o custo médio viaja junto com a mercadoria, então o saldo e o valor batem nos dois lados."

**30 segundos (call de qualificação):**
"A maioria dos sistemas trata transferência como duas coisas soltas: uma saída aqui, uma entrada ali.
Aí some mercadoria no caminho e o custo médio do destino fica errado. O EstoqueFlow trata como um
movimento só, com o custo viajando junto. Em cima disso vêm inventário cíclico com apuração de
divergência, PDV no mesmo saldo e os relatórios que o gestor precisa — valor por depósito, abaixo do
mínimo, curva ABC, giro e cobertura. É multi-empresa e mantém um espelho somente-leitura em Google
Sheets, para o dado nunca ficar preso."

**60 segundos (investidor / parceiro):**
"Existe uma faixa de empresa brasileira com dois a oito depósitos que é grande demais para planilha e
pequena demais para ERP. Ela sofre num ponto muito específico: o trânsito de mercadoria entre os
próprios depósitos, onde saldo e custo se perdem. O EstoqueFlow ataca exatamente esse ponto — a
transferência é atômica e carrega o custo médio. A partir dessa âncora, entregamos o resto da operação:
PDV, inventário cíclico, curva ABC, giro, cobertura, multi-empresa. A adoção é rápida porque tem
tutorial guiado no primeiro login, e a objeção de risco cai porque mantemos um espelho somente-leitura
em Google Sheets. Crescemos por depósito e por usuário dentro da mesma conta."

**Pitch de uma linha para bio/perfil:**
"Controle de estoque multi-depósito com transferência atômica e custo médio que viaja junto."

---

## 9. Objeções e respostas

| Objeção | Resposta (mecanismo primeiro) |
|---|---|
| "Minha planilha resolve." | Resolve até o segundo depósito. Na transferência, a planilha exige dois lançamentos manuais e não recalcula custo médio no destino — é aí que a divergência nasce. |
| "É caro para o meu tamanho." | Compare com o custo de uma divergência de inventário. E compare com o ERP: aqui não há projeto de implantação de meses. |
| "Meu time não vai aprender." | Tutorial guiado no primeiro login, e a rotina diária são três telas: entrada, transferência, saída. |
| "E se eu quiser sair?" | O espelho somente-leitura em Google Sheets fica com você o tempo todo. O dado não é refém. |
| "Já tenho sistema de PDV." | O PDV do EstoqueFlow baixa do mesmo saldo do depósito. Se o seu PDV atual não conversa com o estoque, o problema não é o PDV — é a fonte de verdade. |
| "Emite nota fiscal?" | Não. O EstoqueFlow é a fonte de verdade do estoque físico e do custo. (Não prometa o contrário.) |
| "Preciso migrar tudo de uma vez?" | Não. Comece por um depósito e uma transferência real. O saldo entra por cadastro e ajuste inicial. |
| "Funciona para mais de um CNPJ?" | Sim, multi-empresa é nativo; os saldos não se misturam. |

---

## 10. Notas de precificação

Princípios (o número exato é decisão do negócio; aqui vai a estrutura recomendada):

- **Eixo de cobrança = depósito.** É a unidade que espelha o valor entregue e cresce junto com o
  cliente. Usuário como eixo secundário. Não cobre por SKU: pune o cliente por cadastrar bem.
- **Três planos.** Um plano de entrada com 2 depósitos (o mínimo em que a proposta faz sentido), um
  plano intermediário com mais depósitos e usuários, e um plano superior com multi-empresa e volume
  maior. Nunca ofereça plano de 1 depósito — ele atrai o cliente errado e destrói o posicionamento.
- **Teste antes de pagar.** Período de teste com dados reais é mais convincente que demo, porque o
  produto só prova valor quando a primeira transferência real acontece.
- **Ancoragem.** A âncora não é o concorrente barato; é o custo de uma divergência de inventário e o
  custo de um projeto de ERP. Faça o comprador comparar com isso.
- **Desconto anual** em vez de desconto pontual: preserva preço percebido e melhora caixa.
- **Expansão natural:** novo depósito, novo CNPJ, novos usuários. Ver `06-retencao-e-expansao.md`.

Faixas de conversão de teste para pago, ticket e desconto anual variam muito por mercado — trate
qualquer número que você encontrar como *faixa de referência do setor, a validar com seus próprios dados*.
