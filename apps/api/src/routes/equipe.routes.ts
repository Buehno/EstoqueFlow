import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes, scryptSync } from "node:crypto";
import {
  PAPEIS,
  PERMISSAO_CHAVES,
  podeGerenciar,
  podeAbrirPainelEquipe,
  resolverPermissoes,
  type PermissaoOverrides,
  type Role,
} from "../lib/permissoes.js";

/**
 * Página única "Equipe" (pedido de 18/09): Owner/Gestor/Administrador
 * adicionam, editam, excluem e atualizam pessoas — e trocam papel +
 * permissões individuais — tudo pelas mesmas rotas, sem tela separada.
 *
 * Autorização em duas camadas, sempre em cima do usuário autenticado
 * (`req.usuarioAtual`, populado pelo middleware de auth — a escrever junto
 * com o bootstrap do Fastify):
 *   1. `podeAbrirPainelEquipe` — precisa ter a permissão `equipeGerenciar`
 *      resolvida (papel ou override) pra sequer listar a equipe.
 *   2. `podeGerenciar(quem, alvo)` — checada de novo por ação (criar com um
 *      certo papel, editar, trocar papel, excluir) pra impedir, por
 *      exemplo, um Administrador mexendo em outro Administrador, ou
 *      qualquer um mexendo no Owner.
 */

const overridesSchema = z
  .object(Object.fromEntries(PERMISSAO_CHAVES.map((c) => [c, z.boolean().nullable().optional()])) as Record<
    (typeof PERMISSAO_CHAVES)[number],
    z.ZodOptional<z.ZodNullable<z.ZodBoolean>>
  >)
  .partial();

const roleSchema = z.enum(["OWNER", "GESTOR", "ADMINISTRADOR", "OPERADOR"]);

function gerarSenhaProvisoria(): string {
  // 8 caracteres alfanuméricos, fácil de ditar por telefone/whatsapp.
  return randomBytes(6).toString("base64url").slice(0, 8);
}

