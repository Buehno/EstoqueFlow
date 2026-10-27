import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { forbidden, passwordChangeRequired, unauthorized } from './errors.js';
import { prisma } from './prisma.js';
import { capacidadesEfetivas, ROTULO_CAPACIDADE, type Capacidade, type Role } from './permissoes.js';

export type { Role, Capacidade };

export interface AuthUser {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword?: boolean;
  /** Capacidades efetivas (papel + liga/desliga por pessoa) — preenchidas a cada requisição. */
  caps?: Set<Capacidade>;
}

/**
 * Enquanto `mustChangePassword` estiver pendente, só estas rotas respondem —
 * tudo mais retorna 403/SENHA_PROVISORIA para o front forçar a troca antes
 * de deixar a pessoa usar o sistema (correção da falha de senha inicial
 * nunca trocada, achada em produção em 18/09).
 */
const ROTAS_LIBERADAS_COM_SENHA_PROVISORIA = new Set(['/api/auth/me', '/api/auth/me/password']);

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const signToken = (u: AuthUser) =>
  jwt.sign(u, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES as never });

export function verifyToken(token: string): AuthUser {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AuthUser;
  } catch {
    throw unauthorized('Sessão expirada. Faça login novamente.');
  }
}

/** preHandler: exige token válido */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.cookies?.ef_token as string);
  if (!token) throw unauthorized();
  req.user = verifyToken(token);

  // Papel e permissões são lidos do banco a cada requisição (não do token):
  // assim uma mudança feita na tela de Equipe vale na hora, e uma pessoa
  // desativada perde o acesso mesmo com token ainda válido.
  const atual = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { role: true, permissionOverrides: true, active: true, companyId: true },
  });
  if (!atual || !atual.active || atual.companyId !== req.user.companyId) {
    throw unauthorized('Sessão inválida. Faça login novamente.');
  }
  req.user.role = atual.role as Role;
  req.user.caps = capacidadesEfetivas(req.user.role, atual.permissionOverrides);

  const caminho = req.url.split('?')[0];
  if (req.user.mustChangePassword && !ROTAS_LIBERADAS_COM_SENHA_PROVISORIA.has(caminho)) {
    throw passwordChangeRequired();
  }
}

/** preHandler factory: exige um dos papéis informados */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) {
      throw forbidden(`Ação restrita a: ${roles.join(', ')}`);
    }
  };
}

/** `true` quando a pessoa tem ao menos uma das capacidades. */
export function temCap(user: AuthUser | undefined, ...caps: Capacidade[]): boolean {
  if (!user?.caps) return false;
  return caps.some((c) => user.caps!.has(c));
}

/**
 * preHandler factory: exige ao menos UMA das capacidades. É o guarda usado
 * nas rotas desde 27/10 — o papel só define o padrão, o que vale é a
 * capacidade efetiva da pessoa.
 */
export function requireCap(...caps: Capacidade[]) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (!temCap(req.user, ...caps)) {
      throw forbidden(`Você não tem permissão para: ${caps.map((c) => ROTULO_CAPACIDADE[c].titulo).join(' / ')}.`);
    }
  };
}

/** Papéis com acesso total — mantidos para as poucas rotas que são da conta, não da operação. */
export const CAN_MANAGE: Role[] = ['OWNER', 'GESTOR', 'ADMIN'];
