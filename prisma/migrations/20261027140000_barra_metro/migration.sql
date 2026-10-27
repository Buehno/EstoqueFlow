-- Barra × metro (27/10/2026): embalagem por comprimento no produto, sobra em
-- metros por depósito e metragem/sobra registradas no movimento.
ALTER TABLE "products"
  ADD COLUMN "pack_type" TEXT,
  ADD COLUMN "pack_length" DECIMAL(10,3);

ALTER TABLE "stock_items"
  ADD COLUMN "remnant" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "movements"
  ADD COLUMN "meters" DECIMAL(14,3),
  ADD COLUMN "remnant_from" DECIMAL(14,3),
  ADD COLUMN "remnant_to" DECIMAL(14,3);
