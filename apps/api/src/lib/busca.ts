/**
 * Motor de busca/sugestão de produtos.
 *
 * Objetivo (pedido do Ronaldo, 18/09/2026): tirar a obrigatoriedade do
 * comando `/peça` na proposta. O vendedor só digita o nome do produto — a
 * sugestão aparece sozinha, palavra por palavra, enquanto ele digita.
 *
 * Regra:
 *  - Toda palavra "fechada" (o usuário já passou por ela, normalmente porque
 *    veio um espaço depois) precisa aparecer inteira na descrição do produto,
 *    em qualquer ordem, sem acento, ignorando plural simples e palavras de
 *    ligação (de/da/do/com/para...). Isso é a busca que já existia no
 *    catálogo (`entrega-v1.md`).
 *  - A ÚLTIMA palavra, se ainda estiver "aberta" (o usuário está no meio
 *    dela, sem espaço depois), casa por PREFIXO. É essa peça nova que permite
 *    sugerir em tempo real, sem precisar terminar de digitar a palavra nem
 *    disparar um comando.
 *
 * Exemplos do pedido original:
 *   "Piscina aque"   -> "Piscina" (palavra fechada) + "aque" (prefixo)
 *                       casa com "Aquecedor de Piscina ..."
 *   "Tigre tubo de"  -> "de" é ligação (ignorada); "Tigre" e "tubo" fecham
 *                       (o espaço final indica que "de" já terminou de ser
 *                       digitado) casam com "Tubo Tigre 25mm"
 */

export const LIGACOES = new Set([
  "de", "da", "do", "das", "dos", "e", "ou", "com", "sem", "para", "por",
  "em", "no", "na", "nos", "nas", "a", "o", "as", "os", "um", "uma",
]);

/** Remove acentuação e normaliza para minúsculas. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Singular ingênuo (plural com 's') — "abraçadeiras" casa com "abraçadeira". */
function raizPlural(palavra: string): string {
  if (palavra.length > 3 && palavra.endsWith("s")) return palavra.slice(0, -1);
  return palavra;
}

/** Quebra um texto em palavras normalizadas, sem pontuação, sem ligações. */
export function palavrasDoTexto(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9À-ÿ]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !LIGACOES.has(p));
}

export interface TermosDeBusca {
  /** Palavras que já foram digitadas por completo (têm espaço depois, ou vieram antes da última). */
  completas: string[];
  /** A última palavra, ainda em digitação — ou null se a query termina em espaço/está vazia. */
  prefixoAberto: string | null;
}

/**
 * Separa a query em palavras fechadas + um prefixo aberto.
 *
 * `query` é exatamente o que está no campo agora (pode ter espaço no fim).
 * Se termina em espaço (ou está vazia), não há prefixo em aberto — todas as
 * palavras já digitadas contam como fechadas.
 */
export function separarTermos(query: string): TermosDeBusca {
  const terminaEmEspaco = query.length === 0 || /\s$/.test(query);
  const brutas = normalizar(query)
    .split(/[^a-z0-9À-ÿ]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (terminaEmEspaco) {
    return {
      completas: brutas.filter((p) => !LIGACOES.has(p)),
      prefixoAberto: null,
    };
  }

  const ultima = brutas[brutas.length - 1] ?? null;
  const restante = brutas.slice(0, -1).filter((p) => !LIGACOES.has(p));

  // A última palavra só é "prefixo em aberto" se tiver pelo menos 2 letras —
  // 1 letra sozinha gera ruído demais (sugestão aparece cedo demais).
  if (ultima && !LIGACOES.has(ultima) && ultima.length >= 2) {
    return { completas: restante, prefixoAberto: ultima };
  }
  // última "palavra" é uma ligação (de/da/com...) ou muito curta: ela não
  // filtra nada sozinha — trata como se o usuário ainda não tivesse
  // começado a digitar a próxima palavra de verdade.
  return { completas: restante, prefixoAberto: null };
}

export interface ProdutoBuscavel {
  id: string;
  descricao: string;
  /** Campos extras que também entram na busca: tamanho, código interno, código de barras. */
  camposExtras?: (string | null | undefined)[];
}

function palavrasDoProduto(produto: ProdutoBuscavel): string[] {
  const textos = [produto.descricao, ...(produto.camposExtras ?? [])].filter(
    (t): t is string => !!t,
  );
  return textos.flatMap((t) => palavrasDoTexto(t));
}

/** Uma palavra fechada da busca "bate" numa palavra do produto (com raiz de plural). */
function bateCompleta(termoBusca: string, palavraProduto: string): boolean {
  return raizPlural(termoBusca) === raizPlural(palavraProduto) || termoBusca === palavraProduto;
}

/**
 * Verifica se um produto casa com a query digitada até agora.
 * Toda palavra fechada precisa achar uma palavra correspondente no produto
 * (em qualquer ordem); o prefixo aberto (se houver) precisa achar pelo menos
 * uma palavra do produto que comece com ele.
 */
export function produtoCasaComQuery(produto: ProdutoBuscavel, query: string): boolean {
  const { completas, prefixoAberto } = separarTermos(query);
  if (completas.length === 0 && !prefixoAberto) return false; // nada digitado ainda

  const palavras = palavrasDoProduto(produto);

  for (const termo of completas) {
    if (!palavras.some((p) => bateCompleta(termo, p))) return false;
  }

  if (prefixoAberto) {
    if (!palavras.some((p) => p.startsWith(prefixoAberto))) return false;
  }

  return true;
}

/** Ordena os resultados: produto cuja palavra bate o prefixo mais "de perto" (mais curta) vem primeiro. */
export function sugerirProdutos<T extends ProdutoBuscavel>(
  produtos: T[],
  query: string,
  limite = 8,
): T[] {
  const { prefixoAberto } = separarTermos(query);
  const encontrados = produtos.filter((p) => produtoCasaComQuery(p, query));

  if (!prefixoAberto) return encontrados.slice(0, limite);

  return encontrados
    .slice()
    .sort((a, b) => {
      const menorPalavra = (p: T) => {
        const palavras = palavrasDoProduto(p).filter((w) => w.startsWith(prefixoAberto));
        return Math.min(...palavras.map((w) => w.length), Infinity);
      };
      return menorPalavra(a) - menorPalavra(b);
    })
    .slice(0, limite);
}
