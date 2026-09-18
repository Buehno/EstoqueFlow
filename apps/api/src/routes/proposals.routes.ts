import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, type ProposalStatus } from '@prisma/client';
import { prisma, nextNumber } from '../lib/prisma.js';
import { authenticate, requireRole, CAN_SELL, CAN_MANAGE } from '../lib/auth.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { porExtensoEntreParenteses } from '../lib/extenso.js';
import { gerarDocx, gerarPdf, gerarXlsx, nomeArquivo, type PropostaExport } from '../services/proposal-export.service.js';

const STATUS = [
  'RASCUNHO', 'ENVIADA', 'AGUARDANDO_RETORNO', 'EM_NEGOCIACAO',
  'ACEITA', 'RECUSADA', 'EXPIRADA', 'CANCELADA',
] as const;

/** Status a partir dos quais a negociação já saiu das nossas mãos. */
const ABERTOS: ProposalStatus[] = ['RASCUNHO', 'ENVIADA', 'AGUARDANDO_RETORNO', 'EM_NEGOCIACAO'];

const itemSchema = z.object({
  quantity: z.coerce.number().min(0).default(1),
  quantityText: z.string().max(12).optional(),
  unit: z.string().max(10).optional(),
  description: z.string().min(1, 'A descrição do item não pode ficar vazia'),
  unitPrice: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0).optional(),
  productId: z.string().uuid().optional().nullable(),
});

const corpoSchema = {
  scopeTitle: z.string().min(3).optional(),
  intro: z.string().optional().nullable(),
  clientName: z.string().min(2).optional(),
  clientPhone: z.string().optional().nullable(),
  clientEmail: z.string().optional().nullable(),
  clientLocal: z.string().optional().nullable(),
  clientDocument: z.string().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  discount: z.coerce.number().min(0).optional(),
  paymentTerms: z.string().optional().nullable(),
  paymentCash: z.string().optional().nullable(),
  cashTotal: z.coerce.number().min(0).optional().nullable(),
  deliveryTerms: z.string().optional().nullable(),
  validityDays: z.coerce.number().int().min(1).max(365).optional(),
  closingNote: z.string().optional().nullable(),
  footerNote: z.string().optional().nullable(),
  salesRep: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  issueDate: z.string().optional(),
  followUpAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lostReason: z.string().optional().nullable(),
};

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));

/** Saldo total do produto somando todos os depósitos. */
async function saldoDoProduto(productId: string): Promise<number> {
  const linhas = await prisma.stockItem.findMany({ where: { productId } });
  return linhas.reduce((a, s) => a + Number(s.quantity), 0);
}

/**
 * Regra do negócio: não se oferece ao cliente o que não existe no estoque.
 * Itens livres (mão de obra, kit estimado) passam direto; itens vinculados a
 * um produto são conferidos contra o saldo somado dos dois depósitos.
 */
async function conferirEstoque(
  companyId: string,
  itens: { productId?: string | null; quantity: number; description: string }[],
) {
  const problemas: { description: string; solicitado: number; disponivel: number; produto: string }[] = [];
  for (const item of itens) {
    if (!item.productId) continue;
    const produto = await prisma.product.findFirst({ where: { id: item.productId, companyId } });
    if (!produto) {
      problemas.push({ description: item.description, solicitado: item.quantity, disponivel: 0, produto: '(produto removido)' });
      continue;
    }
    const saldo = await saldoDoProduto(item.productId);
    if (saldo < item.quantity) {
      problemas.push({ description: item.description, solicitado: item.quantity, disponivel: saldo, produto: produto.name });
    }
  }
  return problemas;
}

async function registrarEvento(
  proposalId: string,
  type: 'CRIADA' | 'EDITADA' | 'ENVIADA' | 'RETORNO_CLIENTE' | 'FOLLOW_UP' | 'STATUS_ALTERADO' | 'NOTA' | 'EXPORTADA',
  dados: { message?: string; fromStatus?: ProposalStatus; toStatus?: ProposalStatus; userId?: string; userName?: string },
) {
  await prisma.proposalEvent.create({ data: { proposalId, type, ...dados } });
}

