import type { PrismaClient } from "@prisma/client";

// Decoradores registrados no bootstrap da API (`app.ts`): `prisma` pelo
// plugin `prisma.plugin.ts`, `authSecret` direto em `app.ts` (lido de
// `AUTH_SECRET`) e usado por `middleware/auth.ts` pra assinar/verificar
// tokens de sessão.
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    authSecret: string;
  }
}
