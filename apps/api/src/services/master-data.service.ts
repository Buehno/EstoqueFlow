/**
 * ID único / master data — pedido de 18/09 (§6 do plano), formato decidido
 * em 27/10: PREFIXO DA CATEGORIA (3 letras) + sequencial por categoria,
 * ex.: TUB-00012, BOM-00007. O código anterior (JQ-xxxxx, P-xxxxx, código
 * da tabela do fornecedor) fica guardado em `legacySku` e continua achável.
 */
import { Prisma } from '@prisma/client';
import { prisma, nextNumber } from '../lib/prisma.js';

type Tx = Prisma.TransactionClient;

export const FORMATO_ID_UNICO = /^[A-Z]{3}-\d{5}$/;
const PREFIXO_SEM_CATEGORIA = 'GER';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Candidatos de prefixo a partir do nome, do mais natural ao mais forçado. */
export function candidatosDePrefixo(nome: string): string[] {
  const palavras = semAcento(nome).toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !['DE', 'DA', 'DO', 'E', 'PARA', 'A', 'O', 'EM'].includes(w));
  const letras = palavras.join('');
  const out = new Set<string>();
  if (palavras[0]?.length >= 3) out.add(palavras[0].slice(0, 3));
  if (palavras[0] && palavras[1]) out.add((palavras[0].slice(0, 2) + palavras[1][0]).padEnd(3, 'X'));
  const consoantes = (palavras[0] ?? letras).replace(/[AEIOU]/g, '');
  if (consoantes.length >= 3) out.add(consoantes.slice(0, 3));
  if (palavras[0] && palavras[1] && palavras[2]) out.add(palavras[0][0] + palavras[1][0] + palavras[2][0]);
  if (letras.length >= 3) out.add(letras.slice(0, 3));
  for (let i = 0; i < 10; i++) if (palavras[0]?.length >= 2) out.add(palavras[0].slice(0, 2) + String(i));
  return [...out].filter((p) => /^[A-Z0-9]{3}$/.test(p)).map((p) => p.replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[Number(d)]));
}

/** Garante (e persiste) o prefixo da categoria, único na empresa. */
export async function prefixoDaCategoria(tx: Tx, companyId: string, categoryId: string | null): Promise<string> {
  if (!categoryId) return PREFIXO_SEM_CATEGORIA;
  const cat = await tx.category.findUnique({ where: { id: categoryId } });
  if (!cat) return PREFIXO_SEM_CATEGORIA;
  if (cat.codePrefix) return cat.codePrefix;
  // A categoria "Geral" (criada de fábrica) divide o GER com "sem categoria".
  if (semAcento(cat.name).trim().toUpperCase() === 'GERAL') {
    await tx.category.update({ where: { id: cat.id }, data: { codePrefix: PREFIXO_SEM_CATEGORIA } });
    return PREFIXO_SEM_CATEGORIA;
  }
  const usados = new Set(
    (await tx.category.findMany({ where: { companyId, codePrefix: { not: null } }, select: { codePrefix: true } })).map((c) => c.codePrefix!),
  );
  usados.add(PREFIXO_SEM_CATEGORIA);
  const escolhido = candidatosDePrefixo(cat.name).find((c) => !usados.has(c)) ?? null;
  let prefixo = escolhido;
  if (!prefixo) {
    // último recurso: 2 letras + letra sequencial
    const base = (semAcento(cat.name).toUpperCase().replace(/[^A-Z]/g, '') + 'XX').slice(0, 2);
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (!usados.has(base + l)) { prefixo = base + l; break; } }
  }
  if (!prefixo) throw new Error('Não foi possível derivar um prefixo único para a categoria.');
  await tx.category.update({ where: { id: cat.id }, data: { codePrefix: prefixo } });
  return prefixo;
}

/** Próximo ID único da categoria: PREFIXO-00001, 00002… (contador por prefixo, atômico). */
export async function proximoIdUnico(tx: Tx, companyId: string, categoryId: string | null): Promise<string> {
  const prefixo = await prefixoDaCategoria(tx, companyId, categoryId);
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const n = await nextNumber(tx, companyId, `sku:${prefixo}`);
    const sku = `${prefixo}-${String(n).padStart(5, '0')}`;
    const existe = await tx.product.findFirst({ where: { companyId, sku }, select: { id: true } });
    if (!existe) return sku;
  }
  throw new Error(`Sequencial esgotado para o prefixo ${prefixo}.`);
}

/**
 * Gera o ID único para todos os produtos da empresa que ainda não têm um no
 * formato novo. O código anterior vai para `legacySku` e entra no texto de
 * busca. Idempotente: rodar de novo não troca quem já tem.
 */
export async function gerarIdsUnicos(companyId: string, montarSearchText: (p: { name?: string | null; description?: string | null; size?: string | null; unit?: string | null; sku?: string | null; barcode?: string | null }) => string) {
  const produtos = await prisma.product.findMany({
    where: { companyId },
    orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
  });
  let gerados = 0, mantidos = 0;
  const porPrefixo: Record<string, number> = {};
  for (const p of produtos) {
    if (FORMATO_ID_UNICO.test(p.sku)) { mantidos++; continue; }
    await prisma.$transaction(async (tx) => {
      const novo = await proximoIdUnico(tx, companyId, p.categoryId);
      await tx.product.update({
        where: { id: p.id },
        data: {
          sku: novo,
          legacySku: p.legacySku ?? p.sku,
          searchText: montarSearchText({ ...p, sku: `${novo} ${p.legacySku ?? p.sku}` }),
        },
      });
      const pref = novo.slice(0, 3);
      porPrefixo[pref] = (porPrefixo[pref] ?? 0) + 1;
    });
    gerados++;
  }
  const categorias = await prisma.category.findMany({ where: { companyId }, select: { name: true, codePrefix: true }, orderBy: { name: 'asc' } });
  return { gerados, mantidos, total: produtos.length, porPrefixo, categorias };
}
