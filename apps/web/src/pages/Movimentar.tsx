import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeftRight, ArrowUpRight, Check, PackageMinus, PackagePlus, SlidersHorizontal } from 'lucide-react';
import { api, ApiError, type Warehouse } from '../lib/api';
import { Badge, brl, Card, Field, Input, qty, Select, Spinner, useToast } from '../lib/ui';
import ProductSearch, { type ProdutoBusca } from '../components/ProductSearch';

type Tipo = 'entrada' | 'saida' | 'transferencia' | 'ajuste';

const META: Record<Tipo, { title: string; desc: string; icon: typeof PackagePlus; cta: string; tone: string }> = {
  entrada: {
    title: 'Entrada de mercadoria',
    desc: 'Compra, devolução de cliente ou produção. O custo médio do depósito é recalculado automaticamente.',
    icon: PackagePlus, cta: 'Confirmar entrada', tone: 'text-ok',
  },
  saida: {
    title: 'Saída de mercadoria',
    desc: 'Consumo, perda ou devolução ao fornecedor. O sistema bloqueia saldo negativo.',
    icon: PackageMinus, cta: 'Confirmar saída', tone: 'text-danger',
  },
  transferencia: {
    title: 'Transferência entre depósitos',
    desc: 'Baixa na origem e entrada no destino na mesma transação — ou as duas acontecem, ou nenhuma.',
    icon: ArrowLeftRight, cta: 'Confirmar transferência', tone: 'text-info',
  },
  ajuste: {
    title: 'Ajuste de saldo',
    desc: 'Informe o saldo real contado. O sistema gera o movimento de acerto rastreável.',
    icon: SlidersHorizontal, cta: 'Aplicar ajuste', tone: 'text-warn',
  },
};

