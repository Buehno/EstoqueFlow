import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole, CAN_WRITE_STOCK, CAN_MANAGE } from '../lib/auth.js';
import { ajuste, editarMovimento, entrada, estornar, posicao, saida, transferencia } from '../services/stock.service.js';

const baseMove = {
  productId: z.string().uuid(),
  quantity: z.coerce.number().positive('Quantidade deve ser maior que zero'),
  reason: z.string().optional(),
  document: z.string().optional(),
  notes: z.string().optional(),
};

export default async function stockRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Posição de estoque (consulta). */
  app.get('/stock', async (req) => {
    const q = z
      .object({
        warehouseId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        search: z.string().optional(),
        belowMin: z.enum(['true', 'false']).optional(),
        take: z.coerce.number().min(1).max(1000).default(500),
        skip: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);

    return posicao({
      companyId: req.user!.companyId,
      warehouseId: q.warehouseId,
      categoryId: q.categoryId,
      search: q.search,
      onlyBelowMin: q.belowMin === 'true',
      take: q.take,
      skip: q.skip,
    });
  });

  /** ENTRADA */
  app.post('/movements/entrada', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z
      .object({ ...baseMove, warehouseId: z.string().uuid(), unitCost: z.coerce.number().min(0).optional() })
      .parse(req.body);
    return entrada({ ...body, companyId: req.user!.companyId, userId: req.user!.id });
  });

  /** SAÍDA */
  app.post('/movements/saida', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z.object({ ...baseMove, warehouseId: z.string().uuid() }).parse(req.body);
    return saida({ ...body, companyId: req.user!.companyId, userId: req.user!.id });
  });

  /** TRANSFERÊNCIA ENTRE DEPÓSITOS */
  app.post('/movements/transferencia', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z
      .object({
        ...baseMove,
        fromWarehouseId: z.string().uuid(),
        toWarehouseId: z.string().uuid(),
      })
      .parse(req.body);
    return transferencia({ ...body, companyId: req.user!.companyId, userId: req.user!.id });
  });

  /** AJUSTE DE SALDO */
  app.post('/movements/ajuste', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z
      .object({
        productId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        newQuantity: z.coerce.number().min(0),
        reason: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const mov = await ajuste({ ...body, companyId: req.user!.companyId, userId: req.user!.id });
    return mov ?? { message: 'Saldo já estava correto, nenhum ajuste necessário.' };
  });

  /**
   * CORREÇÃO — edita motivo/documento/observações de um lançamento já
   * confirmado. Quantidade, tipo e depósito são imutáveis de propósito: para
   * corrigir um número errado, estorne (abaixo) e lance de novo — assim o
   * histórico real fica registrado em vez de reescrito.
   */
  app.patch('/movements/:id', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        reason: z.string().max(500).nullable().optional(),
        document: z.string().max(120).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .parse(req.body);
    return editarMovimento(req.user!.companyId, id, req.user!.id, body);
  });

  /** ESTORNO */
  app.post('/movements/:id/estorno', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return estornar(req.user!.companyId, id, req.user!.id, body.reason);
  });

  /** Listagem de movimentações com filtros. */
  app.get('/movements', async (req) => {
    const q = z
      .object({
        type: z.enum(['ENTRADA', 'SAIDA', 'TRANSFERENCIA', 'AJUSTE', 'VENDA', 'ESTORNO']).optional(),
        productId: z.string().uuid().optional(),
        warehouseId: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        search: z.string().optional(),
        take: z.coerce.number().min(1).max(500).default(100),
        skip: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);

    const where = {
      companyId: req.user!.companyId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.warehouseId
        ? { OR: [{ fromWarehouseId: q.warehouseId }, { toWarehouseId: q.warehouseId }] }
        : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59`) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            product: {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' as const } },
                { sku: { contains: q.search, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.movement.findMany({
        where,
        include: { product: true, fromWarehouse: true, toWarehouse: true, user: true },
        orderBy: { createdAt: 'desc' },
        take: q.take,
        skip: q.skip,
      }),
      prisma.movement.count({ where }),
    ]);

    return {
      total,
      items: items.map((m) => ({
        id: m.id,
        number: m.number,
        type: m.type,
        status: m.status,
        product: { id: m.productId, sku: m.product.sku, name: m.product.name, unit: m.product.unit },
        quantity: Number(m.quantity),
        unitCost: Number(m.unitCost),
        from: m.fromWarehouse ? { id: m.fromWarehouse.id, name: m.fromWarehouse.name } : null,
        to: m.toWarehouse ? { id: m.toWarehouse.id, name: m.toWarehouse.name } : null,
        reason: m.reason,
        document: m.document,
        notes: m.notes,
        user: m.user.name,
        createdAt: m.createdAt,
      })),
    };
  });
}
