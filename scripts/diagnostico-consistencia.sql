-- ============================================================================
--  diagnostico-consistencia.sql
--  Confere a saúde do banco de produção — 100% LEITURA, nenhum UPDATE/DELETE.
--
--  Como rodar: abra o console Postgres do Railway (aba "Data" do serviço
--  Postgres, ou `railway connect Postgres` na CLI) e cole este arquivo
--  inteiro. Cada bloco imprime um título e, se houver alguma linha,
--  é algo que vale olhar — nenhum resultado é o cenário esperado/bom.
--
--  Pedido de 20/09: "valida se a base esta boa e consistente". Como este
--  ambiente não pode ler/escrever direto no Postgres de produção (restrição
--  de segurança da sessão), o diagnóstico sai como script para você rodar
--  você mesmo, com uma explicação de cada verificação.
-- ============================================================================

-- 1) Saldos negativos — nunca deveriam existir (toda saída/venda checa saldo
--    antes de confirmar, exceto quando allowNegative foi usado de propósito).
SELECT 'saldos negativos' AS verificacao, si.id, p.name AS produto, w.name AS deposito, si.quantity
FROM stock_items si
JOIN products p ON p.id = si.product_id
JOIN warehouses w ON w.id = si.warehouse_id
WHERE si.quantity < 0;

-- 2) stock_items órfãos — produto ou depósito que não existe mais (não deveria
--    acontecer: as FKs são ON DELETE CASCADE, mas vale conferir).
SELECT 'stock_item orfao (produto sumiu)' AS verificacao, si.id, si.product_id
FROM stock_items si
LEFT JOIN products p ON p.id = si.product_id
WHERE p.id IS NULL;

SELECT 'stock_item orfao (deposito sumiu)' AS verificacao, si.id, si.warehouse_id
FROM stock_items si
LEFT JOIN warehouses w ON w.id = si.warehouse_id
WHERE w.id IS NULL;

-- 3) SKU ou código de barras duplicado dentro da mesma empresa — o schema tem
--    UNIQUE(company_id, sku) e UNIQUE(company_id, barcode), então isso só
--    apareceria se alguma migração antiga tiver rodado sem a constraint.
SELECT 'sku duplicado' AS verificacao, company_id, sku, count(*)
FROM products
GROUP BY company_id, sku
HAVING count(*) > 1;

SELECT 'codigo de barras duplicado' AS verificacao, company_id, barcode, count(*)
FROM products
WHERE barcode IS NOT NULL
GROUP BY company_id, barcode
HAVING count(*) > 1;

-- 4) Movimento sem produto ou usuário existente (não deveria acontecer —
--    FKs sem CASCADE aqui de propósito, para nunca perder a trilha).
SELECT 'movimento com produto orfao' AS verificacao, m.id, m.number, m.product_id
FROM movements m
LEFT JOIN products p ON p.id = m.product_id
WHERE p.id IS NULL;

-- 5) Contas travadas em "precisa trocar senha" há muito tempo (>30 dias) —
--    sinal de usuário criado que nunca fez o primeiro login.
SELECT 'conta travada ha mais de 30 dias sem trocar senha' AS verificacao,
       u.id, u.name, u.email, u.created_at
FROM users u
WHERE u.must_change_password = true
  AND u.created_at < now() - interval '30 days'
  AND u.active = true;

-- 6) Propostas "esquecidas" em RASCUNHO há muito tempo (>60 dias) — não é bug,
--    mas costuma ser proposta morta poluindo a lista de quem vende.
SELECT 'proposta em rascunho ha mais de 60 dias' AS verificacao,
       p.id, p.number, p.client_name, p.created_at
FROM proposals p
WHERE p.status = 'RASCUNHO' AND p.created_at < now() - interval '60 days'
ORDER BY p.created_at;

-- 7) Propostas vencidas (validade estourada) que ainda estão "em aberto" —
--    deveriam virar EXPIRADA; se aparecerem aqui, o filtro de follow-up do
--    dashboard não está pegando essas.
SELECT 'proposta vencida ainda em aberto' AS verificacao,
       p.id, p.number, p.client_name, p.status, p.valid_until
FROM proposals p
WHERE p.status IN ('RASCUNHO','ENVIADA','AGUARDANDO_RETORNO','EM_NEGOCIACAO')
  AND p.valid_until IS NOT NULL AND p.valid_until < now();

