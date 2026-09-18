import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { separarTermos, sugerirProdutos, type ProdutoBuscavel } from "../lib/busca.js";

/**
 * Sugestão de produto em tempo real para a proposta — substitui a
 * obrigatoriedade do comando `/peça`.
 *
 * O front chama isso a cada tecla (com debounce) passando o texto que o
 * vendedor já digitou na descrição do item. Só responde a partir de 2
 * caracteres úteis (ver `separarTermos`), pra não devolver o catálogo
 * inteiro a cada tecla.
 */
export async function catalogRoutes(app: FastifyInstance) {
  app.get("/products/suggest", async (req, reply) => {
    const querySchema = z.object({ q: z.string().default("") });
    const { q } = querySchema.parse(req.query);
    const companyId = (req as any).companyId as string; // vem do middleware de auth

    const { completas, prefixoAberto } = separarTermos(q);
    if (completas.length === 0 && !prefixoAberto) {
      return reply.send({ termosUsados: [], produtos: [] });
    }

    // Pré-filtro no banco: qualquer produto cujo search_text contenha pelo
    // menos a primeira palavra útil (rápido, usa índice). O filtro fino —
    // que decide de verdade o que aparece — é sempre o `sugerirProdutos` em
    // JS, pra nunca divergir do que o front mostra.
    const primeiraPalavra = completas[0] ?? prefixoAberto!;
    const candidatos = await app.prisma.product.findMany({
      where: {
        companyId,
        searchText: { contains: primeiraPalavra, mode: "insensitive" },
      },
      take: 200, // teto de segurança; o catálogo da Jundiaquece tem ~900 produtos
    });

    const buscaveis: (ProdutoBuscavel & { raw: (typeof candidatos)[number] })[] =
      candidatos.map((p) => ({
        id: p.id,
        descricao: p.description,
        camposExtras: [p.sku, p.size, p.unit],
        raw: p,
      }));

    const sugeridos = sugerirProdutos(buscaveis, q, 8);

    return reply.send({
      termosUsados: [...completas, ...(prefixoAberto ? [prefixoAberto] : [])],
      produtos: sugeridos.map((p) => ({
        id: p.raw.id,
        descricao: p.raw.description,
        sku: p.raw.sku,
        size: p.raw.size,
        unit: p.raw.unit,
      })),
    });
  });
}
