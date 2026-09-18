import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash e verificação de senha (scrypt — já usado no rascunho de
 * equipe.routes.ts; extraído pra cá pra ser compartilhado com o login e
 * testado isoladamente). Formato salvo: "<salt hex>:<hash hex>".
 */

export function hashSenha(senha: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(senha, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verificarSenha(senha: string, hashSalvo: string): boolean {
  const [salt, hashEsperado] = hashSalvo.split(":");
  if (!salt || !hashEsperado) return false;
  const hashCalculado = scryptSync(senha, salt, 64);
  const bufferEsperado = Buffer.from(hashEsperado, "hex");
  if (bufferEsperado.length !== hashCalculado.length) return false;
  return timingSafeEqual(hashCalculado, bufferEsperado);
}

/** Senha provisória de 8 caracteres, fácil de ditar por telefone/WhatsApp. */
export function gerarSenhaProvisoria(): string {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

/**
 * Regra mínima pra troca de senha (primeiro login ou autoatendimento):
 * pelo menos 8 caracteres. Mantido simples de propósito — a prioridade é
 * existir o fluxo de troca (hoje não existe nenhum), não uma política
 * elaborada.
 */
export function senhaValida(senha: string): boolean {
  return typeof senha === "string" && senha.length >= 8;
}
