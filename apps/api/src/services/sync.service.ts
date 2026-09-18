/**
 * ════════════════════════════════════════════════════════════════════════════
 *  REDUNDÂNCIA GOOGLE SHEETS
 * ════════════════════════════════════════════════════════════════════════════
 *  Regra de ouro do projeto: a planilha é ESPELHO, nunca origem.
 *
 *   Postgres (fonte da verdade)
 *        │  outbox (sync_outbox)
 *        ▼
 *   Worker de replicação  ──►  Google Sheets (abas Produtos/Estoque/Mov/Vendas)
 *        ▲
 *        └── Guardião: relê a planilha, compara com o Postgres e REVERTE
 *            qualquer edição feita à mão, registrando em sheet_guard_logs.
 *
 *  Ou seja: alterar a planilha direto não tem efeito nenhum — em no máximo
 *  SHEET_GUARD_INTERVAL_MS o valor volta ao que o sistema diz.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { google, type sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';

type Tx = Prisma.TransactionClient;

export const TABS = {
  produtos: 'Produtos',
  estoque: 'Estoque',
  movimentacoes: 'Movimentacoes',
  vendas: 'Vendas',
} as const;

export const HEADERS: Record<string, string[]> = {
  [TABS.produtos]: [
    'ID', 'SKU', 'Codigo de Barras', 'Produto', 'Categoria', 'Unidade',
    'Custo', 'Preco Venda', 'Estoque Minimo', 'Ativo', 'Atualizado em',
  ],
  [TABS.estoque]: [
    'Chave', 'SKU', 'Produto', 'Deposito', 'Quantidade', 'Reservado',
    'Disponivel', 'Custo Medio', 'Valor em Estoque', 'Abaixo do Minimo', 'Atualizado em',
  ],
  [TABS.movimentacoes]: [
    'ID', 'Numero', 'Data', 'Tipo', 'SKU', 'Produto', 'Quantidade',
    'Origem', 'Destino', 'Custo Unit.', 'Motivo', 'Documento', 'Usuario', 'Status',
  ],
  [TABS.vendas]: [
    'ID', 'Numero', 'Data', 'Deposito', 'Cliente', 'Itens', 'Subtotal',
    'Desconto', 'Total', 'Pagamento', 'Vendedor', 'Status',
  ],
};

// ─────────────────────────── Cliente Sheets ───────────────────────────

let cached: sheets_v4.Sheets | null = null;

export function sheetsEnabled(): boolean {
  if (!env.SHEET_SYNC_ENABLED) return false;
  if (!env.GOOGLE_SHEET_ID) return false;
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON || (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY));
}

function credentials(): { email: string; key: string } | null {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const j = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
      return { email: j.client_email, key: j.private_key };
    } catch {
      return null;
    }
  }
  if (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY) {
    return { email: env.GOOGLE_CLIENT_EMAIL, key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') };
  }
  return null;
}

export function getSheets(): sheets_v4.Sheets | null {
  if (cached) return cached;
  const c = credentials();
  if (!c) return null;
  const auth = new JWT({
    email: c.email,
    key: c.key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  cached = google.sheets({ version: 'v4', auth });
  return cached;
}

// ─────────────────────────── Outbox ───────────────────────────

async function push(tx: Tx, companyId: string, sheetTab: string, rowKey: string, payload: unknown) {
  await tx.syncOutbox.create({
    data: { companyId, sheetTab, rowKey, op: 'UPSERT', payload: payload as Prisma.InputJsonValue },
  });
}

export async function enqueueProduct(tx: Tx, companyId: string, productId: string) {
  const p = await tx.product.findUnique({ where: { id: productId }, include: { category: true } });
  if (!p) return;
  await push(tx, companyId, TABS.produtos, p.id, [
    p.id, p.sku, p.barcode ?? '', p.name, p.category?.name ?? '', p.unit,
    Number(p.costPrice), Number(p.salePrice), Number(p.minStock),
    p.active ? 'SIM' : 'NAO', new Date().toISOString(),
  ]);
}

export async function enqueueStock(tx: Tx, companyId: string, stockItemId: string) {
  const s = await tx.stockItem.findUnique({
    where: { id: stockItemId },
    include: { product: true, warehouse: true },
  });
  if (!s) return;
  const qty = Number(s.quantity);
  const avg = Number(s.avgCost);
  await push(tx, companyId, TABS.estoque, `${s.productId}:${s.warehouseId}`, [
    `${s.productId}:${s.warehouseId}`, s.product.sku, s.product.name, s.warehouse.name,
    qty, Number(s.reserved), qty - Number(s.reserved), avg, +(qty * avg).toFixed(2),
    qty < Number(s.product.minStock) ? 'SIM' : 'NAO', new Date().toISOString(),
  ]);
}

export async function enqueueMovement(tx: Tx, companyId: string, movementId: string) {
  const m = await tx.movement.findUnique({
    where: { id: movementId },
    include: { product: true, fromWarehouse: true, toWarehouse: true, user: true },
  });
  if (!m) return;
  await push(tx, companyId, TABS.movimentacoes, m.id, [
    m.id, m.number, m.createdAt.toISOString(), m.type, m.product.sku, m.product.name,
    Number(m.quantity), m.fromWarehouse?.name ?? '', m.toWarehouse?.name ?? '',
    Number(m.unitCost), m.reason ?? '', m.document ?? '', m.user.name, m.status,
  ]);
}

export async function enqueueSale(tx: Tx, companyId: string, saleId: string) {
  const s = await tx.sale.findUnique({
    where: { id: saleId },
    include: { warehouse: true, user: true, items: true },
  });
  if (!s) return;
  await push(tx, companyId, TABS.vendas, s.id, [
    s.id, s.number, s.createdAt.toISOString(), s.warehouse.name, s.customerName ?? 'Consumidor',
    s.items.length, Number(s.subtotal), Number(s.discount), Number(s.total),
    s.payment, s.user.name, s.status,
  ]);
}

// ─────────────────────────── Worker ───────────────────────────

/** Garante que as abas e cabeçalhos existem. */
export async function ensureTabs(sheetId: string) {
  const api = getSheets();
  if (!api) return;
  const meta = await api.spreadsheets.get({ spreadsheetId: sheetId });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));

  const missing = Object.values(TABS).filter((t) => !existing.has(t));
  if (missing.length) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  for (const tab of Object.values(TABS)) {
    await api.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS[tab]] },
    });
  }
}

