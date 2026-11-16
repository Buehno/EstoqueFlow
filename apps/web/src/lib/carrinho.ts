/**
 * Carrinho de compra do comprador (16/11/2026) — o que ele está juntando
 * ANTES de salvar como lista. Vive no navegador de quem monta (sobrevive a
 * trocar de tela ou recarregar) e é esvaziado quando a lista é salva.
 */
import { useSyncExternalStore } from 'react';

export interface ItemCarrinho {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  fornecedor: string | null;
  quantidade: number;
  custo: number;
  /** Contexto de onde veio: saldo e sugerido quando entrou. */
  saldo: number | null;
  sugerido: number | null;
}

const CHAVE = 'ef.carrinho-compra';
let itens: ItemCarrinho[] = ler();
const ouvintes = new Set<() => void>();

function ler(): ItemCarrinho[] {
  try {
    const raw = localStorage.getItem(CHAVE);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function gravar(novos: ItemCarrinho[]) {
  itens = novos;
  try { localStorage.setItem(CHAVE, JSON.stringify(novos)); } catch { /* sem storage: fica só em memória */ }
  ouvintes.forEach((f) => f());
}

export const carrinho = {
  itens: () => itens,
  /** Produto que já está soma a quantidade. */
  adicionar(novo: Omit<ItemCarrinho, 'quantidade'> & { quantidade?: number }) {
    const q = Math.max(0.001, novo.quantidade ?? 1);
    const ja = itens.find((i) => i.productId === novo.productId);
    if (ja) gravar(itens.map((i) => (i.productId === novo.productId ? { ...i, quantidade: Number((i.quantidade + q).toFixed(3)) } : i)));
    else gravar([...itens, { ...novo, quantidade: q }]);
  },
  adicionarVarios(lista: (Omit<ItemCarrinho, 'quantidade'> & { quantidade?: number })[]) {
    let novos = [...itens];
    for (const n of lista) {
      const q = Math.max(0.001, n.quantidade ?? 1);
      const idx = novos.findIndex((i) => i.productId === n.productId);
      if (idx >= 0) novos[idx] = { ...novos[idx], quantidade: Number((novos[idx].quantidade + q).toFixed(3)) };
      else novos = [...novos, { ...n, quantidade: q }];
    }
    gravar(novos);
  },
  alterar(productId: string, dados: Partial<Pick<ItemCarrinho, 'quantidade' | 'custo'>>) {
    gravar(itens.map((i) => (i.productId === productId ? { ...i, ...dados } : i)));
  },
  remover(productId: string) { gravar(itens.filter((i) => i.productId !== productId)); },
  limpar() { gravar([]); },
  tem: (productId: string) => itens.some((i) => i.productId === productId),
};

export function useCarrinho() {
  return useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    () => itens,
    () => itens,
  );
}
