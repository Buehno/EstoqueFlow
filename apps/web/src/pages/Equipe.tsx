import { useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, RotateCcw, Trash2, Users } from 'lucide-react';
import { api, ApiError, type Capacidade } from '../lib/api';
import { Badge, Card, cx, dt, Empty, Field, Input, Modal, Select, Spinner, Table, useToast } from '../lib/ui';
import { useAuth } from '../App';

interface Permissao {
  cap: Capacidade;
  titulo: string;
  descricao: string;
  /** O que o papel dá de fábrica. */
  padrao: boolean;
  /** Liga/desliga feito na pessoa (null = segue o padrão). */
  override: boolean | null;
  /** O que vale de verdade. */
  efetiva: boolean;
}

interface U {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  active: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  permissionOverrides: Record<string, boolean> | null;
  permissoes: Permissao[];
}

interface Catalogo {
  papeis: { role: string; label: string; desc: string }[];
  capacidades: { cap: Capacidade; titulo: string; descricao: string }[];
  minhasCaps: Capacidade[];
}

/**
 * Equipe — uma tela só para tudo (pedido de 18/09): adicionar, editar,
 * excluir, trocar o papel e ligar/desligar cada permissão da pessoa.
 * O papel é o ponto de partida; o botão de cada permissão sobrescreve.
 */
