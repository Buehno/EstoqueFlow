import { useEffect, useState } from 'react';
import { Plus, Star, Warehouse } from 'lucide-react';
import { api, ApiError, type StockRow, type Warehouse as W } from '../lib/api';
import { Badge, brl, Card, Empty, Field, Input, int, Modal, qty, Spinner, Table, useToast } from '../lib/ui';

export default function Depositos() {
  const [items, setItems] = useState<W[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<W | null>(null);
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

  const resumo = (id: string) => {
    const rows = stock.filter((s) => s.warehouseId === id);
    return {
      skus: rows.filter((r) => r.quantity > 0).length,
      unidades: rows.reduce((a, r) => a + r.quantity, 0),
      valor: rows.reduce((a, r) => a + r.stockValue, 0),
      alertas: rows.filter((r) => r.belowMin).length,
    };
  };

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
              {r.alertas > 0 && <p className="mt-2.5 text-[13px] font-semibold text-danger">{r.alertas} item(ns) abaixo do mínimo</p>}
              {!w.active && <div className="mt-2"><Badge tone="warn">inativo</Badge></div>}
            </button>
          );
        })}
      </div>

      <Card title="Posição detalhada" subtitle="Saldo de cada produto em cada depósito">
        <Table
          rows={stock}
          keyOf={(r) => r.productId + r.warehouseId}
          empty={<Empty icon={<Warehouse size={24} />} title="Sem saldo registrado" body="Faça a primeira entrada para ver a posição aqui." />}
          columns={[
            { key: 'p', header: 'Produto', render: (r) => (
              <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div>
            ) },
            { key: 'w', header: 'Depósito', render: (r) => <Badge>{r.warehouseCode}</Badge> },
            { key: 'q', header: 'Saldo', align: 'right', render: (r) => (
              <span className={r.belowMin ? 'font-semibold text-danger' : ''}>{qty(r.quantity)} <span className="text-[11.5px] text-faint">{r.unit}</span></span>
            ) },
            { key: 'm', header: 'Mínimo', align: 'right', render: (r) => qty(r.minStock) },
            { key: 'c', header: 'Custo médio', align: 'right', render: (r) => brl(r.avgCost) },
            { key: 'v', header: 'Valor', align: 'right', render: (r) => <b>{brl(r.stockValue)}</b> },
          ]}
        />
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
    </div>
  );
}
