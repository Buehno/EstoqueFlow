import { useEffect, useState } from 'react';
import { Package, Plus, Search, Upload } from 'lucide-react';
import { api, ApiError, type Product } from '../lib/api';
import { Badge, brl, Card, Empty, Field, Input, Modal, qty, Select, Spinner, Table, useToast } from '../lib/ui';

export default function Produtos() {
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'novo' | 'lote' | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const toast = useToast();

  const load = async (q = '') => {
    setLoading(true);
    const res = await api.get<{ items: Product[] }>(`/products?take=200${q ? `&search=${encodeURIComponent(q)}` : ''}`);
    setItems(res.items);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    api.get<{ id: string; name: string }[]>('/categories').then(setCats);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 320);
    return () => clearTimeout(t);
  }, [search]);

  const salvar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      if (editing) await api.patch(`/products/${editing.id}`, f);
      else await api.post('/products', f);
      toast({ kind: 'ok', title: editing ? 'Produto atualizado' : 'Produto cadastrado', body: f.name });
      setModal(null);
      setEditing(null);
      void load(search);
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível salvar', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  const importarLote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get('csv') ?? '');
    const linhas = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed = linhas.map((l) => {
      const [sku, name, barcode, unit, costPrice, salePrice, minStock] = l.split(/[;,\t]/).map((s) => s?.trim());
      return { sku, name, barcode, unit: unit || 'UN', costPrice: Number(costPrice || 0), salePrice: Number(salePrice || 0), minStock: Number(minStock || 0) };
    }).filter((p) => p.sku && p.name);

    if (!parsed.length) return toast({ kind: 'err', title: 'Nenhuma linha válida encontrada' });
    try {
      const r = await api.post<{ criados: number; atualizados: number }>('/products/bulk', { items: parsed });
      toast({ kind: 'ok', title: 'Importação concluída', body: `${r.criados} criado(s), ${r.atualizados} atualizado(s)` });
      setModal(null);
      void load();
    } catch (err) {
      toast({ kind: 'err', title: 'Falha na importação', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Produtos</h1>
          <p className="mt-1 text-[14px] text-muted">Catálogo compartilhado por todos os depósitos.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal('lote')} className="btn-ghost btn-sm gap-2">
            <Upload size={15} /> Importar lista
          </button>
          <button id="btn-novo-produto" onClick={() => { setEditing(null); setModal('novo'); }} className="btn-primary btn-sm gap-2">
            <Plus size={16} /> Novo produto
          </button>
        </div>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" size={17} aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por qualquer palavra do produto"
          className="field pl-10"
          aria-label="Buscar produtos"
        />
      </div>

      <Card>
        {loading ? (
          <Spinner />
        ) : (
          <Table
            rows={items}
            keyOf={(r) => r.id}
            empty={<Empty icon={<Package size={24} />} title="Nenhum produto cadastrado" body="Cadastre o primeiro produto para começar a movimentar o estoque." action={<button onClick={() => setModal('novo')} className="btn-primary btn-sm mt-2 gap-2"><Plus size={15} /> Cadastrar produto</button>} />}
            columns={[
              { key: 'n', header: 'Produto', render: (p) => (
                <button onClick={() => { setEditing(p); setModal('novo'); }} className="text-left">
                  <p className="font-medium text-ink hover:text-brand">{p.name}</p>
                  <p className="font-mono text-[11.5px] text-faint">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</p>
                </button>
              ) },
              { key: 'c', header: 'Categoria', render: (p) => p.category ? <Badge>{p.category.name}</Badge> : <span className="text-faint">—</span> },
              { key: 's', header: 'Estoque total', align: 'right', render: (p) => (
                <div>
                  <span className={(p.totalStock ?? 0) < p.minStock ? 'font-semibold text-danger' : ''}>{qty(p.totalStock ?? 0)}</span>
                  <span className="ml-1 text-[11.5px] text-faint">{p.unit}</span>
                </div>
              ) },
              { key: 'd', header: 'Por depósito', render: (p) => (
                <div className="flex flex-wrap gap-1.5">
                  {(p.stockByWarehouse ?? []).map((s) => (
                    <span key={s.warehouseId} className="chip bg-line/60 text-muted">
                      {s.code}: <b className="tnum">{qty(s.quantity)}</b>
                    </span>
                  ))}
                </div>
              ) },
              { key: 'v', header: 'Venda', align: 'right', render: (p) => brl(p.salePrice) },
              { key: 'a', header: '', align: 'right', render: (p) => p.active ? null : <Badge tone="warn">inativo</Badge> },
            ]}
          />
        )}
      </Card>

      <Modal open={modal === 'novo'} onClose={() => { setModal(null); setEditing(null); }} title={editing ? 'Editar produto' : 'Novo produto'} wide>
        <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-raised p-3.5 text-[12.5px] leading-relaxed text-muted sm:col-span-2">
            Este estoque <b>não usa etiqueta nem código de barras</b>: o produto é encontrado pela
            descrição. Escreva o nome do jeito que a equipe fala no dia a dia — é por ele que a busca
            do balcão funciona. Código interno e código de barras são opcionais.
          </div>
          <Field label="Nome do produto" required hint="É por aqui que o operador acha o item">
            <Input name="name" required defaultValue={editing?.name} placeholder="Tubo marrom de 20 mm" />
          </Field>
          <Field label="Unidade" hint="UN, MT, PC, CX, KG, RL…"><Input name="unit" defaultValue={editing?.unit ?? 'UN'} placeholder="UN" /></Field>
          <Field label="Tamanho / bitola" hint='Ex.: 20 mm, 1/2", M, nº 40'>
            <Input name="size" defaultValue={(editing as any)?.size ?? ''} placeholder="20 mm" />
          </Field>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Metragem" hint="Quando o item é vendido por medida">
              <Input name="measure" type="number" step="0.001" min="0" defaultValue={(editing as any)?.measure ?? ''} placeholder="2,5" />
            </Field>
            <Field label="Medida"><Input name="measureUnit" defaultValue={(editing as any)?.measureUnit ?? ''} placeholder="m" /></Field>
          </div>
          <Field label="Código interno (opcional)" hint="Em branco, o sistema gera">
            <Input name="sku" defaultValue={editing?.sku} placeholder="gerado automaticamente" />
          </Field>
          <Field label="Código de barras (opcional)" hint="Só se houver etiqueta"><Input name="barcode" defaultValue={editing?.barcode ?? ''} placeholder="—" /></Field>
          <Field label="Categoria">
            <Select name="categoryId" defaultValue={editing?.category?.id ?? ''}>
              <option value="">Sem categoria</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Custo unitário (R$)"><Input name="costPrice" type="number" step="0.0001" min="0" defaultValue={editing?.costPrice ?? 0} /></Field>
          <Field label="Preço de venda (R$)"><Input name="salePrice" type="number" step="0.01" min="0" defaultValue={editing?.salePrice ?? 0} /></Field>
          <Field label="Estoque mínimo" hint="Dispara o alerta de reposição">
            <Input name="minStock" type="number" step="0.001" min="0" defaultValue={editing?.minStock ?? 0} />
          </Field>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => { setModal(null); setEditing(null); }} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary">{editing ? 'Salvar alterações' : 'Cadastrar produto'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'lote'} onClose={() => setModal(null)} title="Importar lista de produtos" wide>
        <form onSubmit={importarLote} className="space-y-4">
          <p className="rounded-xl bg-raised p-3.5 text-[13px] leading-relaxed text-muted">
            Cole uma linha por produto, separando os campos por <b>ponto e vírgula</b>:
            <br />
            <code className="mt-1.5 block font-mono text-[12.5px] text-brand">
              SKU;Nome;CodigoBarras;Unidade;Custo;PrecoVenda;EstoqueMinimo
            </code>
          </p>
          <Field label="Lista de produtos" required>
            <textarea
              name="csv"
              required
              rows={10}
              className="field h-auto py-3 font-mono text-[13px]"
              placeholder={'SKU-9001;Palete Plástico;7891234567890;UN;120;219;10\nSKU-9002;Fita Crepe 48mm;;UN;3.5;8.9;50'}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModal(null)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary gap-2"><Upload size={16} /> Importar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
