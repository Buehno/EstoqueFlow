/**
 * Uma lista de compra: itens, quem fez o quê, mudança de status, entrada no
 * estoque ao marcar como comprada, exportar o pedido.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, FileSpreadsheet, FileText, Trash2 } from 'lucide-react';
import { api, ApiError, ROTULO_STATUS_LISTA, type ListaCompra, type Warehouse } from '../lib/api';
import { Badge, brl, Card, cx, dt, Modal, qty, Spinner, useToast } from '../lib/ui';
import { useAuth } from '../App';
import ProductSearch from '../components/ProductSearch';
import { TOM_STATUS } from './Compras';

interface Fornecedor { id: string; name: string }

export default function CompraDetalhe() {
  const { id = '' } = useParams();
  const [l, setL] = useState<ListaCompra | null>(null);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [depositos, setDepositos] = useState<Warehouse[]>([]);
  const [modal, setModal] = useState<'comprada' | 'cancelar' | 'excluir' | null>(null);
  const [darEntrada, setDarEntrada] = useState(true);
  const [deposito, setDeposito] = useState('');
  const [documento, setDocumento] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const { pode } = useAuth();
  const podeEntrada = pode('MOVIMENTAR_ESTOQUE');

  const carregar = useCallback(async () => setL(await api.get<ListaCompra>(`/purchase-lists/${id}`)), [id]);
  useEffect(() => {
    void carregar();
    api.get<Fornecedor[]>('/suppliers').then(setFornecedores).catch(() => undefined);
    api.get<Warehouse[]>('/warehouses').then((ws) => { setDepositos(ws); setDeposito((d) => d || ws.find((w) => w.isDefault)?.id || ws[0]?.id || ''); }).catch(() => undefined);
  }, [carregar]);

  const erro = (titulo: string, e: unknown) => toast({ kind: 'err', title: titulo, body: e instanceof ApiError ? e.message : undefined });
  const aplicar = async (fn: () => Promise<ListaCompra | void>, ok?: string) => {
    setOcupado(true);
    try { const r = await fn(); if (r) setL(r); if (ok) toast({ kind: 'ok', title: ok }); }
    catch (e) { erro('Não foi possível concluir', e); }
    finally { setOcupado(false); }
  };

  if (!l) return <Spinner label="Carregando lista…" />;
  const aberta = l.status === 'ABERTA';
  const encerrada = l.status === 'COMPRADA' || l.status === 'CANCELADA';
  const numero = `#${String(l.number).padStart(4, '0')}`;

  const editarCabecalho = (dados: Record<string, unknown>) => aplicar(() => api.patch<ListaCompra>(`/purchase-lists/${l.id}`, dados));
  const alterarItem = (itemId: string, dados: { quantity?: number; unitCost?: number }) =>
    aplicar(() => api.patch<ListaCompra>(`/purchase-lists/${l.id}/itens/${itemId}`, dados));
  const removerItem = (itemId: string) => aplicar(() => api.del<ListaCompra>(`/purchase-lists/${l.id}/itens/${itemId}`));
  const mudarStatus = (status: string, extra: Record<string, unknown> = {}) =>
    aplicar(async () => {
      const r = await api.post<ListaCompra>(`/purchase-lists/${l.id}/status`, { status, ...extra });
      setModal(null);
      if (status === 'COMPRADA') {
        toast({
          kind: 'ok', title: 'Lista marcada como comprada',
          body: extra.darEntrada ? `${r.entradasLancadas} entrada(s) no estoque${r.itensSemEntrada?.length ? ` · sem entrada: ${r.itensSemEntrada.join(', ')}` : ''}` : 'Sem entrada no estoque — lance pela tela de Entrada quando a mercadoria chegar.',
        });
      }
      return r;
    }, status === 'COMPRADA' ? undefined : `Lista ${ROTULO_STATUS_LISTA[status as keyof typeof ROTULO_STATUS_LISTA].toLowerCase()}`);
  const duplicar = () => aplicar(async () => { const n = await api.post<ListaCompra>(`/purchase-lists/${l.id}/duplicar`); nav(`/app/compras/${n.id}`); });
  const excluir = () => aplicar(async () => { await api.del(`/purchase-lists/${l.id}`); nav('/app/compras'); }, 'Lista excluída');
  const exportar = (f: 'pdf' | 'xlsx') => api.download(`/purchase-lists/${l.id}/export/${f}`, `pedido-${String(l.number).padStart(4, '0')}.${f}`);

  const linhaTempo: { quando: string; texto: string }[] = [
    { quando: l.createdAt, texto: `Montada por ${l.createdByName}` },
    ...(l.orderedAt ? [{ quando: l.orderedAt, texto: `Pedida ao fornecedor por ${l.orderedByName}` }] : []),
    ...(l.boughtAt ? [{ quando: l.boughtAt, texto: `Comprada (mercadoria recebida) por ${l.boughtByName}${l.stockedAt ? ` · entrada no estoque em ${depositos.find((d) => d.id === l.stockedWarehouseId)?.code ?? 'depósito'}` : ' · sem entrada no estoque'}` }] : []),
    ...(l.canceledAt ? [{ quando: l.canceledAt, texto: `Cancelada por ${l.canceledByName}` }] : []),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/app/compras" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> Compras</Link>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[14px] text-muted">{numero}</span>
            {aberta ? (
              <input
                defaultValue={l.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.name && editarCabecalho({ name: e.target.value })}
                className="field min-w-[260px] text-[18px] font-semibold" aria-label="Nome da lista" maxLength={160}
              />
            ) : <h1 className="text-[22px] font-bold tracking-tight">{l.name}</h1>}
            <Badge tone={TOM_STATUS[l.status]}>{ROTULO_STATUS_LISTA[l.status]}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => exportar('pdf')} className="btn-ghost btn-sm gap-1.5"><FileText size={15} /> Pedido em PDF</button>
          <button onClick={() => exportar('xlsx')} className="btn-ghost btn-sm gap-1.5"><FileSpreadsheet size={15} /> Excel</button>
          <button onClick={duplicar} disabled={ocupado} className="btn-ghost btn-sm gap-1.5"><Copy size={15} /> Duplicar</button>
          {(aberta || l.status === 'CANCELADA') && <button onClick={() => setModal('excluir')} className="btn-ghost btn-sm gap-1.5 text-danger hover:text-danger"><Trash2 size={15} /> Excluir</button>}
        </div>
      </header>

      {!encerrada && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3">
          <span className="mr-2 text-[13.5px] text-muted">Próximo passo:</span>
          {aberta && <button onClick={() => mudarStatus('PEDIDA')} disabled={ocupado || !l.items.length} className="btn-primary btn-sm">Marcar como pedida</button>}
          {l.status === 'PEDIDA' && <button onClick={() => mudarStatus('ABERTA')} disabled={ocupado} className="btn-ghost btn-sm">Voltar para aberta</button>}
          <button onClick={() => setModal('comprada')} disabled={ocupado || !l.items.length} className={cx('btn-sm', l.status === 'PEDIDA' ? 'btn-primary' : 'btn-ghost')}>Marcar como comprada</button>
          <button onClick={() => setModal('cancelar')} disabled={ocupado} className="btn-ghost btn-sm text-danger hover:text-danger">Cancelar lista</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <Card title={`Itens (${l.items.length})`} subtitle={aberta ? 'Quantidades e custos ainda podem ser ajustados.' : 'Itens travados — a lista já foi pedida.'}>
          {aberta && (
            <div className="mb-4">
              <ProductSearch
                autoFocus={false}
                placeholder="Incluir produto — digite uma palavra"
                onSelect={(p) => aplicar(() => api.post<ListaCompra>(`/purchase-lists/${l.id}/itens`, {
                  items: [{ productId: p.id, quantity: p.minStock > 0 && p.totalStock < p.minStock ? Number((p.minStock - p.totalStock).toFixed(3)) : 1 }],
                }))}
              />
            </div>
          )}
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">Produto</th><th className="th text-right">Saldo na hora</th><th className="th text-right">Quantidade</th>
                  <th className="th text-right">Custo unit.</th><th className="th text-right">Total</th>{aberta && <th className="th" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {l.items.map((i) => (
                  <tr key={i.id}>
                    <td className="td">
                      <p className="font-medium">{i.name}</p>
                      <p className="font-mono text-[11.5px] text-faint">{i.sku ?? 'sem cadastro'}{i.supplierName ? ` · ${i.supplierName}` : ''}{i.notes ? ` · ${i.notes}` : ''}</p>
                    </td>
                    <td className="td text-right text-[12.5px] text-muted tnum">{i.stockAtAdd == null ? '—' : `${qty(i.stockAtAdd)}${i.minStockAtAdd ? ` / ${qty(i.minStockAtAdd)}` : ''}`}</td>
                    <td className="td text-right tnum">
                      {aberta ? (
                        <input type="number" min={0.001} step="any" defaultValue={i.quantity} key={`q-${i.id}-${i.quantity}`}
                          onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== i.quantity) void alterarItem(i.id, { quantity: v }); }}
                          className="field field-sm w-[90px] text-right tnum" aria-label={`Quantidade de ${i.name}`} />
                      ) : <b>{qty(i.quantity)}</b>} <span className="text-[11px] text-faint">{i.unit}</span>
                    </td>
                    <td className="td text-right tnum">
                      {aberta ? (
                        <input type="number" min={0} step="0.01" defaultValue={i.unitCost} key={`c-${i.id}-${i.unitCost}`}
                          onBlur={(e) => { const v = Number(e.target.value); if (v >= 0 && v !== i.unitCost) void alterarItem(i.id, { unitCost: v }); }}
                          className="field field-sm w-[100px] text-right tnum" aria-label={`Custo de ${i.name}`} />
                      ) : brl(i.unitCost)}
                    </td>
                    <td className="td text-right font-medium tnum">{brl(i.total)}</td>
                    {aberta && (
                      <td className="td text-right">
                        <button onClick={() => removerItem(i.id)} disabled={ocupado} className="-m-1.5 rounded-lg p-1.5 text-faint transition-colors hover:text-danger" aria-label={`Remover ${i.name}`}><Trash2 size={15} /></button>
                      </td>
                    )}
                  </tr>
                ))}
                {!l.items.length && <tr><td className="td text-muted" colSpan={6}>Nenhum item. Busque um produto acima.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-right text-[14px]"><span className="text-muted">total </span><b className="text-[18px] tnum">{brl(l.total)}</b></p>
        </Card>

        <div className="space-y-6">
          <Card title="Dados do pedido">
            <div className="space-y-3">
              <label className="block">
                <span className="label">Fornecedor</span>
                {aberta || l.status === 'PEDIDA' ? (
                  <select value={l.supplierId ?? ''} onChange={(e) => editarCabecalho({ supplierId: e.target.value || null, supplierName: e.target.value ? undefined : null })} className="field" disabled={ocupado}>
                    <option value="">{l.supplierName && !l.supplierId ? l.supplierName : 'Vários / não definido'}</option>
                    {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                ) : <p className="text-[14px]">{l.supplierName ?? <span className="text-faint">vários</span>}</p>}
              </label>
              <label className="block">
                <span className="label">Observações</span>
                {encerrada ? <p className="text-[13.5px] text-muted">{l.notes || '—'}</p> : (
                  <textarea defaultValue={l.notes ?? ''} key={`n-${l.notes}`} rows={3} onBlur={(e) => (e.target.value.trim() || null) !== (l.notes || null) && editarCabecalho({ notes: e.target.value })} className="field" placeholder="prazo, frete, condição…" />
                )}
              </label>
            </div>
          </Card>
          <Card title="Linha do tempo">
            <ol className="space-y-2.5">
              {linhaTempo.map((e, i) => (
                <li key={i} className="text-[13px]"><p>{e.texto}</p><p className="text-[12px] text-faint">{dt(e.quando)}</p></li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal open={modal === 'comprada'} onClose={() => setModal(null)} title={`Marcar ${numero} como comprada`}>
        <div className="space-y-4">
          <p className="text-[14px] leading-relaxed text-muted">A mercadoria chegou. Os {l.items.length} item(ns) somam <b className="text-ink">{brl(l.total)}</b>.</p>
          {podeEntrada ? (
            <>
              <label className="flex items-start gap-2.5 text-[14px]">
                <input type="checkbox" checked={darEntrada} onChange={(e) => setDarEntrada(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>Dar entrada no estoque agora <span className="block text-[12.5px] text-muted">Uma entrada por item cadastrado, com o custo da lista e o número dela no histórico. Desmarque se alguém já lançou a nota.</span></span>
              </label>
              {darEntrada && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label">Depósito que recebe</span>
                    <select value={deposito} onChange={(e) => setDeposito(e.target.value)} className="field">
                      {depositos.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label">Nota / documento</span>
                    <input value={documento} onChange={(e) => setDocumento(e.target.value)} className="field" placeholder="NF 1234" maxLength={120} />
                  </label>
                </div>
              )}
            </>
          ) : <p className="rounded-lg bg-line/40 px-3 py-2 text-[13px] text-muted">Você não tem a permissão de movimentar estoque: a lista fica como comprada e a entrada precisa ser lançada por alguém do estoque.</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="btn-ghost">Voltar</button>
            <button onClick={() => mudarStatus('COMPRADA', { darEntrada: podeEntrada && darEntrada, warehouseId: podeEntrada && darEntrada ? deposito : null, documento: documento || null })} disabled={ocupado || (podeEntrada && darEntrada && !deposito)} className="btn-primary">
              {ocupado ? 'Gravando…' : podeEntrada && darEntrada ? 'Comprada + entrada no estoque' : 'Marcar como comprada'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'cancelar'} onClose={() => setModal(null)} title={`Cancelar ${numero}`}>
        <div className="space-y-4">
          <p className="text-[14px] leading-relaxed text-muted">A lista fica no histórico como cancelada e não pode ser reaberta. Para refazer a compra, use <b className="text-ink">Duplicar</b>.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="btn-ghost">Voltar</button>
            <button onClick={() => mudarStatus('CANCELADA')} disabled={ocupado} className="btn-danger">Cancelar lista</button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'excluir'} onClose={() => setModal(null)} title={`Excluir ${numero}`}>
        <div className="space-y-4">
          <p className="text-[14px] leading-relaxed text-muted">A lista some de vez, com os itens. Não dá para desfazer.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="btn-ghost">Voltar</button>
            <button onClick={excluir} disabled={ocupado} className="btn-danger">Excluir</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
