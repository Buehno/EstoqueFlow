-- AlterTable
ALTER TABLE "products" ADD COLUMN     "measure" DECIMAL(14,4),
ADD COLUMN     "measure_unit" TEXT,
ADD COLUMN     "size" TEXT;

-- CreateIndex
CREATE INDEX "products_company_id_size_idx" ON "products"("company_id", "size");
