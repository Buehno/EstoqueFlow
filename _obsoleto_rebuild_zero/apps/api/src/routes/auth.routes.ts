import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verificarSenha, hashSenha, senhaValida } from "../lib/senha.js";
import { gerarToken, expiracaoEmHoras } from "../lib/token.js";
import { resolverPermissoes, type Role } from "../lib/permissoes.js";

/**
 * Login, troca de senha obrigatória e leitura do próprio perfil. É o
 * bootstrap de autenticação que faltava pra tudo mais (Equipe, propostas
 * etc.) rodar de verdade — antes disso, `req.usuarioAtual` não existia em
 * lugar nenhum.
 */
export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login — única rota pública (ver middleware/auth.ts).
  app.post("/auth/login", async (req, reply) => {
    const corpo = z.object({ email: z.string().email(), senha: z.string().min(1) }).parse(req.body);

    const usuario = await app.prisma.user.findUnique({ where: { email: corpo.email } });
    if (!usuario || !usuario.active || !verificarSenha(corpo.senha, usuario.passwordHash)) {
      // Mensagem genérica de propósito — não revela se o e-mail existe.
      return reply.status(401).send({ erro: "E-mail ou senha inválidos." });
    }

    const token = gerarToken(
      { sub: usuario.id, companyId: usuario.companyId, role: usuario.role, exp: expiracaoEmHoras(8) },
      app.authSecret,
    );

    return reply.send({
      token,
      mustChangePassword: usuario.mustChangePassword,
      usuario: { id: usuario.id, name: usuario.name, email: usuario.email, role: usuario.role },
    });
  });

  // POST /auth/change-password — a única rota liberada com senha
  // provisória além de /auth/me (ver middleware/auth.ts). Corrige a falha
  // encontrada em produção: agora existe um jeito de trocar a senha, e é
  // obrigatório usá-lo antes de continuar quando `mustChangePassword`.
  app.post("/auth/change-password", async (req, reply) => {
    const eu = req.usuarioAtual!;
    const corpo = z
      .object({ senhaAtual: z.string().min(1), novaSenha: z.string() })
      .parse(req.body);

    const usuario = await app.prisma.user.findUnique({ where: { id: eu.id } });
    if (!usuario || !verificarSenha(corpo.senhaAtual, usuario.passwordHash)) {
      return reply.status(401).send({ erro: "Senha atual incorreta." });
    }
    if (!senhaValida(corpo.novaSenha)) {
      return reply.status(422).send({ erro: "A nova senha precisa ter pelo menos 8 caracteres." });
    }
    if (corpo.novaSenha === corpo.senhaAtual) {
      return reply.status(422).send({ erro: "A nova senha precisa ser diferente da atual." });
    }

    await app.prisma.user.update({
      where: { id: eu.id },
      data: { passwordHash: hashSenha(corpo.novaSenha), mustChangePassword: false },
    });

    return reply.send({ ok: true });
  });

  // GET /auth/me — perfil + permissões resolvidas de quem está logado.
  app.get("/auth/me", async (req, reply) => {
    const eu = req.usuarioAtual!;
    const usuario = await app.prisma.user.findUnique({ where: { id: eu.id }, include: { permissions: true } });
    if (!usuario) return reply.status(404).send({ erro: "Usuário não encontrado." });

    return reply.send({
      id: usuario.id,
      name: usuario.name,
      email: usuario.email,
      role: usuario.role,
      mustChangePassword: usuario.mustChangePassword,
      permissoesResolvidas: resolverPermissoes(usuario.role as Role, usuario.permissions as any),
    });
  });

  // POST /auth/logout — stateless (token expira sozinho); existe só pra o
  // front ter um endpoint pra chamar e descartar o token localmente.
  app.post("/auth/logout", async (_req, reply) => {
    return reply.send({ ok: true });
  });
}
