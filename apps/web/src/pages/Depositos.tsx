import { useEffect, useState } from 'react';
import { Plus, Search, SlidersHorizontal, Star, Warehouse } from 'lucide-react';
import { api, ApiError, type StockRow, type Warehouse as W } from '../lib/api';
import { Badge, brl, Card, Empty, Field, Input, int, Modal, qty, Spinner, Table, useToast } from '../lib/ui';

export default function Depositos() {
  const [items, setItems] = useState<W[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<W | null>(null);
  const [busca, setBusca] = useState('');
  // Ajuste manual de saldo direto na posição detalhada (pedido de 06/10):
  // a equipe precisa acertar o saldo de um item sem passar pela tela de
  // movimentação. Continua gerando um movimento de AJUSTE rastreável.
  const [ajustando, setAjustando] = useState<StockRow | null>(null);
  const [salvandoAjuste, setSalvandoAjuste] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    const [w, s] = await Promise.all([api.get<W[]>('/warehouses'), api.get<StockRow[]>('/stock?take=1000')]);
    setItems(w);
    setStock(s);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const salvar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const payload = { ...f, isDefault: f.isDefault === 'on' };
    try {
      if (editing) await api.patch(`/warehouses/${editing.id}`, payload);
      else await api.post('/warehouses', payload);
      toast({ kind: 'ok', title: editing ? 'Depósito atualizado' : 'Depósito criado' });
      setModal(false);
      setEditing(null);
      void load();
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível salvar', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  const aplicarAjuste = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ajustando) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setSalvandoAjuste(true);
    try {
      await api.post('/movements/ajuste', {
        productId: ajustando.productId,
        warehouseId: ajustando.warehouseId,
        newQuantity: Number(String(f.newQuantity).replace(',', '.')),
        ...(ajustando.embalagem && String(f.newRemnant ?? '').trim() !== ''
          ? { newRemnantMeters: Number(String(f.newRemnant).replace(',', '.')) }
          : {}),
        reason: f.reason?.trim() || 'Ajuste manual de saldo',
      });
      toast({ kind: 'ok', title: 'Saldo ajustado', body: `${ajustando.name} · ${ajustando.warehouseCode}` });
      setAjustando(null);
      void load();
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível ajustar', body: err instanceof ApiError ? err.message : undefined });
    } finally {
      setSalvandoAjuste(false);
    }
  };

  const resumo = (id: string) => {
    const rows = stock.filter((s) => s.warehouseId === id);
    return {
      skus: rows.filter((r) => r.quantity > 0).length,
      unidades: rows.reduce((a, r) => a + r.quantity, 0),
      valor: rows.reduce((a, r) => a + r.stockValue, 0),
      alertas: rows.filter((r) => r.belowMin).length,
    };
  };

  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? stock.filter((r) => `${r.name} ${r.sku} ${r.barcode ?? ''}`.toLowerCase().includes(termo))
    : stock.slice(0, 300);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Depósitos</h1>
          <p className="mt-1 text-[14px] text-muted">
            Todo saldo é sempre <b>produto × depósito</b>. É assim que a plataforma controla a
            movimentação entre as unidades.
          </p>
        </div>
        <button onClick={() => { setEditing(null); setModal(true); }} className="btn-primary btn-sm gap-2">
          <Plus size={16} /> Novo depósito
        </button>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" id="warehouses-table">
        {items.map((w) => {
          const r = resumo(w.id);
          return (
            <button key={w.id} onClick={() => { setEditing(w); setModal(true); }} className="card animate-fade-up p-5 text-left transition-colors hover:border-brand/50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/12 text-brand">
                    <Warehouse size={19} />
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold leading-tight">{w.name}</p>
                    <p className="font-mono text-[11.5px] text-faint">{w.code}</p>
                  </div>
                </div>
                {w.isDefault && <Badge tone="brand"><Star size={11} /> padrão</Badge>}
              </div>
              <p className="mt-4 text-[22px] font-bold tnum">{brl(r.valor)}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                <span>{int(r.skus)} SKUs</span>
                <span>{int(r.unidades)} unidades</span>
              </div>
              {r.alertas > 0 && <p className="mt-2.5 text-[13px] font-semibold text-danger">{r.alertas} item(ns) em alerta de compra</p>}
              {!w.active && <div className="mt-2"><Badge tone="warn">inativo</Badge></div>}
            </button>
          );
        })}
      </div>

      <Card
        title="Posição detalhada"
        subtitle="Saldo de cada produto em cada depósito — clique em Ajustar para corrigir o saldo na hora"
        action={
          <label className="relative block w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.currentTarget.value)}
              placeholder="Buscar por produto ou código"
              className="pl-9"
            />
          </label>
        }
      >
        <Table
          rows={visiveis}
          keyOf={(r) => r.productId + r.warehouseId}
          empty={<Empty icon={<Warehouse size={24} />} title="Sem saldo registrado" body="Faça a primeira entrada para ver a posição aqui." />}
          columns={[
            { key: 'p', header: 'Produto', render: (r) => (
              <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div>
            ) },
            { key: 'w', header: 'Depósito', render: (r) => <Badge>{r.warehouseCode}</Badge> },
            { key: 'q', header: 'Saldo', align: 'right', render: (r) => r.embalagem ? (
              <div className="text-right">
                <span className={r.belowMin ? 'font-semibold text-danger' : ''}>{r.embalagem.pecasContadas} <span className="text-[11.5px] text-faint">{r.unit}</span></span>
                <p className="text-[11px] text-faint tnum">{r.embalagem.pecasInteiras} inteira(s){r.embalagem.sobraM > 0 ? ` + ${r.embalagem.sobra} em aberto` : ''}</p>
                <p className="text-[11px] text-faint tnum">total {r.embalagem.total}</p>
              </div>
            ) : (
              <span className={r.belowMin ? 'font-semibold text-danger' : ''}>{qty(r.quantity)} <span className="text-[11.5px] text-faint">{r.unit}</span></span>
            ) },
            { key: 'm', header: 'Sugerido', align: 'right', render: (r) => qty(r.minStock) },
            { key: 'c', header: 'Custo médio', align: 'right', render: (r) => brl(r.avgCost) },
            { key: 'v', header: 'Valor', align: 'right', render: (r) => <b>{brl(r.stockValue)}</b> },
            { key: 'a', header: '', align: 'right', render: (r) => (
              <button onClick={() => setAjustando(r)} className="btn-ghost btn-sm gap-1.5 whitespace-nowrap">
                <SlidersHorizontal size={14} /> Ajustar
              </button>
            ) },
          ]}
        />
        {stock.length > visiveis.length && (
          <p className="px-1 pt-3 text-[13px] text-muted">
            Mostrando {int(visiveis.length)} de {int(stock.length)} linhas. Use a busca para encontrar um item.
          </p>
        )}
      </Card>

      <Modal open={modal} onClose={() => { setModal(false); setEditing(null); }} title={editing ? 'Editar depósito' : 'Novo depósito'}>
        <form onSubmit={salvar} className="space-y-4">
          {!editing && <Field label="Código" required hint="Ex.: DEP-3"><Input name="code" required placeholder="DEP-3" /></Field>}
          <Field label="Nome" required><Input name="name" required defaultValue={editing?.name} placeholder="Depósito 1 · Superior" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cidade"><Input name="city" defaultValue={editing?.city ?? ''} /></Field>
            <Field label="UF"><Input name="state" maxLength={2} defaultValue={editing?.state ?? ''} /></Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-raised p-3.5">
            <input type="checkbox" name="isDefault" defaultChecked={editing?.isDefault} className="h-4 w-4 accent-[rgb(var(--c-brand))]" />
            <span className="text-[14px]">Usar como depósito padrão nos formulários</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setModal(false); setEditing(null); }} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary">Salvar</button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!ajustando}
        onClose={() => setAjustando(null)}
        title="Ajustar saldo manualmente"
      >
        {ajustando && (
          <form onSubmit={aplicarAjuste} className="space-y-4">
            <div className="rounded-xl border border-line bg-raised p-3.5">
              <p className="text-[15px] font-semibold leading-tight">{ajustando.name}</p>
              <p className="mt-0.5 font-mono text-[11.5px] text-faint">{ajustando.sku}</p>
              <p className="mt-2 text-[13px] text-muted">
                {ajustando.warehouse} · saldo atual <b className="tnum">{ajustando.embalagem ? ajustando.embalagem.descricao : `${qty(ajustando.quantity)} ${ajustando.unit}`}</b>
              </p>
            </div>
            <Field
              label={ajustando.embalagem ? 'Peças inteiras contadas' : 'Novo saldo'}
              required
              hint={ajustando.embalagem ? `${ajustando.embalagem.comprimento} cada; a sobra vai no campo abaixo` : `Informe a contagem real. ${ajustando.unit.toUpperCase()} vendido por unidade aceita só número inteiro.`}
            >
              <Input name="newQuantity" type="number" step={ajustando.embalagem ? '1' : '0.001'} min="0" required autoFocus defaultValue={ajustando.quantity} />
            </Field>
            {ajustando.embalagem && (
              <Field label="Sobra em aberto (metros)" hint="Pedaços cortados somados, em metros (ex.: 2,5). Em branco mantém a sobra atual.">
                <Input name="newRemnant" type="number" step="0.001" min="0" placeholder={ajustando.embalagem.sobra} />
              </Field>
            )}
            <Field label="Motivo" hint="Fica registrado no histórico junto com o seu nome.">
              <Input name="reason" placeholder="Ex.: recontagem na prateleira" />
            </Field>
            <p className="text-[12.5px] text-faint">
              O ajuste não apaga nada: gera um movimento de AJUSTE com o saldo antes e depois.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAjustando(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" disabled={salvandoAjuste} className="btn-primary">
                {salvandoAjuste ? 'Aplicando…' : 'Aplicar ajuste'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
