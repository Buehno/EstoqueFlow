import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, Copy, Download, FileSpreadsheet, FileText, FileType2, LayoutTemplate,
  MessageSquarePlus, Plus, Save, Send, TriangleAlert,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Badge, brl, Card, cx, dt, Field, Input, Modal, Select, Spinner, useToast } from '../lib/ui';
import ItemEditor, { type ItemProposta } from '../components/ItemEditor';
import { STATUS_ROTULO, STATUS_TOM } from './Propostas';

const novaChave = () => Math.random().toString(36).slice(2);

export default function PropostaEditor() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const [p, setP] = useState<any>(null);
  const [itens, setItens] = useState<ItemProposta[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [modal, setModal] = useState<'status' | 'nota' | 'modelo' | null>(null);

  const carregar = async () => {
    const d = await api.get<any>(`/proposals/${id}`);
    setP(d);
    setItens(
      d.items.map((i: any) => ({
        key: novaChave(),
        quantity: i.quantity,
        quantityText: i.quantityText ?? String(i.quantity),
        description: i.description,
        unitPrice: i.unitPrice,
        total: i.total,
        productId: i.productId,
        produtoNome: i.product?.name ?? null,
        saldo: i.stockAtInsert,
        imageUrl: i.imageUrl ?? null,
      })),
    );
    setSujo(false);
  };
  useEffect(() => { void carregar(); }, [id]);

  const encerrada = p && ['ACEITA', 'CANCELADA'].includes(p.status);
  const subtotal = useMemo(() => itens.reduce((a, i) => a + (i.total || 0), 0), [itens]);
  const total = Math.max(0, subtotal - (p?.discount ?? 0));

  const mexer = (fn: (l: ItemProposta[]) => ItemProposta[]) => { setItens(fn); setSujo(true); };
  const campo = (chave: string, valor: unknown) => { setP((a: any) => ({ ...a, [chave]: valor })); setSujo(true); };

  const salvar = async () => {
    setSalvando(true);
    try {
      await api.put(`/proposals/${id}/itens`, {
        items: itens.map((i) => ({
          quantity: i.quantity, quantityText: i.quantityText, description: i.description,
          unitPrice: i.unitPrice, total: i.total, productId: i.productId ?? null,
          imageUrl: i.imageUrl ?? null,
        })),
      });
      await api.patch(`/proposals/${id}`, {
        clientName: p.clientName, clientPhone: p.clientPhone, clientLocal: p.clientLocal, clientEmail: p.clientEmail,
        scopeTitle: p.scopeTitle, intro: p.intro, discount: p.discount, cashTotal: p.cashTotal,
        paymentTerms: p.paymentTerms, paymentCash: p.paymentCash, deliveryTerms: p.deliveryTerms,
        validityDays: p.validityDays, closingNote: p.closingNote, footerNote: p.footerNote,
        salesRep: p.salesRep, city: p.city, notes: p.notes,
      });
      await carregar();
      toast({ kind: 'ok', title: 'Proposta salva' });
    } catch (e) {
      const err = e as ApiError;
      toast({
        kind: 'err',
        title: 'Não foi possível salvar',
        body: err.details?.length
          ? `${err.message} — ${(err.details as any[]).map((d) => d.produto ?? d.campo).join(', ')}`
          : err.message,
      });
    } finally { setSalvando(false); }
  };

  const exportar = (formato: 'pdf' | 'docx' | 'xlsx') =>
    api.download(`/proposals/${id}/export/${formato}`, `proposta-${p.number}.${formato}`);

  const mudarStatus = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api.post(`/proposals/${id}/status`, {
        status: f.status,
        message: f.message || undefined,
        lostReason: f.status === 'RECUSADA' ? f.message : undefined,
        followUpAt: f.followUpAt || undefined,
      });
      setModal(null); await carregar();
      toast({ kind: 'ok', title: `Status: ${STATUS_ROTULO[f.status]}` });
    } catch (err) {
      const e2 = err as ApiError;
      toast({ kind: 'err', title: 'Não foi possível alterar', body: e2.message });
    }
  };

  const anotar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await api.post(`/proposals/${id}/eventos`, { type: f.type, message: f.message, followUpAt: f.followUpAt || undefined });
    setModal(null); await carregar();
    toast({ kind: 'ok', title: 'Anotado na linha do tempo' });
  };

  const salvarModelo = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api.post(`/proposals/${id}/salvar-como-modelo`, { name: f.name });
      setModal(null);
      toast({ kind: 'ok', title: 'Modelo salvo', body: 'Já aparece na lista de modelos.' });
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível salvar', body: (err as ApiError).message });
    }
  };

  if (!p) return <Spinner label="Abrindo a proposta…" />;

  const alertas = p.alertasEstoque ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <button onClick={() => nav('/app/propostas')} className="mb-1 flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
            <ArrowLeft size={14} /> Voltar às propostas
          </button>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[26px] font-bold tracking-tight">Proposta #{String(p.number).padStart(4, '0')}</h1>
            <Badge tone={STATUS_TOM[p.status]}>{STATUS_ROTULO[p.status]}</Badge>
            {sujo && <Badge tone="warn">alterações não salvas</Badge>}
          </div>
          <p className="mt-1 text-[14px] text-muted">{p.clientName} · {p.clientLocal ?? 'sem local'}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => exportar('pdf')} className="btn-ghost btn-sm gap-1.5"><FileText size={15} /> PDF</button>
          <button onClick={() => exportar('docx')} className="btn-ghost btn-sm gap-1.5"><FileType2 size={15} /> Word</button>
          <button onClick={() => exportar('xlsx')} className="btn-ghost btn-sm gap-1.5"><FileSpreadsheet size={15} /> Excel</button>
          <button onClick={() => setModal('status')} className="btn-ghost btn-sm gap-1.5"><Send size={15} /> Status</button>
          {!encerrada && (
            <button onClick={salvar} disabled={salvando} className="btn-primary btn-sm gap-1.5">
              <Save size={15} /> {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </header>

      {alertas.length > 0 && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-danger">
            <TriangleAlert size={17} /> {alertas.length} item(ns) sem estoque suficiente
          </p>
          <ul className="mt-2 space-y-1 text-[13px] text-muted">
            {alertas.map((a: any, i: number) => (
              <li key={i}>
                <b className="text-ink">{a.produto}</b> — pedido {a.solicitado}, disponível {a.disponivel}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-muted">Reponha o estoque ou troque o item: a proposta não pode ser enviada assim.</p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ─────────── o documento ─────────── */}
        <div className="space-y-5">
          <Card title="Cliente" subtitle="É o cabeçalho que sai impresso no documento">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cliente" required><Input value={p.clientName ?? ''} disabled={encerrada} onChange={(e) => campo('clientName', e.target.value)} /></Field>
              <Field label="Telefone"><Input value={p.clientPhone ?? ''} disabled={encerrada} onChange={(e) => campo('clientPhone', e.target.value)} /></Field>
              <Field label="Local"><Input value={p.clientLocal ?? ''} disabled={encerrada} onChange={(e) => campo('clientLocal', e.target.value)} /></Field>
              <Field label="E-mail"><Input value={p.clientEmail ?? ''} disabled={encerrada} onChange={(e) => campo('clientEmail', e.target.value)} /></Field>
            </div>
          </Card>

          <Card title="Escopo">
            <Field label="Título da proposta" hint="Sai centralizado, em destaque, acima da tabela">
              <textarea
                value={p.scopeTitle ?? ''}
                disabled={encerrada}
                onChange={(e) => campo('scopeTitle', e.target.value)}
                rows={2}
                className="field h-auto w-full resize-none py-2.5 text-[14px]"
              />
            </Field>
          </Card>

          <Card
            title="Itens da proposta"
            subtitle="Digite /peça na descrição para trazer do estoque"
            action={!encerrada && (
              <button
                onClick={() => mexer((l) => [...l, { key: novaChave(), quantity: 1, quantityText: '01', description: '', unitPrice: 0, total: 0 }])}
                className="btn-ghost btn-sm gap-1.5"
              >
                <Plus size={15} /> Adicionar item
              </button>
            )}
          >
            <div className="space-y-3">
              {itens.length === 0 && (
                <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13.5px] text-muted">
                  Nenhum item ainda. Clique em “Adicionar item” e digite <code className="rounded bg-line/70 px-1 font-mono text-brand">/peça</code> para puxar do estoque.
                </p>
              )}
              {itens.map((item, i) => (
                <ItemEditor
                  key={item.key}
                  item={item}
                  indice={i}
                  somenteLeitura={encerrada}
                  onChange={(novo) => mexer((l) => l.map((x) => (x.key === item.key ? novo : x)))}
                  onRemove={() => mexer((l) => l.filter((x) => x.key !== item.key))}
                  onSubir={i > 0 ? () => mexer((l) => { const c = [...l]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; }) : undefined}
                  onDescer={i < itens.length - 1 ? () => mexer((l) => { const c = [...l]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; return c; }) : undefined}
                />
              ))}
            </div>

            <dl className="mt-5 space-y-1.5 border-t border-line pt-4 text-[14px]">
              <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="tnum">{brl(subtotal)}</dd></div>
              <div className="flex items-center justify-between text-muted">
                <dt>Desconto</dt>
                <dd>
                  <input
                    type="number" step="0.01" min="0" disabled={encerrada}
                    value={p.discount ?? 0}
                    onChange={(e) => campo('discount', Number(e.target.value) || 0)}
                    className="field field-sm w-32 text-right tnum"
                    aria-label="Desconto"
                  />
                </dd>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <dt className="text-[15px] font-semibold">Valor Total da Proposta</dt>
                <dd className="text-[26px] font-bold tnum">{brl(total)}</dd>
              </div>
              {p.totalInWords && <p className="text-right text-[12.5px] italic text-faint">{p.totalInWords}</p>}
            </dl>
          </Card>

          <Card title="Condições comerciais">
            <div className="space-y-4">
              <Field label="Condições de pagamento">
                <textarea value={p.paymentTerms ?? ''} disabled={encerrada} onChange={(e) => campo('paymentTerms', e.target.value)} rows={2} className="field h-auto w-full resize-none py-2.5 text-[14px]" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <Field label="Condição à vista"><Input value={p.paymentCash ?? ''} disabled={encerrada} onChange={(e) => campo('paymentCash', e.target.value)} /></Field>
                <Field label="Valor à vista (R$)">
                  <Input type="number" step="0.01" min="0" value={p.cashTotal ?? ''} disabled={encerrada} onChange={(e) => campo('cashTotal', e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
                <Field label="Prazo de entrega"><Input value={p.deliveryTerms ?? ''} disabled={encerrada} onChange={(e) => campo('deliveryTerms', e.target.value)} /></Field>
                <Field label="Validade (dias)"><Input type="number" min="1" value={p.validityDays} disabled={encerrada} onChange={(e) => campo('validityDays', Number(e.target.value) || 10)} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vendedor"><Input value={p.salesRep ?? ''} disabled={encerrada} onChange={(e) => campo('salesRep', e.target.value)} /></Field>
                <Field label="Cidade"><Input value={p.city ?? ''} disabled={encerrada} onChange={(e) => campo('city', e.target.value)} /></Field>
              </div>
              <Field label="Fechamento" hint="Texto acima da assinatura">
                <textarea value={p.closingNote ?? ''} disabled={encerrada} onChange={(e) => campo('closingNote', e.target.value)} rows={3} className="field h-auto w-full resize-none py-2.5 text-[14px]" />
              </Field>
              <Field label="Observação final" hint="Bloco IMPORTANTE! no rodapé">
                <textarea value={p.footerNote ?? ''} disabled={encerrada} onChange={(e) => campo('footerNote', e.target.value)} rows={3} className="field h-auto w-full resize-none py-2.5 text-[14px]" />
              </Field>
            </div>
          </Card>
        </div>

        {/* ─────────── gestão da negociação ─────────── */}
        <aside className="space-y-4 xl:sticky xl:top-[88px] xl:self-start">
          <Card title="Negociação">
            <dl className="space-y-2 text-[13.5px]">
              <div className="flex justify-between"><dt className="text-muted">Criada</dt><dd>{dt(p.createdAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Enviada</dt><dd>{p.sentAt ? dt(p.sentAt) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Retorno</dt><dd>{p.respondedAt ? dt(p.respondedAt) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Vale até</dt><dd className={cx(p.validUntil && new Date(p.validUntil) < new Date() && 'font-semibold text-danger')}>{p.validUntil ? dt(p.validUntil) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Próximo contato</dt><dd>{p.followUpAt ? dt(p.followUpAt) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Vendedor</dt><dd>{p.user?.name}</dd></div>
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setModal('nota')} className="btn-ghost btn-sm gap-1.5"><MessageSquarePlus size={15} /> Anotar</button>
              <button onClick={() => setModal('status')} className="btn-ghost btn-sm gap-1.5"><Send size={15} /> Status</button>
              <button onClick={() => setModal('modelo')} className="btn-ghost btn-sm gap-1.5"><LayoutTemplate size={15} /> Virar modelo</button>
              <button
                onClick={async () => {
                  const nova = await api.post<{ id: string; number: number }>(`/proposals/${id}/duplicar`);
                  toast({ kind: 'ok', title: `Proposta #${nova.number} criada` });
                  nav(`/app/propostas/${nova.id}`);
                }}
                className="btn-ghost btn-sm gap-1.5"
              ><Copy size={15} /> Duplicar</button>
            </div>
          </Card>

          <Card title="Linha do tempo" subtitle="Tudo que aconteceu com esta proposta">
            <ol className="space-y-3">
              {p.events.map((e: any) => (
                <li key={e.id} className="relative border-l border-line pl-4">
                  <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden />
                  <p className="text-[13px] font-medium">
                    {e.type === 'STATUS_ALTERADO'
                      ? `${STATUS_ROTULO[e.fromStatus] ?? '—'} → ${STATUS_ROTULO[e.toStatus] ?? '—'}`
                      : e.type.replaceAll('_', ' ').toLowerCase()}
                  </p>
                  {e.message && <p className="mt-0.5 text-[12.5px] text-muted">{e.message}</p>}
                  <p className="mt-0.5 text-[11.5px] text-faint">{dt(e.createdAt)} · {e.userName ?? 'sistema'}</p>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      {/* ─────────── modais ─────────── */}
      <Modal open={modal === 'status'} onClose={() => setModal(null)} title="Mudar o estágio da negociação">
        <form onSubmit={mudarStatus} className="space-y-4">
          <Field label="Novo status" required>
            <Select name="status" required defaultValue={p.status}>
              {Object.entries(STATUS_ROTULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Observação" hint="Fica registrada na linha do tempo"><Input name="message" placeholder="Enviada por WhatsApp / cliente pediu desconto…" /></Field>
          <Field label="Próximo contato"><Input name="followUpAt" type="date" /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModal(null)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary gap-1.5"><Check size={16} /> Confirmar</button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'nota'} onClose={() => setModal(null)} title="Anotar na linha do tempo">
        <form onSubmit={anotar} className="space-y-4">
          <Field label="Tipo" required>
            <Select name="type" defaultValue="RETORNO_CLIENTE">
              <option value="RETORNO_CLIENTE">Retorno do cliente</option>
              <option value="FOLLOW_UP">Follow-up feito</option>
              <option value="NOTA">Nota interna</option>
            </Select>
          </Field>
          <Field label="O que aconteceu" required>
            <textarea name="message" required rows={3} className="field h-auto w-full resize-none py-2.5 text-[14px]" placeholder="Cliente ligou pedindo prazo maior…" />
          </Field>
          <Field label="Próximo contato"><Input name="followUpAt" type="date" /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModal(null)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary">Anotar</button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'modelo'} onClose={() => setModal(null)} title="Salvar como modelo">
        <form onSubmit={salvarModelo} className="space-y-4">
          <p className="rounded-xl bg-raised p-3.5 text-[13px] leading-relaxed text-muted">
            Guarda escopo, itens, condições, validade e vendedor. Na próxima proposta parecida,
            é só escolher o modelo e trocar o cliente.
          </p>
          <Field label="Nome do modelo" required><Input name="name" required placeholder="Solar Casa — Solis 400AP" /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModal(null)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary gap-1.5"><Download size={16} /> Salvar modelo</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
