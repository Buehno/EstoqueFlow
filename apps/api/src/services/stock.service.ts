import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, D, nextNumber } from '../lib/prisma.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { enqueueStock, enqueueMovement } from './sync.service.js';

type Tx = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

export interface MoveInput {
  companyId: string;
  userId: string;
  productId: string;
  quantity: number;
  unitCost?: number;
  reason?: string;
  document?: string;
  notes?: string;
  allowNegative?: boolean;
}

/**
 * Busca (ou cria zerado) o saldo de um produto num depósito, TRAVANDO a
 * linha (SELECT ... FOR UPDATE) dentro da transação.
 *
 * Achado no teste de força de 18/09: com um simples `findUnique` seguido de
 * `update`, duas movimentações concorrentes no mesmo produto/depósito liam
 * o mesmo saldo antes de qualquer uma escrever — a segunda a confirmar
 * sobrescrevia o resultado da primeira em silêncio (100 saídas de 1 unidade
 * em paralelo tiraram só 20 do saldo, não 100). O `FOR UPDATE` faz a segunda
 * transação esperar a primeira terminar antes de ler, em vez de correr em
 * paralelo sobre o mesmo número — sem isso, contagem de estoque diverge
 * silenciosamente sempre que duas pessoas mexem no mesmo item ao mesmo
 * tempo (bem comum: PDV + estoquista, ou duas movimentações seguidas).
 */
