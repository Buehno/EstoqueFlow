/**
 * compras.service
 *
 * Regra de reposição pedida em 24/09, depois da primeira contagem física:
 *
 *   O estoque mínimo é o teto de conforto, não o gatilho de compra.
 *   - total acima do mínimo ............................ OK
 *   - total igual ou abaixo do mínimo .................. ATENÇÃO
 *   - total igual ou abaixo de 50% do mínimo ........... ALERTA DE COMPRA
 *
 * E o que conta é o **total somado dos dois depósitos**, não o saldo de cada
 * um separado — era esse o defeito da regra antiga (`reports.service`
 * comparava linha a linha, então 60 peças no Depósito 1 e 60 no Depósito 2,
 * com mínimo 100, apareciam como falta nos dois, quando na verdade há 120).
 *
 * Produto sem mínimo cadastrado não tem régua para comparar: sai do alerta e
 * vai para uma lista própria ("sem mínimo definido"), para a equipe ir
 * definindo o mínimo dos itens que importam.
 */
import { prisma } from '../lib/prisma.js';

/** Unidades vendidas por medida — nelas o saldo quebrado é legítimo. */
export const UNIDADES_FRACIONADAS = new Set([
  'MT', 'M', 'CM', 'MM', 'M2', 'M²', 'M3', 'M³', 'KG', 'G', 'L', 'ML', 'TON',
]);

/** `true` quando o produto pode ter saldo com casa decimal (metro, quilo…). */
export function permiteFracao(unit?: string | null): boolean {
  return UNIDADES_FRACIONADAS.has((unit ?? 'UN').trim().toUpperCase());
}

export type SituacaoCompra = 'ALERTA_COMPRA' | 'ATENCAO' | 'OK' | 'SEM_MINIMO';

export interface LinhaCompra {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  size: string | null;
  categoria: string | null;
  fornecedor: string | null;
  /** Saldo em cada depósito, na ordem do código (DEP-1, DEP-2…). */
  depositos: { id: string; code: string; name: string; quantity: number }[];
  /** A soma dos depósitos — é este número que decide a compra. */
  total: number;
  minStock: number;
  /** 50% do mínimo: abaixo disso dispara o alerta de compra. */
  pontoCompra: number;
  situacao: SituacaoCompra;
  /** Quanto falta para voltar ao mínimo (0 quando está acima). */
  comprarParaRepor: number;
  custoMedio: number;
  valorEstoque: number;
  /** Consumo (saídas + vendas) dos últimos 90 dias — ajuda a dimensionar a compra. */
  saidas90: number;
  /** Quantos dias o saldo atual cobre, no ritmo dos últimos 90 dias. */
  coberturaDias: number | null;
}

