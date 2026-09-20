import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlarmClock, ChevronRight, FileText, FolderOpen, LayoutTemplate, Plus, Search, Sparkles, TrendingUp,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Badge, brl, Card, cx, dOnly, Empty, Field, Input, int, Modal, Select, Spinner, Stat, Table, useToast } from '../lib/ui';
import { useAuth } from '../App';

export const STATUS_ROTULO: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  AGUARDANDO_RETORNO: 'Aguardando retorno',
  EM_NEGOCIACAO: 'Em negociação',
  ACEITA: 'Aceita',
  RECUSADA: 'Recusada',
  EXPIRADA: 'Expirada',
  CANCELADA: 'Cancelada',
};
export const STATUS_TOM: Record<string, 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand'> = {
  RASCUNHO: 'neutral', ENVIADA: 'info', AGUARDANDO_RETORNO: 'warn', EM_NEGOCIACAO: 'brand',
  ACEITA: 'ok', RECUSADA: 'danger', EXPIRADA: 'warn', CANCELADA: 'neutral',
};

interface Linha {
  id: string; number: number; status: string; clientName: string; clientLocal: string | null;
  clientPhone: string | null; scopeTitle: string; totalValue: number; itens: number;
  vendedor: string; createdAt: string; validUntil: string | null; followUpAt: string | null;
}
interface Modelo {
  id: string; name: string; scopeTitle: string; usageCount: number; validityDays: number;
  items: { id: string; description: string; total: number }[]; valorBase: number;
  _count: { proposals: number };
}
interface Pasta {
  chave: string; cliente: string; telefone: string | null; local: string | null;
  propostas: Linha[]; total: number; emAberto: number; ganhas: number;
}

