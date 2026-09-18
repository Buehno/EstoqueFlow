import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, D, nextNumber } from '../lib/prisma.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { enqueueMovement, enqueueSale, enqueueStock } from './sync.service.js';

type Tx = Prisma.TransactionClient;

/**
 * Mesmo motivo do `getOrCreateStock` de `stock.service.ts` (achado no teste
 * de força de 18/09): sem travar a linha, duas vendas/cancelamentos
 * concorrentes no mesmo produto+depósito liam o mesmo saldo e uma
 * sobrescrevia a outra em silêncio. `FOR UPDATE` serializa as transações
 * concorrentes nessa linha em vez de deixar as duas lerem o mesmo número.
 */
async function lockStock(tx: Tx, productId: string, warehouseId: string) {
  await tx.$executeRaw`
    INSERT INTO stock_items (id, product_id, warehouse_id, quantity, reserved, avg_cost, updated_at)
    VALUES (${randomUUID()}::uuid, ${productId}::uuid, ${warehouseId}::uuid, 0, 0, 0, now())
    ON CONFLICT (product_id, warehouse_id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    { id: string; quantity: Prisma.Decimal; reserved: Prisma.Decimal; avg_cost: Prisma.Decimal }[]
  >`
    SELECT id, quantity, reserved, avg_cost FROM stock_items
    WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid
    FOR UPDATE
  `;
  const r = rows[0];
  return {
    id: r.id,
    quantity: new Prisma.Decimal(r.quantity),
    reserved: new Prisma.Decimal(r.reserved),
    avgCost: new Prisma.Decimal(r.avg_cost),
  };
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
}

export interface CreateSaleInput {
  companyId: string;
  userId: string;
  warehouseId: string;
  items: SaleItemInput[];
  customerId?: string;
  customerName?: string;
  discount?: number;
  payment?: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'BOLETO' | 'OUTRO';
  received?: number;
  notes?: string;
}

/**
 * VENDA BALCÃO — cria a venda, baixa o estoque do depósito escolhido e
 * gera um movimento tipo VENDA por item. Tudo numa única transação.
 */
export async function criarVenda(input: CreateSaleInput) {
  if (!input.items?.length) throw badRequest('Adicione ao menos um item à venda.');

  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouseId, companyId: input.companyId, active: true },
    });
    if (!warehouse) throw notFound('Depósito de venda não encontrado.');

    const ids = input.items.map((i) => i.productId);
    const products = await tx.product.findMany({
      where: { id: { in: ids }, companyId: input.companyId },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let subtotal = new Prisma.Decimal(0);
    let costTotal = new Prisma.Decimal(0);
    const prepared: {
      productId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      discount: Prisma.Decimal;
      total: Prisma.Decimal;
      stockId: string;
      newQty: Prisma.Decimal;
    }[] = [];

    // Trava os saldos em ordem fixa por productId (não pela ordem dos itens
    // na venda) — duas vendas concorrentes com os mesmos produtos em ordem
    // diferente na sacola não podem deadlockar uma na outra.
    const itensEmOrdem = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
    const saldosTravados = new Map<string, Awaited<ReturnType<typeof lockStock>>>();
    for (const item of itensEmOrdem) {
      saldosTravados.set(item.productId, await lockStock(tx, item.productId, input.warehouseId));
    }

    for (const item of input.items) {
      const product = byId.get(item.productId);
      if (!product) throw notFound(`Produto ${item.productId} não encontrado.`);
      if (item.quantity <= 0) throw badRequest(`Quantidade inválida para "${product.name}".`);

      const stock = saldosTravados.get(item.productId)!;
      const qty = D(item.quantity);
      if (stock.quantity.lt(qty)) {
        throw unprocessable(
          `Estoque insuficiente de "${product.name}" em ${warehouse.name}: ` +
            `disponível ${stock.quantity.toFixed(3)}, venda ${qty.toFixed(3)}.`,
        );
      }

      const unitPrice = D(item.unitPrice ?? Number(product.salePrice));
      const itemDiscount = D(item.discount ?? 0);
      const total = unitPrice.mul(qty).minus(itemDiscount);

      subtotal = subtotal.plus(unitPrice.mul(qty));
      costTotal = costTotal.plus(stock.avgCost.mul(qty));

      prepared.push({
        productId: product.id,
        quantity: qty,
        unitPrice,
        unitCost: stock.avgCost,
        discount: itemDiscount,
        total,
        stockId: stock.id,
        newQty: stock.quantity.minus(qty),
      });
    }

    const discount = D(input.discount ?? 0);
    const total = subtotal.minus(discount);
    if (total.isNegative()) throw badRequest('O desconto não pode ser maior que o subtotal.');

    const received = input.received != null ? D(input.received) : null;
    const change = received ? received.minus(total) : null;
    if (received && change!.isNegative()) {
      throw badRequest('Valor recebido menor que o total da venda.');
    }

    const number = await nextNumber(tx, input.companyId, 'sale');
    const sale = await tx.sale.create({
      data: {
        companyId: input.companyId,
        number,
        warehouseId: input.warehouseId,
        userId: input.userId,
        customerId: input.customerId,
        customerName: input.customerName,
        subtotal,
        discount,
        total,
        costTotal,
        payment: input.payment ?? 'DINHEIRO',
        received,
        change,
        notes: input.notes,
        status: 'FINALIZADA',
        items: {
          create: prepared.map((p) => ({
            productId: p.productId,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            unitCost: p.unitCost,
            discount: p.discount,
            total: p.total,
          })),
        },
      },
      include: { items: { include: { product: true } }, warehouse: true, user: true },
    });

    for (const p of prepared) {
      const updated = await tx.stockItem.update({
        where: { id: p.stockId },
        data: { quantity: p.newQty },
      });
      const movNumber = await nextNumber(tx, input.companyId, 'movement');
      const mov = await tx.movement.create({
        data: {
          companyId: input.companyId,
          number: movNumber,
          type: 'VENDA',
          productId: p.productId,
          quantity: p.quantity,
          unitCost: p.unitCost,
          fromWarehouseId: input.warehouseId,
          balanceFrom: p.newQty,
          reason: `Venda balcão #${number}`,
          document: `VENDA-${number}`,
          saleId: sale.id,
          userId: input.userId,
        },
      });
      await enqueueStock(tx, input.companyId, updated.id);
      await enqueueMovement(tx, input.companyId, mov.id);
    }

    await enqueueSale(tx, input.companyId, sale.id);
    return sale;
  });
}

