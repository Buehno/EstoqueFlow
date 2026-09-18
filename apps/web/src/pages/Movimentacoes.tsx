import { useEffect, useState } from 'react';
import { Download, RotateCcw, ScrollText } from 'lucide-react';
import { api, ApiError, type MovementRow, type Warehouse } from '../lib/api';
import { Badge, brl, Card, dt, Empty, Field, Input, qty, Select, Spinner, Table, useToast } from '../lib/ui';
import { useAuth } from '../App';

const TONE: Record<string, 'ok' | 'danger' | 'info' | 'warn' | 'brand' | 'neutral'> = {
  ENTRADA: 'ok', SAIDA: 'danger', TRANSFERENCIA: 'info', AJUSTE: 'warn', VENDA: 'brand', ESTORNO: 'neutral',
};

export default function Movimentacoes() {
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ type: '', warehouseId: '', from: '', to: '', search: '' });
  const toast = useToast();
  const { me } = useAuth();
  const podeEstornar = me?.user.role === 'OWNER' || me?.user.role === 'ADMIN';

  const load = async () => {
    setLoading(true);
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    qs.set('take', '200');
    const r = await api.get<{ items: MovementRow[]; total: number }>(`/movements?${qs}`);
    setRows(r.items);
    setTotal(r.total);
    setLoading(false);
  };

  useEffect(() => { api.get<Warehouse[]>('/warehouses').then(setWarehouses); }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 280); return () => clearTimeout(t); }, [f]);

  const estornar = async (m: MovementRow) => {
    try {
      await api.post(`/movements/${m.id}/estorno`, { reason: `Estorno solicitado no histórico` });
      toast({ kind: 'ok', title: `Movimento #${m.number} estornado` });
      void load();
    } catch (e) {
      toast({ kind: 'err', title: 'Não foi possível estornar', body: e instanceof ApiError ? e.message : undefined });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Histórico de movimentações</h1>
          <p className="mt-1 text-[14px] text-muted">{total} registro(s) — trilha completa e auditável.</p>
        </div>
        <button onClick={() => api.download('/reports/export/movimentacoes', 'movimentacoes.csv')} className="btn-ghost btn-sm gap-2">
          <Download size={15} /> Exportar CSV
        </button>
      </header>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Tipo">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="">Todos</option>
              {['ENTRADA', 'SAIDA', 'TRANSFERENCIA', 'AJUSTE', 'VENDA', 'ESTORNO'].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Depósito">
            <Select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
              <option value="">Todos</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </Select>
          </Field>
          <Field label="De"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Até"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Produto"><Input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="Nome ou SKU" /></Field>
        </div>
      </Card>

      <Card>
        {loading ? <Spinner /> : (
          <Table
            rows={rows}
            keyOf={(r) => r.id}
            empty={<Empty icon={<ScrollText size={24} />} title="Nenhuma movimentação encontrada" body="Ajuste os filtros ou registre o primeiro movimento." />}
            columns={[
              { key: 'n', header: '#', render: (r) => <span className="font-mono text-[12.5px] text-faint">{r.number}</span> },
              { key: 't', header: 'Tipo', render: (r) => (
                <span className="flex items-center gap-1.5">
                  <Badge tone={TONE[r.type] ?? 'neutral'}>{r.type}</Badge>
                  {r.status === 'ESTORNADO' && <Badge tone="warn">estornado</Badge>}
                </span>
              ) },
              { key: 'p', header: 'Produto', render: (r) => (
                <div><p className="font-medium">{r.product.name}</p><p className="font-mono text-[11.5px] text-faint">{r.product.sku}</p></div>
              ) },
              { key: 'q', header: 'Qtd', align: 'right', render: (r) => <>{qty(r.quantity)} <span className="text-[11.5px] text-faint">{r.product.unit}</span></> },
              { key: 'f', header: 'Fluxo', render: (r) => (
                <span className="text-[13px] text-muted">{r.from?.name ?? '—'} → {r.to?.name ?? '—'}</span>
              ) },
              { key: 'c', header: 'Custo un.', align: 'right', render: (r) => brl(r.unitCost) },
              { key: 'm', header: 'Motivo', render: (r) => <span className="text-[13px] text-muted">{r.reason ?? '—'}</span> },
              { key: 'u', header: 'Usuário', render: (r) => <span className="text-[13px]">{r.user}</span> },
              { key: 'd', header: 'Data', align: 'right', render: (r) => <span className="text-[12.5px] text-faint">{dt(r.createdAt)}</span> },
              ...(podeEstornar ? [{
                key: 'a', header: '', align: 'right' as const,
                render: (r: MovementRow) =>
                  r.status === 'CONFIRMADO' && r.type !== 'VENDA' ? (
                    <button onClick={() => estornar(r)} className="btn-ghost btn-sm gap-1.5" aria-label={`Estornar movimento ${r.number}`}>
                      <RotateCcw size={13} /> Estornar
                    </button>
                  ) : null,
              }] : []),
            ]}
          />
        )}
      </Card>
    </div>
  );
}
