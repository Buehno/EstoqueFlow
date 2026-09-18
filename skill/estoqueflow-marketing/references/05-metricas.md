# Fase 5 — Métricas e Instrumentação

O que medir, como definir cada termo sem ambiguidade, e quais eventos precisam existir no produto.

## Índice
1. North star metric
2. Métricas de apoio
3. Dicionário de métricas
4. Definição de "usuário ativado" no EstoqueFlow
5. Eventos a rastrear no app
6. Propriedades de conta
7. Relatório semanal
8. Relatório mensal
9. Armadilhas de medição

---

## 1. North star metric

**Transferências entre depósitos concluídas por conta ativa, por semana.**

Por que essa e não MRR: MRR é resultado, não sinal. A transferência entre depósitos é o único evento
que só acontece quando o cliente **está usando o produto para aquilo que ele foi feito**. Uma conta que
transfere semanalmente entendeu o valor; uma conta que só cadastra produto ainda não.

Leitura da métrica:
- **Cresce com contas novas** → aquisição funcionando
- **Cresce por conta** → produto ganhando profundidade na operação
- **Cai por conta com base estável** → risco de churn 30 a 60 dias à frente, agir agora

Meta de referência interna: toda conta paga deve chegar a pelo menos 1 transferência/semana até o
dia 30. Abaixo disso, o time de CS entra em contato.

---

## 2. Métricas de apoio

**Aquisição:** sessões qualificadas (visitantes de páginas MOFU/BOFU), inscritos na lista, MQL, SQL,
testes iniciados, custo por teste iniciado.

**Ativação:** taxa de ativação (definição na seção 4), time to value (TTV), taxa de conclusão do
tutorial guiado, % de contas com 2º depósito cadastrado.

**Receita:** MRR, novo MRR, MRR de expansão, MRR de contração, MRR perdido, ARPA, NRR.

**Retenção:** churn de clientes, churn de receita, retenção por coorte de mês de entrada,
% de contas com uso semanal.

**Eficiência:** CAC, LTV, LTV/CAC, payback (fórmulas em `04-aquisicao-e-funil.md`).

Regra: nenhuma dessas métricas é avaliada isolada. Ativação sem retenção é ilusão; MRR sem NRR
esconde base furada.

---

## 3. Dicionário de métricas

Definições fechadas. Se alguém no time usa outra definição, o número perde sentido.

| Termo | Definição operacional no EstoqueFlow |
|---|---|
| **Visitante qualificado** | Sessão que passou por landing multi-depósito, preços, comparativo ou case |
| **Inscrito** | E-mail capturado com opt-in, em waitlist ou isca |
| **MQL** | Inscrito que declarou 2+ depósitos E consumiu 1+ material MOFU ou visitou preços |
| **SQL** | MQL que iniciou teste E cadastrou o segundo depósito |
| **Teste iniciado** | Conta criada com primeiro login concluído (conta criada sem login não conta) |
| **Ativação** | Ver seção 4 — os quatro critérios em até 14 dias |
| **TTV (time to value)** | Horas entre o primeiro login e a primeira transferência entre depósitos concluída |
| **Conta ativa** | Conta com pelo menos 1 movimento de estoque nos últimos 7 dias |
| **MRR** | Soma das assinaturas mensais recorrentes; anual dividido por 12; sem taxas de setup |
| **Novo MRR** | MRR de contas que entraram no mês |
| **MRR de expansão** | Aumento em contas existentes: mais depósitos, mais usuários, upgrade de plano |
| **MRR de contração** | Redução em contas existentes que permaneceram (downgrade) |
| **MRR perdido (churn)** | MRR de contas que cancelaram no mês |
| **ARPA** | MRR total / clientes ativos pagantes |
| **Churn de clientes** | Contas canceladas no mês / contas ativas no início do mês |
| **Churn de receita** | (MRR perdido − MRR de expansão) / MRR do início do mês |
| **NRR** | (MRR inicial da coorte + expansão − contração − perdido) / MRR inicial da coorte |
| **Coorte** | Grupo de contas agrupadas pelo mês de início da assinatura paga |
| **Health score** | Índice 0-100 de saúde da conta (critérios em `06-retencao-e-expansao.md`) |

