-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('RASCUNHO', 'ENVIADA', 'AGUARDANDO_RETORNO', 'EM_NEGOCIACAO', 'ACEITA', 'RECUSADA', 'EXPIRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ProposalEventType" AS ENUM ('CRIADA', 'EDITADA', 'ENVIADA', 'RETORNO_CLIENTE', 'FOLLOW_UP', 'STATUS_ALTERADO', 'NOTA', 'EXPORTADA');

-- CreateTable
CREATE TABLE "proposal_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope_title" TEXT NOT NULL,
    "intro" TEXT,
    "payment_terms" TEXT,
    "payment_cash" TEXT,
    "delivery_terms" TEXT,
    "validity_days" INTEGER NOT NULL DEFAULT 10,
    "closing_note" TEXT,
    "footer_note" TEXT,
    "sales_rep" TEXT,
    "city" TEXT DEFAULT 'Jundiaí',
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_template_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "quantity_text" TEXT,
    "description" TEXT NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "product_id" UUID,

    CONSTRAINT "proposal_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'RASCUNHO',
    "customer_id" UUID,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT,
    "client_email" TEXT,
    "client_local" TEXT,
    "client_document" TEXT,
    "scope_title" TEXT NOT NULL,
    "intro" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_in_words" TEXT,
    "payment_terms" TEXT,
    "payment_cash" TEXT,
    "cash_total" DECIMAL(14,2),
    "delivery_terms" TEXT,
    "validity_days" INTEGER NOT NULL DEFAULT 10,
    "valid_until" TIMESTAMP(3),
    "closing_note" TEXT,
    "footer_note" TEXT,
    "sales_rep" TEXT,
    "city" TEXT DEFAULT 'Jundiaí',
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "follow_up_at" TIMESTAMP(3),
    "lost_reason" TEXT,
    "notes" TEXT,
    "template_id" UUID,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_items" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "quantity_text" TEXT,
    "unit" TEXT DEFAULT 'UN',
    "description" TEXT NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "product_id" UUID,
    "stock_at_insert" DECIMAL(14,3),

    CONSTRAINT "proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_events" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "type" "ProposalEventType" NOT NULL,
    "from_status" "ProposalStatus",
    "to_status" "ProposalStatus",
    "message" TEXT,
    "user_id" UUID,
    "user_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_templates_company_id_active_idx" ON "proposal_templates"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_templates_company_id_name_key" ON "proposal_templates"("company_id", "name");

-- CreateIndex
CREATE INDEX "proposal_template_items_template_id_position_idx" ON "proposal_template_items"("template_id", "position");

-- CreateIndex
CREATE INDEX "proposals_company_id_status_idx" ON "proposals"("company_id", "status");

-- CreateIndex
CREATE INDEX "proposals_company_id_created_at_idx" ON "proposals"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "proposals_customer_id_idx" ON "proposals"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_company_id_number_key" ON "proposals"("company_id", "number");

-- CreateIndex
CREATE INDEX "proposal_items_proposal_id_position_idx" ON "proposal_items"("proposal_id", "position");

-- CreateIndex
CREATE INDEX "proposal_events_proposal_id_created_at_idx" ON "proposal_events"("proposal_id", "created_at");

-- AddForeignKey
ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_template_items" ADD CONSTRAINT "proposal_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "proposal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_template_items" ADD CONSTRAINT "proposal_template_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "proposal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