-- 8) Movimento do tipo ENTRADA/SAIDA/TRANSFERENCIA/AJUSTE sem nenhum saldo de
--    estoque correspondente (produto+depósito) — indício de stock_item
--    apagado manualmente depois do movimento já ter existido.
SELECT 'movimento sem stock_item correspondente' AS verificacao,
       m.id, m.number, m.type, m.product_id,
       coalesce(m.to_warehouse_id, m.from_warehouse_id) AS deposito
FROM movements m
LEFT JOIN stock_items si
  ON si.product_id = m.product_id
 AND si.warehouse_id = coalesce(m.to_warehouse_id, m.from_warehouse_id)
WHERE si.id IS NULL
  AND coalesce(m.to_warehouse_id, m.from_warehouse_id) IS NOT NULL;

-- 9) Diferença entre o saldo atual (stock_items) e o saldo recalculado a
--    partir do histórico de movimentos confirmados — é a checagem mais forte:
--    se der diferente de zero, o saldo "oficial" divergiu da soma real dos
--    lançamentos. (Não conta ESTORNADO, que já tem o estorno como novo
--    lançamento somado separadamente.)
WITH recalculado AS (
  SELECT
    product_id,
    coalesce(to_warehouse_id, from_warehouse_id) AS warehouse_id,
    sum(
      CASE
        WHEN to_warehouse_id IS NOT NULL AND from_warehouse_id IS NULL THEN quantity   -- entra no depósito
        WHEN from_warehouse_id IS NOT NULL AND to_warehouse_id IS NULL THEN -quantity  -- sai do depósito
        ELSE 0 -- transferência é tratada nas duas linhas abaixo
      END
    ) AS saldo_entrada_saida
  FROM movements
  WHERE status = 'CONFIRMADO' AND type IN ('ENTRADA','SAIDA','AJUSTE','VENDA')
  GROUP BY product_id, coalesce(to_warehouse_id, from_warehouse_id)
),
transferencias AS (
  SELECT product_id, to_warehouse_id AS warehouse_id, sum(quantity) AS saldo
  FROM movements WHERE status = 'CONFIRMADO' AND type = 'TRANSFERENCIA' AND to_warehouse_id IS NOT NULL
  GROUP BY product_id, to_warehouse_id
  UNION ALL
  SELECT product_id, from_warehouse_id AS warehouse_id, -sum(quantity) AS saldo
  FROM movements WHERE status = 'CONFIRMADO' AND type = 'TRANSFERENCIA' AND from_warehouse_id IS NOT NULL
  GROUP BY product_id, from_warehouse_id
),
somado AS (
  SELECT product_id, warehouse_id, sum(saldo_entrada_saida) AS saldo FROM (
    SELECT product_id, warehouse_id, saldo_entrada_saida FROM recalculado
    UNION ALL
    SELECT product_id, warehouse_id, saldo FROM transferencias
  ) x
  GROUP BY product_id, warehouse_id
)
SELECT 'saldo atual diverge do historico de movimentos' AS verificacao,
       p.name AS produto, w.name AS deposito,
       si.quantity AS saldo_atual, s.saldo AS saldo_pelo_historico,
       si.quantity - s.saldo AS diferenca
FROM somado s
JOIN stock_items si ON si.product_id = s.product_id AND si.warehouse_id = s.warehouse_id
JOIN products p ON p.id = s.product_id
JOIN warehouses w ON w.id = s.warehouse_id
WHERE si.quantity <> s.saldo
ORDER BY abs(si.quantity - s.saldo) DESC;

-- 10) Contagem geral — não é um teste de erro, é só um retrato do tamanho da
--     base para acompanhar o crescimento ao longo do tempo.
SELECT 'contagem geral' AS verificacao,
  (SELECT count(*) FROM companies)  AS empresas,
  (SELECT count(*) FROM users WHERE active) AS usuarios_ativos,
  (SELECT count(*) FROM products WHERE active) AS produtos_ativos,
  (SELECT count(*) FROM movements) AS movimentos,
  (SELECT count(*) FROM sales) AS vendas,
  (SELECT count(*) FROM proposals) AS propostas,
  (SELECT count(*) FROM proposal_templates WHERE active) AS modelos_de_proposta;
