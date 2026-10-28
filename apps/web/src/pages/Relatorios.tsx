import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, Download, FileSpreadsheet, FileText, PackageX, Ruler, TrendingUp, Truck } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  api, ApiError,
  type Fracionados, type GrupoDuplicado, type LinhaCompra, type PosicaoCompra, type SaldoQuebrado, type StockRow,
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
  ALERTA_COMPRA: 'danger', OK: 'ok', SEM_MINIMO: 'neutral',
};
const ROTULO_SITUACAO: Record<string, string> = {
  ALERTA_COMPRA: 'comprar', OK: 'ok', SEM_MINIMO: 'sem sugerido',
};

export default function Relatorios() {
  const [aba, setAba] = useState<Aba>('compras');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [abc, setAbc] = useState<any[]>([]);
  const [giro, setGiro] = useState<any[]>([]);
  const [compras, setCompras] = useState<PosicaoCompra | null>(null);
  const [quebrados, setQuebrados] = useState<SaldoQuebrado[]>([]);
  const [fracionados, setFracionados] = useState<Fracionados | null>(null);
  const [duplicados, setDuplicados] = useState<GrupoDuplicado[]>([]);
  const [filtroCompra, setFiltroCompra] = useState<'alerta' | 'semMinimo' | 'todos'>('alerta');
  const [fornecedorSel, setFornecedorSel] = useState<string>('');
  const [menuExportar, setMenuExportar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const toast = useToast();
  const { pode } = useAuth();
  const podeCorrigir = pode('GERENCIAR_REGRAS_ALERTA');

  const carregar = async () => {
    const [s, a, g, c, q, d, f] = await Promise.all([
      api.get<StockRow[]>('/stock?take=1000'),
      api.get<any[]>('/reports/abc?dias=90'),
      api.get<any[]>('/reports/giro?dias=90'),
      api.get<PosicaoCompra>('/reports/compras'),
      api.get<{ itens: SaldoQuebrado[] }>('/reports/saldos-quebrados'),
      api.get<{ grupos: GrupoDuplicado[] }>('/reports/duplicados'),
      api.get<Fracionados>('/reports/fracionados'),
    ]);
    setStock(s); setAbc(a); setGiro(g); setCompras(c); setQuebrados(q.itens); setDuplicados(d.grupos); setFracionados(f);
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

  const base: LinhaCompra[] =
    filtroCompra === 'alerta' ? compras.alerta
      : filtroCompra === 'semMinimo' ? compras.semMinimo
      : compras.itens;
  const listaCompra = fornecedorSel ? base.filter((i) => (i.fornecedor ?? '(sem fornecedor cadastrado)') === fornecedorSel) : base;
  const valorLista = listaCompra.reduce((a, i) => a + i.comprarParaRepor * i.custoMedio, 0);

  /** Extrai o relatório de compras: Excel completo, PDF ou CSV — da lista inteira ou só do fornecedor filtrado. */
  const extrairCompras = (formato: 'xlsx' | 'pdf' | 'csv', soFornecedor = false) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const forn = soFornecedor && fornecedorSel ? `&fornecedor=${encodeURIComponent(fornecedorSel)}` : '';
    const nome = soFornecedor && fornecedorSel ? `pedido-de-compra-${hoje}.${formato}` : `relatorio-de-compras-${hoje}.${formato}`;
    setMenuExportar(false);
    return api.download(`/reports/compras/extrair?formato=${formato}${forn}`, nome);
  };

  const exportar = () => {
    if (aba === 'compras') return setMenuExportar((m) => !m);
    const map: Record<Aba, string> = { compras: 'estoque', posicao: 'estoque', abc: 'abc', giro: 'estoque', base: 'estoque' };
    api.download(`/reports/export/${map[aba]}`, `${aba}.csv`);
  };

  // ── dados dos gráficos da aba de compras ──
  const urgentes = compras.alerta.slice(0, 12).map((i) => ({
    nome: i.name.length > 34 ? `${i.name.slice(0, 33)}…` : i.name,
    completo: i.name,
    restante: Math.round((i.fracaoRestante ?? 0) * 100),
    comprar: i.comprarParaRepor,
    unit: i.unit,
    urgencia: i.urgencia,
  }));
  const porFornecedorGraf = compras.porFornecedor.slice(0, 10).map((f) => ({ nome: f.fornecedor.length > 22 ? `${f.fornecedor.slice(0, 21)}…` : f.fornecedor, completo: f.fornecedor, valor: Number(f.valor.toFixed(2)), itens: f.itensParaComprar, zerados: f.zerados }));
  const porCategoriaGraf = compras.porCategoria.filter((c) => c.alerta > 0).slice(0, 10).map((c) => ({ nome: c.categoria.length > 22 ? `${c.categoria.slice(0, 21)}…` : c.categoria, completo: c.categoria, alerta: c.alerta, produtos: c.produtos }));
  const situacaoGraf = [
    { nome: 'Em alerta de compra', valor: compras.resumo.alertaCompra, cor: 'rgb(var(--c-danger))' },
    { nome: 'OK', valor: compras.resumo.ok, cor: 'rgb(var(--c-ok))' },
    { nome: 'Sem sugerido', valor: compras.resumo.semMinimo, cor: 'rgb(var(--c-faint))' },
  ];
  const estiloTooltip = { background: 'rgb(var(--c-raised))', border: '1px solid rgb(var(--c-line))', borderRadius: 12, fontSize: 13, color: 'rgb(var(--c-ink))' };
  const corUrgencia = (u: string | null) => (u === 'ZERADO' ? 'rgb(var(--c-danger))' : u === 'CRITICO' ? 'rgb(var(--c-warn))' : 'rgb(var(--c-brand))');

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
        <div className="relative">
          <button onClick={exportar} className="btn-primary btn-sm gap-2" aria-haspopup={aba === 'compras' ? 'menu' : undefined} aria-expanded={aba === 'compras' ? menuExportar : undefined}>
            {aba === 'compras' ? <><Download size={15} /> Extrair relatório</> : <><Download size={15} /> Exportar CSV</>}
          </button>
          {aba === 'compras' && menuExportar && (
            <div role="menu" className="absolute right-0 z-30 mt-2 w-[300px] rounded-xl border border-line bg-raised p-1.5 shadow-pop">
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Lista de compra completa</p>
              <button role="menuitem" onClick={() => void extrairCompras('xlsx')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-line/50"><FileSpreadsheet size={15} /> Excel completo <span className="ml-auto text-[11px] text-faint">6 abas</span></button>
              <button role="menuitem" onClick={() => void extrairCompras('pdf')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-line/50"><FileText size={15} /> PDF para imprimir / WhatsApp</button>
              <button role="menuitem" onClick={() => void extrairCompras('csv')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-line/50"><Download size={15} /> CSV</button>
              {fornecedorSel && (
                <>
                  <p className="mt-1 border-t border-line px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Só {fornecedorSel}</p>
                  <button role="menuitem" onClick={() => void extrairCompras('pdf', true)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-line/50"><Truck size={15} /> Pedido em PDF</button>
                  <button role="menuitem" onClick={() => void extrairCompras('xlsx', true)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-line/50"><FileSpreadsheet size={15} /> Pedido em Excel</button>
                </>
              )}
            </div>
          )}
        </div>
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
          {compras.resumo.zerados > 0 && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
              <PackageX size={18} className="shrink-0 text-danger" />
              <p className="text-[14px]"><b className="text-danger">{compras.resumo.zerados} produto(s) com saldo ZERO</b> entre os que pedem compra — comprar primeiro: {compras.alerta.filter((i) => i.urgencia === 'ZERADO').slice(0, 4).map((i) => i.name).join(', ')}{compras.resumo.zerados > 4 ? '…' : ''}</p>
            </div>
          )}
          {compras.resumo.alertaCompra === 0 && (
            <div className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-[14px]">Nenhum produto atingiu 50% do estoque sugerido — nada a comprar agora.</div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Itens para comprar" value={int(compras.resumo.alertaCompra)} sub="total ≤ 50% do estoque sugerido" tone={compras.resumo.alertaCompra ? 'danger' : 'ok'} icon={<AlertTriangle size={18} />} />
            <Stat label="Zerados" value={int(compras.resumo.zerados)} sub={`${int(compras.resumo.criticos)} crítico(s) abaixo de 25%`} tone={compras.resumo.zerados ? 'danger' : compras.resumo.criticos ? 'warn' : 'ok'} icon={<PackageX size={18} />} />
            <Stat label="Valor estimado" value={brl(compras.resumo.valorAComprar)} sub="para voltar ao sugerido" />
            <Stat label="Fornecedores" value={int(compras.resumo.fornecedoresEnvolvidos)} sub="envolvidos na compra" icon={<Truck size={18} />} />
            <Stat label="Sem estoque sugerido" value={int(compras.resumo.semMinimo)} sub="fora do alerta até definir" tone={compras.resumo.semMinimo ? 'warn' : 'default'} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Mais urgentes" subtitle="Quanto do estoque sugerido ainda resta — menor é mais urgente" >
              {urgentes.length === 0 ? <Empty icon={<TrendingUp size={24} />} title="Nada em alerta" /> : (
                <div style={{ height: Math.max(180, urgentes.length * 30) }} className="w-full">
                  <ResponsiveContainer>
                    <BarChart data={urgentes} layout="vertical" margin={{ left: 4, right: 36, top: 4, bottom: 4 }}>
                      <CartesianGrid stroke="rgb(var(--c-line))" horizontal={false} />
                      <XAxis type="number" domain={[0, 50]} tick={{ fontSize: 11, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                      <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11, fill: 'rgb(var(--c-muted))' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={estiloTooltip} formatter={(v, _n, p) => [`${v}% do sugerido · comprar ${qty(p.payload.comprar)} ${p.payload.unit}`, p.payload.completo]} />
                      <Bar dataKey="restante" radius={[0, 4, 4, 0]} barSize={14} minPointSize={3}>
                        {urgentes.map((u) => <Cell key={u.completo} fill={corUrgencia(u.urgencia)} />)}
                        <LabelList dataKey="restante" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11, fill: 'rgb(var(--c-muted))' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-faint">
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgb(var(--c-danger))' }} />zerado</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgb(var(--c-warn))' }} />crítico (≤ 25%)</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgb(var(--c-brand))' }} />alerta (≤ 50%)</span>
              </p>
            </Card>

            <Card title="Valor a comprar por fornecedor" subtitle="Clique numa barra para filtrar a lista e extrair o pedido daquele fornecedor">
              {porFornecedorGraf.length === 0 ? <Empty icon={<Truck size={24} />} title="Nada em alerta" /> : (
                <div style={{ height: Math.max(180, porFornecedorGraf.length * 34) }} className="w-full">
                  <ResponsiveContainer>
                    <BarChart data={porFornecedorGraf} layout="vertical" margin={{ left: 4, right: 70, top: 4, bottom: 4 }} onClick={(e) => { const n = (e as { activePayload?: { payload: { completo: string } }[] })?.activePayload?.[0]?.payload.completo; if (n) setFornecedorSel((f) => (f === n ? '' : n)); }}>
                      <CartesianGrid stroke="rgb(var(--c-line))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'rgb(var(--c-faint))' }} axisLine={false} tickLine={false} tickFormatter={(v) => brl(Number(v)).replace('R$', '').trim()} />
                      <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 11, fill: 'rgb(var(--c-muted))' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={estiloTooltip} formatter={(v, _n, p) => [`${brl(Number(v))} · ${p.payload.itens} item(ns)${p.payload.zerados ? ` · ${p.payload.zerados} zerado(s)` : ''}`, p.payload.completo]} />
                      <Bar dataKey="valor" radius={[0, 4, 4, 0]} barSize={14} minPointSize={3} cursor="pointer">
                        {porFornecedorGraf.map((f) => <Cell key={f.completo} fill={fornecedorSel && fornecedorSel !== f.completo ? 'rgb(var(--c-line))' : 'rgb(var(--c-brand))'} />)}
                        <LabelList dataKey="valor" position="right" formatter={(v: number) => brl(v)} style={{ fontSize: 11, fill: 'rgb(var(--c-muted))' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Situação do catálogo" subtitle="Quantos produtos estão em cada faixa da régua">
              <div className="flex items-center gap-4">
                <div className="h-[180px] w-[180px] shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={situacaoGraf} dataKey="valor" nameKey="nome" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="rgb(var(--c-surface))" strokeWidth={2}>
                        {situacaoGraf.map((x) => <Cell key={x.nome} fill={x.cor} />)}
                      </Pie>
                      <Tooltip contentStyle={estiloTooltip} formatter={(v, n) => [`${int(Number(v))} produto(s)`, String(n)]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2 text-[13px]">
                  {situacaoGraf.map((x) => (
                    <li key={x.nome} className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: x.cor }} />
                      <span className="text-muted">{x.nome}</span>
                      <b className="tnum">{int(x.valor)}</b>
                      <span className="text-[11.5px] text-faint">({compras.resumo.produtos ? Math.round((x.valor / compras.resumo.produtos) * 100) : 0}%)</span>
                    </li>
                  ))}
                </ul>
              </div>
              {porCategoriaGraf.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-1 text-[12px] font-semibold text-muted">Itens em alerta por categoria</p>
                  <ul className="space-y-1.5">
                    {porCategoriaGraf.map((c) => (
                      <li key={c.completo} className="flex items-center gap-2 text-[12.5px]">
                        <span className="w-[120px] truncate text-muted" title={c.completo}>{c.nome}</span>
                        <span className="h-2 rounded-sm" style={{ width: `${Math.max(4, (c.alerta / Math.max(1, porCategoriaGraf[0].alerta)) * 100)}%`, maxWidth: 140, background: 'rgb(var(--c-danger))' }} />
                        <b className="tnum">{c.alerta}</b><span className="text-[11px] text-faint">de {c.produtos}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>

          <Card
            title="Lista de compra"
            subtitle={`Regra: estoque sugerido é a quantidade que deve haver; quando o total dos depósitos chega a 50% dele, o item entra aqui com o que falta para voltar ao sugerido.${fornecedorSel ? ` · Filtrando: ${fornecedorSel}` : ''}`}
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  ['alerta', `Comprar (${compras.resumo.alertaCompra})`],
                  ['semMinimo', `Sem sugerido (${compras.resumo.semMinimo})`],
                  ['todos', `Todos (${compras.resumo.produtos})`],
                ] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setFiltroCompra(k)} aria-pressed={filtroCompra === k} className={cx('chip', filtroCompra === k ? 'bg-brand/15 text-brand' : 'bg-line/60 text-muted')}>{label}</button>
                ))}
                <select value={fornecedorSel} onChange={(e) => setFornecedorSel(e.target.value)} className="field field-sm ml-1 w-[200px]" aria-label="Filtrar por fornecedor">
                  <option value="">Todos os fornecedores</option>
                  {compras.porFornecedor.map((f) => <option key={f.fornecedor} value={f.fornecedor}>{f.fornecedor} ({f.itensParaComprar})</option>)}
                </select>
              </div>
            }
          >
            <Table
              rows={listaCompra}
              keyOf={(r) => r.productId}
              empty={<Empty icon={<TrendingUp size={24} />} title="Nada nesta lista" body="Troque o filtro acima para ver as outras situações." />}
              columns={[
                { key: 's', header: 'Situação', render: (r) => r.situacao === 'ALERTA_COMPRA'
                  ? <Badge tone={r.urgencia === 'ZERADO' ? 'danger' : r.urgencia === 'CRITICO' ? 'warn' : 'danger'}>{r.urgencia === 'ZERADO' ? 'ZERADO' : r.urgencia === 'CRITICO' ? 'crítico' : 'comprar'}</Badge>
                  : <Badge tone={TOM_SITUACAO[r.situacao]}>{ROTULO_SITUACAO[r.situacao]}</Badge> },
                { key: 'p', header: 'Produto', render: (r) => (
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="font-mono text-[11.5px] text-faint">{r.sku}{r.categoria ? ` · ${r.categoria}` : ''}{r.fornecedor ? ` · ${r.fornecedor}` : ''}</p>
                  </div>
                ) },
                ...compras.depositos.map((d) => ({
                  key: `d-${d.id}`,
                  header: d.code,
                  align: 'right' as const,
                  render: (r: LinhaCompra) => qty(r.depositos.find((x) => x.id === d.id)?.quantity ?? 0),
                })),
                { key: 't', header: 'TOTAL', align: 'right', render: (r) => <b className="tnum">{qty(r.total)} <span className="text-[11px] font-normal text-faint">{r.unit}</span></b> },
                { key: 'm', header: 'Sugerido', align: 'right', render: (r) => qty(r.minStock) },
                { key: 'f', header: '% restante', align: 'right', render: (r) => r.fracaoRestante == null ? '—' : (
                  <div className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-14 overflow-hidden rounded-full bg-line"><span className="block h-full" style={{ width: `${Math.round(r.fracaoRestante * 100)}%`, background: r.situacao === 'ALERTA_COMPRA' ? corUrgencia(r.urgencia) : 'rgb(var(--c-ok))' }} /></span>
                    <span className="tnum text-[12.5px]">{Math.round(r.fracaoRestante * 100)}%</span>
                  </div>
                ) },
                { key: 'c', header: 'Comprar', align: 'right', render: (r) => r.comprarParaRepor ? <b className="text-danger">{qty(r.comprarParaRepor)}</b> : '—' },
                { key: 'v', header: 'Valor est.', align: 'right', render: (r) => r.comprarParaRepor ? brl(r.comprarParaRepor * r.custoMedio) : '—' },
                { key: 'x', header: 'Saídas 90d', align: 'right', render: (r) => qty(r.saidas90) },
                { key: 'cb', header: 'Cobertura', align: 'right', render: (r) => r.coberturaDias == null ? '—' : `${int(r.coberturaDias)} d` },
              ]}
            />
            {listaCompra.some((i) => i.comprarParaRepor > 0) && (
              <p className="mt-3 text-right text-[13.5px]">
                <span className="text-muted">{listaCompra.filter((i) => i.comprarParaRepor > 0).length} item(ns) · valor estimado </span><b className="tnum">{brl(valorLista)}</b>
              </p>
            )}
            <p className="mt-3 text-[12.5px] text-faint">
              Use <b>Extrair relatório</b> (no topo) para baixar em Excel (resumo, lista, por fornecedor, por categoria, todos, sem sugerido), PDF para imprimir ou mandar no WhatsApp, ou CSV. Com um fornecedor filtrado, dá para extrair só o pedido dele.
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
            title="Unidades com casa decimal na base"
            subtitle="Confira antes de corrigir: a plataforma só arredonda o que não é medida"
          >
            {!fracionados || fracionados.unidades.length === 0 ? (
              <Empty icon={<Ruler size={24} />} title="Nenhum saldo com casa decimal" body="Toda a base está com número redondo ou em unidade de medida." />
            ) : (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-line bg-raised p-3.5">
                    <p className="text-[12.5px] text-muted">Vai ser arredondado</p>
                    <p className="text-[20px] font-bold tnum text-warn">{int(fracionados.aArredondar)}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-raised p-3.5">
                    <p className="text-[12.5px] text-muted">Preservado (é metragem/peso/volume)</p>
                    <p className="text-[20px] font-bold tnum text-ok">{int(fracionados.preservados)}</p>
                  </div>
                </div>
                <Table
                  rows={fracionados.unidades}
                  keyOf={(u) => u.normalizada}
                  columns={[
                    { key: 'u', header: 'Unidade cadastrada', render: (u) => (
                      <div><p className="font-medium">{u.unidade}</p><p className="font-mono text-[11.5px] text-faint">lida como {u.normalizada}</p></div>
                    ) },
                    { key: 't', header: 'Tratamento', render: (u) => (
                      <Badge tone={u.medida ? 'ok' : 'warn'}>{u.medida ? 'medida · preserva a fração' : 'unidade · arredonda'}</Badge>
                    ) },
                    { key: 'q', header: 'Saldos quebrados', align: 'right', render: (u) => int(u.saldosQuebrados) },
                    { key: 'p', header: 'Produtos', align: 'right', render: (u) => int(u.produtos) },
                    { key: 'e', header: 'Exemplos', render: (u) => (
                      <span className="text-[12.5px] text-muted">{u.exemplos.slice(0, 2).join(' · ')}</span>
                    ) },
                  ]}
                />
                <p className="mt-4 text-[12.5px] text-faint">
                  Se alguma unidade de medida estiver marcada como “arredonda”, corrija a unidade no
                  cadastro do produto (MT, M², KG, L…) antes de mandar arredondar.
                </p>
              </>
            )}
          </Card>

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
