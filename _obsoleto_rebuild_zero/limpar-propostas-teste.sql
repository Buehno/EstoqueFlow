-- EstoqueFlow — limpar propostas de teste/rascunho em produção
-- Rode isto no console de Postgres do Railway (Project → Postgres → Query),
-- passo a passo, na ordem. Não existe "desfazer" depois do COMMIT no passo 3,
-- então confira o resultado de cada passo antes de seguir para o próximo.

-- ============================================================
-- PASSO 1 — descobrir o nome exato da tabela de propostas
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name ILIKE '%propos%';

-- Anote o nome que aparecer (ex.: "Proposal", "proposals", "propostas").
-- Troque "NOME_DA_TABELA" pelo nome real em todos os passos abaixo.


-- ============================================================
-- PASSO 2 — ver quais status existem hoje e quantas propostas em cada um
-- ============================================================
SELECT status, COUNT(*) AS quantidade
FROM "NOME_DA_TABELA"
GROUP BY status
ORDER BY quantidade DESC;

-- O documento do módulo registra os status como:
--   Rascunho → Enviada → Aguardando retorno → Em negociação →
--   Aceita / Recusada / Expirada / Cancelada
-- mas o valor gravado no banco pode estar em outra grafia
-- (ex.: "Rascunho", "RASCUNHO", "draft"). Use o que aparecer aqui de verdade.


-- ============================================================
-- PASSO 2.5 — descobrir se há tabela de itens de proposta apontando
-- para ela (pra não travar por chave estrangeira no DELETE)
-- ============================================================
SELECT tc.table_name AS tabela_filha, kcu.column_name AS coluna_fk
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'NOME_DA_TABELA';

-- Se aparecer uma tabela filha (ex.: itens da proposta) SEM exclusão em
-- cascata configurada, apague primeiro os itens dela (WHERE proposal_id IN
-- (SELECT id FROM "NOME_DA_TABELA" WHERE status ILIKE '%rascunho%')) antes
-- do passo 3. Se o DELETE do passo 3 der erro de chave estrangeira, é isso.


-- ============================================================
-- PASSO 3 — apagar só as de teste/rascunho, dentro de uma transação
-- ============================================================
BEGIN;

DELETE FROM "NOME_DA_TABELA"
WHERE status ILIKE '%rascunho%';
-- ^ ajuste este WHERE para bater exatamente com o valor visto no PASSO 2.
--   Ex.: WHERE status = 'Rascunho'  ou  WHERE status = 'draft'

-- O próprio comando acima mostra "DELETE n" com o número de linhas afetadas.
-- Confira se bate com o esperado.

-- Se bateu certinho:
COMMIT;

-- Se não bateu, ou você não tiver certeza:
-- ROLLBACK;
