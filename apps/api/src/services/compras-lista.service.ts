/**
 * compras-lista.service — listas de compra (carrinho do comprador), 16/11/2026.
 *
 * O relatório de compras diz O QUE está faltando (regra dos 50% do estoque
 * sugerido). A lista de compra é o que o comprador DECIDIU pedir: ele junta
 * itens num carrinho — do alerta ou de qualquer produto do catálogo —, acerta
 * as quantidades, salva com um nome e acompanha até a mercadoria chegar.
 *
 * Status:  ABERTA → PEDIDA → COMPRADA   (ou CANCELADA a qualquer momento)
 *   ABERTA    sendo montada; itens e quantidades ainda mudam.
 *   PEDIDA    o pedido foi mandado ao fornecedor; itens travados.
 *   COMPRADA  a mercadoria chegou. Na hora de marcar, o comprador escolhe se
 *             o sistema dá ENTRADA no estoque (uma por item, com o número da
 *             lista no motivo) ou se alguém já lançou a nota à mão.
 *
 * Cada mudança registra quem fez e quando. Lista comprada/cancelada não volta
 * atrás — para repetir a compra, duplique.
 */
import { Prisma } from '@prisma/client';
import { prisma, D, nextNumber } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { entrada } from './stock.service.js';

export type StatusLista = 'ABERTA' | 'PEDIDA' | 'COMPRADA' | 'CANCELADA';

export const ROTULO_STATUS_LISTA: Record<StatusLista, string> = {
  ABERTA: 'Aberta',
  PEDIDA: 'Pedida',
  COMPRADA: 'Comprada',
  CANCELADA: 'Cancelada',
};

/** Para onde cada status pode ir. */
const TRANSICOES: Record<StatusLista, StatusLista[]> = {
  ABERTA: ['PEDIDA', 'COMPRADA', 'CANCELADA'],
  PEDIDA: ['COMPRADA', 'CANCELADA', 'ABERTA'],
  COMPRADA: [],
  CANCELADA: [],
};

export interface ItemEntrada {
  productId?: string | null;
  /** Só para item livre (sem cadastro): descrição digitada. */
  name?: string;
  unit?: string;
  quantity: number;
  unitCost?: number;
  notes?: string | null;
}

const incluir = {
  items: { orderBy: { position: 'asc' as const } },
  supplier: { select: { id: true, name: true } },
};

type ListaComItens = Prisma.PurchaseListGetPayload<{ include: typeof incluir }>;

/** Converte Decimals em número — o front não lida com Decimal. */
export function serializar(l: ListaComItens) {
  return {
    id: l.id,
    number: l.number,
    status: l.status as StatusLista,
    name: l.name,
    supplierId: l.supplierId,
    supplierName: l.supplierName ?? l.supplier?.name ?? null,
    notes: l.notes,
    total: Number(l.total),
    itens: l.items.length,
    createdById: l.createdById,
    createdByName: l.createdByName,
    orderedAt: l.orderedAt,
    orderedByName: l.orderedByName,
    boughtAt: l.boughtAt,
    boughtByName: l.boughtByName,
    canceledAt: l.canceledAt,
    canceledByName: l.canceledByName,
    stockedAt: l.stockedAt,
    stockedWarehouseId: l.stockedWarehouseId,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    items: l.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      supplierName: i.supplierName,
      quantity: Number(i.quantity),
      unitCost: Number(i.unitCost),
      total: Number(i.total),
      stockAtAdd: i.stockAtAdd == null ? null : Number(i.stockAtAdd),
      minStockAtAdd: i.minStockAtAdd == null ? null : Number(i.minStockAtAdd),
      notes: i.notes,
      position: i.position,
    })),
  };
}

export type ListaSerializada = ReturnType<typeof serializar>;

async function carregar(tx: Prisma.TransactionClient, companyId: string, id: string) {
  const l = await tx.purchaseList.findFirst({ where: { id, companyId }, include: incluir });
  if (!l) throw notFound('Lista de compra não encontrada.');
  return l;
}

