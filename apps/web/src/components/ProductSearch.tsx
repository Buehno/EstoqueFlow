import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, PackageSearch, Search } from 'lucide-react';
import { api } from '../lib/api';
import { cx, qty, brl } from '../lib/ui';

export interface ProdutoBusca {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unit: string;
  size: string | null;
  measure: number | null;
  measureUnit: string | null;
  medidaFormatada: string | null;
  category: string | null;
  costPrice: number;
  salePrice: number;
  minStock: number;
  exato: boolean;
  totalStock: number;
  saldoNoDeposito: number | null;
  stockByWarehouse: { warehouseId: string; warehouse: string; code: string; quantity: number }[];
}

/**
 * Campo de busca do balcão.
 *
 * O estoque desta operação NÃO tem etiqueta e NÃO é identificado por SKU: o
 * operador digita uma palavra do produto ("tubo 20 marrom") e escolhe na lista.
 * Quem tiver leitor de código de barras continua podendo bipar — a leitura cai
 * no mesmo campo e, quando bate exatamente, o item é selecionado direto.
 */
export default function ProductSearch({
  onSelect,
  warehouseId,
  autoFocus = true,
  placeholder = 'Digite uma palavra do produto — ex.: tubo 20 marrom',
  id,
  limparAoEscolher = true,
}: {
  onSelect: (p: ProdutoBusca) => void;
  warehouseId?: string;
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
  limparAoEscolher?: boolean;
}) {
  const [termo, setTermo] = useState('');
  const [itens, setItens] = useState<ProdutoBusca[]>([]);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) {
      setItens([]);
      setAberto(false);
      return;
    }
    setCarregando(true);
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ q: t, take: '12' });
      if (warehouseId) qs.set('warehouseId', warehouseId);
      api
        .get<{ items: ProdutoBusca[] }>(`/products/search?${qs}`)
        .then((r) => {
          setItens(r.items);
          setAtivo(0);
          setAberto(true);
          // leitura de código de barras: bateu exato e é o único → seleciona sozinho
          if (r.items.length === 1 && r.items[0].exato) escolher(r.items[0]);
        })
        .catch(() => setItens([]))
        .finally(() => setCarregando(false));
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo, warehouseId]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  function escolher(p: ProdutoBusca) {
    onSelect(p);
    setAberto(false);
    if (limparAoEscolher) {
      setTermo('');
      setItens([]);
      inputRef.current?.focus();
    }
  }

  function teclas(e: KeyboardEvent<HTMLInputElement>) {
    if (!aberto || !itens.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((i) => (i + 1) % itens.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((i) => (i - 1 + itens.length) % itens.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      escolher(itens[ativo]);
    } else if (e.key === 'Escape') {
      setAberto(false);
    }
  }

  return (
    <div className="relative" ref={boxRef} id={id}>
      <Search className="pointer-events-none absolute left-3.5 top-[22px] -translate-y-1/2 text-brand" size={19} aria-hidden />
      <input
        ref={inputRef}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        onKeyDown={teclas}
        onFocus={() => itens.length && setAberto(true)}
        placeholder={placeholder}
        aria-label="Buscar produto por palavra"
        aria-autocomplete="list"
        aria-expanded={aberto}
        role="combobox"
        autoComplete="off"
        className="field h-11 pl-11 pr-10 text-[15px]"
      />
      {carregando && (
        <Loader2 className="absolute right-3.5 top-[22px] -translate-y-1/2 animate-spin text-faint" size={17} aria-hidden />
      )}

      <p className="mt-1.5 text-[12px] text-faint">
        Busque por qualquer palavra da descrição — o estoque não usa etiqueta nem código.
        Se você tiver leitor, pode bipar aqui mesmo.
      </p>

      {aberto && (
        <div className="absolute z-30 mt-1 max-h-[380px] w-full overflow-auto rounded-xl border border-line bg-raised p-1 shadow-pop">
          {itens.length === 0 ? (
            <div className="flex items-center gap-2.5 px-3 py-4 text-[13.5px] text-muted">
              <PackageSearch size={17} className="text-faint" aria-hidden />
              Nenhum produto com “{termo}”. Tente outra palavra.
            </div>
          ) : (
            <ul role="listbox">
              {itens.map((p, i) => {
                const saldo = p.saldoNoDeposito ?? p.totalStock;
                return (
                  <li key={p.id} role="option" aria-selected={i === ativo}>
                    <button
                      type="button"
                      onMouseEnter={() => setAtivo(i)}
                      onClick={() => escolher(p)}
                      className={cx(
                        'flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                        i === ativo ? 'bg-brand/12' : 'hover:bg-line/50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-ink">{p.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint">
                          {p.size && <span className="rounded bg-line/70 px-1.5 py-0.5 font-medium text-muted">{p.size}</span>}
                          {p.medidaFormatada && <span className="rounded bg-line/70 px-1.5 py-0.5 font-medium text-muted">{p.medidaFormatada}</span>}
                          <span>{p.unit}</span>
                          {p.category && <span>· {p.category}</span>}
                        </span>
                        <span className="mt-1 block text-[11.5px] text-faint">
                          {p.stockByWarehouse.map((s) => `${s.code}: ${qty(s.quantity)}`).join('  ·  ') || 'sem saldo'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cx('block text-[15px] font-semibold tnum', saldo <= 0 ? 'text-danger' : 'text-ink')}>
                          {qty(saldo)}
                        </span>
                        {p.salePrice > 0 && <span className="block text-[11.5px] text-faint tnum">{brl(p.salePrice)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