async function getOrCreateStock(tx: Tx, productId: string, warehouseId: string) {
  // Cria a linha primeiro (fora do lock — não dá pra travar o que não
  // existe). `ON CONFLICT DO NOTHING` deixa concorrência na criação segura.
  await tx.$executeRaw`
    INSERT INTO stock_items (id, product_id, warehouse_id, quantity, reserved, avg_cost, updated_at)
    VALUES (${randomUUID()}::uuid, ${productId}::uuid, ${warehouseId}::uuid, 0, 0, 0, now())
    ON CONFLICT (product_id, warehouse_id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    { id: string; quantity: Prisma.Decimal; reserved: Prisma.Decimal; avg_cost: Prisma.Decimal }[]
  >`
    SELECT id, quantity, reserved, avg_cost FROM stock_items
    WHERE product_id = ${productId}::uuid AND warehouse_id = ${warehouseId}::uuid
    FOR UPDATE
  `;
  const r = rows[0];
  return {
    id: r.id,
    productId,
    warehouseId,
    quantity: new Prisma.Decimal(r.quantity),
    reserved: new Prisma.Decimal(r.reserved),
    avgCost: new Prisma.Decimal(r.avg_cost),
  };
}

/** Garante que produto e depósito pertencem à empresa do usuário. */
async function assertScope(tx: Tx, companyId: string, productId: string, warehouseIds: string[]) {
  const product = await tx.product.findFirst({ where: { id: productId, companyId } });
  if (!product) throw notFound('Produto não encontrado nesta empresa.');
  if (!product.active) throw unprocessable(`Produto "${product.name}" está inativo.`);

  const ws = await tx.warehouse.findMany({
    where: { id: { in: warehouseIds }, companyId, active: true },
  });
  if (ws.length !== new Set(warehouseIds).size) {
    throw notFound('Depósito não encontrado ou inativo nesta empresa.');
  }
  return { product, warehouses: ws };
}

/**
 * ENTRADA — soma ao depósito e recalcula o custo médio ponderado.
 */
export async function entrada(input: MoveInput & { warehouseId: string }) {
  if (input.quantity <= 0) throw badRequest('A quantidade da entrada deve ser maior que zero.');

  return prisma.$transaction(async (tx) => {
    const { product } = await assertScope(tx, input.companyId, input.productId, [
      input.warehouseId,
    ]);

    const stock = await getOrCreateStock(tx, input.productId, input.warehouseId);
    const qty = D(input.quantity);
    const cost = D(input.unitCost ?? Number(product.costPrice));

    const newQty = stock.quantity.plus(qty);
    // custo médio ponderado: (saldo*custoAtual + entrada*custoNovo) / saldoFinal
    const newAvg = newQty.gt(0)
      ? stock.quantity.mul(stock.avgCost).plus(qty.mul(cost)).div(newQty)
      : cost;

    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: newQty, avgCost: newAvg },
    });

    const number = await nextNumber(tx, input.companyId, 'movement');
    const mov = await tx.movement.create({
      data: {
        companyId: input.companyId,
        number,
        type: 'ENTRADA',
        productId: input.productId,
        quantity: qty,
        unitCost: cost,
        toWarehouseId: input.warehouseId,
        balanceTo: newQty,
        reason: input.reason ?? 'Entrada de mercadoria',
        document: input.document,
        notes: input.notes,
        userId: input.userId,
      },
      include: { product: true, toWarehouse: true, user: true },
    });

    await enqueueStock(tx, input.companyId, updated.id);
    await enqueueMovement(tx, input.companyId, mov.id);
    return mov;
  });
}

/**
 * SAÍDA — baixa do depósito. Bloqueia saldo negativo (salvo allowNegative).
 */
export async function saida(input: MoveInput & { warehouseId: string }) {
  if (input.quantity <= 0) throw badRequest('A quantidade da saída deve ser maior que zero.');

  return prisma.$transaction(async (tx) => {
    const { product } = await assertScope(tx, input.companyId, input.productId, [
      input.warehouseId,
    ]);
    const stock = await getOrCreateStock(tx, input.productId, input.warehouseId);
    const qty = D(input.quantity);

    if (!input.allowNegative && stock.quantity.lt(qty)) {
      throw unprocessable(
        `Saldo insuficiente de "${product.name}": disponível ${stock.quantity.toFixed(3)}, solicitado ${qty.toFixed(3)}.`,
      );
    }

    const newQty = stock.quantity.minus(qty);
    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: newQty },
    });

    const number = await nextNumber(tx, input.companyId, 'movement');
    const mov = await tx.movement.create({
      data: {
        companyId: input.companyId,
        number,
        type: 'SAIDA',
        productId: input.productId,
        quantity: qty,
        unitCost: stock.avgCost,
        fromWarehouseId: input.warehouseId,
        balanceFrom: newQty,
        reason: input.reason ?? 'Saída de mercadoria',
        document: input.document,
        notes: input.notes,
        userId: input.userId,
      },
      include: { product: true, fromWarehouse: true, user: true },
    });

    await enqueueStock(tx, input.companyId, updated.id);
    await enqueueMovement(tx, input.companyId, mov.id);
    return mov;
  });
}

/**
 * TRANSFERÊNCIA — move saldo entre os depósitos, atômico.
 * Leva junto o custo médio da origem para não distorcer o CMV do destino.
 */
export async function transferencia(
  input: MoveInput & { fromWarehouseId: string; toWarehouseId: string },
) {
  if (input.quantity <= 0) throw badRequest('A quantidade da transferência deve ser maior que zero.');
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw badRequest('Depósito de origem e destino não podem ser o mesmo.');
  }

  return prisma.$transaction(async (tx) => {
    const { product } = await assertScope(tx, input.companyId, input.productId, [
      input.fromWarehouseId,
      input.toWarehouseId,
    ]);

    // Trava os dois depósitos numa ORDEM FIXA (pelo id, não por origem/
    // destino) — senão uma transferência A->B e outra B->A do mesmo produto,
    // acontecendo ao mesmo tempo, travariam em ordem invertida uma da outra
    // e o Postgres teria que abortar uma delas por deadlock.
    const primeiroId =
      input.fromWarehouseId < input.toWarehouseId ? input.fromWarehouseId : input.toWarehouseId;
    const segundoId =
      input.fromWarehouseId < input.toWarehouseId ? input.toWarehouseId : input.fromWarehouseId;
    const travados = new Map<string, Awaited<ReturnType<typeof getOrCreateStock>>>();
    travados.set(primeiroId, await getOrCreateStock(tx, input.productId, primeiroId));
    travados.set(segundoId, await getOrCreateStock(tx, input.productId, segundoId));
    const from = travados.get(input.fromWarehouseId)!;
    const to = travados.get(input.toWarehouseId)!;
    const qty = D(input.quantity);

    if (from.quantity.lt(qty)) {
      throw unprocessable(
        `Saldo insuficiente na origem para "${product.name}": disponível ${from.quantity.toFixed(3)}.`,
      );
    }

    const newFrom = from.quantity.minus(qty);
    const newTo = to.quantity.plus(qty);
    const newToAvg = newTo.gt(0)
      ? to.quantity.mul(to.avgCost).plus(qty.mul(from.avgCost)).div(newTo)
      : from.avgCost;

    const uFrom = await tx.stockItem.update({
      where: { id: from.id },
      data: { quantity: newFrom },
    });
    const uTo = await tx.stockItem.update({
      where: { id: to.id },
      data: { quantity: newTo, avgCost: newToAvg },
    });

    const number = await nextNumber(tx, input.companyId, 'movement');
    const mov = await tx.movement.create({
      data: {
        companyId: input.companyId,
        number,
        type: 'TRANSFERENCIA',
        productId: input.productId,
        quantity: qty,
        unitCost: from.avgCost,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        balanceFrom: newFrom,
        balanceTo: newTo,
        reason: input.reason ?? 'Transferência entre depósitos',
        document: input.document,
        notes: input.notes,
        userId: input.userId,
      },
      include: { product: true, fromWarehouse: true, toWarehouse: true, user: true },
    });

    await enqueueStock(tx, input.companyId, uFrom.id);
    await enqueueStock(tx, input.companyId, uTo.id);
    await enqueueMovement(tx, input.companyId, mov.id);
    return mov;
  });
}

/**
 * AJUSTE — define o saldo real de um produto no depósito (contagem/acerto).
 */
export async function ajuste(
  input: Omit<MoveInput, 'quantity'> & { warehouseId: string; newQuantity: number; countId?: string },
) {
  if (input.newQuantity < 0) throw badRequest('O saldo ajustado não pode ser negativo.');

  return prisma.$transaction(async (tx) => {
    await assertScope(tx, input.companyId, input.productId, [input.warehouseId]);
    const stock = await getOrCreateStock(tx, input.productId, input.warehouseId);

    const target = D(input.newQuantity);
    const diff = target.minus(stock.quantity);
    if (diff.isZero()) return null;

    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: target },
    });

    const number = await nextNumber(tx, input.companyId, 'movement');
    const mov = await tx.movement.create({
      data: {
        companyId: input.companyId,
        number,
        type: 'AJUSTE',
        productId: input.productId,
        quantity: diff.abs(),
        unitCost: stock.avgCost,
        fromWarehouseId: diff.isNegative() ? input.warehouseId : null,
        toWarehouseId: diff.isNegative() ? null : input.warehouseId,
        balanceFrom: diff.isNegative() ? target : null,
        balanceTo: diff.isNegative() ? null : target,
        reason: input.reason ?? 'Ajuste de inventário',
        document: input.document,
        notes: input.notes,
        countId: input.countId,
        userId: input.userId,
      },
      include: { product: true, user: true },
    });

    await enqueueStock(tx, input.companyId, updated.id);
    await enqueueMovement(tx, input.companyId, mov.id);
    return mov;
  });
}

/**
 * ESTORNO — desfaz um movimento confirmado, gerando o lançamento inverso.
 */
export async function estornar(companyId: string, movementId: string, userId: string, motivo?: string) {
  return prisma.$transaction(async (tx) => {
    const mov = await tx.movement.findFirst({ where: { id: movementId, companyId } });
    if (!mov) throw notFound('Movimento não encontrado.');
    if (mov.status === 'ESTORNADO') throw unprocessable('Este movimento já foi estornado.');
    if (mov.type === 'VENDA') {
      throw unprocessable('Baixas de venda são estornadas pelo cancelamento da venda no PDV.');
    }

    // desfaz saldos — trava na mesma ordem fixa (por id) que `transferencia`
    // usa, pra nunca deadlockar contra uma transferência/estorno concorrente
    // do mesmo produto entre os mesmos dois depósitos.
    const idsParaTravar = [mov.toWarehouseId, mov.fromWarehouseId]
      .filter((id): id is string => !!id)
      .sort();
    for (const id of idsParaTravar) {
      await getOrCreateStock(tx, mov.productId, id);
    }

    if (mov.toWarehouseId) {
      const s = await getOrCreateStock(tx, mov.productId, mov.toWarehouseId);
      const u = await tx.stockItem.update({
        where: { id: s.id },
        data: { quantity: s.quantity.minus(mov.quantity) },
      });
      await enqueueStock(tx, companyId, u.id);
    }
    if (mov.fromWarehouseId) {
      const s = await getOrCreateStock(tx, mov.productId, mov.fromWarehouseId);
      const u = await tx.stockItem.update({
        where: { id: s.id },
        data: { quantity: s.quantity.plus(mov.quantity) },
      });
      await enqueueStock(tx, companyId, u.id);
    }

    await tx.movement.update({ where: { id: mov.id }, data: { status: 'ESTORNADO' } });

    const number = await nextNumber(tx, companyId, 'movement');
    const rev = await tx.movement.create({
      data: {
        companyId,
        number,
        type: 'ESTORNO',
        productId: mov.productId,
        quantity: mov.quantity,
        unitCost: mov.unitCost,
        fromWarehouseId: mov.toWarehouseId,
        toWarehouseId: mov.fromWarehouseId,
        reason: motivo ?? `Estorno do movimento #${mov.number}`,
        reversalOf: mov.id,
        userId,
      },
      include: { product: true, user: true },
    });
    await enqueueMovement(tx, companyId, rev.id);
    return rev;
  });
}