/** Recalcula o total da lista a partir dos itens. */
async function recalcular(tx: Prisma.TransactionClient, listId: string) {
  const soma = await tx.purchaseListItem.aggregate({ where: { listId }, _sum: { total: true } });
  await tx.purchaseList.update({ where: { id: listId }, data: { total: soma._sum.total ?? D(0) } });
}

/**
 * Monta o retrato de cada item: nome, unidade, fornecedor, custo e saldo no
 * momento. Produto do catálogo vem do banco; item livre vem do que foi digitado.
 */
async function montarItens(tx: Prisma.TransactionClient, companyId: string, itens: ItemEntrada[], posicaoInicial: number) {
  const ids = itens.map((i) => i.productId).filter((x): x is string => !!x);
  const produtos = ids.length
    ? await tx.product.findMany({
        where: { id: { in: ids }, companyId },
        include: { supplier: { select: { name: true } }, stockItems: { select: { quantity: true, avgCost: true } } },
      })
    : [];
  const porId = new Map(produtos.map((p) => [p.id, p]));

  return itens.map((i, idx) => {
    if (!(i.quantity > 0)) throw badRequest(`Quantidade inválida no item ${idx + 1}.`);
    const p = i.productId ? porId.get(i.productId) : undefined;
    if (i.productId && !p) throw badRequest(`Produto do item ${idx + 1} não encontrado.`);
    if (!p && !i.name?.trim()) throw badRequest(`Item ${idx + 1}: informe o produto ou uma descrição.`);

    let custo = i.unitCost;
    let saldo: number | null = null;
    if (p) {
      saldo = p.stockItems.reduce((a, s) => a + Number(s.quantity), 0);
      if (custo == null) {
        // mesmo critério do relatório: custo médio ponderado pelo saldo; sem saldo, o custo de cadastro
        const somaValor = p.stockItems.reduce((a, s) => a + Number(s.avgCost) * Number(s.quantity), 0);
        custo = saldo > 0 && somaValor > 0 ? somaValor / saldo : Number(p.costPrice);
      }
    }
    const unitCost = Number((custo ?? 0).toFixed(4));
    const quantity = Number(i.quantity.toFixed(3));
    return {
      productId: p?.id ?? null,
      sku: p?.sku ?? null,
      name: p?.name ?? i.name!.trim(),
      unit: p?.unit ?? (i.unit?.trim() || 'UN'),
      supplierName: p?.supplier?.name ?? null,
      quantity: D(quantity),
      unitCost: D(unitCost),
      total: D(Number((quantity * unitCost).toFixed(2))),
      stockAtAdd: p ? D(saldo ?? 0) : null,
      minStockAtAdd: p ? p.minStock : null,
      notes: i.notes?.trim() || null,
      position: posicaoInicial + idx,
    };
  });
}

// ─────────────────────────── consultas ───────────────────────────

export async function listar(companyId: string, filtro: { status?: StatusLista | 'PENDENTES'; take?: number }) {
  const where: Prisma.PurchaseListWhereInput = { companyId };
  if (filtro.status === 'PENDENTES') where.status = { in: ['ABERTA', 'PEDIDA'] };
  else if (filtro.status) where.status = filtro.status;
  const [listas, contagem] = await Promise.all([
    prisma.purchaseList.findMany({ where, include: incluir, orderBy: [{ createdAt: 'desc' }], take: filtro.take ?? 200 }),
    prisma.purchaseList.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true }, _sum: { total: true } }),
  ]);
  const porStatus = Object.fromEntries(
    (['ABERTA', 'PEDIDA', 'COMPRADA', 'CANCELADA'] as StatusLista[]).map((s) => {
      const c = contagem.find((x) => x.status === s);
      return [s, { listas: c?._count._all ?? 0, valor: Number(c?._sum.total ?? 0) }];
    }),
  ) as Record<StatusLista, { listas: number; valor: number }>;
  return { items: listas.map(serializar), porStatus };
}