export default function Equipe() {
  const [users, setUsers] = useState<U[]>([]);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);
  const [editando, setEditando] = useState<U | null>(null);
  const [excluindo, setExcluindo] = useState<U | null>(null);
  const [salvandoPerm, setSalvandoPerm] = useState<string | null>(null);
  const toast = useToast();
  const { me, reload } = useAuth();

  const load = async () => {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([api.get<U[]>('/auth/users'), api.get<Catalogo>('/auth/users/catalogo')]);
      setUsers(u); setCatalogo(c);
    } catch { setUsers([]); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const erro = (title: string, err: unknown) =>
    toast({ kind: 'err', title, body: err instanceof ApiError ? err.message : undefined });

  const criar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api.post('/auth/users', f);
      toast({ kind: 'ok', title: 'Pessoa adicionada', body: `${f.name} já pode acessar — vai precisar trocar a senha no primeiro login.` });
      setModalNovo(false);
      void load();
    } catch (err) { erro('Não foi possível adicionar', err); }
  };

  const salvarEdicao = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editando) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const corpo: Record<string, unknown> = { name: f.name, email: f.email };
    if (f.role && f.role !== editando.role) corpo.role = f.role;
    if (f.password) corpo.password = f.password;
    try {
      await api.patch(`/auth/users/${editando.id}`, corpo);
      toast({ kind: 'ok', title: 'Dados atualizados', body: f.password ? 'Senha redefinida — vai pedir troca no próximo login.' : undefined });
      setEditando(null);
      void load();
      if (editando.id === me?.user.id) void reload();
    } catch (err) { erro('Não foi possível salvar', err); }
  };

  /** Liga/desliga uma permissão da pessoa. Voltar ao padrão = tirar o override. */
  const alternarPermissao = async (u: U, p: Permissao, valor: boolean | null) => {
    const overrides: Record<string, boolean> = { ...(u.permissionOverrides ?? {}) };
    if (valor === null || valor === p.padrao) delete overrides[p.cap];
    else overrides[p.cap] = valor;
    setSalvandoPerm(`${u.id}:${p.cap}`);
    try {
      const atualizado = await api.patch<U>(`/auth/users/${u.id}`, { permissionOverrides: overrides });
      setUsers((lista) => lista.map((x) => (x.id === u.id ? atualizado : x)));
    } catch (err) { erro('Não foi possível alterar a permissão', err); }
    finally { setSalvandoPerm(null); }
  };

  const voltarAoPadrao = async (u: U) => {
    setSalvandoPerm(`${u.id}:*`);
    try {
      const atualizado = await api.patch<U>(`/auth/users/${u.id}`, { permissionOverrides: {} });
      setUsers((lista) => lista.map((x) => (x.id === u.id ? atualizado : x)));
      toast({ kind: 'ok', title: 'Permissões voltaram ao padrão do papel' });
    } catch (err) { erro('Não foi possível redefinir', err); }
    finally { setSalvandoPerm(null); }
  };

  const alternarAtivo = async (u: U) => {
    try { await api.patch(`/auth/users/${u.id}`, { active: !u.active }); void load(); }
    catch (err) { erro('Não foi possível alterar', err); }
  };

  const excluir = async () => {
    if (!excluindo) return;
    try {
      const r = await api.del<{ ok: true; modo: 'excluido' | 'desativado'; motivo?: string }>(`/auth/users/${excluindo.id}`);
      toast({ kind: 'ok', title: r.modo === 'excluido' ? 'Pessoa excluída' : 'Pessoa desativada', body: r.motivo });
      setExcluindo(null);
      void load();
    } catch (err) { erro('Não foi possível excluir', err); }
  };

  if (loading) return <Spinner />;
  if (!catalogo) {
    return <Empty icon={<Users size={24} />} title="Acesso restrito" body="Você não tem a permissão &quot;Equipe&quot;." />;
  }

  /** Quem a pessoa logada pode editar: só papéis abaixo do seu (o servidor confere também). */
  const nivel = (role: string) => ({ OWNER: 4, GESTOR: 3, ADMIN: 3, ADMINISTRADOR: 2, OPERADOR: 1, ESTOQUISTA: 1, VENDEDOR: 1, LEITURA: 0 } as Record<string, number>)[role] ?? 1;
  const meuNivel = nivel(me?.user.role ?? 'LEITURA');
  const podeMexer = (u: U) => u.id !== me?.user.id && u.role !== 'OWNER' && (me?.user.role === 'OWNER' || nivel(u.role) < meuNivel);
  const papelSelecionavel = (role: string) => catalogo.papeis.some((p) => p.role === role);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Equipe</h1>
          <p className="mt-1 text-[14px] text-muted">
            Adicione, edite, troque o papel e ligue ou desligue cada permissão — tudo aqui. O papel é o ponto de partida; cada botão vale por cima dele.
          </p>
        </div>
        <button onClick={() => setModalNovo(true)} className="btn-primary btn-sm gap-2"><Plus size={16} /> Adicionar pessoa</button>
      </header>

      <div className="space-y-4">
        {users.length === 0 && <Card><Empty icon={<Users size={24} />} title="Nenhuma pessoa" /></Card>}
        {users.map((u) => {
          const editavel = podeMexer(u);
          const temOverride = u.permissoes.some((p) => p.override !== null);
          return (
            <Card key={u.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/15 text-[13px] font-bold text-brand">
                    {u.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="font-semibold">{u.name} {u.id === me?.user.id && <span className="text-[11.5px] font-normal text-faint">(você)</span>}</p>
                    <p className="text-[12px] text-faint">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={u.role === 'OWNER' ? 'brand' : 'neutral'}>{u.roleLabel}</Badge>
                      <Badge tone={u.active ? 'ok' : 'warn'}>{u.active ? 'ativo' : 'inativo'}</Badge>
                      {u.mustChangePassword && <Badge tone="warn">troca de senha pendente</Badge>}
                      <span className="text-[11.5px] text-faint">último acesso: {u.lastLoginAt ? dt(u.lastLoginAt) : 'nunca'}</span>
                    </div>
                  </div>
                </div>
                {editavel && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button onClick={() => setEditando(u)} className="btn-ghost btn-sm gap-1.5" aria-label={`Editar ${u.name}`}><Pencil size={14} /> Editar</button>
                    <button onClick={() => alternarAtivo(u)} className="btn-ghost btn-sm">{u.active ? 'Desativar' : 'Reativar'}</button>
                    {temOverride && (
                      <button onClick={() => voltarAoPadrao(u)} disabled={salvandoPerm === `${u.id}:*`} className="btn-ghost btn-sm gap-1.5" title="Tira todos os liga/desliga e volta ao padrão do papel">
                        <RotateCcw size={14} /> Padrão do papel
                      </button>
                    )}
                    <button onClick={() => setExcluindo(u)} className="btn-ghost btn-sm text-danger hover:text-danger" aria-label={`Excluir ${u.name}`}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>

              {u.role !== 'OWNER' && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" role="group" aria-label={`Permissões de ${u.name}`}>
                  {u.permissoes.map((p) => {
                    const ocupado = salvandoPerm === `${u.id}:${p.cap}` || salvandoPerm === `${u.id}:*`;
                    const podeLigar = me?.user.role === 'OWNER' || catalogo.minhasCaps.includes(p.cap);
                    return (
                      <button
                        key={p.cap}
                        type="button"
                        disabled={!editavel || ocupado || (!p.efetiva && !podeLigar)}
                        onClick={() => alternarPermissao(u, p, !p.efetiva)}
                        aria-pressed={p.efetiva}
                        title={!podeLigar && !p.efetiva ? 'Você não tem esta permissão, então não pode ligá-la para outra pessoa' : p.descricao}
                        className={cx(
                          'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                          p.efetiva ? 'border-ok/40 bg-ok/8' : 'border-line bg-surface',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cx(
                            'mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
                            p.efetiva ? 'bg-ok' : 'bg-line',
                          )}
                        >
                          <span className={cx('h-4 w-4 rounded-full bg-white shadow transition-transform', p.efetiva && 'translate-x-4')} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium leading-tight">{p.titulo}</span>
                          <span className="block text-[11px] leading-snug text-faint">{p.descricao}</span>
                          {p.override !== null && (
                            <span className="mt-1 inline-block rounded-md bg-brand/12 px-1.5 text-[10.5px] font-semibold text-brand">
                              {p.override ? 'ligado por cima do papel' : 'desligado por cima do papel'}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Papéis" subtitle="O que cada papel tem de fábrica — depois, ajuste pessoa por pessoa nos botões acima">
        <Table
          rows={catalogo.papeis}
          keyOf={(p) => p.role}
          columns={[
            { key: 'p', header: 'Papel', render: (p) => <span className="font-medium">{p.label}</span> },
            { key: 'd', header: 'Padrão', render: (p) => <span className="text-[13px] text-muted">{p.desc}</span> },
          ]}
        />
      </Card>

      <Modal open={modalNovo} onClose={() => setModalNovo(false)} title="Adicionar pessoa">
        <form onSubmit={criar} className="space-y-4">
          <Field label="Nome" required><Input name="name" required /></Field>
          <Field label="E-mail" required><Input name="email" type="email" required /></Field>
          <Field label="Senha inicial" required hint="Mínimo de 8 caracteres — a pessoa vai precisar trocá-la no primeiro acesso">
            <Input name="password" type="password" minLength={8} required />
          </Field>
          <Field label="Papel" required hint="As permissões individuais podem ser ajustadas depois, nos botões de cada pessoa">
            <Select name="role" required defaultValue={catalogo.papeis.some((p) => p.role === 'OPERADOR') ? 'OPERADOR' : catalogo.papeis[0]?.role}>
              {catalogo.papeis.map((p) => (
                <option key={p.role} value={p.role}>{p.label} — {p.desc}</option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalNovo(false)} className="btn-ghost">Cancelar</button>
            <button type="submit" className="btn-primary">Adicionar</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editando} onClose={() => setEditando(null)} title={editando ? `Editar ${editando.name}` : ''}>
        {editando && (
          <form onSubmit={salvarEdicao} className="space-y-4">
            <Field label="Nome" required><Input name="name" required defaultValue={editando.name} /></Field>
            <Field label="E-mail" required><Input name="email" type="email" required defaultValue={editando.email} /></Field>
            <Field label="Papel" required hint={!papelSelecionavel(editando.role) ? `Papel atual: ${editando.roleLabel} (antigo). Escolha um dos papéis novos para trocar.` : undefined}>
              <Select name="role" defaultValue={papelSelecionavel(editando.role) ? editando.role : ''}>
                {!papelSelecionavel(editando.role) && <option value="">{editando.roleLabel} (manter)</option>}
                {catalogo.papeis.map((p) => (
                  <option key={p.role} value={p.role}>{p.label} — {p.desc}</option>
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

      <Modal open={!!excluindo} onClose={() => setExcluindo(null)} title="Excluir pessoa">
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
