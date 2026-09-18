# Template — E-mails de Onboarding EstoqueFlow

Sequência completa pronta para colar no provedor de e-mail. Substitua `[nome]` pela variável de merge
e os links pelos destinos reais.

**Regras de envio:**
- Cada e-mail tem UMA ação. Nunca dois CTAs concorrentes.
- Pule o e-mail cuja ação a conta já executou (use os eventos de `references/05-metricas.md`).
- Remetente: pessoa real com nome e sobrenome, não "equipe EstoqueFlow".
- Responder ao e-mail deve chegar em uma caixa de entrada monitorada por humano.
- Sem emoji, sem imagem pesada, sem HTML elaborado. Texto simples converte melhor neste público.

---

## E-mail 1 — Dia 0 (imediato após o cadastro)

**Assunto:** Comece pela transferência que mais te dá dor de cabeça
**Pré-cabeçalho:** Dois depósitos e cinco produtos já bastam para o primeiro teste.
**Condição de envio:** sempre.

Oi, [nome]. Sua conta do EstoqueFlow está de pé.

Sugestão para os próximos 15 minutos: não tente cadastrar o estoque inteiro. Cadastre dois depósitos,
uns 5 produtos e faça uma transferência de verdade entre eles.

É nessa tela que você vê a diferença. A transferência é um movimento único e o custo médio viaja junto
com a mercadoria. Olhe o custo médio no depósito de destino antes e depois — ele continua verdadeiro,
sem ajuste manual.

O tutorial guiado abre sozinho no primeiro login e te leva por esse caminho.

**[Fazer minha primeira transferência]**

Se travar em qualquer ponto, é só responder este e-mail.

— [Nome], EstoqueFlow

---

## E-mail 2 — Dia 1

**Assunto:** Seu segundo depósito já está cadastrado?
**Pré-cabeçalho:** Com um depósito só, você não vê o que o EstoqueFlow faz de diferente.
**Condição de envio:** pular se a conta já tem 2+ depósitos.

[nome], um aviso honesto.

Com um depósito só, o EstoqueFlow é um controle de estoque comum. Com dois, ele vira o que você veio
buscar: saldo e custo médio que continuam corretos nos dois lados depois de uma transferência.

Leva dois minutos: **Cadastros → Depósitos → Novo**.

Se o segundo depósito é uma loja, uma filial ou um estoque de rua, tanto faz — o que importa é ele
existir no sistema como existe na sua operação.

**[Cadastrar o segundo depósito]**

— [Nome], EstoqueFlow

---

## E-mail 3 — Dia 3

**Assunto:** Parar de digitar código errado
**Pré-cabeçalho:** A maior parte da divergência nasce na digitação, não no furto.
**Condição de envio:** pular se `codigo_barras_utilizado` já ocorreu.

[nome],

Quando o estoque não bate, o primeiro pensamento costuma ser furto. Na prática, boa parte da
divergência nasce em digitação: produto parecido, código trocado, quantidade errada.

No EstoqueFlow você cadastra e movimenta por código de barras — na entrada, na saída, na transferência
e na contagem. O produto certo entra no lugar certo.

Se você ainda não tem leitor no depósito, dá para começar com a câmera do celular.

**[Ver como movimentar com código de barras]**

— [Nome], EstoqueFlow

---

## E-mail 4 — Dia 5

**Assunto:** Contar o estoque sem parar o depósito
**Pré-cabeçalho:** Comece por 20 itens da sua curva A.
**Condição de envio:** pular se já houve `inventario_iniciado`.

[nome],

Inventário geral trava a operação, consome um sábado inteiro do time e mesmo assim fecha com
divergência que ninguém consegue rastrear.

A alternativa é contar por partes. No EstoqueFlow, o inventário cíclico deixa você contar um grupo de
produtos por vez e apura a divergência automaticamente — por produto e por depósito. Você descobre
**onde** o número quebrou, não só que ele quebrou.

Sugestão para esta semana: 20 itens da sua curva A, em um depósito só.

**[Abrir minha primeira contagem]**

— [Nome], EstoqueFlow

---

## E-mail 5 — Dia 8

**Assunto:** Os quatro relatórios que você leva para a reunião
**Pré-cabeçalho:** O quarto costuma mudar a próxima compra.
**Condição de envio:** sempre (a leitura vale mesmo para quem já abriu os relatórios).

[nome], agora que os movimentos começaram a entrar, estes quatro passam a valer:

1. **Valor em estoque por depósito** — quanto de dinheiro está parado em cada lugar
2. **Produtos abaixo do mínimo** — o que vai romper antes de você perceber
3. **Curva ABC** — os poucos itens que respondem pela maior parte do valor
4. **Giro e cobertura em dias** — o que sai rápido e por quantos dias o estoque atual segura

