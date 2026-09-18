import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Minus, Plus, Receipt, ShoppingCart, Trash2 } from 'lucide-react';
import { api, ApiError, type Warehouse } from '../lib/api';
import { brl, Card, Empty, Field, Input, Modal, qty, Select, useToast } from '../lib/ui';
import ProductSearch, { type ProdutoBusca } from '../components/ProductSearch';

interface Item { product: ProdutoBusca; quantity: number; unitPrice: number }

const PAGAMENTOS = [
  { v: 'DINHEIRO', label: 'Dinheiro', icon: Banknote },
  { v: 'PIX', label: 'PIX', icon: Receipt },
  { v: 'DEBITO', label: 'Débito', icon: CreditCard },
  { v: 'CREDITO', label: 'Crédito', icon: CreditCard },
];

export default function PDV() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [desconto, setDesconto] = useState(0);
  const [pagamento, setPagamento] = useState('DINHEIRO');
  const [recebido, setRecebido] = useState('');
  const [cliente, setCliente] = useState('');
  const [busy, setBusy] = useState(false);
  const [cupom, setCupom] = useState<any>(null);
  const toast = useToast();

  useEffect(() => {
    api.get<Warehouse[]>('/warehouses').then((w) => {
      const ativos = w.filter((x) => x.active);
      setWarehouses(ativos);
      setWarehouseId((ativos.find((x) => x.isDefault) ?? ativos[0])?.id ?? '');
    });
  }, []);

  const subtotal = useMemo(() => itens.reduce((a, i) => a + i.quantity * i.unitPrice, 0), [itens]);
  const total = Math.max(0, subtotal - desconto);
  const troco = pagamento === 'DINHEIRO' && recebido ? Number(recebido) - total : null;

  /** Adiciona o produto escolhido na busca; se já estiver no carrinho, soma 1. */
  const add = (p: ProdutoBusca) => {
    setItens((prev) => {
      const i = prev.findIndex((x) => x.product.id === p.id);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], quantity: copy[i].quantity + 1 };
        return copy;
      }
      return [...prev, { product: p, quantity: 1, unitPrice: p.salePrice }];
    });
  };

  const setQty = (id: string, q: number) =>
    setItens((prev) => prev.map((i) => (i.product.id === id ? { ...i, quantity: Math.max(0.001, q) } : i)));
  const remove = (id: string) => setItens((prev) => prev.filter((i) => i.product.id !== id));

  const finalizar = async () => {
    if (!itens.length) return toast({ kind: 'err', title: 'Adicione ao menos um item.' });
    setBusy(true);
    try {
      const venda = await api.post<any>('/sales', {
        warehouseId,
        items: itens.map((i) => ({ productId: i.product.id, quantity: i.quantity, unitPrice: i.unitPrice })),
        discount: desconto || undefined,
        payment: pagamento,
        received: pagamento === 'DINHEIRO' && recebido ? Number(recebido) : undefined,
        customerName: cliente || undefined,
      });
      setCupom(venda);
      setItens([]);
      setDesconto(0);
      setRecebido('');
      setCliente('');
      toast({ kind: 'ok', title: `Venda #${venda.number} finalizada`, body: brl(venda.total) });
    } catch (e) {
      toast({ kind: 'err', title: 'Venda recusada', body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">PDV · Venda balcão</h1>
          <p className="mt-1 text-[14px] text-muted">Ache o produto pela descrição. A baixa no depósito é automática.</p>
        </div>
        <div className="w-full sm:w-64">
          <Field label="Depósito de saída">
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div id="pdv-scanner">
            <ProductSearch onSelect={add} warehouseId={warehouseId} />
          </div>

          <Card>
            {itens.length === 0 ? (
              <Empty icon={<ShoppingCart size={24} />} title="Carrinho vazio" body="Digite uma palavra do produto no campo acima e escolha na lista." />
            ) : (
              <ul className="divide-y divide-line">
                {itens.map((i) => (
                  <li key={i.product.id} className="flex flex-wrap items-center gap-3 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-medium">{i.product.name}</p>
                      <p className="text-[11.5px] text-faint">
                        {[i.product.size, i.product.medidaFormatada, i.product.unit].filter(Boolean).join(' · ')}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(i.product.id, i.quantity - 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:text-ink" aria-label="Diminuir quantidade">
                        <Minus size={15} />
                      </button>
                      <input
                        value={i.quantity}
                        onChange={(e) => setQty(i.product.id, Number(e.target.value) || 0)}
                        className="field field-sm w-16 text-center tnum"
                        aria-label={`Quantidade de ${i.product.name}`}
                      />
                      <button onClick={() => setQty(i.product.id, i.quantity + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition-colors hover:text-ink" aria-label="Aumentar quantidade">
                        <Plus size={15} />
                      </button>
                    </div>

                    <input
                      value={i.unitPrice}
                      onChange={(e) => setItens((p) => p.map((x) => x.product.id === i.product.id ? { ...x, unitPrice: Number(e.target.value) || 0 } : x))}
                      className="field field-sm w-24 text-right tnum"
                      aria-label={`Preço unitário de ${i.product.name}`}
                    />

                    <span className="w-24 text-right text-[15px] font-semibold tnum">{brl(i.quantity * i.unitPrice)}</span>

                    <button onClick={() => remove(i.product.id)} className="grid h-9 w-9 place-items-center rounded-lg text-faint transition-colors hover:text-danger" aria-label={`Remover ${i.product.name}`}>
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-[88px] lg:self-start">
          <Card title="Fechamento">
            <div className="space-y-4">
              <Field label="Cliente (opcional)"><Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Consumidor" /></Field>

              <div>
                <span className="label">Forma de pagamento</span>
                <div className="grid grid-cols-2 gap-2">
                  {PAGAMENTOS.map((p) => (
                    <button
                      key={p.v}
                      onClick={() => setPagamento(p.v)}
                      className={`btn btn-sm justify-start gap-2 border ${pagamento === p.v ? 'border-brand bg-brand/12 text-brand' : 'border-line bg-raised text-muted'}`}
                      aria-pressed={pagamento === p.v}
                    >
                      <p.icon size={15} /> {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Desconto (R$)">
                <Input type="number" min="0" step="0.01" value={desconto || ''} onChange={(e) => setDesconto(Number(e.target.value) || 0)} placeholder="0,00" />
              </Field>

              {pagamento === 'DINHEIRO' && (
                <Field label="Valor recebido (R$)" hint={troco != null && troco >= 0 ? `Troco: ${brl(troco)}` : undefined}>
                  <Input type="number" min="0" step="0.01" value={recebido} onChange={(e) => setRecebido(e.target.value)} placeholder="0,00" />
                </Field>
              )}

              <dl className="space-y-1.5 border-t border-line pt-4 text-[14px]">
                <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="tnum">{brl(subtotal)}</dd></div>
                {desconto > 0 && <div className="flex justify-between text-danger"><dt>Desconto</dt><dd className="tnum">− {brl(desconto)}</dd></div>}
                <div className="flex items-baseline justify-between pt-1"><dt className="text-[15px] font-semibold">Total</dt><dd className="text-[26px] font-bold tnum">{brl(total)}</dd></div>
              </dl>

              <button onClick={finalizar} disabled={busy || !itens.length} className="btn-primary w-full gap-2">
                <Receipt size={17} /> {busy ? 'Finalizando…' : 'Finalizar venda'}
              </button>
            </div>
          </Card>
        </aside>
      </div>

      <Modal open={!!cupom} onClose={() => setCupom(null)} title={`Cupom da venda #${cupom?.number ?? ''}`}>
        {cupom && (
          <div className="font-mono text-[13px]">
            <p className="text-center text-[15px] font-bold">EstoqueFlow</p>
            <p className="mt-0.5 text-center text-faint">{cupom.warehouse} · {cupom.vendedor}</p>
            <hr className="my-3 border-dashed border-line" />
            <ul className="space-y-1.5">
              {cupom.items.map((i: any, k: number) => (
                <li key={k} className="flex justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">{qty(i.quantity)}× {i.product}</span>
                  <span className="tnum">{brl(i.total)}</span>
                </li>
              ))}
            </ul>
            <hr className="my-3 border-dashed border-line" />
            <div className="flex justify-between"><span>Subtotal</span><span className="tnum">{brl(cupom.subtotal)}</span></div>
            {cupom.discount > 0 && <div className="flex justify-between"><span>Desconto</span><span className="tnum">− {brl(cupom.discount)}</span></div>}
            <div className="mt-1 flex justify-between text-[16px] font-bold"><span>TOTAL</span><span className="tnum">{brl(cupom.total)}</span></div>
            <div className="mt-1 flex justify-between text-faint"><span>{cupom.payment}</span>{cupom.change != null && <span>Troco {brl(cupom.change)}</span>}</div>
            <button onClick={() => window.print()} className="btn-ghost mt-5 w-full">Imprimir</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
