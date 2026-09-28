-- ============================================================================
--  retrato-pre-melhorias.sql   ·   24/09/2026
--  Retrato do estoque DEPOIS da contagem física e ANTES de qualquer melhoria.
--  100% LEITURA — nenhum INSERT, UPDATE ou DELETE. Rodar é seguro a qualquer hora.
--
--  Para que serve: guardar a foto do que está no banco hoje (a contagem que a
--  Daniele subiu) e listar, com nome e número, os três problemas apontados:
--  duplicidade, quantidade quebrada em item de unidade, e a situação do
--  estoque mínimo pela regra nova.
--
--  Como rodar: console Postgres do Railway (serviço Postgres → aba Data →
--  Query). Cole um bloco por vez e exporte o resultado (botão de download do
--  console) — cada bloco vira uma aba da planilha de conferência.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- BLOCO 1 · RETRATO COMPLETO — uma linha por produto, com saldo dos dois
-- depósitos e o total. É esta a foto que precisa ser guardada antes de tudo.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.sku                                   AS codigo,
  p.name                                  AS produto,
  p.unit                                  AS unidade,
  p.size                                  AS tamanho,
  c.name                                  AS categoria,
  coalesce(sum(si.quantity) FILTER (WHERE w.code = 'DEP-1'), 0) AS dep_1,
  coalesce(sum(si.quantity) FILTER (WHERE w.code = 'DEP-2'), 0) AS dep_2,
  coalesce(sum(si.quantity), 0)           AS total,
  p.min_stock                             AS estoque_minimo,
  p.cost_price                            AS custo,
  p.sale_price                            AS venda,
  round(coalesce(sum(si.quantity * si.avg_cost), 0), 2) AS valor_em_estoque,
  p.active                                AS ativo
FROM products p
LEFT JOIN stock_items si ON si.product_id = p.id
LEFT JOIN warehouses w   ON w.id = si.warehouse_id
LEFT JOIN categories c   ON c.id = p.category_id
GROUP BY p.id, c.name
ORDER BY p.name;

-- ─────────────────────────────────────────────────────────────────────────
-- BLOCO 2 · TOTAIS GERAIS — números que servem de conferência depois de
-- qualquer mudança: se estes não baterem, alguma coisa se perdeu.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM products WHERE active)                AS produtos_ativos,
  (SELECT count(*) FROM products)                             AS produtos_total,
  (SELECT round(sum(quantity), 3) FROM stock_items)           AS unidades_em_estoque,
  (SELECT round(sum(quantity * avg_cost), 2) FROM stock_items) AS valor_total_estoque,
  (SELECT count(*) FROM movements)                            AS movimentos,
  (SELECT max(created_at) FROM movements)                     AS ultimo_movimento,
  (SELECT count(*) FROM movements WHERE created_at::date = current_date) AS movimentos_de_hoje,
  (SELECT count(*) FROM sales)                                AS vendas,
  (SELECT count(*) FROM proposals)                            AS propostas;