/** Cancela a venda e devolve tudo ao estoque. */
export async function cancelarVenda(companyId: string, saleId: string, userId: string, motivo?: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, companyId },
      include: { items: true },
    });
    if (!sale) throw notFound('Venda não encontrada.');
    if (sale.status === 'CANCELADA') throw unprocessable('Esta venda já foi cancelada.');

    const itensEmOrdem = [...sale.items].sort((a, b) => a.productId.localeCompare(b.productId));
    for (const item of itensEmOrdem) {
      const stock = await lockStock(tx, item.productId, sale.warehouseId);
      const updated = await tx.stockItem.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity.plus(item.quantity) },
      });

      const movNumber = await nextNumber(tx, companyId, 'movement');
      const mov = await tx.movement.create({
        data: {
          companyId,
          number: movNumber,
          type: 'ESTORNO',
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          toWarehouseId: sale.warehouseId,
          balanceTo: updated.quantity,
          reason: motivo ?? `Cancelamento da venda #${sale.number}`,
          document: `CANC-${sale.number}`,
          saleId: sale.id,
          userId,
        },
      });
      await enqueueStock(tx, companyId, updated.id);
      await enqueueMovement(tx, companyId, mov.id);
    }

    await tx.movement.updateMany({
      where: { saleId: sale.id, type: 'VENDA' },
      data: { status: 'ESTORNADO' },
    });

    const canceled = await tx.sale.update({
      where: { id: sale.id },
      data: { status: 'CANCELADA', canceledAt: new Date() },
    });
    await enqueueSale(tx, companyId, canceled.id);
    return canceled;
  });
}
