import { useEffect, useState } from 'react';
import { ClipboardCheck, Check, Play, Plus } from 'lucide-react';
import { api, ApiError, type Warehouse } from '../lib/api';
import { Badge, brl, Card, dt, Empty, Field, Input, Modal, qty, Select, Spinner, Table, useToast } from '../lib/ui';
import ProductSearch from '../components/ProductSearch';

interface CountItem {
  id: string; productId: string; sku: string; barcode: string | null; name: string; unit: string;
  expected: number; counted: number | null; diff: number | null; applied: boolean;
}
interface Count {
  id: string; number: number; name: string; status: string; startedAt: string;
  warehouse: { name: string; code: string }; user: { name: string };
  items?: CountItem[]; _count?: { items: number };
}

export default function Inventario() {
  const [list, setList] = useState<Count[]>([]);
  const [aberta, setAberta] = useState<Count | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [modal, setModal] = useState(false);
  const [apuracao, setApuracao] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    setList(await api.get<Count[]>('/counts'));
    setLoading(false);
  };
  useEffect(() => { void load(); api.get<Warehouse[]>('/warehouses').then(setWarehouses); }, []);

  const abrir = async (id: string) => setAberta(await api.get<Count>(`/counts/${id}`));

  const criar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const c = await api.post<Count>('/counts', f);
      toast({ kind: 'ok', title: `Contagem #${c.number} aberta`, body: 'Bipe os produtos para registrar o saldo contado.' });
      setModal(false);
      await load();
      await abrir(c.id);
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível abrir', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  const contar = async (payload: { productId?: string; barcode?: string; counted: number }) => {
    if (!aberta) return;
    try {
      await api.patch(`/counts/${aberta.id}/items`, payload);
      await abrir(aberta.id);
    } catch (e) {
      toast({ kind: 'err', title: 'Não foi possível registrar', body: e instanceof ApiError ? e.message : undefined });
    }
  };

  const apurar = async () => {
    if (!aberta) return;
    setApuracao(await api.post(`/counts/${aberta.id}/apurar`));
  };

  const aplicar = async () => {
    if (!aberta) return;
    try {
      const r = await api.post<{ message: string }>(`/counts/${aberta.id}/aplicar`);
      toast({ kind: 'ok', title: 'Inventário aplicado', body: r.message });
      setApuracao(null);
      setAberta(null);
      void load();
    } catch (e) {
      toast({ kind: 'err', title: 'Falha ao aplicar', body: e instanceof ApiError ? e.message : undefined });
    }
  };

  if (loading) return <Spinner />;

  // ─────────── contagem aberta ───────────
  if (aberta) {
    const contados = (aberta.items ?? []).filter((i) => i.counted != null).length;
    const divergentes = (aberta.items ?? []).filter((i) => i.counted != null && i.counted !== i.expected).length;
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <button onClick={() => setAberta(null)} className="mb-1 text-[13px] text-muted hover:text-ink">← Voltar às contagens</button>
            <h1 className="text-[26px] font-bold tracking-tight">#{aberta.number} · {aberta.name}</h1>
            <p className="mt-1 text-[14px] text-muted">
              {aberta.warehouse.name} · {contados}/{aberta.items?.length ?? 0} contados · {divergentes} divergência(s)
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={apurar} className="btn-ghost btn-sm gap-2"><ClipboardCheck size={15} /> Apurar divergências</button>
          </div>
        </header>

        <ProductSearch
          placeholder="Busque o produto pela descrição para lançar a contagem"
          onSelect={(p) => {
            const v = window.prompt(`Quantidade contada de "${p.name}":`);
            if (v != null && v !== '') void contar({ productId: p.id, counted: Number(v) });
          }}
        />

        <Card>
          <Table
            rows={aberta.items ?? []}
            keyOf={(r) => r.id}
            columns={[
              { key: 'p', header: 'Produto', render: (r) => (
                <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div>
              ) },
              { key: 'e', header: 'Sistema', align: 'right', render: (r) => qty(r.expected) },
              { key: 'c', header: 'Contado', align: 'right', render: (r) => (
                <input
                  defaultValue={r.counted ?? ''}
                  onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== r.counted && void contar({ productId: r.productId, counted: Number(e.target.value) })}
                  className="field field-sm w-24 text-right tnum"
                  aria-label={`Quantidade contada de ${r.name}`}
                  placeholder="—"
                />
              ) },
              { key: 'd', header: 'Diferença', align: 'right', render: (r) =>
                r.counted == null ? <span className="text-faint">—</span> :
                r.counted === r.expected ? <Badge tone="ok"><Check size={11} /> ok</Badge> :
                <Badge tone={r.counted > r.expected ? 'info' : 'danger'}>{r.counted > r.expected ? '+' : ''}{qty(r.counted - r.expected)}</Badge>
              },
            ]}
          />
        </Card>

        <Modal open={!!apuracao} onClose={() => setApuracao(null)} title="Apuração do inventário" wide>
          {apuracao && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-raised p-4"><p className="text-[12.5px] text-muted">Itens contados</p><p className="mt-1 text-[22px] font-bold tnum">{apuracao.contados}/{apuracao.totalItens}</p></div>
                <div className="rounded-xl bg-raised p-4"><p className="text-[12.5px] text-muted">Divergências</p><p className="mt-1 text-[22px] font-bold tnum text-warn">{apuracao.divergencias.length}</p></div>
                <div className="rounded-xl bg-raised p-4"><p className="text-[12.5px] text-muted">Impacto financeiro</p><p className={`mt-1 text-[22px] font-bold tnum ${apuracao.impactoFinanceiro < 0 ? 'text-danger' : 'text-ok'}`}>{brl(apuracao.impactoFinanceiro)}</p></div>
              </div>
              <Table
                rows={apuracao.divergencias}
                keyOf={(r: any) => r.productId}
                empty={<Empty title="Nenhuma divergência" body="O estoque físico bate com o sistema." />}
                columns={[
                  { key: 'p', header: 'Produto', render: (r: any) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-faint">{r.sku}</p></div> },
                  { key: 'e', header: 'Sistema', align: 'right', render: (r: any) => qty(r.expected) },
                  { key: 'c', header: 'Contado', align: 'right', render: (r: any) => qty(r.counted) },
                  { key: 'd', header: 'Dif.', align: 'right', render: (r: any) => <b className={r.diff < 0 ? 'text-danger' : 'text-info'}>{r.diff > 0 ? '+' : ''}{qty(r.diff)}</b> },
                  { key: 'v', header: 'R$', align: 'right', render: (r: any) => brl(r.valorDiferenca) },
                ]}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setApuracao(null)} className="btn-ghost">Fechar</button>
                <button onClick={aplicar} className="btn-primary gap-2"><Check size={16} /> Aplicar ajustes no estoque</button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    );
  }

  // ─────────── lista ───────────
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Inventário cíclico</h1>
          <p className="mt-1 text-[14px] text-muted">Conte, apure a divergência e aplique — cada ajuste vira um movimento rastreável.</p>
        </div>
        <button id="btn-nova-contagem" onClick={() => setModal(true)} className="btn-primary btn-sm gap-2"><Plus size={16} /> Nova contagem</button>
      </header>

      <Card>
        <Table
          rows={list}
          keyOf={(r) => r.id}
          empty={<Empty icon={<ClipboardCheck size={24} />} title="Nenhuma contagem registrada" body="Abra uma contagem para conferir o estoque físico de um depósito." action={<button onClick={() => setModal(true)} className="btn-primary btn-sm mt-2 gap-2"><Plus size={15} /> Nova contagem</button>} />}
          columns={[
            { key: 'n', header: '#', render: (r) => <span className="font-mono text-[12.5px] text-faint">{r.number}</span> },
            { key: 'a', header: 'Contagem', render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[11.5px] text-faint">{r.warehouse.name}</p></div> },
            { key: 'i', header: 'Itens', align: 'right', render: (r) => r._count?.items ?? 0 },
            { key: 's', header: 'Status', render: (r) => (
              <Badge tone={r.status === 'APLICADA' ? 'ok' : r.status === 'ABERTA' ? 'brand' : r.status === 'APURADA' ? 'warn' : 'neutral'}>{r.status}</Badge>
            ) },
            { key: 'u', header: 'Responsável', render: (r) => <span className="text-[13px]">{r.user.name}</span> },
            { key: 'd', header: 'Início', align: 'right', render: (r) => <span className="text-[12.5px] text-faint">{dt(r.startedAt)}</span> },
            { key: 'x', header: '', align: 'right', render: (r) => (
              <button onClick={() => abrir(r.id)} className="btn-ghost btn-sm gap-1.5"><Play size={13} /> Abrir</button>
            ) },
          ]}
        />
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Nova contagem">
        <form onSubmit={criar} className="space-y-4">
          <Field label="Depósito" required>
            <Select name="warehouseId" required>
              {warehouses.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Nome da contagem" required hint="Ex.: Contagem semanal — corredor A">
            <Input name="name" required defaultValue="Contagem cíclica" />
          </Field>
          <Field label="Observações"><Input name="notes" placeholder="Opcional" /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModal(false)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary">Abrir contagem</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