export async function obter(companyId: string, id: string) {
  return serializar(await carregar(prisma, companyId, id));
}

/** Produtos que já estão em alguma lista ABERTA ou PEDIDA — para o relatório avisar "já está na lista X". */
export async function produtosEmListasPendentes(companyId: string) {
  const itens = await prisma.purchaseListItem.findMany({
    where: { productId: { not: null }, list: { companyId, status: { in: ['ABERTA', 'PEDIDA'] } } },
    select: { productId: true, quantity: true, list: { select: { id: true, number: true, name: true, status: true } } },
  });
  const mapa: Record<string, { listId: string; number: number; name: string; status: StatusLista; quantity: number }[]> = {};
  for (const i of itens) {
    (mapa[i.productId!] ??= []).push({ listId: i.list.id, number: i.list.number, name: i.list.name, status: i.list.status as StatusLista, quantity: Number(i.quantity) });
  }
  return mapa;
}

// ─────────────────────────── escrita ───────────────────────────

export async function criar(
  companyId: string,
  user: { id: string; name: string },
  dados: { name?: string; supplierId?: string | null; supplierName?: string | null; notes?: string | null; items: ItemEntrada[] },
) {
  if (!dados.items.length) throw badRequest('A lista precisa ter pelo menos um item.');
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, companyId, 'purchase_list');
    let supplierName = dados.supplierName?.trim() || null;
    if (dados.supplierId) {
      const f = await tx.supplier.findFirst({ where: { id: dados.supplierId, companyId } });
      if (!f) throw badRequest('Fornecedor não encontrado.');
      supplierName = f.name;
    }
    const itens = await montarItens(tx, companyId, dados.items, 0);
    const total = itens.reduce((a, i) => a + Number(i.total), 0);
    // nome padrão: "Compra 16/11 — SOLIS" ou "Compra 16/11"
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const name = dados.name?.trim() || `Compra ${hoje}${supplierName ? ` — ${supplierName}` : ''}`;
    const l = await tx.purchaseList.create({
      data: {
        companyId, number, name, supplierId: dados.supplierId ?? null, supplierName,
        notes: dados.notes?.trim() || null, total: D(Number(total.toFixed(2))),
        createdById: user.id, createdByName: user.name,
        items: { create: itens },
      },
      include: incluir,
    });
    return serializar(l);
  });
}

export async function editar(
  companyId: string,
  id: string,
  dados: { name?: string; supplierId?: string | null; supplierName?: string | null; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const l = await carregar(tx, companyId, id);
    if (l.status === 'COMPRADA' || l.status === 'CANCELADA') throw conflict('Lista comprada ou cancelada não pode mais ser alterada. Duplique para uma nova compra.');
    const data: Prisma.PurchaseListUpdateInput = {};
    if (dados.name !== undefined) {
      if (!dados.name.trim()) throw badRequest('Dê um nome para a lista.');
      data.name = dados.name.trim();
    }
    if (dados.notes !== undefined) data.notes = dados.notes?.trim() || null;
    if (dados.supplierId !== undefined) {
      if (dados.supplierId) {
        const f = await tx.supplier.findFirst({ where: { id: dados.supplierId, companyId } });
        if (!f) throw badRequest('Fornecedor não encontrado.');
        data.supplier = { connect: { id: f.id } };
        data.supplierName = f.name;
      } else {
        data.supplier = { disconnect: true };
        data.supplierName = dados.supplierName?.trim() || null;
      }
    } else if (dados.supplierName !== undefined) {
      data.supplierName = dados.supplierName?.trim() || null;
    }
    await tx.purchaseList.update({ where: { id }, data });
    return serializar(await carregar(tx, companyId, id));
  });
}