/**
 * CORREÇÃO DE MOVIMENTO — edita só os campos "de anotação" (motivo, documento,
 * observações) de um lançamento já confirmado.
 *
 * Pedido de 20/09: "mesmo gerando o registro, deve poder atualizar depois".
 * A trava deliberada aqui é que quantidade, tipo e depósito NUNCA são
 * editáveis retroativamente — o próprio schema chama `balanceFrom`/
 * `balanceTo` de "trilha de auditoria imutável" (ver `schema.prisma`), e
 * mudar a quantidade de um lançamento antigo deixaria o saldo congelado nos
 * lançamentos seguintes do mesmo produto/depósito mentindo silenciosamente
 * sobre o que realmente aconteceu naquele momento — exatamente o tipo de
 * inconsistência que o teste de força de 18/09 caçou. Para corrigir uma
 * quantidade errada, o caminho correto continua sendo estornar o lançamento
 * (endpoint /movements/:id/estorno, que já existe) e lançar um novo — isso
 * preserva o histórico real (o que foi digitado, quando, por quem) em vez de
 * reescrevê-lo.
 */
export async function editarMovimento(
  companyId: string,
  movementId: string,
  userId: string,
  patch: { reason?: string | null; document?: string | null; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const mov = await tx.movement.findFirst({ where: { id: movementId, companyId } });
    if (!mov) throw notFound('Movimento não encontrado.');

    const before = { reason: mov.reason, document: mov.document, notes: mov.notes };
    const atualizado = await tx.movement.update({
      where: { id: mov.id },
      data: {
        reason: patch.reason !== undefined ? patch.reason : undefined,
        document: patch.document !== undefined ? patch.document : undefined,
        notes: patch.notes !== undefined ? patch.notes : undefined,
      },
      include: { product: true, fromWarehouse: true, toWarehouse: true, user: true },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        entity: 'Movement',
        entityId: mov.id,
        action: 'UPDATE',
        before,
        after: { reason: atualizado.reason, document: atualizado.document, notes: atualizado.notes },
      },
    });

    return atualizado;
  });
}

