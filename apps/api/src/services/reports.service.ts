import { prisma } from '../lib/prisma.js';

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** KPIs do painel inicial. */
export async function dashboard(companyId: string) {
  const hoje = startOfDay();

  const [warehouses, stockRows, produtosAtivos, vendasHoje, vendas30, movs7, ultimasMov] =
    await Promise.all([
      prisma.warehouse.findMany({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
      prisma.stockItem.findMany({
        where: { product: { companyId, active: true } },
        include: { product: true, warehouse: true },
      }),
      prisma.product.count({ where: { companyId, active: true } }),
      prisma.sale.aggregate({
        where: { companyId, status: 'FINALIZADA', createdAt: { gte: hoje } },
        _sum: { total: true, costTotal: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { companyId, status: 'FINALIZADA', createdAt: { gte: daysAgo(30) } },
        _sum: { total: true, costTotal: true },
        _count: true,
      }),
      prisma.movement.groupBy({
        by: ['type'],
        where: { companyId, createdAt: { gte: daysAgo(7) }, status: 'CONFIRMADO' },
        _count: true,
      }),
      prisma.movement.findMany({
        where: { companyId },
        include: { product: true, fromWarehouse: true, toWarehouse: true, user: true },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
    ]);

  const porDeposito = warehouses.map((w) => {
    const rows = stockRows.filter((s) => s.warehouseId === w.id);
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      skus: rows.filter((r) => Number(r.quantity) > 0).length,
      unidades: rows.reduce((a, r) => a + Number(r.quantity), 0),
      valor: rows.reduce((a, r) => a + Number(r.quantity) * Number(r.avgCost), 0),
      abaixoMinimo: rows.filter((r) => Number(r.quantity) < Number(r.product.minStock)).length,
    };
  });

  const abaixoMinimo = stockRows
    .filter((r) => Number(r.quantity) < Number(r.product.minStock))
    .map((r) => ({
      productId: r.productId,
      sku: r.product.sku,
      name: r.product.name,
      warehouse: r.warehouse.name,
      quantity: Number(r.quantity),
      minStock: Number(r.product.minStock),
      falta: Number(r.product.minStock) - Number(r.quantity),
    }))
    .sort((a, b) => b.falta - a.falta)
    .slice(0, 25);

  const receita30 = Number(vendas30._sum.total ?? 0);
  const custo30 = Number(vendas30._sum.costTotal ?? 0);

  return {
    valorTotalEstoque: stockRows.reduce((a, r) => a + Number(r.quantity) * Number(r.avgCost), 0),
    unidadesTotais: stockRows.reduce((a, r) => a + Number(r.quantity), 0),
    produtosAtivos,
    depositos: porDeposito,
    alertas: { abaixoMinimo: abaixoMinimo.length, lista: abaixoMinimo },
    vendas: {
      hoje: { qtd: vendasHoje._count, total: Number(vendasHoje._sum.total ?? 0) },
      ultimos30: {
        qtd: vendas30._count,
        receita: receita30,
        custo: custo30,
        margem: receita30 > 0 ? ((receita30 - custo30) / receita30) * 100 : 0,
      },
    },
    movimentos7dias: movs7.map((m) => ({ tipo: m.type, qtd: m._count })),
    ultimasMovimentacoes: ultimasMov.map((m) => ({
      id: m.id,
      number: m.number,
      tipo: m.type,
      produto: m.product.name,
      sku: m.product.sku,
      quantidade: Number(m.quantity),
      origem: m.fromWarehouse?.name ?? null,
      destino: m.toWarehouse?.name ?? null,
      usuario: m.user.name,
      data: m.createdAt,
    })),
  };
}

/** Curva ABC por valor de saída no período. */
export async function curvaABC(companyId: string, dias = 90) {
  const movs = await prisma.movement.findMany({
    where: {
      companyId,
      type: { in: ['SAIDA', 'VENDA'] },
      status: 'CONFIRMADO',
      createdAt: { gte: daysAgo(dias) },
    },
    include: { product: true },
  });

  const acc = new Map<string, { sku: string; name: string; qtd: number; valor: number }>();
  for (const m of movs) {
    const cur = acc.get(m.productId) ?? { sku: m.product.sku, name: m.product.name, qtd: 0, valor: 0 };
    cur.qtd += Number(m.quantity);
    cur.valor += Number(m.quantity) * Number(m.unitCost || m.product.salePrice);
    acc.set(m.productId, cur);
  }

  const lista = [...acc.entries()]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.valor - a.valor);

  const total = lista.reduce((a, i) => a + i.valor, 0) || 1;
  let cum = 0;
  return lista.map((i) => {
    cum += i.valor;
    const pct = (cum / total) * 100;
    return {
      ...i,
      participacao: (i.valor / total) * 100,
      acumulado: pct,
      classe: pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C',
    };
  });
}

/** Giro de estoque: saídas do período ÷ estoque médio. */
export async function giroEstoque(companyId: string, dias = 90) {
  const [saidas, stock] = await Promise.all([
    prisma.movement.groupBy({
      by: ['productId'],
      where: {
        companyId,
        type: { in: ['SAIDA', 'VENDA'] },
        status: 'CONFIRMADO',
        createdAt: { gte: daysAgo(dias) },
      },
      _sum: { quantity: true },
    }),
    prisma.stockItem.findMany({
      where: { product: { companyId, active: true } },
      include: { product: true },
    }),
  ]);

  const saidaMap = new Map(saidas.map((s) => [s.productId, Number(s._sum.quantity ?? 0)]));
  const porProduto = new Map<string, { sku: string; name: string; saldo: number; custo: number }>();
  for (const s of stock) {
    const cur = porProduto.get(s.productId) ?? {
      sku: s.product.sku,
      name: s.product.name,
      saldo: 0,
      custo: Number(s.avgCost),
    };
    cur.saldo += Number(s.quantity);
    porProduto.set(s.productId, cur);
  }

  return [...porProduto.entries()]
    .map(([productId, p]) => {
      const consumo = saidaMap.get(productId) ?? 0;
      const giro = p.saldo > 0 ? consumo / p.saldo : consumo > 0 ? 999 : 0;
      const diasCobertura = consumo > 0 ? (p.saldo / (consumo / dias)) : null;
      return {
        productId,
        sku: p.sku,
        name: p.name,
        saldo: p.saldo,
        consumoPeriodo: consumo,
        giro: +giro.toFixed(2),
        diasCobertura: diasCobertura == null ? null : Math.round(diasCobertura),
        situacao:
          consumo === 0 && p.saldo > 0
            ? 'PARADO'
            : diasCobertura != null && diasCobertura < 15
              ? 'RISCO_RUPTURA'
              : diasCobertura != null && diasCobertura > 180
                ? 'EXCESSO'
                : 'SAUDAVEL',
      };
    })
    .sort((a, b) => b.giro - a.giro);
}

/** Extrato (kardex) de um produto. */
export async function kardex(companyId: string, productId: string, dias = 180) {
  const movs = await prisma.movement.findMany({
    where: { companyId, productId, createdAt: { gte: daysAgo(dias) } },
    include: { fromWarehouse: true, toWarehouse: true, user: true },
    orderBy: { createdAt: 'asc' },
  });
  return movs.map((m) => ({
    id: m.id,
    number: m.number,
    data: m.createdAt,
    tipo: m.type,
    status: m.status,
    quantidade: Number(m.quantity),
    origem: m.fromWarehouse?.name ?? null,
    destino: m.toWarehouse?.name ?? null,
    saldoOrigem: m.balanceFrom == null ? null : Number(m.balanceFrom),
    saldoDestino: m.balanceTo == null ? null : Number(m.balanceTo),
    custoUnit: Number(m.unitCost),
    motivo: m.reason,
    documento: m.document,
    usuario: m.user.name,
  }));
}

/** Série diária de vendas para o gráfico do dashboard. */
export async function vendasPorDia(companyId: string, dias = 30) {
  const rows = await prisma.$queryRaw<{ dia: Date; total: number; qtd: bigint }[]>`
    SELECT date_trunc('day', created_at) AS dia,
           COALESCE(SUM(total), 0)::float8 AS total,
           COUNT(*) AS qtd
      FROM sales
     WHERE company_id = ${companyId}::uuid
       AND status = 'FINALIZADA'
       AND created_at >= NOW() - (${dias} || ' days')::interval
     GROUP BY 1
     ORDER BY 1
  `;
  return rows.map((r) => ({ dia: r.dia, total: Number(r.total), qtd: Number(r.qtd) }));
}