/** Posição de compra de toda a empresa, já classificada pela regra nova. */
export async function posicaoCompra(companyId: string) {
  const desde90 = new Date(Date.now() - 90 * 86_400_000);

  const [produtos, depositos, saidas] = await Promise.all([
    prisma.product.findMany({
      where: { companyId, active: true },
      include: {
        category: { select: { name: true } },
        supplier: { select: { name: true } },
        stockItems: { include: { warehouse: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouse.findMany({
      where: { companyId, active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
    prisma.movement.groupBy({
      by: ['productId'],
      where: {
        companyId,
        status: 'CONFIRMADO',
        type: { in: ['SAIDA', 'VENDA'] },
        createdAt: { gte: desde90 },
      },
      _sum: { quantity: true },
    }),
  ]);

  const consumo = new Map(saidas.map((s) => [s.productId, Number(s._sum.quantity ?? 0)]));

  const itens: LinhaCompra[] = produtos.map((p) => {
    const porDeposito = depositos.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      quantity: Number(p.stockItems.find((s) => s.warehouseId === w.id)?.quantity ?? 0),
    }));
    const total = porDeposito.reduce((a, d) => a + d.quantity, 0);
    const minStock = Number(p.minStock);
    const pontoCompra = minStock * 0.5;
    const saidas90 = consumo.get(p.id) ?? 0;
    const custoMedio = p.stockItems.length
      ? p.stockItems.reduce((a, s) => a + Number(s.avgCost) * Number(s.quantity), 0) / (total || 1)
      : Number(p.costPrice);

    const situacao: SituacaoCompra =
      minStock <= 0 ? 'SEM_MINIMO'
        : total <= pontoCompra ? 'ALERTA_COMPRA'
        : total <= minStock ? 'ATENCAO'
        : 'OK';

    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      size: p.size,
      categoria: p.category?.name ?? null,
      fornecedor: p.supplier?.name ?? null,
      depositos: porDeposito,
      total,
      minStock,
      pontoCompra,
      situacao,
      comprarParaRepor: minStock > 0 && total < minStock ? Number((minStock - total).toFixed(3)) : 0,
      custoMedio: Number(custoMedio.toFixed(4)),
      valorEstoque: Number((total * custoMedio).toFixed(2)),
      saidas90,
      coberturaDias: saidas90 > 0 ? Math.round((total / (saidas90 / 90)) * 10) / 10 : null,
    };
  });

  const de = (s: SituacaoCompra) => itens.filter((i) => i.situacao === s);
  const alerta = de('ALERTA_COMPRA');
  const atencao = de('ATENCAO');
  const semMinimo = de('SEM_MINIMO');

  return {
    depositos,
    itens,
    resumo: {
      produtos: itens.length,
      alertaCompra: alerta.length,
      atencao: atencao.length,
      ok: de('OK').length,
      semMinimo: semMinimo.length,
      valorAComprar: Number(
        [...alerta, ...atencao].reduce((a, i) => a + i.comprarParaRepor * i.custoMedio, 0).toFixed(2),
      ),
      valorEstoque: Number(itens.reduce((a, i) => a + i.valorEstoque, 0).toFixed(2)),
    },
    alerta,
    atencao,
    semMinimo,
  };
}

/** Agrupamento por categoria — uma das visões do relatório. */
export function porCategoria(itens: LinhaCompra[]) {
  const mapa = new Map<string, { categoria: string; produtos: number; alerta: number; atencao: number; total: number; valor: number; comprar: number }>();
  for (const i of itens) {
    const chave = i.categoria ?? '(sem categoria)';
    const linha = mapa.get(chave) ?? { categoria: chave, produtos: 0, alerta: 0, atencao: 0, total: 0, valor: 0, comprar: 0 };
    linha.produtos += 1;
    if (i.situacao === 'ALERTA_COMPRA') linha.alerta += 1;
    if (i.situacao === 'ATENCAO') linha.atencao += 1;
    linha.total += i.total;
    linha.valor += i.valorEstoque;
    linha.comprar += i.comprarParaRepor * i.custoMedio;
    mapa.set(chave, linha);
  }
  return [...mapa.values()]
    .map((l) => ({ ...l, valor: Number(l.valor.toFixed(2)), comprar: Number(l.comprar.toFixed(2)) }))
    .sort((a, b) => b.alerta - a.alerta || b.valor - a.valor);
}

/** Agrupamento por fornecedor — para fechar o pedido de compra com cada um. */
export function porFornecedor(itens: LinhaCompra[]) {
  const mapa = new Map<string, { fornecedor: string; itensParaComprar: number; valor: number }>();
  for (const i of itens) {
    if (i.situacao !== 'ALERTA_COMPRA' && i.situacao !== 'ATENCAO') continue;
    const chave = i.fornecedor ?? '(sem fornecedor cadastrado)';
    const linha = mapa.get(chave) ?? { fornecedor: chave, itensParaComprar: 0, valor: 0 };
    linha.itensParaComprar += 1;
    linha.valor += i.comprarParaRepor * i.custoMedio;
    mapa.set(chave, linha);
  }
  return [...mapa.values()]
    .map((l) => ({ ...l, valor: Number(l.valor.toFixed(2)) }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Saldos com casa decimal em produto que NÃO é vendido por medida — o caso do
 * "cotovelo de cobre 33,845" apontado na contagem de 24/09.
 */
export async function saldosQuebrados(companyId: string) {
  const rows = await prisma.stockItem.findMany({
    where: { product: { companyId, active: true } },
    include: { product: true, warehouse: { select: { id: true, code: true, name: true } } },
  });

  return rows
    .filter((r) => !permiteFracao(r.product.unit) && Number(r.quantity) % 1 !== 0)
    .map((r) => {
      const atual = Number(r.quantity);
      const arredondado = Math.round(atual);
      return {
        productId: r.productId,
        sku: r.product.sku,
        name: r.product.name,
        unit: r.product.unit,
        warehouseId: r.warehouseId,
        warehouse: r.warehouse.name,
        warehouseCode: r.warehouse.code,
        atual,
        arredondado,
        diferenca: Number((arredondado - atual).toFixed(3)),
      };
    })
    .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
}

/**
 * Produtos com nome praticamente igual (sem acento, sem pontuação, sem
 * espaço, sem maiúscula) — os candidatos a duplicidade. Traz o saldo e o
 * histórico de cada um, para decidir qual fica.
 */
export async function duplicados(companyId: string) {
  const produtos = await prisma.product.findMany({
    where: { companyId },
    include: {
      stockItems: { include: { warehouse: { select: { code: true, name: true } } } },
      _count: { select: { movements: true, saleItems: true, proposalItems: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const chaveDe = (nome: string) =>
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const grupos = new Map<string, typeof produtos>();
  for (const p of produtos) {
    const chave = chaveDe(p.name);
    grupos.set(chave, [...(grupos.get(chave) ?? []), p]);
  }

  return [...grupos.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([chave, lista]) => ({
      chave,
      produtos: lista.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        size: p.size,
        active: p.active,
        criadoEm: p.createdAt,
        total: p.stockItems.reduce((a, s) => a + Number(s.quantity), 0),
        depositos: p.stockItems.map((s) => ({
          code: s.warehouse.code,
          name: s.warehouse.name,
          quantity: Number(s.quantity),
        })),
        movimentos: p._count.movements,
        vendas: p._count.saleItems,
        propostas: p._count.proposalItems,
      })),
    }))
    .sort((a, b) => b.produtos.length - a.produtos.length);
}