/** Recalcula os totais a partir dos itens gravados e congela o valor por extenso. */
async function recalcular(proposalId: string) {
  const itens = await prisma.proposalItem.findMany({ where: { proposalId } });
  const subtotal = itens.reduce((a, i) => a + Number(i.total), 0);
  const atual = await prisma.proposal.findUnique({ where: { id: proposalId } });
  const total = Math.max(0, subtotal - n(atual?.discount));
  return prisma.proposal.update({
    where: { id: proposalId },
    data: { subtotal, total, totalInWords: porExtensoEntreParenteses(total) },
  });
}

const incluirTudo = {
  items: { orderBy: { position: 'asc' as const }, include: { product: { select: { id: true, name: true, unit: true, sku: true } } } },
  events: { orderBy: { createdAt: 'desc' as const }, take: 50 },
  customer: true,
  user: { select: { id: true, name: true } },
  template: { select: { id: true, name: true } },
};

function serializar(p: any) {
  return {
    ...p,
    subtotal: n(p.subtotal),
    discount: n(p.discount),
    total: n(p.total),
    cashTotal: p.cashTotal == null ? null : n(p.cashTotal),
    items: (p.items ?? []).map((i: any) => ({
      ...i,
      quantity: n(i.quantity),
      unitPrice: n(i.unitPrice),
      total: n(i.total),
      stockAtInsert: i.stockAtInsert == null ? null : n(i.stockAtInsert),
    })),
  };
}

