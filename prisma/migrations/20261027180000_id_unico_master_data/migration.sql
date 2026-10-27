-- ID único / master data (27/10/2026): prefixo por categoria + sequencial,
-- com o código antigo preservado em legacy_sku.
ALTER TABLE "categories" ADD COLUMN "code_prefix" TEXT;
ALTER TABLE "products" ADD COLUMN "legacy_sku" TEXT;
CREATE INDEX "products_company_id_legacy_sku_idx" ON "products"("company_id", "legacy_sku");
