import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole, CAN_MANAGE, CAN_WRITE_STOCK } from '../lib/auth.js';
import { conflict, notFound } from '../lib/errors.js';
import { enqueueProduct } from '../services/sync.service.js';

/**
 * O estoque desta operação não tem etiqueta nem código impresso: o produto é
 * achado pela descrição. O SKU continua existindo como código interno, mas é
 * OPCIONAL — quando não vem preenchido, o sistema gera um sequencial.
 */
async function gerarSku(companyId: string): Promise<string> {
  const total = await prisma.product.count({ where: { companyId } });
  for (let i = total + 1; i < total + 5000; i++) {
    const candidato = `P-${String(i).padStart(5, '0')}`;
    const existe = await prisma.product.findFirst({ where: { companyId, sku: candidato } });
    if (!existe) return candidato;
  }
  return `P-${Date.now()}`;
}

/** Minúsculo e sem acento — "Abraçadeira 3/4" vira "abracadeira 3/4". */
export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Texto único contra o qual a busca do balcão roda. */
export const montarSearchText = (p: {
  name?: string | null; description?: string | null; size?: string | null;
  unit?: string | null; sku?: string | null; barcode?: string | null;
}) =>
  normalizar([p.name, p.description, p.size, p.unit, p.sku, p.barcode].filter(Boolean).join(' '));

/**
 * Busca por PALAVRA — é assim que o operador acha o item, já que o estoque não
 * tem etiqueta nem código impresso. Cada palavra digitada precisa aparecer no
 * texto normalizado do produto, em qualquer ordem e sem depender de acento:
 * "tubo 20 marrom", "marrom 20 tubo" e "tubo 20 marrom" dão o mesmo resultado.
 */
function filtroBusca(termo?: string) {
  const palavras = normalizar(termo ?? '').split(/\s+/).filter(Boolean).slice(0, 8);
  if (!palavras.length) return {};
  return {
    AND: palavras.map((palavra) => ({
      OR: [
        { searchText: { contains: palavra } },
        // fallback para registros antigos ainda sem o texto normalizado
        { name: { contains: palavra, mode: 'insensitive' as const } },
      ],
    })),
  };
}

/** Campos de medida aceitos no cadastro de produto. */
const camposMedida = {
  size: z.string().max(60).optional().or(z.literal('')),
  measure: z.coerce.number().min(0).optional(),
  measureUnit: z.string().max(10).optional().or(z.literal('')),
};