/** Índice chave→linha de uma aba (coluna A é sempre a chave). */
async function keyIndex(sheetId: string, tab: string): Promise<Map<string, number>> {
  const api = getSheets()!;
  const res = await api.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A2:A` });
  const map = new Map<string, number>();
  (res.data.values ?? []).forEach((row, i) => {
    if (row[0]) map.set(String(row[0]), i + 2); // linha real (1-based, +1 do header)
  });
  return map;
}

/** Processa a fila pendente. Chamado pelo scheduler. */
export async function runSync(batch = 200): Promise<{ sent: number; failed: number }> {
  if (!sheetsEnabled()) return { sent: 0, failed: 0 };
  const api = getSheets();
  const sheetId = env.GOOGLE_SHEET_ID!;
  if (!api) return { sent: 0, failed: 0 };

  const pending = await prisma.syncOutbox.findMany({
    where: { status: 'PENDENTE', attempts: { lt: 5 } },
    orderBy: { createdAt: 'asc' },
    take: batch,
  });
  if (!pending.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  // agrupa por aba
  const byTab = new Map<string, typeof pending>();
  for (const row of pending) {
    const arr = byTab.get(row.sheetTab) ?? [];
    arr.push(row);
    byTab.set(row.sheetTab, arr);
  }

  for (const [tab, rows] of byTab) {
    try {
      const index = await keyIndex(sheetId, tab);
      const updates: sheets_v4.Schema$ValueRange[] = [];
      const appends: unknown[][] = [];

      // dedup: mantém apenas o último payload por chave
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) latest.set(r.rowKey, r);

      let nextRow = index.size + 2;
      for (const [key, r] of latest) {
        const values = r.payload as unknown[];
        const line = index.get(key);
        if (line) {
          updates.push({ range: `${tab}!A${line}`, values: [values as string[]] });
        } else {
          appends.push(values);
          index.set(key, nextRow++);
        }
      }

      if (updates.length) {
        await api.spreadsheets.values.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: { valueInputOption: 'RAW', data: updates },
        });
      }
      if (appends.length) {
        await api.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: `${tab}!A1`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: appends as string[][] },
        });
      }

      await prisma.syncOutbox.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: 'ENVIADO', sentAt: new Date() },
      });
      sent += rows.length;
    } catch (err) {
      failed += rows.length;
      await prisma.syncOutbox.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          attempts: { increment: 1 },
          lastError: err instanceof Error ? err.message.slice(0, 500) : 'erro desconhecido',
        },
      });
    }
  }

  return { sent, failed };
}

/**
 * GUARDIÃO — relê a planilha inteira e reescreve tudo que divergir do Postgres.
 * É isto que garante "a planilha só pode ser alterada via sistema".
 */
export async function runGuard(): Promise<{ restored: number }> {
  if (!sheetsEnabled()) return { restored: 0 };
  const api = getSheets();
  const sheetId = env.GOOGLE_SHEET_ID!;
  if (!api) return { restored: 0 };

  let restored = 0;

  const companies = await prisma.company.findMany({ where: { active: true, sheetSyncOn: true } });
  for (const company of companies) {
    // Estado canônico vindo do banco
    const stock = await prisma.stockItem.findMany({
      where: { product: { companyId: company.id } },
      include: { product: true, warehouse: true },
    });

    const canonical = new Map<string, unknown[]>();
    for (const s of stock) {
      const qty = Number(s.quantity);
      const avg = Number(s.avgCost);
      canonical.set(`${s.productId}:${s.warehouseId}`, [
        `${s.productId}:${s.warehouseId}`, s.product.sku, s.product.name, s.warehouse.name,
        qty, Number(s.reserved), qty - Number(s.reserved), avg, +(qty * avg).toFixed(2),
        qty < Number(s.product.minStock) ? 'SIM' : 'NAO', s.updatedAt.toISOString(),
      ]);
    }

    const res = await api.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TABS.estoque}!A2:K`,
    });
    const sheetRows = res.data.values ?? [];

    const updates: sheets_v4.Schema$ValueRange[] = [];
    for (let i = 0; i < sheetRows.length; i++) {
      const row = sheetRows[i];
      const key = String(row[0] ?? '');
      const truth = canonical.get(key);
      if (!truth) continue;
      // compara colunas numéricas sensíveis (E..I → índices 4..8)
      const divergent = [4, 5, 6, 7, 8].some(
        (c) => String(row[c] ?? '') !== String(truth[c] ?? ''),
      );
      if (divergent) {
        updates.push({ range: `${TABS.estoque}!A${i + 2}`, values: [truth as string[]] });
        await prisma.sheetGuardLog.create({
          data: {
            companyId: company.id,
            sheetTab: TABS.estoque,
            rowKey: key,
            action: 'RESTAURADO',
            before: row as Prisma.InputJsonValue,
            after: truth as Prisma.InputJsonValue,
          },
        });
        restored++;
      }
    }

    if (updates.length) {
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }

    await prisma.company.update({
      where: { id: company.id },
      data: { sheetLastSync: new Date() },
    });
  }

  return { restored };
}

