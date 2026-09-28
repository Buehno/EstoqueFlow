import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, Download, FileSpreadsheet, Ruler, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  api, ApiError,
  type GrupoDuplicado, type LinhaCompra, type PosicaoCompra, type SaldoQuebrado, type StockRow,
} from '../lib/api';
import { Badge, brl, Card, cx, Empty, int, qty, Spinner, Stat, Table, useToast } from '../lib/ui';
import { useAuth } from '../App';

type Aba = 'compras' | 'posicao' | 'abc' | 'giro' | 'base';

const ABAS: { k: Aba; label: string; hint: string }[] = [
  { k: 'compras', label: 'Alerta de compra', hint: 'Pelo total dos dois depósitos' },
  { k: 'posicao', label: 'Posição de estoque', hint: 'Saldo e valor por depósito' },
  { k: 'abc', label: 'Curva ABC', hint: 'Onde está a concentração de valor' },
  { k: 'giro', label: 'Giro e cobertura', hint: 'O que gira e o que está parado' },
  { k: 'base', label: 'Limpeza da base', hint: 'Duplicados e saldos quebrados' },
];

const TOM_SITUACAO: Record<string, 'danger' | 'warn' | 'ok' | 'neutral'> = {
  ALERTA_COMPRA: 'danger', ATENCAO: 'warn', OK: 'ok', SEM_MINIMO: 'neutral',
};
const ROTULO_SITUACAO: Record<string, string> = {
  ALERTA_COMPRA: 'comprar', ATENCAO: 'atenção', OK: 'ok', SEM_MINIMO: 'sem mínimo',
};

