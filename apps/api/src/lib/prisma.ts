import { PrismaClient, Prisma } from '@prisma/client';
import { isProd } from '../env.js';

export const prisma = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export { Prisma };

/** Decimal helper — evita erro de ponto flutuante em quantidade/preço. */
export const D = (v: number | string | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(v as never);

export const num = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : Number(v);

/** Próximo número sequencial por empresa, atômico dentro da transação. */
export async function nextNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters (company_id, name, value)
    VALUES (${companyId}::uuid, ${name}, 1)
    ON CONFLICT (company_id, name)
    DO UPDATE SET value = counters.value + 1
    RETURNING value
  `;
  return rows[0].value;
}
