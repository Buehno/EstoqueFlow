import { PrismaClient, Prisma } from '@prisma/client';
import { createRequire } from 'node:module';
import { isProd } from '../env.js';

/**
 * PRISMA_ADAPTER=pg troca o engine nativo do Prisma pelo engine WASM + driver
 * `pg`. Serve para rodar a API em ambientes de teste onde os binários nativos
 * do Prisma não podem ser baixados. Em produção a variável não existe, o
 * cliente padrão é usado e os módulos abaixo nem chegam a ser carregados.
 */
function criarCliente(): PrismaClient {
  const log: Prisma.LogLevel[] = isProd ? ['warn', 'error'] : ['warn', 'error'];
  if (process.env.PRISMA_ADAPTER !== 'pg') return new PrismaClient({ log });
  const req = createRequire(import.meta.url);
  const { Pool } = req('pg') as typeof import('pg');
  const { PrismaPg } = req('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg');
  const wasm = req('@prisma/client/wasm') as typeof import('@prisma/client/wasm');
  // O runtime WASM traz as próprias classes Decimal/erros; o restante do código
  // usa as do pacote padrão. Alinha as duas para `new Prisma.Decimal(x)` e os
  // `instanceof` continuarem válidos com os valores que vêm do banco.
  const alvo = Prisma as unknown as Record<string, unknown>;
  const origem = wasm.Prisma as unknown as Record<string, unknown>;
  for (const k of ['Decimal', 'PrismaClientKnownRequestError', 'PrismaClientValidationError', 'PrismaClientInitializationError', 'PrismaClientUnknownRequestError', 'PrismaClientRustPanicError']) {
    if (origem[k]) alvo[k] = origem[k];
  }
  const adapter = new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL }));
  return new wasm.PrismaClient({ log, adapter }) as unknown as PrismaClient;
}

export const prisma = criarCliente();

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
