import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  authenticate,
  checkPassword,
  hashPassword,
  requireRole,
  requireCap,
  signToken,
  CAN_MANAGE,
  type Role,
} from '../lib/auth.js';
import {
  CAPACIDADES,
  PAPEIS_ATRIBUIVEIS,
  ROTULO_CAPACIDADE,
  ROTULO_PAPEL,
  capacidadesEfetivas,
  detalharPermissoes,
  nivelDoPapel,
  normalizarOverrides,
  type Capacidade,
} from '../lib/permissoes.js';
import { Prisma } from '@prisma/client';
import { enviarAlerta, enviarTeste, montarResumo } from '../services/alertas-email.service.js';
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
        roleLabel: ROTULO_PAPEL[user.role as Role]?.label ?? user.role,
        /** Capacidades efetivas — o menu e as telas se escondem/mostram por aqui. */
        caps: [...capacidadesEfetivas(user.role as Role, user.permissionOverrides)],
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
        roleLabel: ROTULO_PAPEL[user.role as Role]?.label ?? user.role,
        /** Capacidades efetivas — o menu e as telas se escondem/mostram por aqui. */
        caps: [...capacidadesEfetivas(user.role as Role, user.permissionOverrides)],
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
  app.get('/company', { preHandler: authenticate }, async (req) => {
    const c = await prisma.company.findUnique({
      where: { id: req.user!.companyId },
      select: {
        id: true, name: true, legalName: true, cnpj: true, slug: true,
        phone: true, email: true, sheetId: true, sheetSyncOn: true, logoUrl: true,
        alertEmailEnabled: true, alertEmailTo: true, alertEmailHour: true, alertEmailLastAt: true,
        smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true, smtpFrom: true, smtpPass: true,
      },
    });
    if (!c) throw unauthorized();
    // A senha do SMTP nunca volta para a tela — só se está preenchida.
    const { smtpPass, ...resto } = c;
    return { ...resto, smtpPassSet: !!smtpPass };
  });

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
        // Data URI — logotipo comprimido no navegador antes de enviar.
        logoUrl: z.string().max(700_000).regex(/^data:image\/(png|jpe?g|webp);base64,/).nullable().optional(),
        // Alerta diário por e-mail + SMTP (Integrações).
        alertEmailEnabled: z.boolean().optional(),
        alertEmailTo: z.string().max(500).nullable().optional(),
        alertEmailHour: z.coerce.number().int().min(0).max(23).optional(),
        smtpHost: z.string().max(200).nullable().optional(),
        smtpPort: z.coerce.number().int().min(1).max(65535).nullable().optional(),
        smtpSecure: z.boolean().optional(),
        smtpUser: z.string().max(200).nullable().optional(),
        /** Em branco mantém a senha gravada; preenchida substitui. */
        smtpPass: z.string().max(500).nullable().optional(),
        smtpFrom: z.string().max(200).nullable().optional(),
      })
      .parse(req.body);
    if (body.smtpPass === '') delete body.smtpPass;

    // o slug acompanha o nome, mantendo a unicidade
    let slug: string | undefined;
    if (body.name) {
      const base = slugify(body.name);
      const ocupado = await prisma.company.findFirst({
        where: { slug: base, id: { not: req.user!.companyId } },
      });
      slug = ocupado ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base;
    }

    const atualizada = await prisma.company.update({
      where: { id: req.user!.companyId },
      data: { ...body, email: body.email || undefined, ...(slug ? { slug } : {}) },
      select: {
        id: true, name: true, slug: true, legalName: true, cnpj: true, logoUrl: true,
        alertEmailEnabled: true, alertEmailTo: true, alertEmailHour: true, alertEmailLastAt: true,
        smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true, smtpFrom: true, smtpPass: true,
      },
    });
    const { smtpPass, ...resto } = atualizada;
    return { ...resto, smtpPassSet: !!smtpPass };
  });

  // ── Alerta diário por e-mail ─────────────────────────────────────────────
  /** Manda um e-mail de teste com a configuração atual (sem depender de alerta). */
  app.post('/company/alerta-email/testar', { preHandler: [authenticate, requireCap('GERENCIAR_REGRAS_ALERTA')] }, async (req) => {
    const body = z.object({ para: z.string().optional() }).parse(req.body ?? {});
    return enviarTeste(req.user!.companyId, body.para);
  });
  /** Manda o resumo de hoje agora, mesmo fora do horário ou já enviado. */
  app.post('/company/alerta-email/enviar-agora', { preHandler: [authenticate, requireCap('GERENCIAR_REGRAS_ALERTA')] }, async (req) =>
    enviarAlerta(req.user!.companyId, { forcar: true }),
  );
  /** Prévia do resumo (o que iria no e-mail), sem enviar. */
  app.get('/company/alerta-email/previa', { preHandler: [authenticate, requireCap('GERENCIAR_REGRAS_ALERTA', 'VER_ALERTAS')] }, async (req) => {
    const r = await montarResumo(req.user!.companyId);
    return r ?? { assunto: null, texto: 'Nenhum item em alerta de compra — nada a enviar.', itens: 0 };
  });

  // ── Gestão de usuários da empresa ───────────────────────────────────────
  /**
   * Quem pode mexer em quem: só em pessoas de nível ABAIXO do seu (Gestor
   * mexe em Administrador e Operador; Administrador mexe em Operador). E
   * ninguém liga para outra pessoa uma capacidade que não tem.
   */
  function conferirAlcance(req: { user?: { role: Role; caps?: Set<Capacidade> } }, alvoRole: Role, overrides?: unknown) {
    const meu = req.user!.role;
    if (meu !== 'OWNER' && nivelDoPapel(alvoRole) >= nivelDoPapel(meu)) {
      throw conflict(`Você só pode gerenciar pessoas com papel abaixo do seu (${ROTULO_PAPEL[meu].label}).`);
    }
    if (overrides && meu !== 'OWNER') {
      for (const [cap, ligado] of Object.entries(normalizarOverrides(overrides)) as [Capacidade, boolean][]) {
        if (ligado && !req.user!.caps?.has(cap)) {
          throw conflict(`Você não pode ligar "${ROTULO_CAPACIDADE[cap].titulo}" para outra pessoa: você mesmo não tem essa permissão.`);
        }
      }
    }
  }

  const selecaoUsuario = {
    id: true, name: true, email: true, role: true, active: true, lastLoginAt: true,
    mustChangePassword: true, permissionOverrides: true,
  } as const;
  const comPermissoes = <T extends { role: Role | string; permissionOverrides: unknown }>(u: T) => ({
    ...u,
    roleLabel: ROTULO_PAPEL[u.role as Role]?.label ?? u.role,
    permissoes: detalharPermissoes(u.role as Role, u.permissionOverrides),
  });

  /** Catálogo para a tela: papéis atribuíveis e capacidades com rótulo. */
  app.get('/users/catalogo', { preHandler: [authenticate, requireCap('GERENCIAR_EQUIPE')] }, async (req) => {
    const meuNivel = nivelDoPapel(req.user!.role);
    return {
      papeis: PAPEIS_ATRIBUIVEIS
        .filter((r) => req.user!.role === 'OWNER' || nivelDoPapel(r) < meuNivel)
        .map((r) => ({ role: r, ...ROTULO_PAPEL[r] })),
      capacidades: CAPACIDADES.map((c) => ({ cap: c, ...ROTULO_CAPACIDADE[c] })),
      minhasCaps: [...(req.user!.caps ?? [])],
    };
  });

  app.get('/users', { preHandler: [authenticate, requireCap('GERENCIAR_EQUIPE')] }, async (req) =>
    (await prisma.user.findMany({
      where: { companyId: req.user!.companyId },
      select: selecaoUsuario,
      orderBy: { name: 'asc' },
    })).map(comPermissoes),
  );

  const papelSchema = z.enum(['GESTOR', 'ADMINISTRADOR', 'OPERADOR', 'LEITURA', 'ADMIN', 'ESTOQUISTA', 'VENDEDOR']);
  const overridesSchema = z.record(z.string(), z.boolean()).optional().nullable();

  app.post('/users', { preHandler: [authenticate, requireCap('GERENCIAR_EQUIPE')] }, async (req) => {
    const body = z
      .object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        role: papelSchema,
        permissionOverrides: overridesSchema,
      })
      .parse(req.body);
    conferirAlcance(req, body.role, body.permissionOverrides);

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
        permissionOverrides:
          body.permissionOverrides && Object.keys(normalizarOverrides(body.permissionOverrides)).length
            ? normalizarOverrides(body.permissionOverrides)
            : Prisma.DbNull,
        passwordHash: await hashPassword(body.password),
        // quem cria escolhe a senha inicial — força a pessoa a trocar por
        // uma que só ela conhece no primeiro acesso (falha corrigida em 18/09).
        mustChangePassword: true,
      },
      select: selecaoUsuario,
    });
    return comPermissoes(user);
  });

  app.patch('/users/:id', { preHandler: [authenticate, requireCap('GERENCIAR_EQUIPE')] }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        role: papelSchema.optional(),
        active: z.boolean().optional(),
        password: z.string().min(8).optional(),
        /** Mapa completo de liga/desliga; `{}` ou null volta ao padrão do papel. */
        permissionOverrides: overridesSchema,
      })
      .parse(req.body);

    const alvo = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!alvo) throw notFound('Pessoa não encontrada.');
    if (alvo.role === 'OWNER') throw conflict('O proprietário não pode ser editado por aqui.');
    if (alvo.id === req.user!.id && (body.role || body.permissionOverrides !== undefined || body.active === false)) {
      throw conflict('Você não pode mudar o próprio papel, as próprias permissões nem se desativar.');
    }
    conferirAlcance(req, alvo.role as Role);
    if (body.role) conferirAlcance(req, body.role, body.permissionOverrides);
    else if (body.permissionOverrides) conferirAlcance(req, alvo.role as Role, body.permissionOverrides);

    if (body.email) {
      const dup = await prisma.user.findFirst({
        where: { companyId: req.user!.companyId, email: body.email, id: { not: id } },
      });
      if (dup) throw conflict('Já existe um usuário com este e-mail na empresa.');
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.email ? { email: body.email } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.active != null ? { active: body.active } : {}),
        ...(body.permissionOverrides !== undefined
          ? {
              permissionOverrides:
                body.permissionOverrides && Object.keys(normalizarOverrides(body.permissionOverrides)).length
                  ? normalizarOverrides(body.permissionOverrides)
                  : Prisma.DbNull,
            }
          : {}),
        // senha redefinida por um administrador é, de novo, uma senha que
        // só ele conhece até aqui — mesma trava de troca obrigatória.
        ...(body.password ? { passwordHash: await hashPassword(body.password), mustChangePassword: true } : {}),
      },
      select: selecaoUsuario,
    });
    return comPermissoes(user);
  });

  /**
   * Excluir de verdade quando dá, ou desativar quando não dá. A pessoa pode
   * ter movimentações, vendas, propostas etc. vinculadas ao `userId` — apagar
   * o registro quebraria esse histórico de auditoria, então nesses casos a
   * exclusão vira apenas uma desativação (mesmo efeito prático: some da
   * equipe ativa e não consegue mais logar).
   */
  app.delete('/users/:id', { preHandler: [authenticate, requireCap('GERENCIAR_EQUIPE')] }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === req.user!.id) throw conflict('Você não pode excluir a si mesmo.');

    const alvo = await prisma.user.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!alvo) throw notFound('Pessoa não encontrada.');
    if (alvo.role === 'OWNER') throw conflict('O proprietário não pode ser excluído.');
    conferirAlcance(req, alvo.role as Role);

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
