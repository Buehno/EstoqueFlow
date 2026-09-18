import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, Boxes, Package, ShoppingCart, TrendingUp, Warehouse,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, type Dashboard as D } from '../lib/api';
import { Badge, brl, Card, dt, Empty, int, qty, Spinner, Stat, Table } from '../lib/ui';

const TIPO_TONE: Record<string, 'ok' | 'danger' | 'info' | 'warn' | 'brand' | 'neutral'> = {
  ENTRADA: 'ok', SAIDA: 'danger', TRANSFERENCIA: 'info', AJUSTE: 'warn', VENDA: 'brand', ESTORNO: 'neutral',
};

export default function Dashboard() {
  const [d, setD] = useState<D | null>(null);
  const [serie, setSerie] = useState<{ dia: string; total: number }[]>([]);

  useEffect(() => {
    api.get<D>('/reports/dashboard').then(setD);
    api.get<{ dia: string; total: number }[]>('/reports/vendas-por-dia?dias=30').then(setSerie);
  }, []);

  if (!d) return <Spinner label="Montando o painel…" />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">Painel de estoque</h1>
        <p className="mt-1 text-[14px] text-muted">
          Posição consolidada dos seus depósitos, atualizada a cada movimento.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Valor em estoque" value={brl(d.valorTotalEstoque)} sub={`${int(d.unidadesTotais)} unidades`} icon={<Boxes size={18} />} />
        <Stat label="Produtos ativos" value={int(d.produtosAtivos)} sub={`${d.depositos.length} depósito(s)`} icon={<Package size={18} />} />
        <Stat
          label="Abaixo do mínimo"
          value={int(d.alertas.abaixoMinimo)}
          sub={d.alertas.abaixoMinimo ? 'Requer reposição' : 'Tudo em ordem'}
          tone={d.alertas.abaixoMinimo ? 'danger' : 'ok'}
          icon={<AlertTriangle size={18} />}
        />
        <Stat
          label="Vendas hoje"
          value={brl(d.vendas.hoje.total)}
          sub={`${d.vendas.hoje.qtd} venda(s) no balcão`}
          icon={<ShoppingCart size={18} />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Vendas dos últimos 30 dias" subtitle={`Margem no período: ${d.vendas.ultimos30.margem.toFixed(1)}%`} className="xl:col-span-2">
          {serie.length ? (
            <div className="h-[260px] w-full">
              <ResponsiveContainer>
                <AreaChart data={serie.map((s) => ({ ...s, label: new Date(s.dia).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }))}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgb(var(--c-line))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} width={64}
                         tickFormatter={(v) => brl(Number(v)).replace('R$', '').trim()} />
                  <Tooltip
                    formatter={(v) => brl(Number(v))}
                    contentStyle={{
                      background: 'rgb(var(--c-raised))', border: '1px solid rgb(var(--c-line))',
                      borderRadius: 12, fontSize: 13, color: 'rgb(var(--c-ink))',
                    }}
                  />
                  <Area type="monotone" dataKey="total" stroke="rgb(var(--c-brand))" strokeWidth={2.2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty icon={<ShoppingCart size={24} />} title="Nenhuma venda ainda" body="Assim que a primeira venda for registrada no PDV, o gráfico aparece aqui." />
          )}
        </Card>

        <Card title="Estoque por depósito" subtitle="Onde está o seu dinheiro parado" id="warehouses-summary">
          <ul className="space-y-3">
            {d.depositos.map((w) => (
              <li key={w.id} className="rounded-xl border border-line bg-raised p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Warehouse size={16} className="text-brand" aria-hidden />
                    <span className="text-[14px] font-semibold">{w.name}</span>
                  </div>
                  <span className="font-mono text-[11px] text-faint">{w.code}</span>
                </div>
                <p className="mt-2.5 text-[20px] font-bold tnum">{brl(w.valor)}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
                  <span>{int(w.skus)} SKUs</span>
                  <span>{int(w.unidades)} un.</span>
                  {w.abaixoMinimo > 0 && <span className="font-semibold text-danger">{w.abaixoMinimo} abaixo do mínimo</span>}
                </div>
              </li>
            ))}
          </ul>
          <Link to="/app/movimentacoes/transferencia" className="btn-ghost btn-sm mt-4 w-full gap-2">
            <ArrowLeftRight size={15} /> Transferir entre depósitos
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Reposição urgente"
          subtitle="Produtos abaixo do estoque mínimo"
          action={<Link to="/app/relatorios" className="btn-ghost btn-sm">Ver tudo</Link>}
        >
          <Table
            rows={d.alertas.lista.slice(0, 8)}
            keyOf={(r) => r.productId + r.warehouse}
            empty={<Empty icon={<TrendingUp size={24} />} title="Nenhum produto abaixo do mínimo" body="Sua reposição está em dia." />}
            columns={[
              { key: 'p', header: 'Produto', render: (r) => (
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="font-mono text-[11.5px] text-faint">{r.sku} · {r.warehouse}</p>
                </div>
              ) },
              { key: 'q', header: 'Saldo', align: 'right', render: (r) => qty(r.quantity) },
              { key: 'm', header: 'Mínimo', align: 'right', render: (r) => qty(r.minStock) },
              { key: 'f', header: 'Falta', align: 'right', render: (r) => <span className="font-semibold text-danger">{qty(r.falta)}</span> },
            ]}
          />
        </Card>

        <Card
          title="Últimas movimentações"
          subtitle="Trilha de auditoria em tempo real"
          action={<Link to="/app/movimentacoes" className="btn-ghost btn-sm">Histórico</Link>}
        >
          <Table
            rows={d.ultimasMovimentacoes}
            keyOf={(r) => r.id}
            empty={<Empty icon={<Boxes size={24} />} title="Nenhuma movimentação ainda" body="Comece dando entrada nos produtos." />}
            columns={[
              { key: 't', header: 'Tipo', render: (r) => <Badge tone={TIPO_TONE[r.tipo] ?? 'neutral'}>{r.tipo}</Badge> },
              { key: 'p', header: 'Produto', render: (r) => (
                <div>
                  <p className="font-medium">{r.produto}</p>
                  <p className="font-mono text-[11.5px] text-faint">
                    {r.origem ?? '—'} → {r.destino ?? '—'}
                  </p>
                </div>
              ) },
              { key: 'q', header: 'Qtd', align: 'right', render: (r) => qty(r.quantidade) },
              { key: 'd', header: 'Quando', align: 'right', render: (r) => <span className="text-[12.5px] text-faint">{dt(r.data)}</span> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