export default async function proposalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ══════════════════════ MODELOS DE PROPOSTA ══════════════════════
  app.get('/proposal-templates', async (req) => {
    const lista = await prisma.proposalTemplate.findMany({
      where: { companyId: req.user!.companyId, active: true },
      include: { items: { orderBy: { position: 'asc' } }, _count: { select: { proposals: true } } },
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    });
    return lista.map((t) => ({
      ...t,
      items: t.items.map((i) => ({ ...i, quantity: n(i.quantity), unitPrice: n(i.unitPrice), total: n(i.total) })),
      valorBase: t.items.reduce((a, i) => a + Number(i.total), 0),
    }));
  });

  app.post('/proposal-templates', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const body = z
      .object({
        name: z.string().min(2),
        scopeTitle: z.string().min(3),
        intro: z.string().optional(),
        paymentTerms: z.string().optional(),
        paymentCash: z.string().optional(),
        deliveryTerms: z.string().optional(),
        validityDays: z.coerce.number().int().min(1).max(365).default(10),
        closingNote: z.string().optional(),
        footerNote: z.string().optional(),
        salesRep: z.string().optional(),
        city: z.string().optional(),
        items: z.array(itemSchema).default([]),
      })
      .parse(req.body);

    const companyId = req.user!.companyId;
    const dup = await prisma.proposalTemplate.findFirst({ where: { companyId, name: body.name } });
    if (dup) throw conflict(`Já existe um modelo chamado "${body.name}".`);

    const { items, ...cabecalho } = body;
    return prisma.proposalTemplate.create({
      data: {
        ...cabecalho,
        companyId,
        items: {
          create: items.map((i, idx) => ({
            position: idx,
            quantity: i.quantity,
            quantityText: i.quantityText ?? String(i.quantity).padStart(2, '0'),
            description: i.description,
            unitPrice: i.unitPrice,
            total: i.total ?? i.unitPrice * i.quantity,
            productId: i.productId ?? null,
          })),
        },
      },
      include: { items: true },
    });
  });

  app.patch('/proposal-templates/:id', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(2).optional(),
        scopeTitle: z.string().min(3).optional(),
        intro: z.string().optional().nullable(),
        paymentTerms: z.string().optional().nullable(),
        paymentCash: z.string().optional().nullable(),
        deliveryTerms: z.string().optional().nullable(),
        validityDays: z.coerce.number().int().min(1).max(365).optional(),
        closingNote: z.string().optional().nullable(),
        footerNote: z.string().optional().nullable(),
        salesRep: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        active: z.boolean().optional(),
        items: z.array(itemSchema).optional(),
      })
      .parse(req.body);

    const modelo = await prisma.proposalTemplate.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!modelo) throw notFound('Modelo não encontrado.');

    const { items, ...cabecalho } = body;
    if (items) {
      await prisma.proposalTemplateItem.deleteMany({ where: { templateId: id } });
      await prisma.proposalTemplateItem.createMany({
        data: items.map((i, idx) => ({
          templateId: id,
          position: idx,
          quantity: new Prisma.Decimal(i.quantity),
          quantityText: i.quantityText ?? String(i.quantity).padStart(2, '0'),
          description: i.description,
          unitPrice: new Prisma.Decimal(i.unitPrice),
          total: new Prisma.Decimal(i.total ?? i.unitPrice * i.quantity),
          productId: i.productId ?? null,
        })),
      });
    }
    return prisma.proposalTemplate.update({
      where: { id },
      data: cabecalho as Prisma.ProposalTemplateUpdateInput,
      include: { items: { orderBy: { position: 'asc' } } },
    });
  });

  app.delete('/proposal-templates/:id', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const modelo = await prisma.proposalTemplate.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!modelo) throw notFound('Modelo não encontrado.');
    await prisma.proposalTemplate.update({ where: { id }, data: { active: false } });
    return { ok: true };
  });

  // ══════════════════════ PROPOSTAS ══════════════════════

  /** Funil: quantas propostas e quanto dinheiro em cada estágio. */
  app.get('/proposals/resumo', async (req) => {
    const companyId = req.user!.companyId;
    const [porStatus, vencendo, atrasadas, ultimas] = await Promise.all([
      prisma.proposal.groupBy({ by: ['status'], where: { companyId }, _count: true, _sum: { total: true } }),
      prisma.proposal.findMany({
        where: { companyId, status: { in: ABERTOS }, validUntil: { gte: new Date(), lte: new Date(Date.now() + 3 * 86400000) } },
        select: { id: true, number: true, clientName: true, total: true, validUntil: true },
        orderBy: { validUntil: 'asc' },
      }),
      prisma.proposal.findMany({
        where: { companyId, status: { in: ABERTOS }, followUpAt: { lte: new Date() } },
        select: { id: true, number: true, clientName: true, total: true, followUpAt: true },
        orderBy: { followUpAt: 'asc' },
        take: 20,
      }),
      prisma.proposal.findMany({
        where: { companyId },
        select: { id: true, number: true, clientName: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const mapa = Object.fromEntries(
      porStatus.map((s) => [s.status, { quantidade: s._count, valor: n(s._sum.total) }]),
    );
    const totalAberto = ABERTOS.reduce((a, s) => a + (mapa[s]?.valor ?? 0), 0);
    const ganho = mapa.ACEITA?.valor ?? 0;
    const perdido = mapa.RECUSADA?.valor ?? 0;
    const decididas = (mapa.ACEITA?.quantidade ?? 0) + (mapa.RECUSADA?.quantidade ?? 0);

    return {
      porStatus: mapa,
      totalAberto,
      ganho,
      perdido,
      taxaConversao: decididas ? ((mapa.ACEITA?.quantidade ?? 0) / decididas) * 100 : 0,
      vencendoEm3Dias: vencendo.map((p) => ({ ...p, total: n(p.total) })),
      followUpAtrasado: atrasadas.map((p) => ({ ...p, total: n(p.total) })),
      ultimas: ultimas.map((p) => ({ ...p, total: n(p.total) })),
    };
  });

  /** As "pastas": um cliente, suas propostas e o estágio de cada uma. */
  app.get('/proposals/clientes', async (req) => {
    const companyId = req.user!.companyId;
    const propostas = await prisma.proposal.findMany({
      where: { companyId },
      select: {
        id: true, number: true, clientName: true, clientPhone: true, clientLocal: true,
        customerId: true, status: true, total: true, createdAt: true, validUntil: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const pastas = new Map<string, any>();
    for (const p of propostas) {
      const chave = p.customerId ?? p.clientName.trim().toLowerCase();
      if (!pastas.has(chave)) {
        pastas.set(chave, {
          chave,
          customerId: p.customerId,
          cliente: p.clientName,
          telefone: p.clientPhone,
          local: p.clientLocal,
          propostas: [],
          total: 0,
          emAberto: 0,
          ganhas: 0,
        });
      }
      const pasta = pastas.get(chave);
      pasta.propostas.push({ ...p, total: n(p.total) });
      pasta.total += n(p.total);
      if (ABERTOS.includes(p.status)) pasta.emAberto++;
      if (p.status === 'ACEITA') pasta.ganhas++;
    }
    return [...pastas.values()].sort((a, b) => b.propostas.length - a.propostas.length);
  });

  app.get('/proposals', async (req) => {
    const q = z
      .object({
        status: z.enum(STATUS).optional(),
        search: z.string().optional(),
        customerId: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        take: z.coerce.number().min(1).max(200).default(50),
        skip: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);

    const where: Prisma.ProposalWhereInput = {
      companyId: req.user!.companyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.search
        ? {
            OR: [
              { clientName: { contains: q.search, mode: 'insensitive' } },
              { scopeTitle: { contains: q.search, mode: 'insensitive' } },
              { clientLocal: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59`) } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.proposal.findMany({
        where,
        include: { user: { select: { name: true } }, _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
        take: q.take,
        skip: q.skip,
      }),
      prisma.proposal.count({ where }),
    ]);

    return {
      total,
      items: items.map((p) => ({
        id: p.id, number: p.number, status: p.status,
        clientName: p.clientName, clientLocal: p.clientLocal, clientPhone: p.clientPhone,
        scopeTitle: p.scopeTitle, totalValue: n(p.total), itens: p._count.items,
        vendedor: p.user.name, createdAt: p.createdAt, sentAt: p.sentAt,
        validUntil: p.validUntil, followUpAt: p.followUpAt,
      })),
    };
  });

  app.get('/proposals/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const p = await prisma.proposal.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: incluirTudo,
    });
    if (!p) throw notFound('Proposta não encontrada.');

    // confere o estoque a cada abertura: o saldo pode ter mudado desde a montagem
    const alertas = await conferirEstoque(
      req.user!.companyId,
      p.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), description: i.description })),
    );
    return { ...serializar(p), alertasEstoque: alertas };
  });

  /** Cria a proposta — em branco ou a partir de um modelo salvo. */
  app.post('/proposals', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const body = z
      .object({
        templateId: z.string().uuid().optional(),
        clientName: z.string().min(2, 'Informe o nome do cliente'),
        clientPhone: z.string().optional(),
        clientEmail: z.string().optional(),
        clientLocal: z.string().optional(),
        clientDocument: z.string().optional(),
        scopeTitle: z.string().optional(),
        salvarCliente: z.boolean().default(true),
      })
      .parse(req.body);

    const companyId = req.user!.companyId;
    const modelo = body.templateId
      ? await prisma.proposalTemplate.findFirst({
          where: { id: body.templateId, companyId },
          include: { items: { orderBy: { position: 'asc' } } },
        })
      : null;
    if (body.templateId && !modelo) throw notFound('Modelo não encontrado.');

    // a "pasta" do cliente: reaproveita o cadastro se já existir
    let customerId: string | null = null;
    if (body.salvarCliente) {
      const existente = await prisma.customer.findFirst({
        where: { companyId, name: { equals: body.clientName.trim(), mode: 'insensitive' } },
      });
      const cliente = existente
        ?? (await prisma.customer.create({
          data: { companyId, name: body.clientName.trim(), phone: body.clientPhone, email: body.clientEmail || null, document: body.clientDocument },
        }));
      customerId = cliente.id;
    }

    const proposta = await prisma.$transaction(async (tx) => {
      const numero = await nextNumber(tx, companyId, 'proposal');
      const validityDays = modelo?.validityDays ?? 10;
      const criada = await tx.proposal.create({
        data: {
          companyId,
          number: numero,
          customerId,
          clientName: body.clientName.trim(),
          clientPhone: body.clientPhone,
          clientEmail: body.clientEmail || null,
          clientLocal: body.clientLocal,
          clientDocument: body.clientDocument,
          scopeTitle: body.scopeTitle ?? modelo?.scopeTitle ?? 'PROPOSTA COMERCIAL',
          intro: modelo?.intro ?? null,
          paymentTerms: modelo?.paymentTerms ?? null,
          paymentCash: modelo?.paymentCash ?? null,
          deliveryTerms: modelo?.deliveryTerms ?? null,
          validityDays,
          validUntil: new Date(Date.now() + validityDays * 86400000),
          closingNote: modelo?.closingNote ?? 'Sem mais para o momento nos colocamos a inteira disposição.\nAntecipadamente gratos.\nAtenciosamente,',
          footerNote: modelo?.footerNote ?? null,
          salesRep: modelo?.salesRep ?? req.user!.name,
          city: modelo?.city ?? 'Jundiaí',
          templateId: modelo?.id ?? null,
          userId: req.user!.id,
          items: modelo
            ? {
                create: modelo.items.map((i) => ({
                  position: i.position,
                  quantity: i.quantity,
                  quantityText: i.quantityText,
                  description: i.description,
                  unitPrice: i.unitPrice,
                  total: i.total,
                  productId: i.productId,
                })),
              }
            : undefined,
        },
        include: incluirTudo,
      });
      if (modelo) await tx.proposalTemplate.update({ where: { id: modelo.id }, data: { usageCount: { increment: 1 } } });
      return criada;
    });

    await recalcular(proposta.id);
    await registrarEvento(proposta.id, 'CRIADA', {
      message: modelo ? `Criada a partir do modelo "${modelo.name}"` : 'Criada em branco',
      userId: req.user!.id,
      userName: req.user!.name,
    });

    const completa = await prisma.proposal.findUnique({ where: { id: proposta.id }, include: incluirTudo });
    return serializar(completa);
  });

  app.patch('/proposals/:id', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object(corpoSchema).parse(req.body);

    const atual = await prisma.proposal.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!atual) throw notFound('Proposta não encontrada.');
    if (atual.status === 'ACEITA' || atual.status === 'CANCELADA') {
      throw unprocessable('Proposta já encerrada — duplique-a para gerar uma nova versão.');
    }

    const validityDays = body.validityDays ?? atual.validityDays;
    const base = body.issueDate ? new Date(body.issueDate) : atual.issueDate;

    await prisma.proposal.update({
      where: { id },
      data: {
        ...body,
        issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
        followUpAt: body.followUpAt ? new Date(body.followUpAt) : body.followUpAt === null ? null : undefined,
        validityDays,
        validUntil: new Date(base.getTime() + validityDays * 86400000),
      } as Prisma.ProposalUpdateInput,
    });
    await recalcular(id);
    await registrarEvento(id, 'EDITADA', { userId: req.user!.id, userName: req.user!.name });

    const p = await prisma.proposal.findUnique({ where: { id }, include: incluirTudo });
    return serializar(p);
  });

  /**
   * Substitui a lista de itens inteira. É aqui que a trava de estoque age:
   * item vinculado a produto sem saldo suficiente derruba a gravação.
   */
  app.put('/proposals/:id/itens', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ items: z.array(itemSchema) }).parse(req.body);

    const companyId = req.user!.companyId;
    const proposta = await prisma.proposal.findFirst({ where: { id, companyId } });
    if (!proposta) throw notFound('Proposta não encontrada.');
    if (proposta.status === 'ACEITA' || proposta.status === 'CANCELADA') {
      throw unprocessable('Proposta já encerrada — duplique-a para alterar os itens.');
    }

    const problemas = await conferirEstoque(companyId, body.items);
    if (problemas.length) {
      throw unprocessable(
        `Sem estoque para ${problemas.length} item(ns) da proposta. Não dá para oferecer o que não temos.`,
        problemas,
      );
    }

    // guarda o saldo do momento, para conferência depois
    const saldos = new Map<string, number>();
    for (const i of body.items) {
      if (i.productId && !saldos.has(i.productId)) saldos.set(i.productId, await saldoDoProduto(i.productId));
    }

    await prisma.$transaction(async (tx) => {
      await tx.proposalItem.deleteMany({ where: { proposalId: id } });
      if (body.items.length) {
        await tx.proposalItem.createMany({
          data: body.items.map((i, idx) => ({
            proposalId: id,
            position: idx,
            quantity: new Prisma.Decimal(i.quantity),
            quantityText: i.quantityText ?? String(Math.round(i.quantity)).padStart(2, '0'),
            unit: i.unit ?? 'UN',
            description: i.description,
            unitPrice: new Prisma.Decimal(i.unitPrice),
            total: new Prisma.Decimal(i.total ?? i.unitPrice * i.quantity),
            productId: i.productId ?? null,
            stockAtInsert: i.productId ? new Prisma.Decimal(saldos.get(i.productId) ?? 0) : null,
          })),
        });
      }
    });

    await recalcular(id);
    await registrarEvento(id, 'EDITADA', {
      message: `${body.items.length} item(ns) na proposta`,
      userId: req.user!.id,
      userName: req.user!.name,
    });

    const p = await prisma.proposal.findUnique({ where: { id }, include: incluirTudo });
    return serializar(p);
  });

  /** Confere o estoque de todos os itens vinculados, sob demanda. */
  app.get('/proposals/:id/disponibilidade', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const p = await prisma.proposal.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: { items: true },
    });
    if (!p) throw notFound('Proposta não encontrada.');
    const problemas = await conferirEstoque(
      req.user!.companyId,
      p.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), description: i.description })),
    );
    return {
      ok: problemas.length === 0,
      itensVinculados: p.items.filter((i) => i.productId).length,
      itensLivres: p.items.filter((i) => !i.productId).length,
      problemas,
    };
  });

  /** Muda o estágio da negociação e deixa registrado quem e quando. */
  app.post('/proposals/:id/status', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(STATUS),
        message: z.string().optional(),
        lostReason: z.string().optional(),
        followUpAt: z.string().optional(),
      })
      .parse(req.body);

    const atual = await prisma.proposal.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!atual) throw notFound('Proposta não encontrada.');
    if (atual.status === body.status) throw badRequest('A proposta já está neste estágio.');

    if (body.status === 'ENVIADA') {
      const problemas = await conferirEstoque(
        req.user!.companyId,
        (await prisma.proposalItem.findMany({ where: { proposalId: id } })).map((i) => ({
          productId: i.productId, quantity: Number(i.quantity), description: i.description,
        })),
      );
      if (problemas.length) {
        throw unprocessable('Não é possível enviar: há itens sem estoque suficiente.', problemas);
      }
    }

    const agora = new Date();
    await prisma.proposal.update({
      where: { id },
      data: {
        status: body.status,
        ...(body.status === 'ENVIADA' && !atual.sentAt ? { sentAt: agora } : {}),
        ...(['EM_NEGOCIACAO', 'AGUARDANDO_RETORNO'].includes(body.status) && !atual.respondedAt ? { respondedAt: agora } : {}),
        ...(['ACEITA', 'RECUSADA'].includes(body.status) ? { decidedAt: agora } : {}),
        ...(body.lostReason ? { lostReason: body.lostReason } : {}),
        ...(body.followUpAt ? { followUpAt: new Date(body.followUpAt) } : {}),
      },
    });
    await registrarEvento(id, 'STATUS_ALTERADO', {
      fromStatus: atual.status,
      toStatus: body.status,
      message: body.message ?? body.lostReason,
      userId: req.user!.id,
      userName: req.user!.name,
    });

    const p = await prisma.proposal.findUnique({ where: { id }, include: incluirTudo });
    return serializar(p);
  });

  /** Anota o retorno do cliente ou um lembrete de follow-up. */
  app.post('/proposals/:id/eventos', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        type: z.enum(['RETORNO_CLIENTE', 'FOLLOW_UP', 'NOTA']).default('NOTA'),
        message: z.string().min(1),
        followUpAt: z.string().optional(),
      })
      .parse(req.body);

    const p = await prisma.proposal.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!p) throw notFound('Proposta não encontrada.');

    await registrarEvento(id, body.type, { message: body.message, userId: req.user!.id, userName: req.user!.name });
    if (body.followUpAt) await prisma.proposal.update({ where: { id }, data: { followUpAt: new Date(body.followUpAt) } });
    if (body.type === 'RETORNO_CLIENTE' && !p.respondedAt) {
      await prisma.proposal.update({ where: { id }, data: { respondedAt: new Date() } });
    }

    const completa = await prisma.proposal.findUnique({ where: { id }, include: incluirTudo });
    return serializar(completa);
  });

  app.post('/proposals/:id/duplicar', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const companyId = req.user!.companyId;
    const origem = await prisma.proposal.findFirst({ where: { id, companyId }, include: { items: { orderBy: { position: 'asc' } } } });
    if (!origem) throw notFound('Proposta não encontrada.');

    const nova = await prisma.$transaction(async (tx) => {
      const numero = await nextNumber(tx, companyId, 'proposal');
      return tx.proposal.create({
        data: {
          companyId, number: numero, status: 'RASCUNHO',
          customerId: origem.customerId, clientName: origem.clientName, clientPhone: origem.clientPhone,
          clientEmail: origem.clientEmail, clientLocal: origem.clientLocal, clientDocument: origem.clientDocument,
          scopeTitle: origem.scopeTitle, intro: origem.intro, discount: origem.discount,
          paymentTerms: origem.paymentTerms, paymentCash: origem.paymentCash, cashTotal: origem.cashTotal,
          deliveryTerms: origem.deliveryTerms, validityDays: origem.validityDays,
          validUntil: new Date(Date.now() + origem.validityDays * 86400000),
          closingNote: origem.closingNote, footerNote: origem.footerNote,
          salesRep: origem.salesRep, city: origem.city,
          templateId: origem.templateId, userId: req.user!.id,
          items: {
            create: origem.items.map((i) => ({
              position: i.position, quantity: i.quantity, quantityText: i.quantityText, unit: i.unit,
              description: i.description, unitPrice: i.unitPrice, total: i.total, productId: i.productId,
            })),
          },
        },
      });
    });

    await recalcular(nova.id);
    await registrarEvento(nova.id, 'CRIADA', {
      message: `Duplicada da proposta #${origem.number}`,
      userId: req.user!.id, userName: req.user!.name,
    });
    const p = await prisma.proposal.findUnique({ where: { id: nova.id }, include: incluirTudo });
    return serializar(p);
  });

  /** Transforma a proposta atual num modelo reutilizável. */
  app.post('/proposals/:id/salvar-como-modelo', { preHandler: requireRole(...CAN_SELL) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ name: z.string().min(2) }).parse(req.body);
    const companyId = req.user!.companyId;

    const p = await prisma.proposal.findFirst({ where: { id, companyId }, include: { items: { orderBy: { position: 'asc' } } } });
    if (!p) throw notFound('Proposta não encontrada.');
    const dup = await prisma.proposalTemplate.findFirst({ where: { companyId, name: body.name } });
    if (dup) throw conflict(`Já existe um modelo chamado "${body.name}".`);

    return prisma.proposalTemplate.create({
      data: {
        companyId, name: body.name, scopeTitle: p.scopeTitle, intro: p.intro,
        paymentTerms: p.paymentTerms, paymentCash: p.paymentCash, deliveryTerms: p.deliveryTerms,
        validityDays: p.validityDays, closingNote: p.closingNote, footerNote: p.footerNote,
        salesRep: p.salesRep, city: p.city,
        items: {
          create: p.items.map((i) => ({
            position: i.position, quantity: i.quantity, quantityText: i.quantityText,
            description: i.description, unitPrice: i.unitPrice, total: i.total, productId: i.productId,
          })),
        },
      },
      include: { items: true },
    });
  });

  app.delete('/proposals/:id', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const p = await prisma.proposal.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!p) throw notFound('Proposta não encontrada.');
    await prisma.proposal.delete({ where: { id } });
    return { ok: true };
  });

  // ══════════════════════ EXPORTAÇÃO ══════════════════════
  app.get('/proposals/:id/export/:formato', async (req, reply) => {
    const { id, formato } = z
      .object({ id: z.string().uuid(), formato: z.enum(['pdf', 'docx', 'xlsx']) })
      .parse(req.params);

    const companyId = req.user!.companyId;
    const p = await prisma.proposal.findFirst({ where: { id, companyId }, include: { items: { orderBy: { position: 'asc' } } } });
    if (!p) throw notFound('Proposta não encontrada.');
    const empresa = await prisma.company.findUnique({ where: { id: companyId } });

    const dados: PropostaExport = {
      numero: p.number,
      emissao: p.issueDate,
      cidade: p.city ?? 'Jundiaí',
      cliente: { nome: p.clientName, telefone: p.clientPhone, local: p.clientLocal, email: p.clientEmail },
      escopo: p.scopeTitle,
      intro: p.intro,
      itens: p.items.map((i) => ({
        quantidadeTexto: i.quantityText ?? String(Math.round(Number(i.quantity))).padStart(2, '0'),
        descricao: i.description,
        total: n(i.total),
      })),
      total: n(p.total),
      totalPorExtenso: p.totalInWords ?? porExtensoEntreParenteses(n(p.total)),
      totalAVista: p.cashTotal == null ? null : n(p.cashTotal),
      condicoesPagamento: p.paymentTerms,
      condicoesAVista: p.paymentCash,
      prazoEntrega: p.deliveryTerms,
      validadeDias: p.validityDays,
      fechamento: p.closingNote,
      notaImportante: p.footerNote,
      vendedor: p.salesRep,
      empresa: {
        nome: (empresa?.name ?? 'JUNDIAQUECE').toUpperCase(),
        endereco: 'Av. Pref. Luiz Latorre, 4115 - Jd das Hortências - CEP 13209-430 - Jundiaí - SP',
        email: empresa?.email ?? 'jundaquece@jundaquece.com.br',
        site: 'www.jundaquece.com.br',
        telefone: empresa?.phone ?? '(11) 4522-6487',
      },
    };

    const gerar = { pdf: gerarPdf, docx: gerarDocx, xlsx: gerarXlsx }[formato];
    const buffer = await gerar(dados);
    const tipo = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }[formato];

    await registrarEvento(id, 'EXPORTADA', {
      message: `Baixada em ${formato.toUpperCase()}`,
      userId: req.user!.id, userName: req.user!.name,
    });

    reply.header('Content-Type', tipo);
    reply.header('Content-Disposition', `attachment; filename="${nomeArquivo(dados, formato)}"`);
    return reply.send(buffer);
  });
}