export default async function catalogRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ─────────────────────── DEPÓSITOS ───────────────────────
  app.get('/warehouses', async (req) =>
    prisma.warehouse.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { code: 'asc' },
    }),
  );

  app.post('/warehouses', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const body = z
      .object({
        code: z.string().min(1),
        name: z.string().min(2),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);

    const dup = await prisma.warehouse.findFirst({
      where: { companyId: req.user!.companyId, code: body.code },
    });
    if (dup) throw conflict(`Já existe um depósito com o código ${body.code}.`);

    if (body.isDefault) {
      await prisma.warehouse.updateMany({
        where: { companyId: req.user!.companyId },
        data: { isDefault: false },
      });
    }
    return prisma.warehouse.create({ data: { ...body, companyId: req.user!.companyId } });
  });

  app.patch('/warehouses/:id', { preHandler: requireRole(...CAN_MANAGE) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        code: z.string().min(1).optional(),
        name: z.string().min(2).optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        active: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);

    const w = await prisma.warehouse.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!w) throw notFound('Depósito não encontrado.');

    if (body.code && body.code !== w.code) {
      const dup = await prisma.warehouse.findFirst({
        where: { companyId: req.user!.companyId, code: body.code, id: { not: id } },
      });
      if (dup) throw conflict(`Já existe um depósito com o código ${body.code}.`);
    }
    if (body.isDefault) {
      await prisma.warehouse.updateMany({
        where: { companyId: req.user!.companyId },
        data: { isDefault: false },
      });
    }
    return prisma.warehouse.update({ where: { id }, data: body });
  });

  // ─────────────────────── CATEGORIAS ───────────────────────
  app.get('/categories', async (req) =>
    prisma.category.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: 'asc' },
    }),
  );

  app.post('/categories', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z.object({ name: z.string().min(1), color: z.string().optional() }).parse(req.body);
    return prisma.category.create({ data: { ...body, companyId: req.user!.companyId } });
  });

  // ─────────────────────── FORNECEDORES ───────────────────────
  app.get('/suppliers', async (req) =>
    prisma.supplier.findMany({
      where: { companyId: req.user!.companyId },
      orderBy: { name: 'asc' },
    }),
  );

  app.post('/suppliers', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z
      .object({
        name: z.string().min(2),
        cnpj: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        phone: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    return prisma.supplier.create({ data: { ...body, companyId: req.user!.companyId } });
  });

  // ─────────────────────── CLIENTES ───────────────────────
  app.get('/customers', async (req) => {
    const q = z.object({ search: z.string().optional() }).parse(req.query);
    return prisma.customer.findMany({
      where: {
        companyId: req.user!.companyId,
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
  });

  app.post('/customers', async (req) => {
    const body = z
      .object({
        name: z.string().min(2),
        document: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
      })
      .parse(req.body);
    return prisma.customer.create({ data: { ...body, companyId: req.user!.companyId } });
  });

  // ─────────────────────── PRODUTOS ───────────────────────
  app.get('/products', async (req) => {
    const q = z
      .object({
        search: z.string().optional(),
        categoryId: z.string().uuid().optional(),
        active: z.enum(['true', 'false']).optional(),
        take: z.coerce.number().min(1).max(500).default(100),
        skip: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);

    const where = {
      companyId: req.user!.companyId,
      ...(q.active ? { active: q.active === 'true' } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...filtroBusca(q.search),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true, supplier: true, stockItems: { include: { warehouse: true } } },
        orderBy: { name: 'asc' },
        take: q.take,
        skip: q.skip,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      total,
      items: items.map((p) => ({
        ...p,
        costPrice: Number(p.costPrice),
        salePrice: Number(p.salePrice),
        minStock: Number(p.minStock),
        maxStock: p.maxStock == null ? null : Number(p.maxStock),
        totalStock: p.stockItems.reduce((a, s) => a + Number(s.quantity), 0),
        stockByWarehouse: p.stockItems.map((s) => ({
          warehouseId: s.warehouseId,
          warehouse: s.warehouse.name,
          code: s.warehouse.code,
          quantity: Number(s.quantity),
        })),
      })),
    };
  });

  /**
   * BUSCA DE BALCÃO — é o campo que o operador usa o dia inteiro.
   * Aceita palavras soltas ("tubo 20 marrom"), o código interno ou uma leitura
   * de código de barras. Devolve o item já com o saldo de cada depósito, para o
   * operador escolher sem precisar de etiqueta.
   */
  app.get('/products/search', async (req) => {
    const q = z
      .object({
        q: z.string().default(''),
        warehouseId: z.string().uuid().optional(),
        take: z.coerce.number().min(1).max(50).default(12),
        comSaldo: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);

    const companyId = req.user!.companyId;
    const termo = q.q.trim();

    // Leitura de código de barras / código interno exato entra na frente.
    const exato = termo
      ? await prisma.product.findFirst({
          where: { companyId, active: true, OR: [{ barcode: termo }, { sku: termo }] },
          include: { category: true, stockItems: { include: { warehouse: true } } },
        })
      : null;

    const encontrados = await prisma.product.findMany({
      where: {
        companyId,
        active: true,
        ...(exato ? { id: { not: exato.id } } : {}),
        ...filtroBusca(termo),
      },
      include: { category: true, stockItems: { include: { warehouse: true } } },
      orderBy: { name: 'asc' },
      take: q.take,
    });

    const lista = exato ? [exato, ...encontrados] : encontrados;

    const mapeado = lista.map((p) => {
      const porDeposito = p.stockItems.map((s) => ({
        warehouseId: s.warehouseId,
        warehouse: s.warehouse.name,
        code: s.warehouse.code,
        quantity: Number(s.quantity),
      }));
      const medida =
        p.measure != null
          ? `${Number(p.measure).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${p.measureUnit ?? ''}`.trim()
          : null;
      return {
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        description: p.description,
        unit: p.unit,
        size: p.size,
        measure: p.measure == null ? null : Number(p.measure),
        measureUnit: p.measureUnit,
        medidaFormatada: medida,
        category: p.category?.name ?? null,
        costPrice: Number(p.costPrice),
        salePrice: Number(p.salePrice),
        minStock: Number(p.minStock),
        exato: exato ? p.id === exato.id : false,
        totalStock: porDeposito.reduce((a, s) => a + s.quantity, 0),
        saldoNoDeposito: q.warehouseId
          ? (porDeposito.find((s) => s.warehouseId === q.warehouseId)?.quantity ?? 0)
          : null,
        stockByWarehouse: porDeposito,
      };
    });

    return {
      termo,
      total: mapeado.length,
      items: q.comSaldo === 'true' ? mapeado.filter((p) => p.totalStock > 0) : mapeado,
    };
  });

  /** Busca por código de barras — atalho opcional, para quem tiver leitor. */
  app.get('/products/barcode/:code', async (req) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.params);
    const product = await prisma.product.findFirst({
      where: {
        companyId: req.user!.companyId,
        active: true,
        OR: [{ barcode: code }, { sku: code }],
      },
      include: { stockItems: { include: { warehouse: true } }, category: true },
    });
    if (!product) throw notFound(`Nenhum produto com o código "${code}".`);
    return {
      ...product,
      costPrice: Number(product.costPrice),
      salePrice: Number(product.salePrice),
      minStock: Number(product.minStock),
      stockByWarehouse: product.stockItems.map((s) => ({
        warehouseId: s.warehouseId,
        warehouse: s.warehouse.name,
        quantity: Number(s.quantity),
        avgCost: Number(s.avgCost),
      })),
    };
  });

  app.post('/products', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z
      .object({
        sku: z.string().optional().or(z.literal('')),
        barcode: z.string().optional().or(z.literal('')),
        name: z.string().min(2),
        description: z.string().optional(),
        unit: z.string().default('UN'),
        ...camposMedida,
        costPrice: z.coerce.number().min(0).default(0),
        salePrice: z.coerce.number().min(0).default(0),
        minStock: z.coerce.number().min(0).default(0),
        maxStock: z.coerce.number().min(0).optional(),
        categoryId: z.string().uuid().optional().or(z.literal('')),
        supplierId: z.string().uuid().optional().or(z.literal('')),
      })
      .parse(req.body);

    const companyId = req.user!.companyId;
    const sku = body.sku?.trim() || (await gerarSku(companyId));

    const dup = await prisma.product.findFirst({ where: { companyId, sku } });
    if (dup) throw conflict(`Já existe um produto com o código interno ${sku}.`);

    const product = await prisma.product.create({
      data: {
        companyId,
        sku,
        barcode: body.barcode || null,
        name: body.name,
        description: body.description,
        unit: body.unit,
        size: body.size || null,
        measure: body.measure ?? null,
        measureUnit: body.measureUnit || null,
        costPrice: body.costPrice,
        salePrice: body.salePrice,
        minStock: body.minStock,
        maxStock: body.maxStock,
        categoryId: body.categoryId || null,
        supplierId: body.supplierId || null,
      },
    });

    await prisma.$transaction(async (tx) => enqueueProduct(tx, req.user!.companyId, product.id));
    return product;
  });

  app.patch('/products/:id', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        sku: z.string().min(1).optional(),
        barcode: z.string().optional().or(z.literal('')),
        name: z.string().min(2).optional(),
        description: z.string().optional(),
        unit: z.string().optional(),
        ...camposMedida,
        costPrice: z.coerce.number().min(0).optional(),
        salePrice: z.coerce.number().min(0).optional(),
        minStock: z.coerce.number().min(0).optional(),
        maxStock: z.coerce.number().min(0).optional(),
        categoryId: z.string().uuid().optional().or(z.literal('')),
        supplierId: z.string().uuid().optional().or(z.literal('')),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const exists = await prisma.product.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!exists) throw notFound('Produto não encontrado.');

    const mesclado = { ...exists, ...body };
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...body,
        barcode: body.barcode === '' ? null : body.barcode,
        size: body.size === '' ? null : body.size,
        measureUnit: body.measureUnit === '' ? null : body.measureUnit,
        categoryId: body.categoryId === '' ? null : body.categoryId,
        supplierId: body.supplierId === '' ? null : body.supplierId,
        searchText: montarSearchText(mesclado as never),
      },
    });
    await prisma.$transaction(async (tx) => enqueueProduct(tx, req.user!.companyId, product.id));
    return product;
  });

  /** Importação em lote (CSV colado no front). */
  app.post('/products/bulk', { preHandler: requireRole(...CAN_WRITE_STOCK) }, async (req) => {
    const body = z
      .object({
        items: z
          .array(
            z.object({
              sku: z.string().min(1),
              name: z.string().min(1),
              barcode: z.string().optional(),
              unit: z.string().default('UN'),
              size: z.string().optional(),
              measure: z.coerce.number().optional(),
              measureUnit: z.string().optional(),
              categoria: z.string().optional(),
              costPrice: z.coerce.number().default(0),
              salePrice: z.coerce.number().default(0),
              minStock: z.coerce.number().default(0),
            }),
          )
          .min(1)
          .max(1000),
      })
      .parse(req.body);

    const companyId = req.user!.companyId;
    let criados = 0;
    let atualizados = 0;

    // resolve as categorias informadas por nome, criando as que faltarem
    const nomesCategoria = [...new Set(body.items.map((i) => i.categoria).filter(Boolean) as string[])];
    const categorias = new Map<string, string>();
    for (const nome of nomesCategoria) {
      const existente = await prisma.category.findFirst({ where: { companyId, name: nome } });
      const cat = existente ?? (await prisma.category.create({ data: { companyId, name: nome } }));
      categorias.set(nome, cat.id);
    }

    for (const item of body.items) {
      const { categoria, ...campos } = item;
      const dados = {
        ...campos,
        size: campos.size || null,
        measure: campos.measure ?? null,
        measureUnit: campos.measureUnit || null,
        barcode: campos.barcode || null,
        categoryId: categoria ? (categorias.get(categoria) ?? null) : undefined,
        searchText: montarSearchText(campos),
      };
      const existing = await prisma.product.findFirst({ where: { companyId, sku: item.sku } });
      const saved = existing
        ? await prisma.product.update({ where: { id: existing.id }, data: dados })
        : await prisma.product.create({ data: { ...dados, companyId } });
      existing ? atualizados++ : criados++;
      await prisma.$transaction(async (tx) => enqueueProduct(tx, companyId, saved.id));
    }
    return { criados, atualizados, total: body.items.length };
  });
}
