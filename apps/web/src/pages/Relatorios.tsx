import { useEffect, useState } from 'react';
import { Download, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type StockRow } from '../lib/api';
import { Badge, brl, Card, cx, Empty, int, qty, Spinner, Table } from '../lib/ui';

type Aba = 'posicao' | 'minimo' | 'abc' | 'giro';

const ABAS: { k: Aba; label: string; hint: string }[] = [
  { k: 'posicao', label: 'Posição de estoque', hint: 'Saldo e valor por depósito' },
  { k: 'minimo', label: 'Abaixo do mínimo', hint: 'O que precisa ser reposto' },
  { k: 'abc', label: 'Curva ABC', hint: 'Onde está a concentração de valor' },
  { k: 'giro', label: 'Giro e cobertura', hint: 'O que gira e o que está parado' },
];

export default function Relatorios() {
  const [aba, setAba] = useState<Aba>('posicao');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [abc, setAbc] = useState<any[]>([]);
  const [giro, setGiro] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<StockRow[]>('/stock?take=1000'),
      api.get<any[]>('/reports/abc?dias=90'),
      api.get<any[]>('/reports/giro?dias=90'),
    ]).then(([s, a, g]) => { setStock(s); setAbc(a); setGiro(g); setLoading(false); });
  }, []);

  if (loading) return <Spinner label="Calculando relatórios…" />;

  const abaixo = stock.filter((s) => s.belowMin);
  const valorPorDeposito = Object.values(
    stock.reduce<Record<string, { name: string; valor: number }>>((acc, s) => {
      acc[s.warehouseId] ??= { name: s.warehouseCode, valor: 0 };
      acc[s.warehouseId].valor += s.stockValue;
      return acc;
    }, {}),
  );

  const exportar = () => {
    const map: Record<Aba, string> = { posicao: 'estoque', minimo: 'estoque', abc: 'abc', giro: 'estoque' };
    api.download(`/reports/export/${map[aba]}`, `${aba}.csv`);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Relatórios</h1>
          <p className="mt-1 text-[14px] text-muted">Últimos 90 dias de movimentação como base de cálculo.</p>
        </div>
        <button onClick={exportar} className="btn-ghost btn-sm gap-2"><Download size={15} /> Exportar CSV</button>
      </header>

      <div id="reports-tabs" className="flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <button
            key={a.k}
            onClick={() => setAba(a.k)}
            aria-pressed={aba === a.k}
            className={cx(
              'rounded-xl border px-4 py-2.5 text-left transition-colors duration-150',
              aba === a.k ? 'border-brand bg-brand/10' : 'border-line bg-surface hover:border-faint',
            )}
          >
            <span className={cx('block text-[14px] font-semibold', aba === a.k && 'text-brand')}>{a.label}</span>
            <span className="block text-[11.5px] text-faint">{a.hint}</span>
          </button>
        ))}
      </div>

      {aba === 'posicao' && (
        <>
          <Card title="Valor em estoque por depósito">
            <div className="h-[220px] w-full">
              <ResponsiveContainer>
                <BarChart data={valorPorDeposito}>
                  <CartesianGrid stroke="rgb(var(--c-line))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} width={70}
                         tickFormatter={(v) => brl(Number(v)).replace('R$', '').trim()} />
                  <Tooltip formatter={(v) => brl(Number(v))}
                           contentStyle={{ background: 'rgb(var(--c-raised))', border: '1px solid rgb(var(--c-line))', borderRadius: 12, fontSize: 13, color: 'rgb(var(--c-ink))' }} />
                  <Bar dataKey="valor" radius={[8, 8, 0, 0]} fill="rgb(var(--c-brand))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Posição detalhada">
            <Table
              rows={stock}
              keyOf={(r) => r.productId + r.warehouseId}
              columns={[
                { key: 'p', header: 'Produto', render: (r) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div> },
                { key: 'w', header: 'Depósito', render: (r) => <Badge>{r.warehouseCode}</Badge> },
                { key: 'q', header: 'Saldo', align: 'right', render: (r) => qty(r.quantity) },
                { key: 'c', header: 'Custo médio', align: 'right', render: (r) => brl(r.avgCost) },
                { key: 'v', header: 'Valor', align: 'right', render: (r) => <b>{brl(r.stockValue)}</b> },
              ]}
            />
          </Card>
        </>
      )}

      {aba === 'minimo' && (
        <Card title={`${abaixo.length} item(ns) abaixo do estoque mínimo`}>
          <Table
            rows={abaixo}
            keyOf={(r) => r.productId + r.warehouseId}
            empty={<Empty icon={<TrendingUp size={24} />} title="Reposição em dia" body="Nenhum produto está abaixo do mínimo." />}
            columns={[
              { key: 'p', header: 'Produto', render: (r) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div> },
              { key: 'w', header: 'Depósito', render: (r) => <Badge>{r.warehouseCode}</Badge> },
              { key: 'q', header: 'Saldo', align: 'right', render: (r) => <span className="font-semibold text-danger">{qty(r.quantity)}</span> },
              { key: 'm', header: 'Mínimo', align: 'right', render: (r) => qty(r.minStock) },
              { key: 'f', header: 'Comprar', align: 'right', render: (r) => <b>{qty(r.minStock - r.quantity)}</b> },
              { key: 'c', header: 'Custo estimado', align: 'right', render: (r) => brl((r.minStock - r.quantity) * r.avgCost) },
            ]}
          />
        </Card>
      )}

      {aba === 'abc' && (
        <Card title="Curva ABC por valor de saída" subtitle="Classe A concentra 80% do valor movimentado">
          <div className="mb-5 h-[220px] w-full">
            <ResponsiveContainer>
              <BarChart data={abc.slice(0, 15)}>
                <CartesianGrid stroke="rgb(var(--c-line))" vertical={false} />
                <XAxis dataKey="sku" tick={{ fontSize: 10, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} width={70}
                       tickFormatter={(v) => brl(Number(v)).replace('R$', '').trim()} />
                <Tooltip formatter={(v) => brl(Number(v))}
                         contentStyle={{ background: 'rgb(var(--c-raised))', border: '1px solid rgb(var(--c-line))', borderRadius: 12, fontSize: 13, color: 'rgb(var(--c-ink))' }} />
                <Bar dataKey="valor" radius={[8, 8, 0, 0]}>
                  {abc.slice(0, 15).map((e, i) => (
                    <Cell key={i} fill={e.classe === 'A' ? 'rgb(var(--c-brand))' : e.classe === 'B' ? 'rgb(var(--c-info))' : 'rgb(var(--c-faint))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Table
            rows={abc}
            keyOf={(r) => r.productId}
            empty={<Empty title="Sem saídas no período" body="A curva ABC usa as saídas e vendas dos últimos 90 dias." />}
            columns={[
              { key: 'c', header: 'Classe', render: (r) => <Badge tone={r.classe === 'A' ? 'brand' : r.classe === 'B' ? 'info' : 'neutral'}>{r.classe}</Badge> },
              { key: 'p', header: 'Produto', render: (r) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div> },
              { key: 'q', header: 'Qtd saída', align: 'right', render: (r) => qty(r.qtd) },
              { key: 'v', header: 'Valor', align: 'right', render: (r) => brl(r.valor) },
              { key: 'pa', header: 'Part.', align: 'right', render: (r) => `${r.participacao.toFixed(1)}%` },
              { key: 'ac', header: 'Acum.', align: 'right', render: (r) => `${r.acumulado.toFixed(1)}%` },
            ]}
          />
        </Card>
      )}

      {aba === 'giro' && (
        <Card title="Giro de estoque e cobertura" subtitle="Consumo dos últimos 90 dias ÷ saldo atual">
          <Table
            rows={giro}
            keyOf={(r) => r.productId}
            columns={[
              { key: 'p', header: 'Produto', render: (r) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div> },
              { key: 's', header: 'Saldo', align: 'right', render: (r) => qty(r.saldo) },
              { key: 'c', header: 'Consumo 90d', align: 'right', render: (r) => qty(r.consumoPeriodo) },
              { key: 'g', header: 'Giro', align: 'right', render: (r) => r.giro.toFixed(2) },
              { key: 'd', header: 'Cobertura', align: 'right', render: (r) => r.diasCobertura == null ? '—' : `${int(r.diasCobertura)} dias` },
              { key: 'x', header: 'Situação', render: (r) => (
                <Badge tone={r.situacao === 'SAUDAVEL' ? 'ok' : r.situacao === 'RISCO_RUPTURA' ? 'danger' : r.situacao === 'EXCESSO' ? 'warn' : 'neutral'}>
                  {r.situacao.replace('_', ' ')}
                </Badge>
              ) },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
