/**
 * Painel do carrinho de compra: os itens que o comprador juntou (do alerta
 * de compra ou da busca de produtos), com quantidade e custo editáveis, e o
 * botão que transforma tudo numa LISTA DE COMPRA salva.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBasket, Trash2 } from 'lucide-react';
import { api, ApiError, type ListaCompra } from '../lib/api';
import { carrinho, useCarrinho } from '../lib/carrinho';
import { brl, cx, Empty, useToast } from '../lib/ui';
import ProductSearch from './ProductSearch';

interface Fornecedor { id: string; name: string }

export default function CarrinhoCompra({ comBusca = false, aoSalvar }: {
  /** Mostra o campo de busca para incluir qualquer produto do catálogo. */
  comBusca?: boolean;
  aoSalvar?: (lista: ListaCompra) => void;
}) {
  const itens = useCarrinho();
  const [nome, setNome] = useState('');
  const [notas, setNotas] = useState('');
  /** Escolha manual do comprador; vazio = segue a sugestão (fornecedor único dos itens). */
  const [fornecedorManual, setFornecedorManual] = useState('');
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => { api.get<Fornecedor[]>('/suppliers').then(setFornecedores).catch(() => setFornecedores([])); }, []);

  const total = useMemo(() => itens.reduce((a, i) => a + i.quantidade * i.custo, 0), [itens]);
  /** Se todos os itens são do mesmo fornecedor, ele vira a sugestão da lista. */
  const fornecedorUnico = useMemo(() => {
    const nomes = new Set(itens.map((i) => i.fornecedor).filter(Boolean));
    return nomes.size === 1 ? [...nomes][0]! : null;
  }, [itens]);
  const fornecedorSugeridoId = fornecedorUnico ? fornecedores.find((x) => x.name === fornecedorUnico)?.id ?? '' : '';
  const fornecedorId = fornecedorManual || fornecedorSugeridoId;

  const salvar = async () => {
    if (!itens.length) return;
    setSalvando(true);
    try {
      const f = fornecedores.find((x) => x.id === fornecedorId);
      const lista = await api.post<ListaCompra>('/purchase-lists', {
        name: nome.trim() || undefined,
        supplierId: f?.id ?? null,
        supplierName: f ? undefined : fornecedorUnico,
        notes: notas.trim() || null,
        items: itens.map((i) => ({ productId: i.productId, quantity: i.quantidade, unitCost: i.custo })),
      });
      carrinho.limpar();
      setNome(''); setNotas(''); setFornecedorManual('');
      toast({ kind: 'ok', title: `Lista #${String(lista.number).padStart(4, '0')} salva`, body: `${lista.items.length} item(ns) · ${brl(lista.total)}` });
      if (aoSalvar) aoSalvar(lista); else nav(`/app/compras/${lista.id}`);
    } catch (e) {
      toast({ kind: 'err', title: 'Não foi possível salvar a lista', body: e instanceof ApiError ? e.message : undefined });
    } finally { setSalvando(false); }
  };

  return (
    <div className="space-y-4">
      {comBusca && (
        <ProductSearch
          autoFocus={false}
          placeholder="Incluir qualquer produto — digite uma palavra"
          onSelect={(p) => carrinho.adicionar({
            productId: p.id, sku: p.sku, name: p.name, unit: p.unit, fornecedor: p.supplier ?? null,
            custo: p.costPrice, saldo: p.totalStock, sugerido: p.minStock,
            quantidade: p.minStock > 0 && p.totalStock < p.minStock ? Number((p.minStock - p.totalStock).toFixed(3)) : 1,
          })}
        />
      )}

      {itens.length === 0 ? (
        <Empty icon={<ShoppingBasket size={22} />} title="Carrinho vazio" body={comBusca ? 'Busque um produto acima ou use "Adicionar" na lista de compra dos Relatórios.' : 'Use "Adicionar" em cada item da lista, ou "Adicionar todos" para a lista filtrada.'} />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {itens.map((i) => (
              <li key={i.productId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                <div className="min-w-0 flex-1 basis-[180px]">
                  <p className="truncate text-[13.5px] font-medium" title={i.name}>{i.name}</p>
                  <p className="truncate font-mono text-[11px] text-faint">{i.sku}{i.fornecedor ? ` · ${i.fornecedor}` : ''}{i.saldo != null && i.sugerido ? ` · ${i.saldo} de ${i.sugerido}` : ''}</p>
                </div>
                <label className="flex items-center gap-1 text-[12px] text-muted">
                  <span className="sr-only">Quantidade de {i.name}</span>
                  <input
                    type="number" min={0.001} step="any" value={i.quantidade}
                    onChange={(e) => carrinho.alterar(i.productId, { quantidade: Math.max(0.001, Number(e.target.value) || 0) })}
                    className="field field-sm w-[84px] text-right tnum" aria-label={`Quantidade de ${i.name}`}
                  />
                  <span>{i.unit}</span>
                </label>
                <label className="flex items-center gap-1 text-[12px] text-muted">
                  <span>×</span>
                  <input
                    type="number" min={0} step="0.01" value={i.custo}
                    onChange={(e) => carrinho.alterar(i.productId, { custo: Math.max(0, Number(e.target.value) || 0) })}
                    className="field field-sm w-[96px] text-right tnum" aria-label={`Custo unitário de ${i.name}`}
                  />
                </label>
                <span className="w-[96px] text-right text-[13px] font-medium tnum">{brl(i.quantidade * i.custo)}</span>
                <button type="button" onClick={() => carrinho.remover(i.productId)} className="-m-1.5 rounded-lg p-1.5 text-faint transition-colors hover:text-danger" aria-label={`Remover ${i.name} do carrinho`}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
          <p className="flex items-baseline justify-between border-t border-line pt-3 text-[13.5px]">
            <span className="text-muted">{itens.length} item(ns)</span>
            <span><span className="text-muted">total </span><b className="text-[16px] tnum">{brl(total)}</b></span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">Nome da lista</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} className="field" placeholder={`Compra ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${fornecedorUnico ? ` — ${fornecedorUnico}` : ''}`} maxLength={160} />
            </label>
            <label className="block">
              <span className="label">Fornecedor</span>
              <select value={fornecedorId} onChange={(e) => setFornecedorManual(e.target.value)} className="field">
                <option value="">{fornecedorUnico && !fornecedores.some((f) => f.name === fornecedorUnico) ? fornecedorUnico : 'Vários / não definido'}</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Observações</span>
              <input value={notas} onChange={(e) => setNotas(e.target.value)} className="field" placeholder="prazo, frete, condição…" maxLength={2000} />
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => carrinho.limpar()} className="btn-ghost">Esvaziar</button>
            <button type="button" onClick={salvar} disabled={salvando} className={cx('btn-primary', salvando && 'opacity-60')}>
              {salvando ? 'Salvando…' : 'Salvar lista de compra'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
