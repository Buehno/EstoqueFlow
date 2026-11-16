/**
 * Listas de compra — carrinho do comprador (16/11/2026).
 *
 * Quem vê o alerta de compra (VER_ALERTAS) monta e acompanha as listas. Dar
 * entrada no estoque ao marcar como comprada exige também MOVIMENTAR_ESTOQUE,
 * porque gera movimentações reais.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCap, temCap } from '../lib/auth.js';
import { forbidden } from '../lib/errors.js';
import * as listas from '../services/compras-lista.service.js';
import { gerarExcelLista, gerarPdfLista, nomeArquivoLista } from '../services/compras-lista-export.service.js';

const itemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  name: z.string().max(300).optional(),
  unit: z.string().max(10).optional(),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0).optional(),
  notes: z.string().max(500).nullable().optional(),
});
const statusSchema = z.enum(['ABERTA', 'PEDIDA', 'COMPRADA', 'CANCELADA']);
const idParam = z.object({ id: z.string().uuid() });

export default async function purchaseListsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  const podeComprar = requireCap('VER_ALERTAS', 'VER_RELATORIO_COMPLETO');

  app.get('/purchase-lists', { preHandler: podeComprar }, async (req) => {
    const q = z.object({ status: z.enum(['ABERTA', 'PEDIDA', 'COMPRADA', 'CANCELADA', 'PENDENTES']).optional(), take: z.coerce.number().min(1).max(500).optional() }).parse(req.query);
    return listas.listar(req.user!.companyId, q);
  });

  /** Produto → listas pendentes em que já está (o relatório mostra "já na lista #7"). */
  app.get('/purchase-lists/em-aberto-por-produto', { preHandler: podeComprar }, async (req) =>
    listas.produtosEmListasPendentes(req.user!.companyId));

  app.get('/purchase-lists/:id', { preHandler: podeComprar }, async (req) => {
    const { id } = idParam.parse(req.params);
    return listas.obter(req.user!.companyId, id);
  });

  app.post('/purchase-lists', { preHandler: podeComprar }, async (req, reply) => {
    const body = z.object({
      name: z.string().max(160).optional(),
      supplierId: z.string().uuid().nullable().optional(),
      supplierName: z.string().max(160).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      items: z.array(itemSchema).min(1),
    }).parse(req.body);
    const l = await listas.criar(req.user!.companyId, { id: req.user!.id, name: req.user!.name }, body);
    return reply.code(201).send(l);
  });

  app.patch('/purchase-lists/:id', { preHandler: podeComprar }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({
      name: z.string().max(160).optional(),
      supplierId: z.string().uuid().nullable().optional(),
      supplierName: z.string().max(160).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).parse(req.body ?? {});
    return listas.editar(req.user!.companyId, id, body);
  });

  app.post('/purchase-lists/:id/itens', { preHandler: podeComprar }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ items: z.array(itemSchema).min(1) }).parse(req.body);
    return listas.adicionarItens(req.user!.companyId, id, body.items);
  });

  app.patch('/purchase-lists/:id/itens/:itemId', { preHandler: podeComprar }, async (req) => {
    const { id, itemId } = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      quantity: z.coerce.number().positive().optional(),
      unitCost: z.coerce.number().min(0).optional(),
      notes: z.string().max(500).nullable().optional(),
    }).parse(req.body ?? {});
    return listas.alterarItem(req.user!.companyId, id, itemId, body);
  });

  app.delete('/purchase-lists/:id/itens/:itemId', { preHandler: podeComprar }, async (req) => {
    const { id, itemId } = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).parse(req.params);
    return listas.removerItem(req.user!.companyId, id, itemId);
  });

  app.post('/purchase-lists/:id/status', { preHandler: podeComprar }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({
      status: statusSchema,
      darEntrada: z.boolean().optional(),
      warehouseId: z.string().uuid().nullable().optional(),
      documento: z.string().max(120).nullable().optional(),
    }).parse(req.body);
    if (body.darEntrada && !temCap(req.user, 'MOVIMENTAR_ESTOQUE')) {
      throw forbidden('Dar entrada no estoque exige a permissão "Movimentar estoque". Marque como comprada sem entrada e peça para alguém do estoque lançar.');
    }
    return listas.mudarStatus(req.user!.companyId, id, { id: req.user!.id, name: req.user!.name }, body);
  });

  app.post('/purchase-lists/:id/duplicar', { preHandler: podeComprar }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const l = await listas.duplicar(req.user!.companyId, id, { id: req.user!.id, name: req.user!.name });
    return reply.code(201).send(l);
  });

  app.delete('/purchase-lists/:id', { preHandler: podeComprar }, async (req) => {
    const { id } = idParam.parse(req.params);
    return listas.excluir(req.user!.companyId, id);
  });

  /** O pedido pronto para mandar ao fornecedor: PDF ou Excel. */
  app.get('/purchase-lists/:id/export/:formato', { preHandler: podeComprar }, async (req, reply) => {
    const { id, formato } = z.object({ id: z.string().uuid(), formato: z.enum(['pdf', 'xlsx']) }).parse(req.params);
    const companyId = req.user!.companyId;
    const [l, empresa] = await Promise.all([
      listas.obter(companyId, id),
      prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    ]);
    const nome = empresa?.name ?? 'EstoqueFlow';
    if (formato === 'pdf') {
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${nomeArquivoLista(l, 'pdf')}"`);
      return reply.send(await gerarPdfLista(l, nome));
    }
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${nomeArquivoLista(l, 'xlsx')}"`);
    return reply.send(await gerarExcelLista(l, nome));
  });
}