export default function Relatorios() {
  const [aba, setAba] = useState<Aba>('compras');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [abc, setAbc] = useState<any[]>([]);
  const [giro, setGiro] = useState<any[]>([]);
  const [compras, setCompras] = useState<PosicaoCompra | null>(null);
  const [quebrados, setQuebrados] = useState<SaldoQuebrado[]>([]);
  const [duplicados, setDuplicados] = useState<GrupoDuplicado[]>([]);
  const [filtroCompra, setFiltroCompra] = useState<'alerta' | 'atencao' | 'semMinimo' | 'todos'>('alerta');
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const toast = useToast();
  const { me } = useAuth();
  const podeCorrigir = me?.user.role === 'OWNER' || me?.user.role === 'ADMIN';

  const carregar = async () => {
    const [s, a, g, c, q, d] = await Promise.all([
      api.get<StockRow[]>('/stock?take=1000'),
      api.get<any[]>('/reports/abc?dias=90'),
      api.get<any[]>('/reports/giro?dias=90'),
      api.get<PosicaoCompra>('/reports/compras'),
      api.get<{ itens: SaldoQuebrado[] }>('/reports/saldos-quebrados'),
      api.get<{ grupos: GrupoDuplicado[] }>('/reports/duplicados'),
    ]);
    setStock(s); setAbc(a); setGiro(g); setCompras(c); setQuebrados(q.itens); setDuplicados(d.grupos);
    setLoading(false);
  };

  useEffect(() => { void carregar(); }, []);

  if (loading || !compras) return <Spinner label="Calculando relatórios…" />;

  const valorPorDeposito = Object.values(
    stock.reduce<Record<string, { name: string; valor: number }>>((acc, s) => {
      acc[s.warehouseId] ??= { name: s.warehouseCode, valor: 0 };
      acc[s.warehouseId].valor += s.stockValue;
      return acc;
    }, {}),
  );

  const listaCompra: LinhaCompra[] =
    filtroCompra === 'alerta' ? compras.alerta
      : filtroCompra === 'atencao' ? compras.atencao
      : filtroCompra === 'semMinimo' ? compras.semMinimo
      : compras.itens;

  const exportar = () => {
    if (aba === 'compras') return api.download('/reports/compras/planilha', 'reposicao-estoque.xlsx');
    const map: Record<Aba, string> = { compras: 'estoque', posicao: 'estoque', abc: 'abc', giro: 'estoque', base: 'estoque' };
    api.download(`/reports/export/${map[aba]}`, `${aba}.csv`);
  };

  const arredondar = async () => {
    if (!quebrados.length) return;
    setOcupado(true);
    try {
      const r = await api.post<{ aplicados: number }>('/reports/saldos-quebrados/arredondar', { confirmar: true });
      toast({ kind: 'ok', title: `${r.aplicados} saldo(s) arredondado(s)`, body: 'Cada correção virou um ajuste rastreável no histórico.' });
      await carregar();
    } catch (e) {
      toast({ kind: 'err', title: 'Não foi possível arredondar', body: e instanceof ApiError ? e.message : undefined });
    } finally { setOcupado(false); }
  };

  const desativar = async (id: string, nome: string) => {
    setOcupado(true);
    try {
      const r = await api.post<{ saldosZerados: unknown[] }>(`/reports/duplicados/${id}/desativar`, {});
      toast({
        kind: 'ok',
        title: `"${nome}" desativado`,
        body: r.saldosZerados.length ? 'O saldo que existia foi zerado por ajuste, com o motivo registrado.' : undefined,
      });
      await carregar();
    } catch (e) {
      toast({ kind: 'err', title: 'Não foi possível desativar', body: e instanceof ApiError ? e.message : undefined });
    } finally { setOcupado(false); }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Relatórios</h1>
          <p className="mt-1 text-[14px] text-muted">Últimos 90 dias de movimentação como base de cálculo.</p>
        </div>
        <button onClick={exportar} className="btn-ghost btn-sm gap-2">
          {aba === 'compras' ? <><FileSpreadsheet size={15} /> Baixar planilha completa</> : <><Download size={15} /> Exportar CSV</>}
        </button>
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

      {aba === 'compras' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Alerta de compra" value={int(compras.resumo.alertaCompra)} sub="total ≤ 50% do mínimo" tone={compras.resumo.alertaCompra ? 'danger' : 'ok'} icon={<AlertTriangle size={18} />} />
            <Stat label="Atenção" value={int(compras.resumo.atencao)} sub="total ≤ mínimo" tone={compras.resumo.atencao ? 'warn' : 'ok'} />
            <Stat label="Reposição estimada" value={brl(compras.resumo.valorAComprar)} sub="alerta + atenção" />
            <Stat label="Sem mínimo definido" value={int(compras.resumo.semMinimo)} sub="fora do alerta até definir" />
          </div>

          <Card
            title="Como a régua funciona"
            subtitle="O que decide é o total somado dos depósitos, nunca o saldo de um só"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { t: 'OK', d: 'Total acima do estoque mínimo.', tone: 'bg-ok/12 text-ok' },
                { t: 'Atenção', d: 'Total igual ou abaixo do mínimo — programar a compra.', tone: 'bg-warn/12 text-warn' },
                { t: 'Alerta de compra', d: 'Total igual ou abaixo da metade do mínimo — comprar agora.', tone: 'bg-danger/12 text-danger' },
              ].map((x) => (
                <div key={x.t} className="rounded-xl border border-line p-4">
                  <span className={cx('chip', x.tone)}>{x.t}</span>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{x.d}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Itens para decidir a compra"
            action={
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['alerta', `Alerta (${compras.resumo.alertaCompra})`],
                  ['atencao', `Atenção (${compras.resumo.atencao})`],
                  ['semMinimo', `Sem mínimo (${compras.resumo.semMinimo})`],
                  ['todos', `Todos (${compras.resumo.produtos})`],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setFiltroCompra(k)}
                    aria-pressed={filtroCompra === k}
                    className={cx('chip', filtroCompra === k ? 'bg-brand/15 text-brand' : 'bg-line/60 text-muted')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            <Table
              rows={listaCompra}
              keyOf={(r) => r.productId}
              empty={<Empty icon={<TrendingUp size={24} />} title="Nada nesta lista" body="Troque o filtro acima para ver as outras situações." />}
              columns={[
                { key: 's', header: 'Situação', render: (r) => <Badge tone={TOM_SITUACAO[r.situacao]}>{ROTULO_SITUACAO[r.situacao]}</Badge> },
                { key: 'p', header: 'Produto', render: (r) => (
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="font-mono text-[11.5px] text-faint">{r.sku}{r.categoria ? ` · ${r.categoria}` : ''}</p>
                  </div>
                ) },
                ...compras.depositos.map((d) => ({
                  key: `d-${d.id}`,
                  header: d.code,
                  align: 'right' as const,
                  render: (r: LinhaCompra) => qty(r.depositos.find((x) => x.id === d.id)?.quantity ?? 0),
                })),
                { key: 't', header: 'TOTAL', align: 'right', render: (r) => <b className="tnum">{qty(r.total)} <span className="text-[11px] font-normal text-faint">{r.unit}</span></b> },
                { key: 'm', header: 'Mínimo', align: 'right', render: (r) => qty(r.minStock) },
                { key: 'pc', header: 'Compra em', align: 'right', render: (r) => <span className="text-muted">{qty(r.pontoCompra)}</span> },
                { key: 'c', header: 'Comprar', align: 'right', render: (r) => r.comprarParaRepor ? <b>{qty(r.comprarParaRepor)}</b> : '—' },
                { key: 'v', header: 'Custo est.', align: 'right', render: (r) => brl(r.comprarParaRepor * r.custoMedio) },
                { key: 'x', header: 'Saídas 90d', align: 'right', render: (r) => qty(r.saidas90) },
                { key: 'cb', header: 'Cobertura', align: 'right', render: (r) => r.coberturaDias == null ? '—' : `${int(r.coberturaDias)} d` },
              ]}
            />
            <p className="mt-4 text-[12.5px] text-faint">
              A planilha (botão no topo) traz sete visões: resumo, alerta, atenção, posição completa, por categoria, por fornecedor e sem mínimo.
            </p>
          </Card>
        </>
      )}

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

      {aba === 'base' && (
        <>
          <Card
            title={`${quebrados.length} saldo(s) quebrado(s) em item de unidade`}
            subtitle="Peça vendida por unidade não pode ter casa decimal — metro, quilo e litro podem"
            action={podeCorrigir && quebrados.length > 0 && (
              <button onClick={arredondar} disabled={ocupado} className="btn-primary btn-sm gap-2">
                <Ruler size={15} /> Arredondar tudo
              </button>
            )}
          >
            <Table
              rows={quebrados}
              keyOf={(r) => r.productId + r.warehouseId}
              empty={<Empty icon={<Ruler size={24} />} title="Nenhum saldo quebrado" body="Todo item de unidade está com número redondo." />}
              columns={[
                { key: 'p', header: 'Produto', render: (r) => (
                  <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku} · {r.unit}</p></div>
                ) },
                { key: 'w', header: 'Depósito', render: (r) => <Badge>{r.warehouseCode}</Badge> },
                { key: 'a', header: 'Saldo atual', align: 'right', render: (r) => <span className="font-semibold text-warn">{r.atual}</span> },
                { key: 'n', header: 'Vai ficar', align: 'right', render: (r) => <b>{r.arredondado}</b> },
                { key: 'd', header: 'Diferença', align: 'right', render: (r) => (
                  <span className={r.diferenca < 0 ? 'text-danger' : 'text-ok'}>{r.diferenca > 0 ? '+' : ''}{r.diferenca}</span>
                ) },
              ]}
            />
            {quebrados.length > 0 && (
              <p className="mt-4 text-[12.5px] text-faint">
                Cada arredondamento entra como ajuste no histórico, com o saldo anterior, o novo e quem mandou corrigir.
              </p>
            )}
          </Card>

          <Card
            title={`${duplicados.length} grupo(s) de cadastro duplicado`}
            subtitle="Mesmo nome, ignorando acento, maiúscula e pontuação"
          >
            {duplicados.length === 0 ? (
              <Empty icon={<Copy size={24} />} title="Nenhuma duplicidade encontrada" body="Cada produto aparece uma vez só na base." />
            ) : (
              <ul className="space-y-4">
                {duplicados.map((g) => (
                  <li key={g.chave} className="rounded-xl border border-line p-4">
                    <ul className="space-y-2">
                      {g.produtos.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-raised px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium">
                              {p.name} {!p.active && <Badge tone="neutral">desativado</Badge>}
                            </p>
                            <p className="font-mono text-[11.5px] text-faint">
                              {p.sku} · {p.unit}{p.size ? ` · ${p.size}` : ''} · {p.movimentos} mov. · {p.vendas} venda(s) · {p.propostas} proposta(s)
                            </p>
                          </div>
                          <span className="text-[13px]">
                            saldo <b className="tnum">{qty(p.total)}</b>
                            {p.depositos.length > 0 && (
                              <span className="ml-1 text-[11.5px] text-faint">
                                ({p.depositos.map((d) => `${d.code}: ${qty(d.quantity)}`).join(' · ')})
                              </span>
                            )}
                          </span>
                          {podeCorrigir && p.active && (
                            <button onClick={() => desativar(p.id, p.name)} disabled={ocupado} className="btn-ghost btn-sm">
                              Desativar este
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[12.5px] text-faint">
              Desativar tira o cadastro da busca e dos relatórios, mas não apaga o histórico dele. Se ainda tiver saldo,
              o saldo é zerado por um ajuste com o motivo registrado — confira antes se a peça já está contada no cadastro que fica.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
