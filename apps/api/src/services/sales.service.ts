import { Prisma } from '@prisma/client';
import { prisma, D, nextNumber } from '../lib/prisma.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { enqueueMovement, enqueueSale, enqueueStock } from './sync.service.js';

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

    for (const item of input.items) {
      const product = byId.get(item.productId);
      if (!product) throw notFound(`Produto ${item.productId} não encontrado.`);
      if (item.quantity <= 0) throw badRequest(`Quantidade inválida para "${product.name}".`);

      let stock = await tx.stockItem.findUnique({
        where: { productId_warehouseId: { productId: product.id, warehouseId: input.warehouseId } },
      });
      if (!stock) {
        stock = await tx.stockItem.create({
          data: { productId: product.id, warehouseId: input.warehouseId },
        });
      }

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

    for (const item of sale.items) {
      let stock = await tx.stockItem.findUnique({
        where: {
          productId_warehouseId: { productId: item.productId, warehouseId: sale.warehouseId },
        },
      });
      if (!stock) {
        stock = await tx.stockItem.create({
          data: { productId: item.productId, warehouseId: sale.warehouseId },
        });
      }
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
