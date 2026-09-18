import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token de sessão assinado (formato tipo JWT, mas sem dependência nova —
 * só `node:crypto`). `payload.exp` é epoch em segundos.
 *
 * Isso substitui a ausência total de login/sessão que existe hoje no
 * rebuild (era o bloqueio pra tudo mais rodar). Segredo vem de
 * `AUTH_SECRET`; sem ele configurado, cai num valor de desenvolvimento —
 * NUNCA use esse padrão em produção (ver `assinarToken`/checagem em
 * `app.ts`, que recusa subir sem `AUTH_SECRET` real fora de dev).
 */

export interface SessaoPayload {
  sub: string; // id do usuário
  companyId: string;
  role: string;
  exp: number; // epoch segundos
}

function base64url(entrada: Buffer | string): string {
  const buffer = typeof entrada === "string" ? Buffer.from(entrada) : entrada;
  return buffer.toString("base64url");
}

function assinar(dado: string, segredo: string): string {
  return base64url(createHmac("sha256", segredo).update(dado).digest());
}

export function gerarToken(payload: SessaoPayload, segredo: string): string {
  const corpo = base64url(JSON.stringify(payload));
  const assinatura = assinar(corpo, segredo);
  return `${corpo}.${assinatura}`;
}

export function verificarToken(token: string, segredo: string): SessaoPayload | null {
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;

  const assinaturaEsperada = assinar(corpo, segredo);
  const bufA = Buffer.from(assinatura);
  const bufB = Buffer.from(assinaturaEsperada);
  if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) return null;

  try {
    const payload = JSON.parse(Buffer.from(corpo, "base64url").toString()) as SessaoPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // expirado
    }
    if (!payload.sub || !payload.companyId || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

export function expiracaoEmHoras(horas: number): number {
  return Math.floor(Date.now() / 1000) + horas * 3600;
}
