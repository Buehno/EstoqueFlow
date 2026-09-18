-- AlterTable
ALTER TABLE "products" ADD COLUMN     "search_text" TEXT;

-- CreateIndex
CREATE INDEX "products_company_id_search_text_idx" ON "products"("company_id", "search_text");

-- Preenche o texto de busca dos produtos já existentes (minúsculo, sem acento).
UPDATE "products"
SET "search_text" = translate(
  lower(
    coalesce("name", '') || ' ' ||
    coalesce("description", '') || ' ' ||
    coalesce("size", '') || ' ' ||
    coalesce("unit", '') || ' ' ||
    coalesce("sku", '') || ' ' ||
    coalesce("barcode", '')
  ),
  'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
  'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
);
