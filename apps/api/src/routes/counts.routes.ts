import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, nextNumber } from '../lib/prisma.js';
import { authenticate, requireRole, CAN_WRITE_STOCK } from '../lib/auth.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { ajuste } from '../services/stock.service.js';

export default async function countsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Abre uma contagem: fotografa o saldo esperado de cada produto do depósito. */
  app.post('/counts', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z
      .object({
        warehouseId: z.string().uuid(),
        name: z.string().min(2).default('Contagem cíclica'),
        categoryId: z.string().uuid().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const companyId = req.user!.companyId;
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: body.warehouseId, companyId },
    });
    if (!warehouse) throw notFound('Depósito não encontrado.');

    return prisma.$transaction(async (tx) => {
      const stock = await tx.stockItem.findMany({
        where: {
          warehouseId: body.warehouseId,
          product: {
            companyId,
            active: true,
            ...(body.categoryId ? { categoryId: body.categoryId } : {}),
          },
        },
      });

      const number = await nextNumber(tx, companyId, 'count');
      return tx.inventoryCount.create({
        data: {
          companyId,
          number,
          warehouseId: body.warehouseId,
          userId: req.user!.id,
          name: body.name,
          notes: body.notes,
          items: {
            create: stock.map((s) => ({ productId: s.productId, expected: s.quantity })),
          },
        },
        include: { items: { include: { product: true } }, warehouse: true },
      });
    });
  });

  app.get('/counts', async (req) =>
    prisma.inventoryCount.findMany({
      where: { companyId: req.user!.companyId },
      include: { warehouse: true, user: true, _count: { select: { items: true } } },
      orderBy: { startedAt: 'desc' },
      take: 50,
    }),
  );

  app.get('/counts/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const count = await prisma.inventoryCount.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: {
        warehouse: true,
        user: true,
        items: { include: { product: true }, orderBy: { product: { name: 'asc' } } },
      },
    });
    if (!count) throw notFound('Contagem não encontrada.');
    return {
      ...count,
      items: count.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        sku: i.product.sku,
        barcode: i.product.barcode,
        name: i.product.name,
        unit: i.product.unit,
        expected: Number(i.expected),
        counted: i.counted == null ? null : Number(i.counted),
        diff: i.diff == null ? null : Number(i.diff),
        applied: i.applied,
      })),
    };
  });

  /** Lança a contagem física de um item (leitura por código de barras inclusa). */
  app.patch('/counts/:id/items', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        productId: z.string().uuid().optional(),
        barcode: z.string().optional(),
        counted: z.coerce.number().min(0),
      })
      .parse(req.body);

    const count = await prisma.inventoryCount.findFirst({
      where: { id, companyId: req.user!.companyId },
    });
    if (!count) throw notFound('Contagem não encontrada.');
    if (count.status !== 'ABERTA') throw unprocessable('Esta contagem não está mais aberta.');

    let productId = body.productId;
    if (!productId && body.barcode) {
      const p = await prisma.product.findFirst({
        where: {
          companyId: req.user!.companyId,
          OR: [{ barcode: body.barcode }, { sku: body.barcode }],
        },
      });
      if (!p) throw notFound(`Nenhum produto com o código "${body.barcode}".`);
      productId = p.id;
    }
    if (!productId) throw unprocessable('Informe productId ou barcode.');

    const item = await prisma.inventoryCountItem.findUnique({
      where: { countId_productId: { countId: id, productId } },
    });
    if (!item) throw notFound('Produto não faz parte desta contagem.');

    return prisma.inventoryCountItem.update({
      where: { id: item.id },
      data: { counted: body.counted, diff: Number(body.counted) - Number(item.expected) },
    });
  });

  /** Apura divergências (não mexe no estoque ainda). */
  app.post('/counts/:id/apurar', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const count = await prisma.inventoryCount.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: { items: { include: { product: true } } },
    });
    if (!count) throw notFound('Contagem não encontrada.');

    await prisma.inventoryCount.update({ where: { id }, data: { status: 'APURADA' } });

    const divergencias = count.items
      .filter((i) => i.counted != null && Number(i.counted) !== Number(i.expected))
      .map((i) => ({
        productId: i.productId,
        sku: i.product.sku,
        name: i.product.name,
        expected: Number(i.expected),
        counted: Number(i.counted),
        diff: Number(i.counted) - Number(i.expected),
        valorDiferenca: (Number(i.counted) - Number(i.expected)) * Number(i.product.costPrice),
      }));

    return {
      totalItens: count.items.length,
      contados: count.items.filter((i) => i.counted != null).length,
      naoContados: count.items.filter((i) => i.counted == null).length,
      divergencias,
      impactoFinanceiro: divergencias.reduce((a, d) => a + d.valorDiferenca, 0),
    };
  });

  /** Aplica os ajustes no estoque. */
  app.post('/counts/:id/aplicar', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const companyId = req.user!.companyId;

    const count = await prisma.inventoryCount.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!count) throw notFound('Contagem não encontrada.');
    if (count.status === 'APLICADA') throw unprocessable('Esta contagem já foi aplicada.');

    let ajustados = 0;
    for (const item of count.items) {
      if (item.counted == null) continue;
      if (Number(item.counted) === Number(item.expected)) continue;
      await ajuste({
        companyId,
        userId: req.user!.id,
        productId: item.productId,
        warehouseId: count.warehouseId,
        newQuantity: Number(item.counted),
        reason: `Inventário #${count.number} — ${count.name}`,
        countId: count.id,
      });
      await prisma.inventoryCountItem.update({ where: { id: item.id }, data: { applied: true } });
      ajustados++;
    }

    await prisma.inventoryCount.update({
      where: { id },
      data: { status: 'APLICADA', closedAt: new Date() },
    });

    return { ajustados, message: `${ajustados} produto(s) ajustado(s) no estoque.` };
  });
}
