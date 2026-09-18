import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verificarToken } from "../lib/token.js";
import type { PermissaoOverrides, Role } from "../lib/permissoes.js";

/**
 * Popula `req.usuarioAtual` a partir do header `Authorization: Bearer <token>`
 * pra toda rota registrada DEPOIS deste plugin. É o que faltava pra
 * `equipe.routes.ts` (que já lê `req.usuarioAtual`) funcionar de verdade,
 * em vez de assumir que alguém preencheu isso por fora.
 *
 * Regra de negócio importante embutida aqui: **conta com
 * `mustChangePassword = true` só pode chamar `/auth/change-password` e
 * `/auth/me`** — tudo mais volta 403 com um código específico
 * (`SENHA_PROVISORIA`) pro front saber que precisa forçar a troca antes de
 * deixar a pessoa usar o sistema. É a correção direta da falha de
 * segurança encontrada em produção (senha provisória sem troca
 * obrigatória).
 */

declare module "fastify" {
  interface FastifyRequest {
    usuarioAtual?: {
      id: string;
      companyId: string;
      role: Role;
      mustChangePassword: boolean;
      permissionOverrides?: PermissaoOverrides | null;
    };
  }
}

const ROTAS_LIBERADAS_COM_SENHA_PROVISORIA = new Set<string>([
  "/auth/change-password",
  "/auth/me",
  "/auth/logout",
]);

async function authPlugin(app: FastifyInstance) {
  const segredo = app.authSecret;

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    // /auth/login e /health são as únicas rotas públicas — todo o resto
    // exige token. /health é o endpoint que o Railway usa pra checar se o
    // serviço está de pé, tem que responder sem sessão.
    if (req.url.startsWith("/auth/login") || req.url.startsWith("/health")) return;

    const cabecalho = req.headers.authorization;
    const token = cabecalho?.startsWith("Bearer ") ? cabecalho.slice(7) : null;
    if (!token) {
      return reply.status(401).send({ erro: "Não autenticado." });
    }

    const payload = verificarToken(token, segredo);
    if (!payload) {
      return reply.status(401).send({ erro: "Sessão inválida ou expirada." });
    }

    const usuario = await app.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { permissions: true },
    });
    if (!usuario || !usuario.active) {
      return reply.status(401).send({ erro: "Usuário inativo ou não encontrado." });
    }

    req.usuarioAtual = {
      id: usuario.id,
      companyId: usuario.companyId,
      role: usuario.role as Role,
      mustChangePassword: usuario.mustChangePassword,
      permissionOverrides: usuario.permissions as any,
    };

    // Trava real da falha de segurança: com troca pendente, só a rota de
    // troca (e leitura do próprio perfil) responde.
    const caminho = req.url.split("?")[0];
    if (usuario.mustChangePassword && !ROTAS_LIBERADAS_COM_SENHA_PROVISORIA.has(caminho)) {
      return reply.status(403).send({
        erro: "Troca de senha obrigatória antes de continuar.",
        codigo: "SENHA_PROVISORIA",
      });
    }
  });
}

export default fp(authPlugin, { name: "auth-plugin" });
