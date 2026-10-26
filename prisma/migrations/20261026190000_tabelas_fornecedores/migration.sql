-- Tabelas de preço dos fornecedores (26/10/2026): preço à vista separado do
-- parcelado, condição de parcelamento, tabela/vigência de origem, código do
-- fornecedor e marcação de venda sob encomenda.
ALTER TABLE "products"
  ADD COLUMN "cash_price" DECIMAL(14,4),
  ADD COLUMN "installment_terms" TEXT,
  ADD COLUMN "price_table" TEXT,
  ADD COLUMN "price_table_date" DATE,
  ADD COLUMN "supplier_code" TEXT,
  ADD COLUMN "on_demand" BOOLEAN NOT NULL DEFAULT false;

-- Qual preço (parcelado / à vista) foi escolhido para o item da proposta.
ALTER TABLE "proposal_items" ADD COLUMN "price_mode" TEXT;