export default function Propostas() {
  const [aba, setAba] = useState<'propostas' | 'pastas' | 'modelos'>('propostas');
  const [resumo, setResumo] = useState<any>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [filtro, setFiltro] = useState({ status: '', search: '' });
  const [carregando, setCarregando] = useState(true);
  const [nova, setNova] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const { me } = useAuth();
  const podeGerenciarModelos = me?.user.role === 'OWNER' || me?.user.role === 'ADMIN';
  const [carregandoPadroes, setCarregandoPadroes] = useState(false);

  const carregar = async () => {
    const qs = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v) as [string, string][]);
    const [r, l, p, m] = await Promise.all([
      api.get<any>('/proposals/resumo'),
      api.get<{ items: Linha[] }>(`/proposals?${qs}`),
      api.get<Pasta[]>('/proposals/clientes'),
      api.get<Modelo[]>('/proposal-templates'),
    ]);
    setResumo(r); setLinhas(l.items); setPastas(p); setModelos(m); setCarregando(false);
  };

  useEffect(() => { const t = setTimeout(() => void carregar(), 250); return () => clearTimeout(t); }, [filtro]);

  const criar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const p = await api.post<{ id: string; number: number }>('/proposals', {
        ...f,
        templateId: f.templateId || undefined,
      });
      toast({ kind: 'ok', title: `Proposta #${p.number} criada`, body: 'Monte os itens e exporte quando quiser.' });
      nav(`/app/propostas/${p.id}`);
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível criar', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  const carregarModelosPadrao = async () => {
    setCarregandoPadroes(true);
    try {
      const r = await api.post<{ criados: string[]; pulados: string[] }>('/proposal-templates/seed-jundiaquece');
      if (r.criados.length) {
        toast({ kind: 'ok', title: `${r.criados.length} modelo(s) carregado(s)`, body: r.criados.join(', ') });
      } else {
        toast({ kind: 'ok', title: 'Nenhum modelo novo', body: 'Os 5 modelos já estavam cadastrados.' });
      }
      void carregar();
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível carregar os modelos', body: err instanceof ApiError ? err.message : undefined });
    } finally { setCarregandoPadroes(false); }
  };

  if (carregando) return <Spinner label="Carregando propostas…" />;

  const abas = [
    { k: 'propostas' as const, label: 'Propostas', icon: FileText, contagem: linhas.length },
    { k: 'pastas' as const, label: 'Pastas por cliente', icon: FolderOpen, contagem: pastas.length },
    { k: 'modelos' as const, label: 'Modelos', icon: LayoutTemplate, contagem: modelos.length },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Gestão de propostas</h1>
          <p className="mt-1 text-[14px] text-muted">
            Do modelo ao fechamento — com os itens amarrados ao estoque.
          </p>
        </div>
        <button onClick={() => setNova(true)} className="btn-primary btn-sm gap-2">
          <Plus size={16} /> Nova proposta
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Em aberto" value={brl(resumo.totalAberto)} sub={`${
          ['RASCUNHO','ENVIADA','AGUARDANDO_RETORNO','EM_NEGOCIACAO']
            .reduce((a, s) => a + (resumo.porStatus[s]?.quantidade ?? 0), 0)
        } proposta(s)`} icon={<FileText size={18} />} />
        <Stat label="Fechado" value={brl(resumo.ganho)} sub={`${resumo.porStatus.ACEITA?.quantidade ?? 0} aceita(s)`} tone="ok" icon={<TrendingUp size={18} />} />
        <Stat label="Taxa de conversão" value={`${resumo.taxaConversao.toFixed(0)}%`} sub={`${resumo.porStatus.RECUSADA?.quantidade ?? 0} recusada(s)`} />
        <Stat
          label="Follow-up atrasado"
          value={int(resumo.followUpAtrasado.length)}
          sub={resumo.vencendoEm3Dias.length ? `${resumo.vencendoEm3Dias.length} vencendo em 3 dias` : 'nada vencendo'}
          tone={resumo.followUpAtrasado.length ? 'warn' : 'ok'}
          icon={<AlarmClock size={18} />}
        />
      </div>

      {(resumo.followUpAtrasado.length > 0 || resumo.vencendoEm3Dias.length > 0) && (
        <Card title="Precisa de atenção" subtitle="Retornos atrasados e propostas perto de vencer">
          <ul className="divide-y divide-line">
            {[...resumo.followUpAtrasado.map((p: any) => ({ ...p, motivo: 'follow-up atrasado' })),
              ...resumo.vencendoEm3Dias.map((p: any) => ({ ...p, motivo: 'validade vencendo' }))]
              .slice(0, 6)
              .map((p: any) => (
                <li key={p.id + p.motivo}>
                  <Link to={`/app/propostas/${p.id}`} className="flex items-center gap-3 py-3 transition-colors hover:text-brand">
                    <Badge tone="warn">{p.motivo}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">#{p.number} · {p.clientName}</span>
                    <span className="text-[13px] tnum text-muted">{brl(p.total)}</span>
                    <ChevronRight size={15} className="text-faint" />
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {abas.map((a) => (
          <button
            key={a.k}
            onClick={() => setAba(a.k)}
            aria-pressed={aba === a.k}
            className={cx(
              'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-semibold transition-colors',
              aba === a.k ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-muted hover:border-faint',
            )}
          >
            <a.icon size={16} /> {a.label}
            <span className="rounded-full bg-line/70 px-1.5 text-[11px] tnum text-muted">{a.contagem}</span>
          </button>
        ))}
      </div>

      {aba === 'propostas' && (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" size={17} aria-hidden />
              <input
                value={filtro.search}
                onChange={(e) => setFiltro({ ...filtro, search: e.target.value })}
                placeholder="Buscar por cliente, escopo ou local"
                className="field pl-10"
                aria-label="Buscar propostas"
              />
            </div>
            <div className="w-full sm:w-56">
              <Select value={filtro.status} onChange={(e) => setFiltro({ ...filtro, status: e.target.value })} aria-label="Filtrar por status">
                <option value="">Todos os status</option>
                {Object.entries(STATUS_ROTULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>

          <Card>
            <Table
              rows={linhas}
              keyOf={(r) => r.id}
              empty={<Empty icon={<FileText size={24} />} title="Nenhuma proposta ainda" body="Crie a primeira a partir de um modelo — leva menos de um minuto." action={<button onClick={() => setNova(true)} className="btn-primary btn-sm mt-2 gap-2"><Plus size={15} /> Nova proposta</button>} />}
              columns={[
                { key: 'n', header: '#', render: (r) => <span className="font-mono text-[12.5px] text-faint">{String(r.number).padStart(4, '0')}</span> },
                { key: 'c', header: 'Cliente', render: (r) => (
                  <Link to={`/app/propostas/${r.id}`} className="block">
                    <p className="font-medium text-ink hover:text-brand">{r.clientName}</p>
                    <p className="text-[11.5px] text-faint">{r.clientLocal ?? r.scopeTitle.slice(0, 48)}</p>
                  </Link>
                ) },
                { key: 's', header: 'Status', render: (r) => <Badge tone={STATUS_TOM[r.status]}>{STATUS_ROTULO[r.status]}</Badge> },
                { key: 'i', header: 'Itens', align: 'right', render: (r) => r.itens },
                { key: 'v', header: 'Valor', align: 'right', render: (r) => <b>{brl(r.totalValue)}</b> },
                { key: 'd', header: 'Criada', align: 'right', render: (r) => <span className="text-[12.5px] text-faint">{dOnly(r.createdAt)}</span> },
                { key: 'val', header: 'Vale até', align: 'right', render: (r) => (
                  <span className={cx('text-[12.5px]', r.validUntil && new Date(r.validUntil) < new Date() ? 'font-semibold text-danger' : 'text-faint')}>
                    {r.validUntil ? dOnly(r.validUntil) : '—'}
                  </span>
                ) },
              ]}
            />
          </Card>
        </>
      )}

      {aba === 'pastas' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pastas.length === 0 && <Empty icon={<FolderOpen size={24} />} title="Nenhum cliente ainda" body="A pasta nasce junto com a primeira proposta do cliente." />}
          {pastas.map((p) => (
            <Card key={p.chave} className="!p-0">
              <div className="p-5">
                <div className="flex items-start gap-2.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand">
                    <FolderOpen size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">{p.cliente}</p>
                    <p className="truncate text-[11.5px] text-faint">{[p.telefone, p.local].filter(Boolean).join(' · ') || 'sem contato'}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                  <span>{p.propostas.length} proposta(s)</span>
                  {p.emAberto > 0 && <span className="font-medium text-warn">{p.emAberto} em aberto</span>}
                  {p.ganhas > 0 && <span className="font-medium text-ok">{p.ganhas} fechada(s)</span>}
                </div>
                <p className="mt-2 text-[20px] font-bold tnum">{brl(p.total)}</p>
                <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                  {p.propostas.slice(0, 4).map((pr) => (
                    <li key={pr.id}>
                      <Link to={`/app/propostas/${pr.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-line/40">
                        <span className="font-mono text-[11.5px] text-faint">{String(pr.number).padStart(4, '0')}</span>
                        <Badge tone={STATUS_TOM[pr.status]}>{STATUS_ROTULO[pr.status]}</Badge>
                        <span className="ml-auto tnum text-muted">{brl(pr.totalValue)}</span>
                      </Link>
                    </li>
                  ))}
                  {p.propostas.length > 4 && <li className="px-2 text-[12px] text-faint">+{p.propostas.length - 4} outra(s)</li>}
                </ul>
              </div>
            </Card>
          ))}
        </div>
      )}

      {aba === 'modelos' && (
        <Card
          title="Modelos salvos"
          subtitle="Cada modelo já vem com escopo, itens, condições e validade"
          action={
            podeGerenciarModelos ? (
              <button onClick={carregarModelosPadrao} disabled={carregandoPadroes} className="btn-ghost btn-sm gap-1.5">
                <Sparkles size={14} /> {carregandoPadroes ? 'Carregando…' : 'Carregar os 5 modelos reais (SORIA, RINNAI, SOLIS, Piscina, Trocador)'}
              </button>
            ) : (
              <span className="text-[12.5px] text-faint">Salve qualquer proposta como modelo pela tela dela</span>
            )
          }
        >
          <Table
            rows={modelos}
            keyOf={(m) => m.id}
            empty={<Empty icon={<LayoutTemplate size={24} />} title="Nenhum modelo ainda" body="Monte uma proposta e use “Salvar como modelo” para reaproveitar depois." />}
            columns={[
              { key: 'n', header: 'Modelo', render: (m) => (
                <div><p className="font-medium">{m.name}</p><p className="text-[11.5px] text-faint">{m.scopeTitle.slice(0, 70)}</p></div>
              ) },
              { key: 'i', header: 'Itens', align: 'right', render: (m) => m.items.length },
              { key: 'v', header: 'Valor base', align: 'right', render: (m) => brl(m.valorBase) },
              { key: 'u', header: 'Usos', align: 'right', render: (m) => m.usageCount },
              { key: 'a', header: '', align: 'right', render: (m) => (
                <button onClick={() => { setNova(true); queueMicrotask(() => { const s = document.querySelector<HTMLSelectElement>('select[name=templateId]'); if (s) s.value = m.id; }); }} className="btn-ghost btn-sm">
                  Usar
                </button>
              ) },
            ]}
          />
        </Card>
      )}

      <Modal open={nova} onClose={() => setNova(false)} title="Nova proposta" wide>
        <form onSubmit={criar} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Partir de um modelo" hint="Traz escopo, itens, condições e validade prontos">
              <Select name="templateId" defaultValue="">
                <option value="">Começar em branco</option>
                {modelos.map((m) => <option key={m.id} value={m.id}>{m.name} — {brl(m.valorBase)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Cliente" required hint="Vira a pasta onde a proposta fica guardada">
            <Input name="clientName" required placeholder="SRº FABIO" />
          </Field>
          <Field label="Telefone"><Input name="clientPhone" placeholder="(11) 98245-7947" /></Field>
          <div className="sm:col-span-2">
            <Field label="Local"><Input name="clientLocal" placeholder="RESERVA DA MATA - JUNDIAÍ / SP" /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Escopo" hint="Deixe em branco para usar o do modelo">
              <Input name="scopeTitle" placeholder="SISTEMA DE AQUECIMENTO VIA SOLAR PARA A ÁGUA DA CASA. FABRICANTE: SOLIS" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setNova(false)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary gap-2"><Plus size={16} /> Criar proposta</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
