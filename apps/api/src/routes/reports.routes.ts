import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole, CAN_MANAGE } from '../lib/auth.js';
import { curvaABC, dashboard, giroEstoque, kardex, vendasPorDia } from '../services/reports.service.js';
import { duplicados, posicaoCompra, saldosQuebrados } from '../services/compras.service.js';
import { gerarRelatorioCompras } from '../services/compras-export.service.js';
import { arredondarSaldosQuebrados, desativarProdutoDuplicado } from '../services/stock.service.js';
import { fullResync, runGuard, runSync, sheetsEnabled } from '../services/sync.service.js';
import { env } from '../env.js';

export default async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/reports/dashboard', async (req) => dashboard(req.user!.companyId));

  // ═══════════════ REPOSIÇÃO / ALERTA DE COMPRA (regra de 24/09) ═══════════
  /** Posição de compra pelo TOTAL dos dois depósitos, já classificada. */
  app.get('/reports/compras', async (req) => posicaoCompra(req.user!.companyId));

  /** A lista de reposição em planilha: só o que atingiu o ponto de compra. */
  app.get('/reports/compras/planilha', async (req, reply) => {
    const companyId = req.user!.companyId;
    const [posicao, empresa] = await Promise.all([
      posicaoCompra(companyId),
      prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    ]);
    const buffer = await gerarRelatorioCompras(posicao, empresa?.name ?? 'EstoqueFlow');
    const hoje = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="lista-de-reposicao-${hoje}.xlsx"`);
    return reply.send(buffer);
  });

  // ═══════════════ LIMPEZA DA BASE (pedido de 24/09) ═══════════════════════
  /** Saldos quebrados em item vendido por unidade. */
  app.get('/reports/saldos-quebrados', async (req) => {
    const itens = await saldosQuebrados(req.user!.companyId);
    return { total: itens.length, itens };
  });

  /** Arredonda os saldos quebrados gerando um AJUSTE rastreável por item. */
  app.post('/reports/saldos-quebrados/arredondar', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const body = z.object({ confirmar: z.boolean().default(false), motivo: z.string().optional() }).parse(req.body ?? {});
    return arredondarSaldosQuebrados(req.user!.companyId, req.user!.id, {
      dryRun: !body.confirmar,
      motivo: body.motivo,
    });
  });

  /** Grupos de produtos com nome praticamente igual. */
  app.get('/reports/duplicados', async (req) => {
    const grupos = await duplicados(req.user!.companyId);
    return { total: grupos.length, grupos };
  });

  /** Desativa o cadastro duplicado (zera o saldo por AJUSTE antes, se houver). */
  app.post('/reports/duplicados/:id/desativar', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ motivo: z.string().optional() }).parse(req.body ?? {});
    return desativarProdutoDuplicado(req.user!.companyId, id, req.user!.id, body.motivo);
  });

  app.get('/reports/abc', async (req) => {
    const q = z.object({ dias: z.coerce.number().min(7).max(730).default(90) }).parse(req.query);
    return curvaABC(req.user!.companyId, q.dias);
  });

  app.get('/reports/giro', async (req) => {
    const q = z.object({ dias: z.coerce.number().min(7).max(730).default(90) }).parse(req.query);
    return giroEstoque(req.user!.companyId, q.dias);
  });

  app.get('/reports/kardex/:productId', async (req) => {
    const { productId } = z.object({ productId: z.string().uuid() }).parse(req.params);
    const q = z.object({ dias: z.coerce.number().min(1).max(730).default(180) }).parse(req.query);
    return kardex(req.user!.companyId, productId, q.dias);
  });

  app.get('/reports/vendas-por-dia', async (req) => {
    const q = z.object({ dias: z.coerce.number().min(1).max(365).default(30) }).parse(req.query);
    return vendasPorDia(req.user!.companyId, q.dias);
  });

  /** Exportação CSV genérica de qualquer relatório. */
  app.get('/reports/export/:tipo', async (req, reply) => {
    const { tipo } = z.object({ tipo: z.enum(['estoque', 'movimentacoes', 'vendas', 'abc']) }).parse(req.params);
    const companyId = req.user!.companyId;

    let header: string[] = [];
    let rows: (string | number)[][] = [];

    if (tipo === 'estoque') {
      const items = await prisma.stockItem.findMany({
        where: { product: { companyId } },
        include: { product: true, warehouse: true },
      });
      header = ['SKU', 'Produto', 'Deposito', 'Quantidade', 'Custo Medio', 'Valor'];
      rows = items.map((i) => [
        i.product.sku, i.product.name, i.warehouse.name,
        Number(i.quantity), Number(i.avgCost), +(Number(i.quantity) * Number(i.avgCost)).toFixed(2),
      ]);
    } else if (tipo === 'movimentacoes') {
      const items = await prisma.movement.findMany({
        where: { companyId },
        include: { product: true, fromWarehouse: true, toWarehouse: true, user: true },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
      });
      header = ['Numero', 'Data', 'Tipo', 'SKU', 'Produto', 'Qtd', 'Origem', 'Destino', 'Usuario'];
      rows = items.map((m) => [
        m.number, m.createdAt.toISOString(), m.type, m.product.sku, m.product.name,
        Number(m.quantity), m.fromWarehouse?.name ?? '', m.toWarehouse?.name ?? '', m.user.name,
      ]);
    } else if (tipo === 'vendas') {
      const items = await prisma.sale.findMany({
        where: { companyId },
        include: { warehouse: true, user: true },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
      });
      header = ['Numero', 'Data', 'Deposito', 'Cliente', 'Total', 'Pagamento', 'Vendedor', 'Status'];
      rows = items.map((s) => [
        s.number, s.createdAt.toISOString(), s.warehouse.name, s.customerName ?? 'Consumidor',
        Number(s.total), s.payment, s.user.name, s.status,
      ]);
    } else {
      const abc = await curvaABC(companyId);
      header = ['SKU', 'Produto', 'Quantidade', 'Valor', 'Participacao %', 'Acumulado %', 'Classe'];
      rows = abc.map((a) => [
        a.sku, a.name, a.qtd, +a.valor.toFixed(2), +a.participacao.toFixed(2),
        +a.acumulado.toFixed(2), a.classe,
      ]);
    }

    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${tipo}-${Date.now()}.csv"`);
    return `﻿${csv}`;
  });

  // ─────────── Status e controle da redundância Google Sheets ───────────
  app.get('/sync/status', async (req) => {
    const companyId = req.user!.companyId;
    const [pendentes, erros, ultimos, company, guard] = await Promise.all([
      prisma.syncOutbox.count({ where: { companyId, status: 'PENDENTE' } }),
      prisma.syncOutbox.count({ where: { companyId, status: 'PENDENTE', attempts: { gte: 5 } } }),
      prisma.syncOutbox.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { sheetTab: true, rowKey: true, status: true, createdAt: true, sentAt: true, lastError: true },
      }),
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.sheetGuardLog.findMany({
        where: { companyId },
        orderBy: { detectedAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      habilitado: sheetsEnabled(),
      motivoDesabilitado: sheetsEnabled()
        ? null
        : !env.GOOGLE_SHEET_ID
          ? 'Falta a variável GOOGLE_SHEET_ID'
          : 'Faltam as credenciais da Service Account (GOOGLE_SERVICE_ACCOUNT_JSON)',
      planilhaId: env.GOOGLE_SHEET_ID ?? null,
      ultimaSincronizacao: company?.sheetLastSync ?? null,
      filaPendente: pendentes,
      filaComErro: erros,
      ultimosEventos: ultimos,
      revertidosPeloGuardiao: guard,
    };
  });

  app.post('/sync/run', { preHandler: requireRole(...CAN_MANAGE) }, async () => runSync());
  app.post('/sync/guard', { preHandler: requireRole(...CAN_MANAGE) }, async () => runGuard());
  app.post('/sync/full', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    await fullResync(req.user!.companyId);
    return { ok: true, message: 'Reenvio completo enfileirado. A planilha será reescrita do zero.' };
  });

  app.get('/audit', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const q = z.object({ take: z.coerce.number().min(1).max(200).default(100) }).parse(req.query);
    return prisma.auditLog.findMany({
      where: { companyId: req.user!.companyId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: q.take,
    });
  });
}