/** Posição consolidada de estoque com filtros. */
export async function posicao(params: {
  companyId: string;
  warehouseId?: string;
  search?: string;
  onlyBelowMin?: boolean;
  categoryId?: string;
  take?: number;
  skip?: number;
}) {
  const where: Prisma.StockItemWhereInput = {
    product: {
      companyId: params.companyId,
      active: true,
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: 'insensitive' } },
              { sku: { contains: params.search, mode: 'insensitive' } },
              { barcode: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
  };

  const rows = await prisma.stockItem.findMany({
    where,
    include: { product: { include: { category: true } }, warehouse: true },
    orderBy: [{ product: { name: 'asc' } }],
    take: params.take ?? 500,
    skip: params.skip ?? 0,
  });

  const mapped = rows.map((r) => ({
    productId: r.productId,
    sku: r.product.sku,
    barcode: r.product.barcode,
    name: r.product.name,
    unit: r.product.unit,
    category: r.product.category?.name ?? null,
    warehouseId: r.warehouseId,
    warehouse: r.warehouse.name,
    warehouseCode: r.warehouse.code,
    quantity: Number(r.quantity),
    reserved: Number(r.reserved),
    available: Number(r.quantity) - Number(r.reserved),
    minStock: Number(r.product.minStock),
    avgCost: Number(r.avgCost),
    salePrice: Number(r.product.salePrice),
    stockValue: Number(r.quantity) * Number(r.avgCost),
    belowMin: Number(r.quantity) < Number(r.product.minStock),
  }));

  return params.onlyBelowMin ? mapped.filter((m) => m.belowMin) : mapped;
}
