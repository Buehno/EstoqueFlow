-- Listas de compra (16/11/2026): carrinho do comprador montado a partir do
-- relatório de compras, salvo com nome e acompanhado por status
-- (aberta → pedida → comprada / cancelada), com entrada no estoque opcional.

-- CreateEnum
CREATE TYPE "PurchaseListStatus" AS ENUM ('ABERTA', 'PEDIDA', 'COMPRADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "purchase_lists" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "PurchaseListStatus" NOT NULL DEFAULT 'ABERTA',
    "name" TEXT NOT NULL,
    "supplier_id" UUID,
    "supplier_name" TEXT,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "ordered_at" TIMESTAMP(3),
    "ordered_by_name" TEXT,
    "bought_at" TIMESTAMP(3),
    "bought_by_name" TEXT,
    "canceled_at" TIMESTAMP(3),
    "canceled_by_name" TEXT,
    "stocked_at" TIMESTAMP(3),
    "stocked_warehouse_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_list_items" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "product_id" UUID,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "supplier_name" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stock_at_add" DECIMAL(14,3),
    "min_stock_at_add" DECIMAL(14,3),
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_lists_company_id_number_key" ON "purchase_lists"("company_id", "number");
CREATE INDEX "purchase_lists_company_id_status_idx" ON "purchase_lists"("company_id", "status");
CREATE INDEX "purchase_lists_company_id_created_at_idx" ON "purchase_lists"("company_id", "created_at");
CREATE INDEX "purchase_list_items_list_id_position_idx" ON "purchase_list_items"("list_id", "position");

-- AddForeignKey
ALTER TABLE "purchase_lists" ADD CONSTRAINT "purchase_lists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_lists" ADD CONSTRAINT "purchase_lists_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_lists" ADD CONSTRAINT "purchase_lists_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_list_items" ADD CONSTRAINT "purchase_list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "purchase_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_list_items" ADD CONSTRAINT "purchase_list_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
