import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole, CAN_SELL, CAN_MANAGE } from '../lib/auth.js';
import { cancelarVenda, criarVenda } from '../services/sales.service.js';
import { notFound } from '../lib/errors.js';

export default async function salesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** VENDA BALCÃO */
  app.post('/sales', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const body = z
      .object({
        warehouseId: z.string().uuid(),
        items: z
          .array(
            z.object({
              productId: z.string().uuid(),
              quantity: z.coerce.number().positive(),
              unitPrice: z.coerce.number().min(0).optional(),
              discount: z.coerce.number().min(0).optional(),
            }),
          )
          .min(1, 'Adicione ao menos um item'),
        customerId: z.string().uuid().optional(),
        customerName: z.string().optional(),
        discount: z.coerce.number().min(0).optional(),
        payment: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'BOLETO', 'OUTRO']).optional(),
        received: z.coerce.number().min(0).optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const sale = await criarVenda({
      ...body,
      companyId: req.user!.companyId,
      userId: req.user!.id,
    });

    return {
      id: sale.id,
      number: sale.number,
      total: Number(sale.total),
      subtotal: Number(sale.subtotal),
      discount: Number(sale.discount),
      change: sale.change == null ? null : Number(sale.change),
      payment: sale.payment,
      warehouse: sale.warehouse.name,
      vendedor: sale.user.name,
      createdAt: sale.createdAt,
      items: sale.items.map((i) => ({
        product: i.product.name,
        sku: i.product.sku,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        total: Number(i.total),
      })),
    };
  });

  app.get('/sales', async (req) => {
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        warehouseId: z.string().uuid().optional(),
        status: z.enum(['ABERTA', 'FINALIZADA', 'CANCELADA']).optional(),
        take: z.coerce.number().min(1).max(300).default(50),
        skip: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);

    const where = {
      companyId: req.user!.companyId,
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59`) } : {}),
            },
          }
        : {}),
    };

    const [items, total, agg] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: { warehouse: true, user: true, items: true },
        orderBy: { createdAt: 'desc' },
        take: q.take,
        skip: q.skip,
      }),
      prisma.sale.count({ where }),
      prisma.sale.aggregate({ where: { ...where, status: 'FINALIZADA' }, _sum: { total: true } }),
    ]);

    return {
      total,
      somaPeriodo: Number(agg._sum.total ?? 0),
      items: items.map((s) => ({
        id: s.id,
        number: s.number,
        createdAt: s.createdAt,
        warehouse: s.warehouse.name,
        vendedor: s.user.name,
        cliente: s.customerName ?? 'Consumidor',
        itens: s.items.length,
        subtotal: Number(s.subtotal),
        discount: Number(s.discount),
        totalVenda: Number(s.total),
        payment: s.payment,
        status: s.status,
      })),
    };
  });

  app.get('/sales/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const sale = await prisma.sale.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: { items: { include: { product: true } }, warehouse: true, user: true, customer: true },
    });
    if (!sale) throw notFound('Venda não encontrada.');
    return {
      ...sale,
      subtotal: Number(sale.subtotal),
      discount: Number(sale.discount),
      total: Number(sale.total),
      received: sale.received == null ? null : Number(sale.received),
      change: sale.change == null ? null : Number(sale.change),
      items: sale.items.map((i) => ({
        product: i.product.name,
        sku: i.product.sku,
        unit: i.product.unit,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        discount: Number(i.discount),
        total: Number(i.total),
      })),
    };
  });

  app.post('/sales/:id/cancel', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return cancelarVenda(req.user!.companyId, id, req.user!.id, body.reason);
  });
}