/** Acrescenta itens; produto que já está na lista soma a quantidade em vez de duplicar. */
export async function adicionarItens(companyId: string, id: string, itens: ItemEntrada[]) {
  if (!itens.length) throw badRequest('Nenhum item para adicionar.');
  return prisma.$transaction(async (tx) => {
    const l = await carregar(tx, companyId, id);
    if (l.status !== 'ABERTA') throw conflict(`Só é possível mexer nos itens de uma lista ABERTA (esta está ${ROTULO_STATUS_LISTA[l.status as StatusLista].toLowerCase()}).`);
    const existentes = new Map(l.items.filter((i) => i.productId).map((i) => [i.productId!, i]));
    const novos: ItemEntrada[] = [];
    for (const i of itens) {
      const ja = i.productId ? existentes.get(i.productId) : undefined;
      if (ja) {
        const quantity = Number(ja.quantity) + i.quantity;
        await tx.purchaseListItem.update({
          where: { id: ja.id },
          data: { quantity: D(quantity), total: D(Number((quantity * Number(ja.unitCost)).toFixed(2))) },
        });
      } else novos.push(i);
    }
    if (novos.length) {
      const montados = await montarItens(tx, companyId, novos, l.items.length);
      await tx.purchaseListItem.createMany({ data: montados.map((m) => ({ ...m, listId: id })) });
    }
    await recalcular(tx, id);
    return serializar(await carregar(tx, companyId, id));
  });
}

export async function alterarItem(
  companyId: string,
  id: string,
  itemId: string,
  dados: { quantity?: number; unitCost?: number; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const l = await carregar(tx, companyId, id);
    if (l.status !== 'ABERTA') throw conflict('Só é possível alterar itens de uma lista ABERTA.');
    const item = l.items.find((i) => i.id === itemId);
    if (!item) throw notFound('Item não encontrado nesta lista.');
    const quantity = dados.quantity ?? Number(item.quantity);
    const unitCost = dados.unitCost ?? Number(item.unitCost);
    if (!(quantity > 0)) throw badRequest('A quantidade deve ser maior que zero.');
    if (unitCost < 0) throw badRequest('O custo não pode ser negativo.');
    await tx.purchaseListItem.update({
      where: { id: itemId },
      data: {
        quantity: D(Number(quantity.toFixed(3))),
        unitCost: D(Number(unitCost.toFixed(4))),
        total: D(Number((quantity * unitCost).toFixed(2))),
        ...(dados.notes !== undefined ? { notes: dados.notes?.trim() || null } : {}),
      },
    });
    await recalcular(tx, id);
    return serializar(await carregar(tx, companyId, id));
  });
}

export async function removerItem(companyId: string, id: string, itemId: string) {
  return prisma.$transaction(async (tx) => {
    const l = await carregar(tx, companyId, id);
    if (l.status !== 'ABERTA') throw conflict('Só é possível remover itens de uma lista ABERTA.');
    if (!l.items.some((i) => i.id === itemId)) throw notFound('Item não encontrado nesta lista.');
    await tx.purchaseListItem.delete({ where: { id: itemId } });
    await recalcular(tx, id);
    return serializar(await carregar(tx, companyId, id));
  });
}

/**
 * Muda o status, gravando quem e quando. Ao marcar COMPRADA com
 * `darEntrada`, gera uma ENTRADA de estoque por item cadastrado, no depósito
 * escolhido, com o custo da lista e o número dela no motivo — assim o
 * histórico diz de onde veio a mercadoria e o item sai do alerta sozinho.
 */
