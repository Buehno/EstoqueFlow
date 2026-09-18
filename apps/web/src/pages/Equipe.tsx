import { useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Badge, Card, dt, Empty, Field, Input, Modal, Select, Spinner, Table, useToast } from '../lib/ui';
import { useAuth } from '../App';

interface U {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
}

const PAPEIS: Record<string, { label: string; desc: string }> = {
  OWNER: { label: 'Proprietário', desc: 'Acesso total à conta' },
  ADMIN: { label: 'Administrador', desc: 'Gestão de estoque, equipe e estornos' },
  ESTOQUISTA: { label: 'Estoquista', desc: 'Entrada, saída, transferência e inventário' },
  VENDEDOR: { label: 'Vendedor', desc: 'Apenas venda no balcão (PDV)' },
  LEITURA: { label: 'Somente leitura', desc: 'Consulta e relatórios' },
};
const PAPEIS_ATRIBUIVEIS = ['ADMIN', 'ESTOQUISTA', 'VENDEDOR', 'LEITURA'];

export default function Equipe() {
  const [users, setUsers] = useState<U[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);
  const [editando, setEditando] = useState<U | null>(null);
  const [excluindo, setExcluindo] = useState<U | null>(null);
  const toast = useToast();
  const { me } = useAuth();
  const pode = me?.user.role === 'OWNER' || me?.user.role === 'ADMIN';

  const load = async () => {
    setLoading(true);
    try { setUsers(await api.get<U[]>('/auth/users')); } catch { setUsers([]); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const criar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api.post('/auth/users', f);
      toast({ kind: 'ok', title: 'Usuário criado', body: `${f.name} já pode acessar a plataforma — vai precisar trocar a senha no primeiro login.` });
      setModalNovo(false);
      void load();
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível criar', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  const salvarEdicao = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editando) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const corpo: Record<string, unknown> = { name: f.name, email: f.email, role: f.role };
    if (f.password) corpo.password = f.password;
    try {
      await api.patch(`/auth/users/${editando.id}`, corpo);
      toast({ kind: 'ok', title: 'Dados atualizados', body: f.password ? 'Senha redefinida — vai pedir troca no próximo login.' : undefined });
      setEditando(null);
      void load();
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível salvar', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  const alternar = async (u: U) => {
    await api.patch(`/auth/users/${u.id}`, { active: !u.active });
    void load();
  };

  const excluir = async () => {
    if (!excluindo) return;
    try {
      const r = await api.del<{ ok: true; modo: 'excluido' | 'desativado'; motivo?: string }>(`/auth/users/${excluindo.id}`);
      toast({
        kind: 'ok',
        title: r.modo === 'excluido' ? 'Usuário excluído' : 'Usuário desativado',
        body: r.motivo,
      });
      setExcluindo(null);
      void load();
    } catch (err) {
      toast({ kind: 'err', title: 'Não foi possível excluir', body: err instanceof ApiError ? err.message : undefined });
    }
  };

  if (loading) return <Spinner />;

  if (!pode) {
    return <Empty icon={<Users size={24} />} title="Acesso restrito" body="Somente proprietários e administradores podem gerenciar a equipe." />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Equipe</h1>
          <p className="mt-1 text-[14px] text-muted">Adicione, edite papéis, redefina senhas e remova pessoas — tudo por aqui.</p>
        </div>
        <button onClick={() => setModalNovo(true)} className="btn-primary btn-sm gap-2"><Plus size={16} /> Novo usuário</button>
      </header>

      <Card>
        <Table
          rows={users}
          keyOf={(u) => u.id}
          empty={<Empty icon={<Users size={24} />} title="Nenhum usuário" />}
          columns={[
            { key: 'n', header: 'Pessoa', render: (u) => (
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 text-[12px] font-bold text-brand">
                  {u.name.slice(0, 2).toUpperCase()}
                </span>
                <div><p className="font-medium">{u.name}</p><p className="text-[11.5px] text-faint">{u.email}</p></div>
              </div>
            ) },
            { key: 'r', header: 'Papel', render: (u) => (
              <div><Badge tone={u.role === 'OWNER' ? 'brand' : 'neutral'}>{PAPEIS[u.role]?.label ?? u.role}</Badge>
              <p className="mt-1 text-[11.5px] text-faint">{PAPEIS[u.role]?.desc}</p></div>
            ) },
            { key: 'l', header: 'Último acesso', render: (u) => (
              <div>
                <span className="text-[13px] text-muted">{u.lastLoginAt ? dt(u.lastLoginAt) : 'nunca'}</span>
                {u.mustChangePassword && <p className="mt-1"><Badge tone="warn">troca de senha pendente</Badge></p>}
              </div>
            ) },
            { key: 's', header: 'Status', render: (u) => <Badge tone={u.active ? 'ok' : 'warn'}>{u.active ? 'ativo' : 'inativo'}</Badge> },
            { key: 'a', header: '', align: 'right', render: (u) => u.role !== 'OWNER' ? (
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setEditando(u)} className="btn-ghost btn-sm gap-1.5" aria-label={`Editar ${u.name}`}>
                  <Pencil size={14} /> Editar
                </button>
                <button onClick={() => alternar(u)} className="btn-ghost btn-sm">{u.active ? 'Desativar' : 'Reativar'}</button>
                <button onClick={() => setExcluindo(u)} className="btn-ghost btn-sm text-danger hover:text-danger" aria-label={`Excluir ${u.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ) : null },
          ]}
        />
      </Card>

      <Modal open={modalNovo} onClose={() => setModalNovo(false)} title="Novo usuário">
        <form onSubmit={criar} className="space-y-4">
          <Field label="Nome" required><Input name="name" required /></Field>
          <Field label="E-mail" required><Input name="email" type="email" required /></Field>
          <Field label="Senha inicial" required hint="Mínimo de 8 caracteres — a pessoa vai precisar trocá-la no primeiro acesso">
            <Input name="password" type="password" minLength={8} required />
          </Field>
          <Field label="Papel" required>
            <Select name="role" required defaultValue="ESTOQUISTA">
              {PAPEIS_ATRIBUIVEIS.map((r) => (
                <option key={r} value={r}>{PAPEIS[r].label} — {PAPEIS[r].desc}</option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalNovo(false)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary">Criar usuário</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editando} onClose={() => setEditando(null)} title={editando ? `Editar ${editando.name}` : ''}>
        {editando && (
          <form onSubmit={salvarEdicao} className="space-y-4">
            <Field label="Nome" required><Input name="name" required defaultValue={editando.name} /></Field>
            <Field label="E-mail" required><Input name="email" type="email" required defaultValue={editando.email} /></Field>
            <Field label="Papel" required>
              <Select name="role" required defaultValue={editando.role}>
                {PAPEIS_ATRIBUIVEIS.map((r) => (
                  <option key={r} value={r}>{PAPEIS[r].label} — {PAPEIS[r].desc}</option>
                ))}
              </Select>
            </Field>
            <Field label="Redefinir senha" hint="Deixe em branco para manter a senha atual. Preenchendo, força troca no próximo login.">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="shrink-0 text-faint" />
                <Input name="password" type="password" minLength={8} placeholder="Nova senha (opcional)" />
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditando(null)} className="btn-ghost">Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Excluir usuário">
        {excluindo && (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-muted">
              Tem certeza que quer excluir <strong className="text-ink">{excluindo.name}</strong>?
              Se essa pessoa já tiver movimentações, vendas ou propostas registradas, ela será
              apenas <strong>desativada</strong> em vez de excluída — para não apagar o histórico de auditoria.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setExcluindo(null)} className="btn-ghost">Cancelar</button>
              <button type="button" onClick={excluir} className="btn-danger">Confirmar exclusão</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
