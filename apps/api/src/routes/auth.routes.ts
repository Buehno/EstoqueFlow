import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  authenticate,
  checkPassword,
  hashPassword,
  requireRole,
  signToken,
  CAN_MANAGE,
  type Role,
} from '../lib/auth.js';
import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export default async function authRoutes(app: FastifyInstance) {
  /** Cadastro de nova empresa (tenant) + usuário OWNER + 2 depósitos padrão. */
  app.post('/register', async (req) => {
    const body = z
      .object({
        companyName: z.string().min(2, 'Informe o nome da empresa'),
        cnpj: z.string().optional(),
        name: z.string().min(2, 'Informe seu nome'),
        email: z.string().email('E-mail inválido'),
        password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres'),
      })
      .parse(req.body);

    const exists = await prisma.user.findFirst({ where: { email: body.email } });
    if (exists) throw conflict('Já existe uma conta com este e-mail.');

    let slug = slugify(body.companyName);
    if (await prisma.company.findUnique({ where: { slug } })) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const company = await prisma.company.create({
      data: {
        name: body.companyName,
        slug,
        cnpj: body.cnpj,
        email: body.email,
        warehouses: {
          create: [
            { code: 'DEP-1', name: 'Depósito 1 · Superior', isDefault: true },
            { code: 'DEP-2', name: 'Depósito 2 · Inferior' },
          ],
        },
        categories: { create: [{ name: 'Geral', color: '#0ea5e9' }] },
        users: {
          create: {
            name: body.name,
            email: body.email,
            passwordHash: await hashPassword(body.password),
            role: 'OWNER',
          },
        },
      },
      include: { users: true },
    });

    const user = company.users[0];
    const token = signToken({
      id: user.id,
      companyId: company.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      mustChangePassword: false, // quem se cadastra sozinho já escolhe a própria senha
    });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tutorialDone: false, tutorialStep: 0, mustChangePassword: false },
      company: { id: company.id, name: company.name, slug: company.slug },
    };
  });

  app.post('/login', async (req) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);

    const user = await prisma.user.findFirst({
      where: { email: body.email, active: true },
      include: { company: true },
    });
    if (!user) throw unauthorized('E-mail ou senha incorretos.');
    if (!(await checkPassword(body.password, user.passwordHash))) {
      throw unauthorized('E-mail ou senha incorretos.');
    }
    if (!user.company.active) throw unauthorized('Conta da empresa está inativa.');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await prisma.auditLog.create({
      data: { companyId: user.companyId, userId: user.id, entity: 'User', entityId: user.id, action: 'LOGIN' },
    });

    return {
      token: signToken({
        id: user.id,
        companyId: user.companyId,
        name: user.name,
        email: user.email,
        role: user.role as Role,
        mustChangePassword: user.mustChangePassword,
      }),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tutorialDone: user.tutorialDone,
        tutorialStep: user.tutorialStep,
        mustChangePassword: user.mustChangePassword,
      },
      company: { id: user.company.id, name: user.company.name, slug: user.company.slug },
    };
  });

  // GET /me continua liberado mesmo com troca de senha pendente (ver
  // ROTAS_LIBERADAS_COM_SENHA_PROVISORIA em lib/auth.ts) — é dele que o front
  // sabe que precisa mostrar a tela de troca obrigatória.
  app.get('/me', { preHandler: authenticate }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { company: true },
    });
    if (!user) throw unauthorized();
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tutorialDone: user.tutorialDone,
        tutorialStep: user.tutorialStep,
        mustChangePassword: user.mustChangePassword,
      },
      company: {
        id: user.company.id,
        name: user.company.name,
        slug: user.company.slug,
        sheetSyncOn: user.company.sheetSyncOn,
        sheetLastSync: user.company.sheetLastSync,
      },
    };
  });

  /** Avança / conclui o tutorial de onboarding. */
  app.patch('/me/tutorial', { preHandler: authenticate }, async (req) => {
    const body = z.object({ step: z.number().int().min(0).max(20).optional(), done: z.boolean().optional() }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(body.step != null ? { tutorialStep: body.step } : {}),
        ...(body.done != null ? { tutorialDone: body.done } : {}),
      },
    });
    return { tutorialStep: user.tutorialStep, tutorialDone: user.tutorialDone };
  });

  // Também liberada com troca de senha pendente — é a própria rota que
  // encerra a pendência. Devolve um token novo porque o token antigo carrega
  // `mustChangePassword: true`; o front precisa trocar o token guardado por
  // este para deixar de ser barrado no /auth/me seguinte.
  app.patch('/me/password', { preHandler: authenticate }, async (req) => {
    const body = z
      .object({ current: z.string().min(1), next: z.string().min(8) })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await checkPassword(body.current, user.passwordHash))) {
      throw badRequest('Senha atual incorreta.');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.next), mustChangePassword: false },
    });
    const token = signToken({
      id: user.id,
      companyId: user.companyId,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      mustChangePassword: false,
    });
    return { ok: true, token };
  });

  // ── Dados da empresa ────────────────────────────────────────────────────
  app.get('/company', { preHandler: authenticate }, async (req) =>
    prisma.company.findUnique({
      where: { id: req.user!.companyId },
      select: {
        id: true, name: true, legalName: true, cnpj: true, slug: true,
        phone: true, email: true, sheetId: true, sheetSyncOn: true,
      },
    }),
  );

  app.patch('/company', { preHandler: [authenticate, requireRole(...CAN_MANAGE)] }, async (req) => {
    const body = z
      .object({
        name: z.string().min(2).optional(),
        legalName: z.string().optional(),
        cnpj: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        sheetId: z.string().optional(),
        sheetSyncOn: z.boolean().optional(),
      })
      .parse(req.body);

    // o slug acompanha o nome, mantendo a unicidade
    let slug: string | undefined;
    if (body.name) {
      const base = slugify(body.name);
      const ocupado = await prisma.company.findFirst({
        where: { slug: base, id: { not: req.user!.companyId } },
      });
      slug = ocupado ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base;
    }

    return prisma.company.update({
      where: { id: req.user!.companyId },
      data: { ...body, email: body.email || undefined, ...(slug ? { slug } : {}) },
      select: { id: true, name: true, slug: true, legalName: true, cnpj: true },
    });
  });

  // ── Gestão de usuários da empresa ───────────────────────────────────────
  app.get('/users', { preHandler: [authenticate, requireRole(...CAN_MANAGE)] }, async (req) =>
    prisma.user.findMany({
      where: { companyId: req.user!.companyId },
      select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, mustChangePassword: true },
      orderBy: { name: 'asc' },
    }),
  );

  app.post('/users', { preHandler: [authenticate, requireRole(...CAN_MANAGE)] }, async (req) => {
    const body = z
      .object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        role: z.enum(['ADMIN', 'ESTOQUISTA', 'VENDEDOR', 'LEITURA']),
      })
      .parse(req.body);

    const dup = await prisma.user.findFirst({
      where: { companyId: req.user!.companyId, email: body.email },
    });
    if (dup) throw conflict('Já existe um usuário com este e-mail na empresa.');

    const user = await prisma.user.create({
      data: {
        companyId: req.user!.companyId,
        name: body.name,
        email: body.email,
        role: body.role,
        passwordHash: await hashPassword(body.password),
        // quem cria escolhe a senha inicial — força a pessoa a trocar por
        // uma que só ela conhece no primeiro acesso (falha corrigida em 18/09).
        mustChangePassword: true,
      },
      select: { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true },
    });
    return user;
  });

  app.patch('/users/:id', { preHandler: [authenticate, requireRole(...CAN_MANAGE)] }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        role: z.enum(['ADMIN', 'ESTOQUISTA', 'VENDEDOR', 'LEITURA']).optional(),
        active: z.boolean().optional(),
        password: z.string().min(8).optional(),
      })
      .parse(req.body);

    const alvo = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!alvo) throw notFound('Pessoa não encontrada.');
    if (alvo.role === 'OWNER') throw conflict('O proprietário não pode ser editado por aqui.');

    if (body.email) {
      const dup = await prisma.user.findFirst({
        where: { companyId: req.user!.companyId, email: body.email, id: { not: id } },
      });
      if (dup) throw conflict('Já existe um usuário com este e-mail na empresa.');
    }

    return prisma.user.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.email ? { email: body.email } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.active != null ? { active: body.active } : {}),
        // senha redefinida por um administrador é, de novo, uma senha que
        // só ele conhece até aqui — mesma trava de troca obrigatória.
        ...(body.password ? { passwordHash: await hashPassword(body.password), mustChangePassword: true } : {}),
      },
      select: { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true },
    });
  });

  /**
   * Excluir de verdade quando dá, ou desativar quando não dá. A pessoa pode
   * ter movimentações, vendas, propostas etc. vinculadas ao `userId` — apagar
   * o registro quebraria esse histórico de auditoria, então nesses casos a
   * exclusão vira apenas uma desativação (mesmo efeito prático: some da
   * equipe ativa e não consegue mais logar).
   */
  app.delete('/users/:id', { preHandler: [authenticate, requireRole(...CAN_MANAGE)] }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === req.user!.id) throw conflict('Você não pode excluir a si mesmo.');

    const alvo = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!alvo) throw notFound('Pessoa não encontrada.');
    if (alvo.role === 'OWNER') throw conflict('O proprietário não pode ser excluído.');

    try {
      await prisma.user.delete({ where: { id } });
      return { ok: true, modo: 'excluido' as const };
    } catch (err) {
      // P2003: violação de chave estrangeira — existe histórico vinculado
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        await prisma.user.update({ where: { id }, data: { active: false } });
        return {
          ok: true,
          modo: 'desativado' as const,
          motivo: 'Esta pessoa tem movimentações/vendas/propostas no histórico — foi desativada em vez de excluída, para não apagar o rastro de auditoria.',
        };
      }
      throw err;
    }
  });
}