export async function mudarStatus(
  companyId: string,
  id: string,
  user: { id: string; name: string },
  dados: { status: StatusLista; darEntrada?: boolean; warehouseId?: string | null; documento?: string | null },
) {
  const resultado = await prisma.$transaction(async (tx) => {
    const l = await carregar(tx, companyId, id);
    const de = l.status as StatusLista;
    if (de === dados.status) return { lista: l, entradas: 0 };
    if (!TRANSICOES[de].includes(dados.status)) {
      throw conflict(`Uma lista ${ROTULO_STATUS_LISTA[de].toLowerCase()} não pode passar para ${ROTULO_STATUS_LISTA[dados.status].toLowerCase()}.`);
    }
    if (dados.status !== 'CANCELADA' && !l.items.length) throw badRequest('A lista está vazia.');

    const agora = new Date();
    const data: Prisma.PurchaseListUpdateInput = { status: dados.status };
    if (dados.status === 'PEDIDA') { data.orderedAt = agora; data.orderedByName = user.name; }
    if (dados.status === 'ABERTA') { data.orderedAt = null; data.orderedByName = null; }
    if (dados.status === 'CANCELADA') { data.canceledAt = agora; data.canceledByName = user.name; }

    let entradas = 0;
    if (dados.status === 'COMPRADA') {
      data.boughtAt = agora; data.boughtByName = user.name;
      if (!l.orderedAt) { data.orderedAt = agora; data.orderedByName = user.name; }
      if (dados.darEntrada) {
        if (!dados.warehouseId) throw badRequest('Escolha o depósito que recebe a mercadoria.');
        const dep = await tx.warehouse.findFirst({ where: { id: dados.warehouseId, companyId, active: true } });
        if (!dep) throw badRequest('Depósito não encontrado.');
        data.stockedAt = agora;
        data.stockedWarehouseId = dep.id;
      }
    }
    await tx.purchaseList.update({ where: { id }, data });
    return { lista: await carregar(tx, companyId, id), entradas };
  });

  // As entradas rodam FORA da transação da lista: cada `entrada()` abre a
  // própria transação (trava de saldo, numeração, fila do Sheets). Se uma
  // falhar, as anteriores ficam e o erro aponta o item — o comprador corrige
  // e lança o resto pela tela de Entrada.
  let entradas = 0;
  const pulados: string[] = [];
  if (dados.status === 'COMPRADA' && dados.darEntrada && dados.warehouseId) {
    for (const item of resultado.lista.items) {
      if (!item.productId) { pulados.push(item.name); continue; }
      const produto = await prisma.product.findFirst({ where: { id: item.productId, companyId }, select: { packType: true, active: true } });
      if (!produto || !produto.active) { pulados.push(item.name); continue; }
      try {
        await entrada({
          companyId, userId: user.id, productId: item.productId, warehouseId: dados.warehouseId,
          quantity: Number(item.quantity), unitCost: Number(item.unitCost),
          reason: `Compra — lista #${String(resultado.lista.number).padStart(4, '0')} ${resultado.lista.name}`,
          document: dados.documento?.trim() || undefined,
        });
        entradas++;
      } catch (e) {
        throw conflict(`Entrada lançada para ${entradas} item(ns). Falhou em "${item.name}": ${(e as Error).message} Lance o restante pela tela de Entrada de Estoque.`);
      }
    }
  }
  return { ...serializar(resultado.lista), entradasLancadas: entradas, itensSemEntrada: pulados };
}

/** Nova lista ABERTA com os mesmos itens (custos atualizados pelo catálogo). */
export async function duplicar(companyId: string, id: string, user: { id: string; name: string }) {
  const origem = await obter(companyId, id);
  return criar(companyId, user, {
    name: `${origem.name} (cópia)`,
    supplierId: origem.supplierId,
    supplierName: origem.supplierName,
    notes: origem.notes,
    items: origem.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, quantity: i.quantity, notes: i.notes })),
  });
}

export async function excluir(companyId: string, id: string) {
  const l = await carregar(prisma, companyId, id);
  if (l.status !== 'ABERTA' && l.status !== 'CANCELADA') throw conflict('Só uma lista aberta ou cancelada pode ser excluída. Para as demais, o histórico fica.');
  await prisma.purchaseList.delete({ where: { id } });
  return { ok: true };
}