function hashSenha(senha: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(senha, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

interface UsuarioAutenticado {
  id: string;
  companyId: string;
  role: Role;
  permissionOverrides?: PermissaoOverrides | null;
}

export async function equipeRoutes(app: FastifyInstance) {
  // Todas as rotas abaixo assumem `req.usuarioAtual` populado pelo plugin de
  // auth (a escrever). Até lá, checagem defensiva: sem usuário, 401.
  app.addHook("preHandler", async (req, reply) => {
    if (!(req as any).usuarioAtual) {
      return reply.status(401).send({ erro: "Não autenticado." });
    }
  });

  function atual(req: any): UsuarioAutenticado {
    return req.usuarioAtual as UsuarioAutenticado;
  }

  function semPermissaoDePainel(req: any, reply: any): boolean {
    const eu = atual(req);
    if (!podeAbrirPainelEquipe(eu.role, eu.permissionOverrides)) {
      reply.status(403).send({ erro: "Sem permissão para gerenciar a equipe." });
      return true;
    }
    return false;
  }

  // GET /equipe — lista única com papel + permissões já resolvidas, pra
  // tela pintar tudo de uma vez (o "one page" pedido).
  app.get("/equipe", async (req, reply) => {
    if (semPermissaoDePainel(req, reply)) return;
    const eu = atual(req);

    const pessoas = await app.prisma.user.findMany({
      where: { companyId: eu.companyId },
      include: { permissions: true },
      orderBy: { name: "asc" },
    });

    return reply.send({
      papeisDisponiveis: PAPEIS,
      permissoesDisponiveis: PERMISSAO_CHAVES,
      pessoas: pessoas.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role as Role,
        active: p.active,
        mustChangePassword: p.mustChangePassword,
        // o que essa pessoa realmente pode fazer hoje (papel + sobrescrita)
        permissoesResolvidas: resolverPermissoes(p.role as Role, p.permissions as any),
        // só as sobrescritas explícitas, pra tela saber quais toggles estão "manuais"
        permissoesOverride: p.permissions ?? {},
        editavelPorMim: podeGerenciar(eu.role, p.role as Role),
      })),
    });
  });

  // POST /equipe — adicionar pessoa
  app.post("/equipe", async (req, reply) => {
    if (semPermissaoDePainel(req, reply)) return;
    const eu = atual(req);

    const corpo = z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        role: roleSchema,
        permissoesOverride: overridesSchema.optional(),
      })
      .parse(req.body);

    if (!podeGerenciar(eu.role, corpo.role)) {
      return reply.status(403).send({ erro: `Você não pode criar alguém com o papel ${corpo.role}.` });
    }

    const senhaProvisoria = gerarSenhaProvisoria();

    const criado = await app.prisma.user.create({
      data: {
        companyId: eu.companyId,
        name: corpo.name,
        email: corpo.email,
        role: corpo.role,
        passwordHash: hashSenha(senhaProvisoria),
        mustChangePassword: true, // corrige a falha viva: toda conta nova exige troca no 1º login
        permissions: corpo.permissoesOverride
          ? { create: corpo.permissoesOverride }
          : undefined,
      },
      include: { permissions: true },
    });

    return reply.status(201).send({
      id: criado.id,
      name: criado.name,
      email: criado.email,
      role: criado.role,
      // devolvida só na criação — nunca mais fica recuperável em texto puro depois disso.
      senhaProvisoria,
    });
  });

  // PATCH /equipe/:id — editar dados básicos e/ou trocar o papel
  app.patch("/equipe/:id", async (req, reply) => {
    if (semPermissaoDePainel(req, reply)) return;
    const eu = atual(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const corpo = z
      .object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        role: roleSchema.optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const alvo = await app.prisma.user.findFirst({ where: { id, companyId: eu.companyId } });
    if (!alvo) return reply.status(404).send({ erro: "Pessoa não encontrada." });
    if (!podeGerenciar(eu.role, alvo.role as Role)) {
      return reply.status(403).send({ erro: "Você não pode editar esta pessoa." });
    }
    if (corpo.role && !podeGerenciar(eu.role, corpo.role)) {
      return reply.status(403).send({ erro: `Você não pode promover/rebaixar para ${corpo.role}.` });
    }

    const atualizado = await app.prisma.user.update({
      where: { id },
      data: corpo,
      include: { permissions: true },
    });

    return reply.send({
      id: atualizado.id,
      name: atualizado.name,
      email: atualizado.email,
      role: atualizado.role,
      active: atualizado.active,
      permissoesResolvidas: resolverPermissoes(atualizado.role as Role, atualizado.permissions as any),
    });
  });

  // PATCH /equipe/:id/permissoes — ligar/desligar permissões individuais
  app.patch("/equipe/:id/permissoes", async (req, reply) => {
    if (semPermissaoDePainel(req, reply)) return;
    const eu = atual(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const overrides = overridesSchema.parse(req.body);

    const alvo = await app.prisma.user.findFirst({ where: { id, companyId: eu.companyId } });
    if (!alvo) return reply.status(404).send({ erro: "Pessoa não encontrada." });
    if (!podeGerenciar(eu.role, alvo.role as Role)) {
      return reply.status(403).send({ erro: "Você não pode alterar as permissões desta pessoa." });
    }

    const permissoes = await app.prisma.userPermission.upsert({
      where: { userId: id },
      create: { userId: id, ...overrides },
      update: overrides,
    });

    return reply.send({
      id,
      permissoesOverride: permissoes,
      permissoesResolvidas: resolverPermissoes(alvo.role as Role, permissoes as any),
    });
  });

  // DELETE /equipe/:id — excluir (com salvaguardas: ninguém exclui a si
  // mesmo por aqui, e o Owner nunca é alvo — já garantido por `podeGerenciar`).
  app.delete("/equipe/:id", async (req, reply) => {
    if (semPermissaoDePainel(req, reply)) return;
    const eu = atual(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);

    if (id === eu.id) {
      return reply.status(400).send({ erro: "Você não pode excluir a si mesmo." });
    }

    const alvo = await app.prisma.user.findFirst({ where: { id, companyId: eu.companyId } });
    if (!alvo) return reply.status(404).send({ erro: "Pessoa não encontrada." });
    if (!podeGerenciar(eu.role, alvo.role as Role)) {
      return reply.status(403).send({ erro: "Você não pode excluir esta pessoa." });
    }

    await app.prisma.user.delete({ where: { id } });
    return reply.status(204).send();
  });
}