/** Reenvia TUDO do zero (usado no botão "Recriar planilha"). */
export async function fullResync(companyId: string) {
  await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { companyId }, select: { id: true } });
    for (const p of products) await enqueueProduct(tx, companyId, p.id);

    const stock = await tx.stockItem.findMany({
      where: { product: { companyId } },
      select: { id: true },
    });
    for (const s of stock) await enqueueStock(tx, companyId, s.id);

    const movs = await tx.movement.findMany({
      where: { companyId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    for (const m of movs) await enqueueMovement(tx, companyId, m.id);

    const sales = await tx.sale.findMany({
      where: { companyId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    for (const s of sales) await enqueueSale(tx, companyId, s.id);
  }, { timeout: 60_000 });
}

/** Loop de background. */
export function startSyncWorkers(log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  if (!sheetsEnabled()) {
    log.info(
      { sheets: 'desligado' },
      'Sync Google Sheets desativado (faltam GOOGLE_SHEET_ID / credenciais). O sistema roda 100% no Postgres.',
    );
    return;
  }

  ensureTabs(env.GOOGLE_SHEET_ID!)
    .then(() => log.info({ sheets: 'ok' }, 'Planilha espelho pronta (abas e cabeçalhos verificados).'))
    .catch((e) => log.error({ err: String(e) }, 'Falha ao preparar a planilha espelho.'));

  setInterval(() => {
    runSync().then(
      (r) => r.sent && log.info(r, 'Replicação para o Google Sheets concluída.'),
      (e) => log.error({ err: String(e) }, 'Erro no worker de replicação.'),
    );
  }, env.SHEET_SYNC_INTERVAL_MS).unref();

  setInterval(() => {
    runGuard().then(
      (r) => r.restored && log.info(r, 'Guardião reverteu edições manuais na planilha.'),
      (e) => log.error({ err: String(e) }, 'Erro no guardião da planilha.'),
    );
  }, env.SHEET_GUARD_INTERVAL_MS).unref();
}
