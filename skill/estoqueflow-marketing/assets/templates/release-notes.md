# Template — Release Notes EstoqueFlow

Release notes são material de retenção, não de documentação. Quem lê é cliente, e ele quer saber uma
coisa: **o que muda na minha operação nesta semana.**

**Regras:**
- Ordem por impacto no cliente, nunca por área técnica.
- Cada item começa pelo problema resolvido, não pelo nome da funcionalidade.
- Nada de "melhorias diversas e correções de bugs". Diga qual bug e o que ele causava.
- Sem nome de framework, biblioteca ou infraestrutura. Node, Fastify, Postgres e Railway não aparecem.
- Publicado no mesmo dia do deploy. Release notes atrasada não é lida.
- Toda entrega que veio de pedido de cliente é creditada (com autorização) — isso alimenta o ciclo.

---

## Modelo — versão publicada no changelog

```markdown
# EstoqueFlow — Versão [X.Y] · [dd/mm/aaaa]

## O destaque

**[Título do recurso, em linguagem de operação]**

[Dois a quatro parágrafos. Comece pelo problema que o cliente vivia. Depois explique o mecanismo — o
que o sistema faz agora, concretamente. Termine com o caminho de uso na interface.]

[Se o recurso mexe com saldo, custo ou histórico, diga explicitamente o que acontece com os dados que
já existem. Cliente de estoque precisa saber se o número dele vai mudar.]

**Como usar:** [Menu → Submenu → Ação]

---

## Também entrou nesta versão

**[Título curto]**
[Uma a duas frases: o que mudou e para quem importa.]

**[Título curto]**
[Uma a duas frases.]

**[Título curto]**
[Uma a duas frases.]

---

## Corrigimos

- **[O que estava errado]** — [o que isso causava na prática e o que muda agora]
- **[O que estava errado]** — [efeito e correção]

---

## O que vem a seguir

[Um ou dois itens em desenvolvimento, sem data prometida se a data não for certa. Escreva
"em desenvolvimento" em vez de inventar prazo — prazo furado em release notes custa confiança.]

---

Alguma coisa aqui resolve um problema seu? Ou falta algo que trava sua operação?
Responda este e-mail ou fale com a gente por [canal]. A maior parte desta lista veio de conversa com
cliente.
```

---

## Exemplo preenchido (versão de referência)

```markdown
# EstoqueFlow — Versão 1.4 · 15/08/2026

## O destaque

**Transferência com conferência na chegada**

Até agora, a transferência entre depósitos era concluída no momento do envio. Isso funciona bem quando
os dois depósitos ficam no mesmo endereço, mas quem transfere entre cidades ficava sem registro do que
efetivamente chegou.

A partir desta versão, a transferência pode ser configurada com conferência na chegada. O movimento
continua sendo único — o saldo e o custo médio continuam viajando juntos — mas o depósito de destino
confirma a quantidade recebida. Se houver diferença entre o enviado e o recebido, o sistema registra a
divergência vinculada àquela transferência específica, com data, responsável e produto.

Na prática: quando 40 saem e 38 chegam, as 2 unidades deixam de ser um mistério de fim de mês e viram
um registro do dia.

Transferências já concluídas não mudam. Saldos e custos existentes permanecem exatamente como estão.

**Como usar:** Configurações → Depósitos → Exigir conferência na chegada

---

## Também entrou nesta versão

**Cobertura em dias no relatório de giro**
O relatório de giro agora traz a cobertura em dias ao lado do giro, por depósito. Dá para ver quanto
tempo o estoque atual segura, sem cálculo à parte.

**Filtro por curva no relatório de abaixo do mínimo**
Agora dá para olhar só a curva A. Em catálogos grandes, isso reduz a lista do que exige ação imediata.

**Contagem cíclica por grupo de produtos**
Além de selecionar itens um a um, você pode abrir uma contagem para um grupo inteiro.

---

## Corrigimos

- **Custo médio arredondando para baixo em transferências com quantidade fracionada** — o valor no
  depósito de destino ficava alguns centavos abaixo do correto e a diferença se acumulava ao longo do
  mês. O cálculo foi ajustado e os saldos afetados foram recalculados automaticamente.
- **Espelho no Google Sheets atrasando após grande volume de movimentos** — em dias com mais de mil
  lançamentos, o espelho podia ficar até uma hora atrás. Agora a atualização acompanha o volume.
- **PDV permitindo venda de produto sem saldo no depósito selecionado** — a venda era registrada e
  deixava o saldo negativo sem aviso. Agora o sistema bloqueia e mostra em qual depósito há saldo.

---

## O que vem a seguir

- Histórico de custo médio por produto ao longo do tempo (em desenvolvimento)
- Exportação do relatório de curva ABC direto para o espelho no Google Sheets (em desenvolvimento)

---

Alguma coisa aqui resolve um problema seu? Ou falta algo que trava sua operação?
Responda este e-mail ou fale com a gente pelo suporte. A conferência na chegada veio exatamente assim:
três clientes descreveram o mesmo problema em calls diferentes no mesmo mês.
```

---

## Versão para e-mail (mais curta que o changelog)

**Assunto:** [Nome do recurso] no EstoqueFlow — [benefício em 3 palavras]
**Pré-cabeçalho:** [Uma linha com o problema que deixou de existir.]

Oi, [nome].

Entrou hoje: **[nome do recurso]**.

[Dois parágrafos, mesmo conteúdo do destaque do changelog, sem os detalhes de migração de dados.]

**Como usar:** [Menu → Submenu → Ação]

Também entrou: [item 2], [item 3] e [item 4]. E corrigimos [correção mais visível].

[Ver tudo o que mudou]

Se isso resolve algo aí, me conta. Se falta outra coisa, me conta também.

— [Nome], EstoqueFlow

---

## Versão para LinkedIn / Instagram

Use o Modelo 6 de `post-linkedin.md`. Regra: um recurso por post. Lista de cinco novidades num post só
não é lida por ninguém.

---

## Checklist antes de publicar release notes

- [ ] O primeiro item é o de maior impacto para o cliente, não o mais difícil de construir
- [ ] Cada item começa pelo problema, não pelo nome da funcionalidade
- [ ] Nenhum termo técnico de bastidor (framework, banco, infraestrutura, endpoint)
- [ ] Efeito sobre dados existentes está declarado quando o recurso mexe em saldo, custo ou histórico
- [ ] Correções descrevem o que o bug causava, não só que foi corrigido
- [ ] Nenhuma data prometida que não esteja garantida
- [ ] Crédito a cliente tem autorização
- [ ] Caminho de uso na interface conferido na versão que está no ar
- [ ] Publicado no mesmo dia do deploy

## Medição
Abertura do e-mail de release, cliques no changelog, e — a métrica que importa — adoção do recurso nos
14 dias seguintes (evento correspondente em `references/05-metricas.md`). Recurso anunciado e não
adotado é sinal de problema de posicionamento do recurso, não de falta de divulgação.
