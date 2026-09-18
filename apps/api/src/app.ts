import Fastify from "fastify";
import prismaPlugin from "./plugins/prisma.plugin.js";
import authPlugin from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.routes.js";
import { catalogRoutes } from "./routes/catalog.routes.js";
import { equipeRoutes } from "./routes/equipe.routes.js";

/**
 * Monta a aplicação Fastify completa. Separado de `server.ts` (que só
 * chama `.listen`) pra poder ser testado/usado por ferramentas de teste de
 * integração sem abrir uma porta de verdade.
 *
 * Ordem importa: prisma primeiro (rotas dependem de `app.prisma`), depois
 * o segredo de auth, depois o plugin de auth (que já barra tudo que não
 * for `/auth/login` a partir daqui), só então as rotas de negócio.
 */
export async function buildApp() {
  const app = Fastify({ logger: true });

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET não configurado. Defina uma variável de ambiente com um segredo forte antes de subir em produção — sem isso os tokens de sessão não têm como ser assinados com segurança.",
      );
    }
    app.log.warn("AUTH_SECRET não definido — usando segredo de desenvolvimento. NUNCA faça isso em produção.");
  }
  app.decorate("authSecret", authSecret ?? "dev-secret-inseguro-so-para-desenvolvimento-local");

  await app.register(prismaPlugin);
  await app.register(authPlugin);

  await app.register(authRoutes);
  await app.register(catalogRoutes);
  await app.register(equipeRoutes);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
