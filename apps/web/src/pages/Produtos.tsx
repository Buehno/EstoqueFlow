import { useEffect, useState } from 'react';
import { BookOpen, Package, Plus, Search, Upload } from 'lucide-react';
import { api, ApiError, type Product } from '../lib/api';
import { Badge, brl, Card, Empty, Field, Input, Modal, qty, Select, Spinner, Table, useToast } from '../lib/ui';
import { useAuth } from '../App';

export default function Produtos() {
  const [items, setItems] = useState<Product[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'novo' | 'lote' | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [carregandoTabelas, setCarregandoTabelas] = useState(false);
  const toast = useToast();
  const { me } = useAuth();
  const podeCarregarTabelas = me?.user.role === 'OWNER' || me?.user.role === 'ADMIN';

  /**
   * Carrega/atualiza as tabelas de preço dos fornecedores (SOLIS, SYLLENT,
   * INOVA, THOLZ e a SODRAMAR 2015/2016, desatualizada) como produtos sob
   * encomenda, com preço parcelado e à vista. Pode rodar quantas vezes quiser:
   * atualiza o que já existe e não mexe em estoque.
   */
  const carregarTabelasFornecedores = async () => {
    setCarregandoTabelas(true);
    try {
      const r = await api.post<{ criados: number; atualizados: number; total: number; tabelas: string[] }>('/products/seed-tabelas-fornecedores');
      toast({
        kind: 'ok',
        title: `${r.total} produtos das tabelas de fornecedores`,
        body: `${r.criados} novo(s), ${r.atualizados} atualizado(s) — ${r.tabelas.length} tabela(s).`,
      });
      void load(search);
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível carregar as tabelas', body: err instanceof ApiError ? err.message : undefined });
    } finally { setCarregandoTabelas(false); }
  };

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
    const fd = new FormData(e.currentTarget);
    const f: Record<string, unknown> = Object.fromEntries(fd);
    // Campos opcionais de tabela: vazio vira nulo (não zero); checkbox vira booleano.
    f.cashPrice = String(fd.get('cashPrice') ?? '').trim() === '' ? null : Number(fd.get('cashPrice'));
    f.onDemand = fd.get('onDemand') === 'on';
    for (const k of ['installmentTerms', 'priceTable', 'supplierCode']) if (!String(f[k] ?? '').trim()) f[k] = null;
    try {
      if (editing) await api.patch(`/products/${editing.id}`, f);
      else await api.post('/products', f);
      toast({ kind: 'ok', title: editing ? 'Produto atualizado' : 'Produto cadastrado', body: String(f.name ?? '') });
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
        <div className="flex flex-wrap gap-2">
          {podeCarregarTabelas && (
            <button onClick={() => void carregarTabelasFornecedores()} disabled={carregandoTabelas} className="btn-ghost btn-sm gap-2" title="SOLIS, SYLLENT, INOVA, THOLZ (e SODRAMAR 2015/2016, desatualizada): cria ou atualiza os produtos com preço parcelado e à vista">
              <BookOpen size={15} /> {carregandoTabelas ? 'Carregando…' : 'Carregar tabelas de fornecedores'}
            </button>
          )}
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
              { key: 'v', header: 'Venda', align: 'right', render: (p) => (
                <div>
                  <span className="tnum">{brl(p.salePrice)}</span>
                  {p.cashPrice != null && p.cashPrice !== p.salePrice && (
                    <span className="block text-[11.5px] text-faint tnum">à vista {brl(p.cashPrice)}</span>
                  )}
                </div>
              ) },
              { key: 'e', header: '', render: (p) => p.onDemand ? <Badge tone="warn">sob encomenda</Badge> : null },
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
          <Field label="Preço de venda (R$)" hint="Nas tabelas de fornecedor é o preço parcelado"><Input name="salePrice" type="number" step="0.01" min="0" defaultValue={editing?.salePrice ?? 0} /></Field>
          <Field label="Preço à vista (R$)" hint="Em branco = não tem preço à vista próprio">
            <Input name="cashPrice" type="number" step="0.01" min="0" defaultValue={editing?.cashPrice ?? ''} placeholder="—" />
          </Field>
          <Field label="Condição do parcelado" hint='Ex.: "até 10x sem juros (Master/Visa)"'>
            <Input name="installmentTerms" defaultValue={editing?.installmentTerms ?? ''} placeholder="—" />
          </Field>
          <Field label="Tabela de preço / vigência" hint="De onde veio o preço">
            <Input name="priceTable" defaultValue={editing?.priceTable ?? ''} placeholder="SOLIS – Coletor solar – Julho/2026" />
          </Field>
          <Field label="Código no fornecedor" hint="Modelo / referência do fabricante">
            <Input name="supplierCode" defaultValue={editing?.supplierCode ?? ''} placeholder="—" />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-ink sm:col-span-2">
            <input type="checkbox" name="onDemand" defaultChecked={editing?.onDemand ?? false} className="h-4 w-4" />
            <span><b>Vendido sob encomenda</b> — entra na proposta mesmo sem saldo em estoque (itens de tabela de fornecedor).</span>
          </label>
          <Field label="Estoque aceitável" hint="Quantidade que deve haver; em 50% dela dispara a compra">
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
