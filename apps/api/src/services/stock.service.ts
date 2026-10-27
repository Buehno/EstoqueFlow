import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, D, nextNumber } from '../lib/prisma.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { enqueueStock, enqueueMovement } from './sync.service.js';
import { permiteFracao, saldosQuebrados } from './compras.service.js';
import { entrarMetros, sairMetros, normalizar, resumo as resumoEmbalagem, type EstadoEmbalagem } from './embalagem.js';

type Tx = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

export interface MoveInput {
  companyId: string;
  userId: string;
  productId: string;
  /** Quantidade em unidades do produto (para barra/rolo: PEÇAS inteiras). */
  quantity: number;
  /**
   * Barra × metro: quando informado, a movimentação é em METROS e `quantity`
   * é ignorada — o serviço consome/forma sobras e fecha peças inteiras.
   */
  meters?: number;
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
    INSERT INTO stock_items (id, product_id, warehouse_id, quantity, reserved, remnant, avg_cost, updated_at)
    VALUES (${randomUUID()}::uuid, ${productId}::uuid, ${warehouseId}::uuid, 0, 0, 0, 0, now())
    ON CONFLICT (product_id, warehouse_id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    { id: string; quantity: Prisma.Decimal; reserved: Prisma.Decimal; remnant: Prisma.Decimal; avg_cost: Prisma.Decimal }[]
  >`
    SELECT id, quantity, reserved, remnant, avg_cost FROM stock_items
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
    remnant: new Prisma.Decimal(r.remnant),
    avgCost: new Prisma.Decimal(r.avg_cost),
  };
}

/**
 * Item vendido por unidade não aceita quantidade quebrada — pedido de 24/09:
 * "tudo que for unidade deve ser redondo, o que for em metros deve ser em
 * metros". A trava vale para toda movimentação nova; os saldos quebrados que
 * já existiam são corrigidos por `arredondarSaldosQuebrados`.
 */
function assertQuantidadeInteira(unit: string | null | undefined, nome: string, quantidade: number) {
  if (permiteFracao(unit)) return;
  if (quantidade % 1 !== 0) {
    throw badRequest(
      `"${nome}" é vendido por ${(unit ?? 'UN').toUpperCase()}: a quantidade precisa ser um número inteiro ` +
        `(recebi ${quantidade}). Para lançar fração, cadastre o produto com unidade de medida (MT, KG, L…).`,
    );
  }
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

/** Comprimento da peça quando o produto é barra/rolo; null para os demais. */
function comprimentoDe(product: { packType: string | null; packLength: Prisma.Decimal | null }): number | null {
  const c = product.packLength == null ? 0 : Number(product.packLength);
  return product.packType && c > 0 ? c : null;
}

/**
 * Resolve o que a movimentação significa em PEÇAS e SOBRA para um produto
 * de barra/rolo. Em metros: aplica a regra de sobras (embalagem.ts). Em
 * peças: mexe só nas inteiras. Devolve o novo estado e a variação de peças
 * (pode ser zero quando a saída saiu toda da sobra).
 */
/** Metragem só faz sentido em produto de barra/rolo. */
function assertMetrosPermitidos(comprimento: number | null, meters: number | undefined, nome: string) {
  if (meters != null && !comprimento) {
    throw badRequest(`"${nome}" não é cadastrado como barra/rolo: informe a quantidade em unidades, não em metros.`);
  }
}

function aplicarEmbalagem(
  sentido: 'ENTRADA' | 'SAIDA',
  atual: { quantity: Prisma.Decimal; remnant: Prisma.Decimal },
  comprimento: number,
  input: { quantity: number; meters?: number },
  nome: string,
): { estado: EstadoEmbalagem; deltaPecas: Prisma.Decimal; metros: number | null } {
  const estado: EstadoEmbalagem = { pecas: Number(atual.quantity), sobraM: Number(atual.remnant) };
  if (input.meters != null) {
    if (input.meters <= 0) throw badRequest('A metragem deve ser maior que zero.');
    const novo = sentido === 'ENTRADA' ? entrarMetros(estado, input.meters, comprimento) : sairMetros(estado, input.meters, comprimento);
    if (!novo) {
      throw unprocessable(
        `Metragem insuficiente de "${nome}": ${resumoEmbalagem(estado, comprimento, 'BARRA').descricao}; solicitado ${input.meters} m.`,
      );
    }
    return { estado: novo, deltaPecas: D(novo.pecas - estado.pecas), metros: input.meters };
  }
  if (input.quantity % 1 !== 0) {
    throw badRequest(`"${nome}" é contado em peças (barra/rolo): informe peças inteiras ou a metragem em metros/centímetros.`);
  }
  const pecas = sentido === 'ENTRADA' ? estado.pecas + input.quantity : estado.pecas - input.quantity;
  if (pecas < 0) {
    throw unprocessable(`Saldo insuficiente de "${nome}": ${resumoEmbalagem(estado, comprimento, 'BARRA').descricao}.`);
  }
  return { estado: normalizar({ pecas, sobraM: estado.sobraM }, comprimento), deltaPecas: D(sentido === 'ENTRADA' ? input.quantity : -input.quantity), metros: null };
}

/**
 * ENTRADA — soma ao depósito e recalcula o custo médio ponderado.
 */
export async function entrada(input: MoveInput & { warehouseId: string }) {
  if (input.meters == null && input.quantity <= 0) throw badRequest('A quantidade da entrada deve ser maior que zero.');

  return prisma.$transaction(async (tx) => {
    const { product } = await assertScope(tx, input.companyId, input.productId, [
      input.warehouseId,
    ]);
    const comprimento = comprimentoDe(product);
    assertMetrosPermitidos(comprimento, input.meters, product.name);
    if (!comprimento) assertQuantidadeInteira(product.unit, product.name, input.quantity);
    else if (input.meters == null && input.quantity <= 0) throw badRequest('A quantidade da entrada deve ser maior que zero.');

    const stock = await getOrCreateStock(tx, input.productId, input.warehouseId);
    const emb = comprimento ? aplicarEmbalagem('ENTRADA', stock, comprimento, input, product.name) : null;
    const qty = emb ? emb.deltaPecas : D(input.quantity);
    const cost = D(input.unitCost ?? Number(product.costPrice));

    const newQty = stock.quantity.plus(qty);
    // custo médio ponderado: (saldo*custoAtual + entrada*custoNovo) / saldoFinal
    const newAvg = newQty.gt(0)
      ? stock.quantity.mul(stock.avgCost).plus(qty.mul(cost)).div(newQty)
      : cost;

    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: newQty, avgCost: newAvg, ...(emb ? { remnant: D(emb.estado.sobraM) } : {}) },
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
        ...(emb ? { meters: emb.metros, remnantTo: D(emb.estado.sobraM) } : {}),
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
  if (input.meters == null && input.quantity <= 0) throw badRequest('A quantidade da saída deve ser maior que zero.');

  return prisma.$transaction(async (tx) => {
    const { product } = await assertScope(tx, input.companyId, input.productId, [
      input.warehouseId,
    ]);
    const comprimento = comprimentoDe(product);
    assertMetrosPermitidos(comprimento, input.meters, product.name);
    if (!comprimento) assertQuantidadeInteira(product.unit, product.name, input.quantity);
    else if (input.meters == null && input.quantity <= 0) throw badRequest('A quantidade da saída deve ser maior que zero.');
    const stock = await getOrCreateStock(tx, input.productId, input.warehouseId);
    const emb = comprimento ? aplicarEmbalagem('SAIDA', stock, comprimento, input, product.name) : null;
    const qty = emb ? emb.deltaPecas.abs() : D(input.quantity);

    if (!emb && !input.allowNegative && stock.quantity.lt(qty)) {
      throw unprocessable(
        `Saldo insuficiente de "${product.name}": disponível ${stock.quantity.toFixed(3)}, solicitado ${qty.toFixed(3)}.`,
      );
    }

    const newQty = emb ? D(emb.estado.pecas) : stock.quantity.minus(qty);
    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: newQty, ...(emb ? { remnant: D(emb.estado.sobraM) } : {}) },
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
        ...(emb ? { meters: emb.metros, remnantFrom: D(emb.estado.sobraM) } : {}),
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
  if (input.meters == null && input.quantity <= 0) throw badRequest('A quantidade da transferência deve ser maior que zero.');
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw badRequest('Depósito de origem e destino não podem ser o mesmo.');
  }

  return prisma.$transaction(async (tx) => {
    const { product } = await assertScope(tx, input.companyId, input.productId, [
      input.fromWarehouseId,
      input.toWarehouseId,
    ]);
    const comprimento = comprimentoDe(product);
    assertMetrosPermitidos(comprimento, input.meters, product.name);
    if (!comprimento) assertQuantidadeInteira(product.unit, product.name, input.quantity);
    else if (input.meters == null && input.quantity <= 0) throw badRequest('A quantidade da transferência deve ser maior que zero.');

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
    // Barra × metro: sai da origem e entra no destino pela mesma regra de
    // sobras — em metros, a metragem é a mesma dos dois lados; em peças, as
    // inteiras.
    const embFrom = comprimento ? aplicarEmbalagem('SAIDA', from, comprimento, input, product.name) : null;
    const embTo = comprimento ? aplicarEmbalagem('ENTRADA', to, comprimento, input, product.name) : null;
    const qty = embFrom ? embFrom.deltaPecas.abs() : D(input.quantity);

    if (!embFrom && from.quantity.lt(qty)) {
      throw unprocessable(
        `Saldo insuficiente na origem para "${product.name}": disponível ${from.quantity.toFixed(3)}.`,
      );
    }

    const newFrom = embFrom ? D(embFrom.estado.pecas) : from.quantity.minus(qty);
    const newTo = embTo ? D(embTo.estado.pecas) : to.quantity.plus(qty);
    const entrouPecas = embTo ? embTo.deltaPecas : qty;
    const newToAvg = newTo.gt(0)
      ? to.quantity.mul(to.avgCost).plus(entrouPecas.mul(from.avgCost)).div(newTo)
      : from.avgCost;

    const uFrom = await tx.stockItem.update({
      where: { id: from.id },
      data: { quantity: newFrom, ...(embFrom ? { remnant: D(embFrom.estado.sobraM) } : {}) },
    });
    const uTo = await tx.stockItem.update({
      where: { id: to.id },
      data: { quantity: newTo, avgCost: newToAvg, ...(embTo ? { remnant: D(embTo.estado.sobraM) } : {}) },
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
        ...(embFrom && embTo ? { meters: embFrom.metros, remnantFrom: D(embFrom.estado.sobraM), remnantTo: D(embTo.estado.sobraM) } : {}),
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
  input: Omit<MoveInput, 'quantity' | 'meters'> & {
    warehouseId: string;
    /** Peças inteiras contadas (para barra/rolo) ou a quantidade (demais). */
    newQuantity: number;
    /** Barra × metro: sobra em metros contada fisicamente (opcional; omitido = mantém). */
    newRemnantMeters?: number;
    countId?: string;
  },
) {
  if (input.newQuantity < 0) throw badRequest('O saldo ajustado não pode ser negativo.');

  return prisma.$transaction(async (tx) => {
    const { product } = await assertScope(tx, input.companyId, input.productId, [input.warehouseId]);
    const comprimento = comprimentoDe(product);
    if (!comprimento) assertQuantidadeInteira(product.unit, product.name, input.newQuantity);
    else if (input.newQuantity % 1 !== 0) throw badRequest(`"${product.name}" é contado em peças inteiras; a sobra vai em metros.`);
    const stock = await getOrCreateStock(tx, input.productId, input.warehouseId);

    let target = D(input.newQuantity);
    let sobra: Prisma.Decimal | null = null;
    if (comprimento) {
      const desejada = input.newRemnantMeters ?? Number(stock.remnant);
      if (desejada < 0) throw badRequest('A sobra em metros não pode ser negativa.');
      const n = normalizar({ pecas: input.newQuantity, sobraM: desejada }, comprimento);
      target = D(n.pecas);
      sobra = D(n.sobraM);
    }
    const diff = target.minus(stock.quantity);
    const sobraMudou = sobra != null && !sobra.eq(stock.remnant);
    if (diff.isZero() && !sobraMudou) return null;

    const updated = await tx.stockItem.update({
      where: { id: stock.id },
      data: { quantity: target, ...(sobra != null ? { remnant: sobra } : {}) },
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
        ...(sobra != null ? (diff.isNegative() ? { remnantFrom: sobra } : { remnantTo: sobra }) : {}),
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

    const produto = await tx.product.findUnique({ where: { id: mov.productId } });
    const comprimento = produto ? comprimentoDe(produto) : null;
    const metros = mov.meters == null ? null : Number(mov.meters);

    if (mov.toWarehouseId) {
      const s = await getOrCreateStock(tx, mov.productId, mov.toWarehouseId);
      const emb = comprimento && metros ? aplicarEmbalagem('SAIDA', s, comprimento, { quantity: 0, meters: metros }, produto!.name) : null;
      const u = await tx.stockItem.update({
        where: { id: s.id },
        data: emb ? { quantity: D(emb.estado.pecas), remnant: D(emb.estado.sobraM) } : { quantity: s.quantity.minus(mov.quantity) },
      });
      await enqueueStock(tx, companyId, u.id);
    }
    if (mov.fromWarehouseId) {
      const s = await getOrCreateStock(tx, mov.productId, mov.fromWarehouseId);
      const emb = comprimento && metros ? aplicarEmbalagem('ENTRADA', s, comprimento, { quantity: 0, meters: metros }, produto!.name) : null;
      const u = await tx.stockItem.update({
        where: { id: s.id },
        data: emb ? { quantity: D(emb.estado.pecas), remnant: D(emb.estado.sobraM) } : { quantity: s.quantity.plus(mov.quantity) },
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
        meters: mov.meters,
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

/**
 * ARREDONDAMENTO DOS SALDOS QUEBRADOS — pedido de 24/09.
 *
 * A contagem trouxe saldos como "cotovelo de cobre 33,845" em item vendido
 * por unidade. Em vez de um UPDATE mudo no banco, cada correção entra como
 * AJUSTE: o movimento guarda o saldo anterior, o novo e quem mandou corrigir.
 * Produto vendido por medida (MT, M, KG, L…) não é tocado — ali a fração é
 * legítima.
 *
 * `dryRun` (padrão) só devolve a lista do que mudaria, para conferência.
 */
export async function arredondarSaldosQuebrados(
  companyId: string,
  userId: string,
  opcoes: { dryRun?: boolean; motivo?: string } = {},
) {
  const dryRun = opcoes.dryRun !== false;
  const pendentes = await saldosQuebrados(companyId);

  if (dryRun) return { dryRun: true, total: pendentes.length, itens: pendentes, aplicados: 0 };

  let aplicados = 0;
  for (const item of pendentes) {
    await ajuste({
      companyId,
      userId,
      productId: item.productId,
      warehouseId: item.warehouseId,
      newQuantity: item.arredondado,
      reason: opcoes.motivo ?? 'Arredondamento de saldo — item vendido por unidade',
      notes: `Saldo anterior ${item.atual} → ${item.arredondado} (${item.diferenca > 0 ? '+' : ''}${item.diferenca})`,
    });
    aplicados += 1;
  }
  return { dryRun: false, total: pendentes.length, itens: pendentes, aplicados };
}

/**
 * ROTINA AUTOMÁTICA DE ARREDONDAMENTO — pedido reforçado em 30/09:
 * "eu falei que devia ser automático".
 *
 * A regra é do negócio, não uma tarefa da equipe: peça vendida por unidade
 * não tem meia peça. Então o sistema varre sozinho todas as empresas, no
 * boot e de hora em hora, e arredonda o que estiver quebrado — sem ninguém
 * precisar clicar em nada.
 *
 * Continua tudo rastreável: cada correção vira um AJUSTE no histórico, com
 * saldo anterior, saldo novo e o motivo. O autor é o dono da conta (OWNER),
 * porque todo movimento precisa de um responsável.
 *
 * Como toda movimentação nova já recusa fração em item de unidade
 * (`assertQuantidadeInteira`), na prática esta varredura só tem trabalho na
 * primeira rodada e depois fica ociosa.
 */
export async function arredondarTodasAsEmpresas(log?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void }) {
  const empresas = await prisma.company.findMany({ where: { active: true }, select: { id: true, name: true } });
  let totalCorrigido = 0;

  for (const empresa of empresas) {
    try {
      const pendentes = await saldosQuebrados(empresa.id);
      if (!pendentes.length) continue;

      const responsavel =
        (await prisma.user.findFirst({ where: { companyId: empresa.id, role: 'OWNER', active: true } })) ??
        (await prisma.user.findFirst({ where: { companyId: empresa.id, active: true } }));
      if (!responsavel) {
        log?.warn({ empresa: empresa.name }, 'Saldos quebrados encontrados, mas a empresa não tem usuário ativo para assinar o ajuste.');
        continue;
      }

      const r = await arredondarSaldosQuebrados(empresa.id, responsavel.id, {
        dryRun: false,
        motivo: 'Arredondamento automático — item vendido por unidade',
      });
      totalCorrigido += r.aplicados;
      log?.info(
        { empresa: empresa.name, corrigidos: r.aplicados, itens: r.itens.map((i) => `${i.name} ${i.atual}→${i.arredondado}`) },
        'Saldos quebrados arredondados automaticamente.',
      );
    } catch (e) {
      log?.warn({ empresa: empresa.name, err: String(e) }, 'Falha ao arredondar saldos desta empresa (as outras seguem).');
    }
  }
  return totalCorrigido;
}

/**
 * DESATIVAR CADASTRO DUPLICADO — pedido de 24/09 (PDF "peças para ser
 * excluída - duplicidade").
 *
 * O produto nunca é apagado: o histórico dele (movimentos, vendas, propostas)
 * precisa continuar existindo. Ele sai da busca e dos relatórios por
 * `active = false`. Se ainda tiver saldo, o saldo é zerado por um AJUSTE
 * explicando o motivo — assim o total do estoque não fica contando uma peça
 * que já está contada no cadastro que ficou.
 */
export async function desativarProdutoDuplicado(
  companyId: string,
  productId: string,
  userId: string,
  motivo?: string,
) {
  const produto = await prisma.product.findFirst({
    where: { id: productId, companyId },
    include: { stockItems: true },
  });
  if (!produto) throw notFound('Produto não encontrado.');

  const razao = motivo ?? 'Cadastro duplicado — saldo conferido no cadastro que permanece';
  const zerados: { warehouseId: string; de: number }[] = [];

  for (const saldo of produto.stockItems) {
    const atual = Number(saldo.quantity);
    if (atual === 0) continue;
    await ajuste({
      companyId,
      userId,
      productId,
      warehouseId: saldo.warehouseId,
      newQuantity: 0,
      reason: razao,
      notes: `Saldo ${atual} zerado ao desativar o cadastro duplicado "${produto.name}"`,
    });
    zerados.push({ warehouseId: saldo.warehouseId, de: atual });
  }

  const desativado = await prisma.product.update({
    where: { id: productId },
    data: { active: false },
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId,
      entity: 'Product',
      entityId: productId,
      action: 'UPDATE',
      before: { active: true, saldos: zerados },
      after: { active: false, motivo: razao },
    },
  });

  return { id: desativado.id, name: desativado.name, saldosZerados: zerados };
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
    // Barra × metro: peças inteiras + sobra, sempre em m e cm.
    embalagem: comprimentoDe(r.product)
      ? resumoEmbalagem({ pecas: Number(r.quantity), sobraM: Number(r.remnant) }, comprimentoDe(r.product)!, r.product.packType!)
      : null,
    minStock: Number(r.product.minStock),
    avgCost: Number(r.avgCost),
    salePrice: Number(r.product.salePrice),
    stockValue: Number(r.quantity) * Number(r.avgCost),
    belowMin: Number(r.quantity) < Number(r.product.minStock),
  }));

  return params.onlyBelowMin ? mapped.filter((m) => m.belowMin) : mapped;
}
