/**
 * compras.service
 *
 * Regra de reposição (24/09, ajustada em 27/10 pelo Ronaldo):
 *
 *   O campo `minStock` NÃO é um mínimo: é o **estoque sugerido** — a
 *   quantidade que o sistema deve ter daquele item. O único gatilho é:
 *   - total igual ou abaixo de 50% do sugerido ........ ALERTA DE COMPRA
 *   - qualquer outro total ............................. OK
 *   Chegar "perto" do sugerido não dispara nada (o estado "atenção" que
 *   existia foi retirado a pedido). A sugestão de compra é a quantidade que
 *   falta para voltar ao sugerido.
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

/**
 * Unidades vendidas por medida — nelas o saldo com casa decimal é legítimo
 * (12,5 metros de tubo é um saldo real; 2,333 cotovelos não é).
 *
 * A lista é ampla de propósito: a unidade é texto livre no cadastro, então a
 * mesma coisa chega escrita de várias formas ("MT", "MTS", "metro", "m²",
 * "M LINEAR"). Tudo é comparado depois de `normalizarUnidade`, que tira
 * acento, pontuação, espaço e maiúscula e troca ² ³ por 2 3. Na dúvida a
 * unidade é tratada como MEDIDA — assim um erro de grafia no cadastro nunca
 * arredonda (e perde) um saldo que era legítimo.
 */
export const UNIDADES_FRACIONADAS = new Set([
  // comprimento
  'M', 'MT', 'MTS', 'MTR', 'MTRS', 'METRO', 'METROS', 'MC', 'ML', 'MLIN',
  'MLINEAR', 'METROLINEAR', 'METROSLINEARES', 'CM', 'MM', 'KM', 'POL', 'POLEGADA', 'POLEGADAS',
  // área e volume
  'M2', 'MT2', 'METRO2', 'METROQUADRADO', 'METROSQUADRADOS', 'CM2',
  'M3', 'MT3', 'METRO3', 'METROCUBICO', 'METROSCUBICOS', 'CM3',
  'L', 'LT', 'LTS', 'LITRO', 'LITROS', 'ML3', 'MILILITRO', 'GL', 'GALAO', 'GALOES',
  // peso
  'KG', 'KGS', 'QUILO', 'QUILOS', 'G', 'GR', 'GRS', 'GRAMA', 'GRAMAS',
  'TON', 'TONS', 'TONELADA', 'TONELADAS',
]);

/**
 * Deixa a unidade comparável: sem acento, sem pontuação, sem espaço, em
 * maiúscula, com ² e ³ virando 2 e 3. "m²" → "M2", " Mts. " → "MTS",
 * "metro linear" → "METROLINEAR".
 */
export function normalizarUnidade(unit?: string | null): string {
  return (unit ?? 'UN')
    .normalize('NFD')
    .replace(/\u00b2/g, '2')
    .replace(/\u00b3/g, '3')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    || 'UN';
}

/** `true` quando o produto pode ter saldo com casa decimal (metro, quilo…). */
export function permiteFracao(unit?: string | null): boolean {
  const u = normalizarUnidade(unit);
  if (UNIDADES_FRACIONADAS.has(u)) return true;
  // Grafias compostas que começam por metro/litro/quilo ("METROSDETUBO",
  // "LITROSDETINTA") também são medida.
  return /^(METRO|METROS|LITRO|LITROS|QUILO|QUILOS|TONELADA|POLEGADA)/.test(u);
}

/**
 * O saldo arredondado de um item de unidade. Arredonda para o inteiro mais
 * próximo, com uma trava: saldo positivo nunca vira zero — 0,4 peça é uma
 * peça que está na prateleira, e zerar apagaria estoque real.
 */
export function arredondarSaldo(atual: number): number {
  if (atual <= 0) return 0;
  return Math.max(1, Math.round(atual));
}

