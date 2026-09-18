import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { forbidden, passwordChangeRequired, unauthorized } from './errors.js';

export type Role = 'OWNER' | 'ADMIN' | 'ESTOQUISTA' | 'VENDEDOR' | 'LEITURA';

export interface AuthUser {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword?: boolean;
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

/** Todos que podem escrever no estoque */
export const CAN_WRITE_STOCK: Role[] = ['OWNER', 'ADMIN', 'ESTOQUISTA'];
export const CAN_SELL: Role[] = ['OWNER', 'ADMIN', 'ESTOQUISTA', 'VENDEDOR'];
export const CAN_MANAGE: Role[] = ['OWNER', 'ADMIN'];
