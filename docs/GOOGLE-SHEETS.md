# Redundância em Google Sheets — configuração passo a passo

A planilha é um **espelho somente-leitura** do Postgres. Este guia liga a replicação em
menos de 10 minutos.

Planilha do projeto:
<https://docs.google.com/spreadsheets/d/1yOGaeneRM-PjSlxnpUKZ7QoLvMOOMAO29k0wSITlQnE/edit>

---

## 1. Criar a Service Account

1. Acesse <https://console.cloud.google.com/> e crie (ou escolha) um projeto.
2. **APIs e serviços → Biblioteca** → habilite **Google Sheets API**.
3. **APIs e serviços → Credenciais → Criar credenciais → Conta de serviço**.
   - Nome: `estoqueflow-sync`
   - Papel: nenhum é necessário (o acesso vem do compartilhamento da planilha).
4. Abra a conta criada → aba **Chaves** → **Adicionar chave → Criar nova chave → JSON**.
   Um arquivo `.json` é baixado. Guarde-o: ele não pode ser baixado de novo.

O JSON tem esta cara:

```json
{
  "type": "service_account",
  "project_id": "meu-projeto",
  "private_key_id": "…",
  "private_key": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n",
  "client_email": "estoqueflow-sync@meu-projeto.iam.gserviceaccount.com",
  …
}
```

---

## 2. Dar acesso à planilha

1. Abra a planilha.
2. **Compartilhar** → cole o `client_email` da Service Account.
3. Papel: **Editor**. É a única conta que precisa escrever.
4. Para a equipe humana, compartilhe como **Leitor** — é isso que torna a planilha
   verdadeiramente somente-leitura para as pessoas.

> Mesmo que alguém com permissão de edição altere uma célula, o **guardião** do sistema
> reverte o valor no próximo ciclo (padrão: 5 minutos) e registra o ocorrido em
> `sheet_guard_logs`, visível na tela **Integrações**.

---

## 3. Publicar as variáveis

No Railway (ou no seu `.env`):

| Variável | Valor |
|---|---|
| `GOOGLE_SHEET_ID` | `1yOGaeneRM-PjSlxnpUKZ7QoLvMOOMAO29k0wSITlQnE` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **o conteúdo inteiro do JSON, em uma linha** |
| `SHEET_SYNC_ENABLED` | `true` |

Para colar o JSON em uma linha:

```bash
node -e "console.log(JSON.stringify(require('fs').readFileSync('chave.json','utf8')))"
```

Alternativa sem o JSON completo:

```
GOOGLE_CLIENT_EMAIL=estoqueflow-sync@meu-projeto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
```

Reinicie o serviço. No boot o sistema cria as abas e os cabeçalhos automaticamente.

---

## 4. Conferir

Entre em **Integrações** na aplicação. Você deve ver:

- `Google Sheets · sincronizando`
- fila pendente zerando a cada 30 segundos
- link direto para a planilha

Botões disponíveis:

| Botão | O que faz |
|---|---|
| **Sincronizar agora** | Processa a fila imediatamente |
| **Recriar planilha** | Reenfileira **tudo** e reescreve a planilha do zero |

---

## 5. Abas geradas

| Aba | Chave (coluna A) | Conteúdo |
|---|---|---|
| `Produtos` | id do produto | catálogo completo |
| `Estoque` | `productId:warehouseId` | saldo, custo médio, valor, flag de mínimo |
| `Movimentacoes` | id do movimento | toda a trilha de auditoria |
| `Vendas` | id da venda | cupons do PDV |

A coluna A é a chave natural usada para o *upsert* — **não a edite nem a reordene**, ou o
guardião tratará a linha como órfã.

---

## 6. Como funciona por dentro

```
┌───────────────┐   mesma transação    ┌──────────────┐
│  movimento    │ ───────────────────► │ sync_outbox  │
└───────────────┘                      └──────┬───────┘
                                              │ worker a cada 30s
                                              ▼
                                    ┌─────────────────────┐
                                    │  Google Sheets API  │
                                    │  batchUpdate/append │
                                    └─────────┬───────────┘
                                              │
                     guardião a cada 5min ◄───┘
                     lê a planilha, compara com o Postgres
                     e reescreve o que divergir
```

- **Atomicidade** — o evento de sincronização é criado na mesma transação do movimento.
  Se o movimento falhar, nada é enfileirado.
- **Idempotência** — o upsert usa a chave da coluna A; reprocessar não duplica linhas.
- **Resiliência** — falhas são reprocessadas até 5 tentativas, com o erro registrado.
  A indisponibilidade do Google **nunca** bloqueia uma operação de estoque.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `The caller does not have permission` | Service Account sem acesso | Compartilhe a planilha como Editor com o `client_email` |
| `Unable to parse range` | Aba renomeada ou apagada | Use **Recriar planilha** |
| `error:1E08010C:DECODER routines` | Quebras de linha da chave privada | Garanta `\n` literais no `GOOGLE_PRIVATE_KEY` |
| Fila cresce e não envia | Cota da API estourada | Aumente `SHEET_SYNC_INTERVAL_MS` |
| Status "desativado" | Falta variável | Confira `GOOGLE_SHEET_ID` e as credenciais |