O quarto é o que costuma mudar a próxima compra. Cobertura de 90 dias em item de curva C é dinheiro
parado; cobertura de 4 dias em curva A é ruptura marcada para a semana que vem.

**[Ver meus relatórios]**

— [Nome], EstoqueFlow

---

## E-mail 6 — Dia 12

**Assunto:** Seu estoque também vive numa planilha (só que atualizada)
**Pré-cabeçalho:** O dado não fica preso aqui dentro.
**Condição de envio:** sempre.

[nome],

Sair da planilha assusta, e não precisa ser um salto no escuro.

O EstoqueFlow mantém um espelho somente-leitura dos seus dados em uma planilha do Google Sheets. Você
continua cruzando número do seu jeito, montando a sua análise, mandando para o contador. E o dado nunca
fica preso aqui dentro.

Se você opera com mais de um CNPJ, vale ativar também o multi-empresa: cada empresa mantém seus
depósitos e seus saldos, na mesma conta, e você troca entre elas em um clique.

**[Abrir meu espelho no Google Sheets]**

— [Nome], EstoqueFlow

---

## E-mail 7 — Dia 14

**Assunto:** O que mudou no seu estoque em duas semanas
**Pré-cabeçalho:** Três perguntas antes de você decidir.
**Condição de envio:** sempre, para contas em teste.

[nome], seu teste está no fim. Antes de decidir, três perguntas:

— A transferência entre depósitos ficou confiável?
— Você conseguiu apurar alguma divergência que antes ficaria sem explicação?
— O valor em estoque por depósito bate com a sua realidade?

Se as três respostas forem sim, continuar é só escolher o plano pelo número de depósitos que você opera.

**[Escolher meu plano]**

Se alguma resposta for não, responda este e-mail dizendo qual. Eu quero saber onde travou — isso me
ajuda mais do que uma venda.

— [Nome], EstoqueFlow

---

# Sequência de reengajamento (após teste expirado sem conversão)

## R1 — Dia 7 após o fim do teste
**Assunto:** Travou onde?

[nome], seu teste terminou e você não seguiu. Isso me interessa mais do que parece.

Foi preço, foi o tempo de cadastrar, foi falta de algo que a gente não tem, ou foi só a semana
atropelada? Responda com uma palavra — leio todas.

— [Nome], EstoqueFlow

## R2 — Dia 14
**Assunto:** A parte chata é o cadastro. Vamos fazer junto.

[nome], se o que travou foi o volume de cadastro, isso a gente resolve em 30 minutos.

Marcamos uma call, subimos seus produtos e saldos iniciais junto com você e deixamos a primeira
transferência real rodando antes de desligar.

**[Marcar 30 minutos]**

— [Nome], EstoqueFlow

## R3 — Dia 25
**Assunto:** O que mudou no EstoqueFlow desde que você saiu
*(Só envie se houver release real. Sem novidade concreta, pule este e-mail.)*

[nome], resumo curto do que entrou desde a sua saída:

- [item real 1 das release notes]
- [item real 2]
- [item real 3]

Se algum deles era justamente o que faltava, seu acesso volta com um clique. Seus dados continuam lá,
você não recadastra nada.

**[Reabrir minha conta]**

— [Nome], EstoqueFlow

## R4 — Dia 40
**Assunto:** Encerrando por aqui (com um presente)

[nome], não vou insistir mais.

Se um dia a transferência entre depósitos voltar a doer, você sabe onde estamos.

Antes de sair, leva o que mais ajuda quem continua na planilha:
- [Checklist de inventário cíclico em 9 passos]
- [Modelo de romaneio de transferência]

Se quiser parar de receber, o descadastro está aqui embaixo e funciona na hora.

— [Nome], EstoqueFlow

---

## Variações de assunto para teste A/B

| E-mail | Variação A (padrão) | Variação B |
|---|---|---|
| 1 | Comece pela transferência que mais te dá dor de cabeça | Sua conta está pronta. Faça uma transferência real hoje |
| 2 | Seu segundo depósito já está cadastrado? | Com um depósito só, você não vê a diferença |
| 4 | Contar o estoque sem parar o depósito | 20 itens da curva A é o suficiente para começar |
| 5 | Os quatro relatórios que você leva para a reunião | Cobertura em dias: a conta que muda sua próxima compra |
| 7 | O que mudou no seu estoque em duas semanas | Três perguntas antes de você decidir |

## Medição
Abertura e clique por e-mail, taxa de execução da ação de cada e-mail (via evento no app),
taxa de ativação da coorte, TTV mediano e conversão teste → pagante.
Se um e-mail tem clique alto e execução baixa, o problema está na tela de destino, não no texto.
