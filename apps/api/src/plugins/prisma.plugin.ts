import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

/**
 * Decora `app.prisma` com um PrismaClient único pra vida da aplicação.
 * Referenciado desde o início em `src/types/fastify.d.ts`; este é o
 * bootstrap real que faltava (documentado como pendência no schema).
 */
async function prismaPlugin(app: FastifyInstance) {
  const prisma = new PrismaClient();
  await prisma.$connect();

  app.decorate("prisma", prisma);

  app.addHook("onClose", async (instancia) => {
    await instancia.prisma.$disconnect();
  });
}

export default fp(prismaPlugin, { name: "prisma-plugin" });