Regras de contagem que evitam discussão:
- Teste não entra em MRR, nem como valor "potencial".
- Conta em inadimplência sai de MRR no dia do cancelamento efetivo, não no dia do vencimento.
- Churn por inadimplência é reportado em coluna separada do churn voluntário.
- Multi-empresa: a conta é a unidade de cobrança, não o CNPJ. Nova empresa dentro da mesma conta é
  expansão, não novo cliente.

---

## 4. Definição de "usuário ativado" no EstoqueFlow

Ativação é o conceito mais importante deste arquivo, porque é o que separa cliente que fica de cliente
que cancela no terceiro mês. Definição específica deste produto:

> **Uma conta está ativada quando, nos primeiros 14 dias, ela cumpre os quatro critérios:**
> 1. **Dois ou mais depósitos cadastrados** — sem isso, o produto não é o que vendemos
> 2. **Pelo menos 20 produtos cadastrados** — massa mínima para o dado significar algo
> 3. **Pelo menos uma transferência entre depósitos concluída** — o momento de valor
> 4. **Pelo menos um relatório de gestão aberto** (valor por depósito, abaixo do mínimo, ABC ou giro)
>    — sinal de que o dado virou decisão

Os quatro são obrigatórios. Três de quatro é "quase ativado" e vira fila de contato do CS.

**Sinais de ativação profunda** (não obrigatórios, mas fortes preditores de retenção):
- Primeiro inventário cíclico concluído com divergência apurada
- Segundo usuário convidado para a conta
- Espelho no Google Sheets aberto ao menos uma vez
- Venda registrada no PDV
- Uso na terceira semana seguida

**Como usar:** a taxa de ativação é o número que o marketing e o CS compartilham. Campanha que traz
muito teste e pouca ativação está trazendo o público errado — o problema é de segmentação, não de produto.

---

## 5. Eventos a rastrear no app

Nomenclatura: `substantivo_verbo_no_passado`, minúsculo, com underline. Todo evento carrega
`conta_id`, `usuario_id`, `empresa_id`, `plano`, `timestamp`.

| Evento | Propriedades | Para que serve |
|---|---|---|
| `conta_criada` | origem_utm, segmento_declarado, depositos_declarados | Início do funil de produto |
| `primeiro_login_realizado` | — | Marca o início do TTV |
| `tutorial_iniciado` | — | Denominador da conclusão do tutorial |
| `tutorial_concluido` | passos_concluidos, duracao_segundos | Qualidade do onboarding |
| `deposito_criado` | total_depositos | Critério 1 de ativação |
| `produto_criado` | metodo (manual/codigo_barras/importacao), total_produtos | Critério 2 de ativação |
| `codigo_barras_utilizado` | contexto (cadastro/entrada/saida/contagem) | Adoção de recurso antifricção |
| `movimento_entrada_registrado` | quantidade, valor_total, deposito_id | Uso básico |
| `movimento_saida_registrado` | quantidade, deposito_id | Uso básico |
| `transferencia_concluida` | deposito_origem, deposito_destino, itens, valor_total | **North star** e critério 3 |
| `ajuste_registrado` | motivo, quantidade, deposito_id | Sinal de divergência operacional |
| `venda_pdv_registrada` | itens, valor_total, deposito_id | Adoção do PDV |
| `inventario_iniciado` | itens_previstos, deposito_id | Início de contagem |
| `inventario_concluido` | itens_contados, divergencias, valor_divergencia | Ativação profunda |
| `relatorio_aberto` | tipo (valor_deposito/abaixo_minimo/abc/giro_cobertura) | Critério 4 de ativação |
| `espelho_sheets_aberto` | — | Redução de objeção de aprisionamento |
| `empresa_adicionada` | total_empresas | Sinal de expansão |
| `usuario_convidado` | papel, total_usuarios | Sinal de expansão e retenção |
| `plano_alterado` | de_plano, para_plano, motivo | Expansão / contração |
| `assinatura_cancelada` | motivo_declarado, dias_de_vida | Análise de churn |

**Instrumentação mínima viável:** se só der para instrumentar cinco eventos no começo, instrumente
`primeiro_login_realizado`, `deposito_criado`, `produto_criado`, `transferencia_concluida` e
`relatorio_aberto`. Com esses cinco a taxa de ativação inteira é calculável.

**Higiene:** evento disparado no servidor sempre que possível (bloqueador de anúncio derruba evento de
navegador). Nunca envie dado pessoal sensível nas propriedades. Toda mudança de nome de evento é
versionada e comunicada — renomear evento sem aviso quebra série histórica.

