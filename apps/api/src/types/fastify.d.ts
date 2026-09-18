import type { PrismaClient } from "@prisma/client";

// Decorador registrado no bootstrap da API (plugin `prisma.plugin.ts`, a
// escrever junto com o restante do app). Documentado aqui pra as rotas já
// terem tipo correto de `app.prisma` desde já.
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