-- ─────────────────────────────────────────────────────────────────────────
-- BLOCO 3 · DUPLICIDADE — produtos com nome praticamente igual (ignorando
-- acento, maiúscula, pontuação e espaço). Mostra o saldo de cada um, para
-- decidir qual fica e para onde vai o saldo do que sair.
-- ─────────────────────────────────────────────────────────────────────────
WITH normalizado AS (
  SELECT
    p.id, p.sku, p.name, p.unit, p.size, p.active, p.created_at,
    regexp_replace(lower(translate(p.name,
      'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
      '[^a-z0-9]', '', 'g') AS chave,
    coalesce((SELECT sum(si.quantity) FROM stock_items si WHERE si.product_id = p.id), 0) AS total
  FROM products p
)
SELECT n.chave AS chave_comparacao, n.sku AS codigo, n.name AS produto,
       n.unit AS unidade, n.size AS tamanho, n.total AS saldo_total,
       n.active AS ativo, n.created_at AS criado_em
FROM normalizado n
WHERE n.chave IN (SELECT chave FROM normalizado GROUP BY chave HAVING count(*) > 1)
ORDER BY n.chave, n.created_at;

-- ─────────────────────────────────────────────────────────────────────────
-- BLOCO 4 · QUANTIDADE QUEBRADA EM ITEM DE UNIDADE — saldo com casa decimal
-- em produto que não é vendido por medida (MT, M, CM, M2, KG, L).
-- É o caso do "cotovelo de cobre 33,845".
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.sku AS codigo, p.name AS produto, p.unit AS unidade,
       w.code AS deposito, si.quantity AS saldo_atual,
       round(si.quantity) AS saldo_arredondado,
       round(si.quantity) - si.quantity AS diferenca
FROM stock_items si
JOIN products p   ON p.id = si.product_id
JOIN warehouses w ON w.id = si.warehouse_id
WHERE si.quantity <> round(si.quantity)
  AND upper(coalesce(p.unit, 'UN')) NOT IN ('MT','M','CM','MM','M2','M²','M3','M³','KG','G','L','ML')
ORDER BY abs(round(si.quantity) - si.quantity) DESC, p.name;

-- ─────────────────────────────────────────────────────────────────────────
-- BLOCO 5 · REGRA NOVA DE COMPRA, pelo TOTAL dos dois depósitos
--   total <= 50% do mínimo  → ALERTA DE COMPRA
--   total <= mínimo         → ATENÇÃO
--   acima do mínimo         → OK
-- ─────────────────────────────────────────────────────────────────────────
WITH saldo AS (
  SELECT p.id, p.sku, p.name, p.unit, p.min_stock,
         coalesce(sum(si.quantity) FILTER (WHERE w.code = 'DEP-1'), 0) AS dep_1,
         coalesce(sum(si.quantity) FILTER (WHERE w.code = 'DEP-2'), 0) AS dep_2,
         coalesce(sum(si.quantity), 0) AS total
  FROM products p
  LEFT JOIN stock_items si ON si.product_id = p.id
  LEFT JOIN warehouses w   ON w.id = si.warehouse_id
  WHERE p.active
  GROUP BY p.id
)
SELECT sku AS codigo, name AS produto, unit AS unidade,
       dep_1, dep_2, total, min_stock AS estoque_minimo,
       round(min_stock * 0.5, 3) AS ponto_de_compra,
       CASE WHEN min_stock <= 0                   THEN 'SEM MINIMO DEFINIDO'
            WHEN total <= min_stock * 0.5         THEN 'ALERTA DE COMPRA'
            WHEN total <= min_stock               THEN 'ATENCAO'
            ELSE 'OK' END                          AS situacao,
       CASE WHEN min_stock > 0 AND total < min_stock
            THEN round(min_stock - total, 3) ELSE 0 END AS comprar_para_repor
FROM saldo
ORDER BY CASE WHEN min_stock <= 0 THEN 3
              WHEN total <= min_stock * 0.5 THEN 0
              WHEN total <= min_stock THEN 1 ELSE 2 END,
         (total - min_stock);

-- ─────────────────────────────────────────────────────────────────────────
-- BLOCO 6 · AS 7 PEÇAS DO PDF DE DUPLICIDADE, com os possíveis "gêmeos"
-- que ficam na base. Serve para conferir, antes de desativar qualquer uma,
-- se ela tem saldo e para onde esse saldo precisa ir.
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.sku AS codigo, p.name AS produto, p.unit AS unidade, p.size AS tamanho,
       p.active AS ativo,
       coalesce((SELECT sum(si.quantity) FROM stock_items si WHERE si.product_id = p.id), 0) AS saldo_total,
       (SELECT count(*) FROM movements m WHERE m.product_id = p.id) AS movimentos,
       (SELECT count(*) FROM sale_items s WHERE s.product_id = p.id) AS vendas,
       (SELECT count(*) FROM proposal_items pi WHERE pi.product_id = p.id) AS em_propostas
FROM products p
WHERE lower(p.name) LIKE '%registro esfera%1/2%'
   OR lower(p.name) LIKE '%niple metal%1/2%'
   OR lower(p.name) LIKE '%te marrom redutor%'
   OR lower(p.name) LIKE '%adaptador solis%'
   OR lower(p.name) LIKE '%filtro de linha%'
ORDER BY p.name, p.created_at;
