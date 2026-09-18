import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { GripVertical, Link2, PackageSearch, Search, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { brl, cx, qty } from '../lib/ui';
import type { ProdutoBusca } from './ProductSearch';

export interface ItemProposta {
  key: string;
  quantity: number;
  quantityText: string;
  description: string;
  unitPrice: number;
  total: number;
  productId?: string | null;
  produtoNome?: string | null;
  saldo?: number | null;
}

/** Reconhece "/peça ", "/peca ", "/item " ou "/produto " sendo digitado. */
const GATILHO = /(^|\s)\/(peç|pec|item|produto)a?\s*([^\n/]*)$/i;

/**
 * Linha de item da proposta.
 *
 * A descrição é um campo livre e longo — é ela que sai impressa. Para puxar
 * algo do estoque sem sair do teclado, digite "/peça " e o nome: a busca roda
 * enquanto você escreve e só oferece o que existe em estoque. Ao escolher, o
 * texto do produto entra na descrição e o item fica vinculado ao saldo.
 */
export default function ItemEditor({
  item, indice, onChange, onRemove, onSubir, onDescer, somenteLeitura,
}: {
  item: ItemProposta;
  indice: number;
  onChange: (i: ItemProposta) => void;
  onRemove: () => void;
  onSubir?: () => void;
  onDescer?: () => void;
  somenteLeitura?: boolean;
}) {
  const [sugestoes, setSugestoes] = useState<ProdutoBusca[]>([]);
  const [ativo, setAtivo] = useState(0);
  const [termo, setTermo] = useState<string | null>(null);
  // Busca manual — pedido de 18/09: "/peça" continua funcionando (quem já
  // pegou o jeito não precisa mudar nada), mas ninguém é obrigado a lembrar
  // do comando. O botão de lupa abre a mesma busca/lista de sugestões sem
  // exigir nenhuma sintaxe especial.
  const [buscaManualAberta, setBuscaManualAberta] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // altura acompanha o conteúdo — a descrição costuma ter vários parágrafos
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(64, el.scrollHeight)}px`;
  }, [item.description]);

  useEffect(() => {
    if (termo == null || termo.trim().length < 2) { setSugestoes([]); return; }
    const t = setTimeout(() => {
      api
        .get<{ items: ProdutoBusca[] }>(`/products/search?q=${encodeURIComponent(termo)}&comSaldo=true&take=8`)
        .then((r) => { setSugestoes(r.items); setAtivo(0); })
        .catch(() => setSugestoes([]));
    }, 200);
    return () => clearTimeout(t);
  }, [termo]);

  function aoDigitar(texto: string) {
    onChange({ ...item, description: texto });
    const caret = areaRef.current?.selectionStart ?? texto.length;
    const antes = texto.slice(0, caret);
    const m = antes.match(GATILHO);
    setTermo(m ? m[3] : null);
  }

  function escolher(p: ProdutoBusca) {
    const texto = item.description;
    const caret = areaRef.current?.selectionStart ?? texto.length;
    const antes = texto.slice(0, caret);
    const depois = texto.slice(caret);
    const m = antes.match(GATILHO);

    const rotulo = [p.name, p.size, p.medidaFormatada].filter(Boolean).join(' · ');
    const novoAntes = m ? antes.slice(0, antes.length - m[0].length) + (m[1] ?? '') + rotulo : `${antes}${rotulo}`;

    onChange({
      ...item,
      description: novoAntes + depois,
      productId: p.id,
      produtoNome: p.name,
      saldo: p.totalStock,
      unitPrice: item.unitPrice || p.salePrice,
      total: item.total || p.salePrice * (item.quantity || 1),
    });
    setTermo(null);
    setSugestoes([]);
    setBuscaManualAberta(false);
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      const pos = novoAntes.length;
      areaRef.current?.setSelectionRange(pos, pos);
    });
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    if (!sugestoes.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => (i + 1) % sugestoes.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => (i - 1 + sugestoes.length) % sugestoes.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); escolher(sugestoes[ativo]); }
    else if (e.key === 'Escape') { setTermo(null); setSugestoes([]); setBuscaManualAberta(false); }
  }

  const semSaldo = item.productId != null && (item.saldo ?? 0) < item.quantity;

  return (
    <div className={cx(
      'rounded-xl border bg-surface p-3 transition-colors',
      semSaldo ? 'border-danger/50' : 'border-line',
    )}>
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-2">
          <span className="text-[11px] font-semibold text-faint tnum">{indice + 1}</span>
          {!somenteLeitura && (
            <div className="flex flex-col text-faint">
              <button type="button" onClick={onSubir} disabled={!onSubir} className="rounded p-0.5 hover:text-ink disabled:opacity-25" aria-label="Mover para cima">▲</button>
              <button type="button" onClick={onDescer} disabled={!onDescer} className="rounded p-0.5 hover:text-ink disabled:opacity-25" aria-label="Mover para baixo">▼</button>
            </div>
          )}
        </div>

        <label className="w-[74px] shrink-0">
          <span className="mb-1 block text-[11px] font-medium text-faint">QTD</span>
          <input
            value={item.quantityText}
            disabled={somenteLeitura}
            onChange={(e) => {
              const texto = e.target.value;
              const numero = Number(texto.replace(',', '.'));
              onChange({
                ...item,
                quantityText: texto,
                quantity: Number.isFinite(numero) && numero > 0 ? numero : item.quantity,
              });
            }}
            className="field field-sm w-full text-center"
            aria-label={`Quantidade do item ${indice + 1}`}
            placeholder="01"
          />
        </label>

        <div className="relative min-w-0 flex-1">
          <span className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-faint">
            <span>
              DESCRIÇÃO DE PRODUTOS
              {!somenteLeitura && (
                <span className="ml-2 font-normal normal-case text-faint">
                  — digite <code className="rounded bg-line/70 px-1 font-mono text-brand">/peça</code> ou use a busca
                </span>
              )}
            </span>
            {!somenteLeitura && (
              <button
                type="button"
                onClick={() => {
                  const abrindo = !buscaManualAberta;
                  setBuscaManualAberta(abrindo);
                  if (!abrindo) { setTermo(null); setSugestoes([]); }
                }}
                className={cx(
                  'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-normal normal-case transition-colors',
                  buscaManualAberta ? 'bg-brand/12 text-brand' : 'text-faint hover:text-ink',
                )}
                aria-label="Buscar produto no estoque"
              >
                <Search size={12} /> buscar no estoque
              </button>
            )}
          </span>

          {buscaManualAberta && !somenteLeitura && (
            <input
              autoFocus
              value={termo ?? ''}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={teclas}
              placeholder="Digite o nome do produto…"
              className="field field-sm mb-1.5 w-full"
              aria-label="Buscar produto no estoque"
            />
          )}

          <textarea
            ref={areaRef}
            value={item.description}
            disabled={somenteLeitura}
            onChange={(e) => aoDigitar(e.target.value)}
            onKeyDown={teclas}
            rows={3}
            className="field h-auto min-h-[64px] w-full resize-none py-2.5 text-[14px] leading-relaxed"
            placeholder={'Descreva o item como sai no papel.\nEx.: /peça tubo 20 marrom'}
            aria-label={`Descrição do item ${indice + 1}`}
          />

          {sugestoes.length > 0 && (
            <div className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-raised p-1 shadow-pop">
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
                Estoque disponível · ↑↓ para escolher, Enter para inserir
              </p>
              <ul role="listbox">
                {sugestoes.map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === ativo}>
                    <button
                      type="button"
                      onMouseEnter={() => setAtivo(i)}
                      onClick={() => escolher(p)}
                      className={cx(
                        'flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                        i === ativo ? 'bg-brand/12' : 'hover:bg-line/50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                        <span className="block text-[11px] text-faint">
                          {[p.size, p.medidaFormatada, p.unit].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-semibold tnum text-ok">{qty(p.totalStock)}</span>
                        {p.salePrice > 0 && <span className="block text-[11px] text-faint tnum">{brl(p.salePrice)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.productId && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className={cx('chip', semSaldo ? 'bg-danger/15 text-danger' : 'bg-ok/15 text-ok')}>
                {semSaldo ? <TriangleAlert size={11} /> : <Link2 size={11} />}
                {item.produtoNome ?? 'item do estoque'}
              </span>
              <span className="text-faint">saldo {qty(item.saldo ?? 0)}</span>
              {!somenteLeitura && (
                <button
                  type="button"
                  onClick={() => onChange({ ...item, productId: null, produtoNome: null, saldo: null })}
                  className="text-faint underline-offset-2 hover:text-ink hover:underline"
                >
                  desvincular
                </button>
              )}
            </p>
          )}
        </div>

        <label className="w-[132px] shrink-0">
          <span className="mb-1 block text-[11px] font-medium text-faint">TOTAL (R$)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            disabled={somenteLeitura}
            value={item.total}
            onChange={(e) => {
              const total = Number(e.target.value) || 0;
              onChange({ ...item, total, unitPrice: item.quantity > 0 ? total / item.quantity : total });
            }}
            className="field field-sm w-full text-right tnum"
            aria-label={`Total do item ${indice + 1}`}
          />
        </label>

        {!somenteLeitura && (
          <button
            type="button"
            onClick={onRemove}
            className="mt-6 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:text-danger"
            aria-label={`Remover item ${indice + 1}`}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {semSaldo && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] font-medium text-danger">
          <PackageSearch size={14} />
          Saldo insuficiente: {qty(item.saldo ?? 0)} disponível para {qty(item.quantity)} solicitado. A proposta não pode ser enviada assim.
        </p>
      )}
    </div>
  );
}