---

## 6. Propriedades de conta

Mantenha atualizadas para segmentar campanha e CS sem consulta ao banco:

`segmento` (distribuidora / ecommerce / industria / varejo / outro), `qtd_depositos`, `qtd_empresas`,
`qtd_usuarios`, `qtd_produtos`, `plano`, `mrr`, `data_inicio_teste`, `data_inicio_pago`, `ativada`
(sim/não), `data_ativacao`, `ttv_horas`, `transferencias_ultimos_30d`, `ultimo_movimento_em`,
`health_score`, `origem` (canal/UTM), `nps_ultimo`.

---

## 7. Relatório semanal

Uma página, mesma estrutura toda semana, enviada segunda-feira de manhã. Formato fixo:

```markdown
# EstoqueFlow — Semana <NN> (<dd/mm> a <dd/mm>)

## North star
Transferências concluídas por conta ativa: <X> (semana anterior: <Y>, variação: <±Z%>)
Contas ativas: <N>   |   Total de transferências: <T>

## Funil
| Etapa | Semana | Anterior | Variação |
|---|---|---|---|
| Visitantes qualificados | | | |
| Inscritos | | | |
| MQL | | | |
| Testes iniciados | | | |
| SQL (2º depósito) | | | |
| Novos pagantes | | | |

## Ativação
Taxa de ativação (coorte que fez 14 dias esta semana): <%>
TTV mediano: <horas>
Contas "quase ativadas" (3 de 4 critérios): <lista com nome e critério faltante>

## Receita
MRR: <valor>  |  Novo: <valor>  |  Expansão: <valor>  |  Contração: <valor>  |  Perdido: <valor>

## Conteúdo e campanhas
Publicado: <lista>  |  Melhor peça: <peça + métrica>  |  Pior peça: <peça + hipótese>
Custo por teste iniciado por canal: <tabela curta>

## Três coisas
1. O que funcionou:
2. O que não funcionou:
3. O que fazemos nesta semana por causa disso:
```

Regra do relatório: nenhuma linha sem número, e a seção "Três coisas" é obrigatória. Relatório sem
decisão é enfeite.

---

## 8. Relatório mensal

Mais analítico, enviado até o 5º dia útil. Além de tudo do semanal, consolidado:

1. **Coortes de retenção** — tabela de retenção por mês de entrada (M0 a M6+), em clientes e em receita
2. **NRR do mês** e leitura: expansão está cobrindo o churn?
3. **CAC, LTV, payback por canal e por persona** (fórmulas em `04-aquisicao-e-funil.md`)
4. **Análise de churn** — motivos declarados agrupados, separando voluntário de inadimplência,
   e o health score que a conta tinha 60 dias antes de cancelar
5. **Ativação por origem** — qual canal traz teste que ativa (não só teste que entra)
6. **SEO** — posições ganhas e perdidas, páginas que entraram em top 10, pautas a atualizar
7. **Expansão** — contas que adicionaram depósito, empresa ou usuário no mês
8. **Decisões do mês** — o que muda no plano por causa dos números acima, com responsável e prazo

---

## 9. Armadilhas de medição

- **Vaidade:** seguidores, impressões e curtidas não entram no relatório principal. Se entrarem, viram
  meta e o time otimiza para o que não paga conta.
- **Média que esconde:** ARPA médio com 3 contas grandes e 40 pequenas não descreve nada. Reporte
  mediana junto com média.
- **Base pequena:** com menos de 30 conversões, variação semanal é ruído. Não tome decisão de verba em
  cima de oscilação sem volume.
- **Atribuição de último clique:** superestima busca de marca e subestima conteúdo e social. Olhe também
  a origem declarada no cadastro ("como você chegou até aqui?").
- **Ativação medida cedo demais:** medir ativação em 3 dias exclui o cliente que implanta devagar —
  e é exatamente ele que costuma ficar mais tempo. Por isso a janela é de 14 dias.
- **Benchmark importado:** número de SaaS americano não descreve distribuidora brasileira de 20
  funcionários. Qualquer benchmark citado é *faixa de referência do setor — valide com seus próprios dados.*
- **Mudar definição no meio do trimestre:** se precisar mudar, recalcule a série histórica inteira e
  avise. Série quebrada apaga aprendizado de meses.