export default function Movimentar() {
  const { tipo = 'entrada' } = useParams<{ tipo: Tipo }>();
  const t = (['entrada', 'saida', 'transferencia', 'ajuste'].includes(tipo) ? tipo : 'entrada') as Tipo;
  const meta = META[t];
  const Icon = meta.icon;

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [product, setProduct] = useState<ProdutoBusca | null>(null);
  const [busy, setBusy] = useState(false);
  const [ultimos, setUltimos] = useState<{ id: string; label: string; sub: string }[]>([]);
  const toast = useToast();

  useEffect(() => {
    api.get<Warehouse[]>('/warehouses').then((w) => setWarehouses(w.filter((x) => x.active)));
  }, []);

  useEffect(() => {
    setProduct(null);
  }, [t]);

  const padrao = useMemo(() => warehouses.find((w) => w.isDefault) ?? warehouses[0], [warehouses]);

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!product) return toast({ kind: 'err', title: 'Selecione um produto antes de continuar.' });
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    try {
      const path = `/movements/${t}`;
      const body: Record<string, unknown> = { productId: product.id, reason: f.reason, document: f.document, notes: f.notes };
      if (t === 'transferencia') {
        body.fromWarehouseId = f.fromWarehouseId;
        body.toWarehouseId = f.toWarehouseId;
        body.quantity = Number(f.quantity);
      } else if (t === 'ajuste') {
        body.warehouseId = f.warehouseId;
        body.newQuantity = Number(f.newQuantity);
      } else {
        body.warehouseId = f.warehouseId;
        body.quantity = Number(f.quantity);
        if (t === 'entrada' && f.unitCost) body.unitCost = Number(f.unitCost);
      }
      const res = await api.post<{ number?: number }>(path, body);
      toast({
        kind: 'ok',
        title: `${meta.title} registrada`,
        body: res.number ? `Movimento #${res.number} · ${product.name}` : product.name,
      });
      setUltimos((u) => [{ id: String(Math.random()), label: product.name, sub: `${f.quantity ?? f.newQuantity} ${product.unit}` }, ...u].slice(0, 5));
      const atualizado = await api.get<{ items: ProdutoBusca[] }>(
        `/products/search?q=${encodeURIComponent(product.sku)}&take=1`,
      );
      if (atualizado.items[0]) setProduct(atualizado.items[0]);
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      toast({ kind: 'err', title: 'Movimento recusado', body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  if (!warehouses.length) return <Spinner label="Carregando depósitos…" />;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3.5">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-line bg-surface ${meta.tone}`}>
          <Icon size={22} />
        </span>
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{meta.title}</h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">{meta.desc}</p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card id={`form-${t}`}>
          <div className="space-y-5">
            <div>
              <span className="label">1 · Encontre o produto</span>
              <ProductSearch onSelect={setProduct} limparAoEscolher={false} />
            </div>

            {product && (
              <div className="animate-fade-up rounded-xl border border-brand/35 bg-brand/8 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold">{product.name}</p>
                    <p className="text-[11.5px] text-faint">
                      {[product.size && `Tamanho ${product.size}`, product.medidaFormatada, `cód. interno ${product.sku}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Badge tone="brand">{product.unit}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(product.stockByWarehouse ?? []).map((s) => (
                    <span key={s.warehouseId} className="chip bg-surface text-muted">
                      {s.warehouse}: <b className="tnum text-ink">{qty(s.quantity)}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={enviar} className="space-y-4 border-t border-line pt-5">
              <span className="label">2 · Preencha o movimento</span>

              {t === 'transferencia' ? (
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <Field label="Depósito de origem" required>
                    <Select name="fromWarehouseId" required defaultValue={padrao?.id}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  </Field>
                  <span className="hidden pb-3 text-faint sm:block" aria-hidden><ArrowUpRight size={20} className="rotate-45" /></span>
                  <Field label="Depósito de destino" required>
                    <Select name="toWarehouseId" required defaultValue={warehouses[1]?.id ?? warehouses[0]?.id}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  </Field>
                </div>
              ) : (
                <Field label="Depósito" required>
                  <Select name="warehouseId" required defaultValue={padrao?.id}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {t === 'ajuste' ? (
                  <Field label="Saldo real contado" required hint="O sistema calcula a diferença sozinho">
                    <Input name="newQuantity" type="number" step="0.001" min="0" required autoComplete="off" />
                  </Field>
                ) : (
                  <Field label="Quantidade" required>
                    <Input name="quantity" type="number" step="0.001" min="0.001" required autoComplete="off" />
                  </Field>
                )}
                {t === 'entrada' && (
                  <Field label="Custo unitário (R$)" hint={product ? `Custo cadastrado: ${brl(product.costPrice)}` : undefined}>
                    <Input name="unitCost" type="number" step="0.0001" min="0" defaultValue={product?.costPrice} />
                  </Field>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Motivo / natureza"><Input name="reason" placeholder={t === 'saida' ? 'Consumo interno, perda, devolução…' : 'Compra, produção, acerto…'} /></Field>
                <Field label="Documento" hint="NF, pedido, OS"><Input name="document" placeholder="NF 12345" /></Field>
              </div>

              <Field label="Observações"><Input name="notes" placeholder="Opcional" /></Field>

              <button type="submit" disabled={busy || !product} className="btn-primary w-full gap-2">
                {busy ? 'Registrando…' : <><Check size={17} /> {meta.cta}</>}
              </button>
            </form>
          </div>
        </Card>

        <aside className="space-y-4">
          <Card title="Como funciona">
            <ul className="space-y-3 text-[13.5px] leading-relaxed text-muted">
              {t === 'transferencia' ? (
                <>
                  <li>• A baixa na origem e a entrada no destino ocorrem numa transação única.</li>
                  <li>• O custo médio da origem viaja com a mercadoria, sem distorcer o CMV do destino.</li>
                  <li>• Se faltar saldo na origem, nada é gravado.</li>
                </>
              ) : t === 'entrada' ? (
                <>
                  <li>• O custo médio ponderado do depósito é recalculado a cada entrada.</li>
                  <li>• O movimento fica registrado com usuário, data e documento.</li>
                  <li>• A planilha espelho é atualizada em seguida, automaticamente.</li>
                </>
              ) : t === 'saida' ? (
                <>
                  <li>• Saldo negativo é bloqueado: o sistema avisa antes de gravar.</li>
                  <li>• Informe sempre o motivo — é o que dá sentido ao relatório de perdas.</li>
                  <li>• Para venda de balcão use o PDV, não a saída manual.</li>
                </>
              ) : (
                <>
                  <li>• Use o ajuste apenas para acertos pontuais.</li>
                  <li>• Para contagem completa, prefira o módulo de Inventário.</li>
                  <li>• Todo ajuste vira um movimento rastreável no histórico.</li>
                </>
              )}
            </ul>
          </Card>

          {ultimos.length > 0 && (
            <Card title="Registrados agora">
              <ul className="space-y-2">
                {ultimos.map((u) => (
                  <li key={u.id} className="flex items-center gap-2.5 rounded-lg bg-raised px-3 py-2.5">
                    <Check size={15} className="shrink-0 text-ok" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{u.label}</span>
                    <span className="text-[12.5px] text-faint tnum">{u.sub}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