export type SituacaoCompra = 'ALERTA_COMPRA' | 'OK' | 'SEM_MINIMO';

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
  /** Estoque ACEITÁVEL (nome histórico do campo: minStock). */
  minStock: number;
  /** 50% do sugerido: igual ou abaixo disso dispara o alerta de compra. */
  pontoCompra: number;
  situacao: SituacaoCompra;
  /** Quanto falta para voltar ao sugerido — só preenchido quando em alerta. */
  comprarParaRepor: number;
  /** Fração do sugerido que ainda resta (0 = zerado, 0,5 = no gatilho, 1 = cheio). Null sem sugerido. */
  fracaoRestante: number | null;
  /** Nível dentro do alerta: ZERADO (saldo 0), CRITICO (≤ 25%), ALERTA (≤ 50%). Null fora do alerta. */
  urgencia: 'ZERADO' | 'CRITICO' | 'ALERTA' | null;
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
    // Custo médio ponderado pelo saldo. Achado na revisão de 30/09: quando o
    // item está zerado (justamente o mais crítico para comprar), a média dava
    // zero e o "valor estimado da compra" saía R$ 0,00. Sem saldo para
    // ponderar, vale o custo de cadastro.
    const somaValor = p.stockItems.reduce((a, s) => a + Number(s.avgCost) * Number(s.quantity), 0);
    const custoMedio = total > 0 && somaValor > 0 ? somaValor / total : Number(p.costPrice);

    const situacao: SituacaoCompra =
      minStock <= 0 ? 'SEM_MINIMO'
        : total <= pontoCompra ? 'ALERTA_COMPRA'
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
      comprarParaRepor: situacao === 'ALERTA_COMPRA' ? Number((minStock - total).toFixed(3)) : 0,
      fracaoRestante: minStock > 0 ? Number(Math.min(1, total / minStock).toFixed(3)) : null,
      urgencia: situacao !== 'ALERTA_COMPRA' ? null : total <= 0 ? 'ZERADO' : total <= minStock * 0.25 ? 'CRITICO' : 'ALERTA',
      custoMedio: Number(custoMedio.toFixed(4)),
      valorEstoque: Number((total * custoMedio).toFixed(2)),
      saidas90,
      coberturaDias: saidas90 > 0 ? Math.round((total / (saidas90 / 90)) * 10) / 10 : null,
    };
  });

  const de = (s: SituacaoCompra) => itens.filter((i) => i.situacao === s);
  // Mais urgente primeiro: menor fração restante, depois maior valor a comprar.
  const alerta = de('ALERTA_COMPRA').sort((a, b) =>
    (a.fracaoRestante ?? 1) - (b.fracaoRestante ?? 1) || b.comprarParaRepor * b.custoMedio - a.comprarParaRepor * a.custoMedio);
  const semMinimo = de('SEM_MINIMO');

  return {
    depositos,
    itens,
    resumo: {
      produtos: itens.length,
      alertaCompra: alerta.length,
      zerados: alerta.filter((i) => i.urgencia === 'ZERADO').length,
      criticos: alerta.filter((i) => i.urgencia === 'CRITICO').length,
      fornecedoresEnvolvidos: new Set(alerta.map((i) => i.fornecedor ?? '(sem fornecedor)')).size,
      ok: de('OK').length,
      semMinimo: semMinimo.length,
      valorAComprar: Number(
        alerta.reduce((a, i) => a + i.comprarParaRepor * i.custoMedio, 0).toFixed(2),
      ),
      valorEstoque: Number(itens.reduce((a, i) => a + i.valorEstoque, 0).toFixed(2)),
    },
    alerta,
    semMinimo,
    porCategoria: porCategoria(itens),
    porFornecedor: porFornecedor(itens),
  };
}

/** Agrupamento por categoria — uma das visões do relatório. */
export function porCategoria(itens: LinhaCompra[]) {
  const mapa = new Map<string, { categoria: string; produtos: number; alerta: number; total: number; valor: number; comprar: number }>();
  for (const i of itens) {
    const chave = i.categoria ?? '(sem categoria)';
    const linha = mapa.get(chave) ?? { categoria: chave, produtos: 0, alerta: 0, total: 0, valor: 0, comprar: 0 };
    linha.produtos += 1;
    if (i.situacao === 'ALERTA_COMPRA') linha.alerta += 1;
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
  const mapa = new Map<string, { fornecedor: string; itensParaComprar: number; valor: number; zerados: number }>();
  for (const i of itens) {
    if (i.situacao !== 'ALERTA_COMPRA') continue;
    const chave = i.fornecedor ?? '(sem fornecedor cadastrado)';
    const linha = mapa.get(chave) ?? { fornecedor: chave, itensParaComprar: 0, valor: 0, zerados: 0 };
    linha.itensParaComprar += 1;
    if (i.urgencia === 'ZERADO') linha.zerados += 1;
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
      const arredondado = arredondarSaldo(atual);
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
 * Radiografia de TODO saldo com casa decimal na empresa, agrupado por
 * unidade — serve para conferir, antes de qualquer correção, quais unidades
 * a plataforma está tratando como medida e quais vai arredondar. Pedido de
 * 06/10 ("olhe o sistema todo"): sem essa visão, um cadastro escrito "MTS"
 * ou "metro" poderia ser arredondado por engano.
 */
export async function radiografiaFracionados(companyId: string) {
  const rows = await prisma.stockItem.findMany({
    where: { product: { companyId } },
    include: { product: { select: { unit: true, active: true, name: true, sku: true } } },
  });

  const porUnidade = new Map<
    string,
    { unidade: string; normalizada: string; medida: boolean; saldosQuebrados: number; produtos: Set<string>; exemplos: string[] }
  >();

  for (const r of rows) {
    const atual = Number(r.quantity);
    if (atual % 1 === 0) continue;
    const unidade = (r.product.unit ?? 'UN').trim() || 'UN';
    const normalizada = normalizarUnidade(unidade);
    const atual_ = porUnidade.get(normalizada) ?? {
      unidade, normalizada, medida: permiteFracao(unidade),
      saldosQuebrados: 0, produtos: new Set<string>(), exemplos: [],
    };
    atual_.saldosQuebrados += 1;
    atual_.produtos.add(r.productId);
    if (atual_.exemplos.length < 5) atual_.exemplos.push(`${r.product.sku} · ${r.product.name} = ${atual}`);
    porUnidade.set(normalizada, atual_);
  }

  const lista = [...porUnidade.values()]
    .map((u) => ({ ...u, produtos: u.produtos.size }))
    .sort((a, b) => b.saldosQuebrados - a.saldosQuebrados);

  return {
    unidades: lista,
    aArredondar: lista.filter((u) => !u.medida).reduce((a, u) => a + u.saldosQuebrados, 0),
    preservados: lista.filter((u) => u.medida).reduce((a, u) => a + u.saldosQuebrados, 0),
    unidadesTratadasComoMedida: lista.filter((u) => u.medida).map((u) => u.unidade),
  };
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
