/**
 * Compras — as listas que o comprador montou e o status de cada uma
 * (aberta → pedida → comprada / cancelada). Pedido de 16/11/2026.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ShoppingBasket } from 'lucide-react';
import { api, ROTULO_STATUS_LISTA, type ListaCompra, type ListagemListas, type StatusLista } from '../lib/api';
import { Badge, brl, Card, cx, dt, Empty, int, Modal, Spinner } from '../lib/ui';
import { useCarrinho } from '../lib/carrinho';
import CarrinhoCompra from '../components/CarrinhoCompra';

type Filtro = 'PENDENTES' | StatusLista | 'TODAS';

export const TOM_STATUS: Record<StatusLista, 'warn' | 'info' | 'ok' | 'neutral'> = {
  ABERTA: 'warn', PEDIDA: 'info', COMPRADA: 'ok', CANCELADA: 'neutral',
};

export default function Compras() {
  const [dados, setDados] = useState<ListagemListas | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('PENDENTES');
  const [nova, setNova] = useState(false);
  const carrinho = useCarrinho();
  const nav = useNavigate();

  const carregar = async (f: Filtro) => {
    const q = f === 'TODAS' ? '' : `?status=${f}`;
    setDados(await api.get<ListagemListas>(`/purchase-lists${q}`));
  };
  useEffect(() => { void carregar(filtro); }, [filtro]);

  if (!dados) return <Spinner label="Carregando listas…" />;
  const ps = dados.porStatus;
  const pendentes = ps.ABERTA.listas + ps.PEDIDA.listas;

  const chips: { k: Filtro; label: string }[] = [
    { k: 'PENDENTES', label: `Pendentes (${pendentes})` },
    { k: 'ABERTA', label: `Abertas (${ps.ABERTA.listas})` },
    { k: 'PEDIDA', label: `Pedidas (${ps.PEDIDA.listas})` },
    { k: 'COMPRADA', label: `Compradas (${ps.COMPRADA.listas})` },
    { k: 'CANCELADA', label: `Canceladas (${ps.CANCELADA.listas})` },
    { k: 'TODAS', label: 'Todas' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Compras</h1>
          <p className="mt-1 text-[14px] text-muted">
            Listas montadas a partir do alerta de compra. {ps.PEDIDA.listas > 0 && <>Aguardando chegar: <b className="tnum">{brl(ps.PEDIDA.valor)}</b> em {ps.PEDIDA.listas} pedido(s).</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/relatorios" className="btn-ghost btn-sm">Alerta de compra</Link>
          <button onClick={() => setNova(true)} className="btn-primary btn-sm gap-2">
            <Plus size={15} /> Nova lista{carrinho.length ? ` (${carrinho.length} no carrinho)` : ''}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button key={c.k} onClick={() => setFiltro(c.k)} aria-pressed={filtro === c.k} className={cx('chip', filtro === c.k ? 'bg-brand/15 text-brand' : 'bg-line/60 text-muted')}>{c.label}</button>
        ))}
      </div>

      <Card>
        {dados.items.length === 0 ? (
          <Empty
            icon={<ShoppingBasket size={24} />}
            title={filtro === 'PENDENTES' ? 'Nenhuma compra pendente' : 'Nenhuma lista aqui'}
            body="Monte uma lista pelo alerta de compra (Relatórios) ou pelo botão Nova lista."
          />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">Nº</th><th className="th">Lista</th><th className="th">Fornecedor</th><th className="th">Status</th>
                  <th className="th text-right">Itens</th><th className="th text-right">Total</th><th className="th">Última mudança</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dados.items.map((l) => (
                  <tr key={l.id} onClick={() => nav(`/app/compras/${l.id}`)} className="cursor-pointer transition-colors hover:bg-line/25">
                    <td className="td font-mono text-[12.5px] text-muted">#{String(l.number).padStart(4, '0')}</td>
                    <td className="td"><p className="font-medium">{l.name}</p><p className="text-[12px] text-faint">por {l.createdByName}</p></td>
                    <td className="td text-[13px]">{l.supplierName ?? <span className="text-faint">vários</span>}</td>
                    <td className="td"><Badge tone={TOM_STATUS[l.status]}>{ROTULO_STATUS_LISTA[l.status]}</Badge></td>
                    <td className="td text-right tnum">{int(l.itens)}</td>
                    <td className="td text-right font-medium tnum">{brl(l.total)}</td>
                    <td className="td text-[12.5px] text-muted">{ultimaMudanca(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={nova} onClose={() => setNova(false)} title="Nova lista de compra" wide>
        <CarrinhoCompra comBusca aoSalvar={(l) => { setNova(false); nav(`/app/compras/${l.id}`); }} />
      </Modal>
    </div>
  );
}

export function ultimaMudanca(l: ListaCompra): string {
  if (l.status === 'COMPRADA' && l.boughtAt) return `comprada ${dt(l.boughtAt)} · ${l.boughtByName}`;
  if (l.status === 'CANCELADA' && l.canceledAt) return `cancelada ${dt(l.canceledAt)} · ${l.canceledByName}`;
  if (l.status === 'PEDIDA' && l.orderedAt) return `pedida ${dt(l.orderedAt)} · ${l.orderedByName}`;
  return `criada ${dt(l.createdAt)}`;
}
