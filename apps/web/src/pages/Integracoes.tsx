import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Lock, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { comprimirImagem } from '../lib/imagem';
import { Badge, Card, dt, Empty, Field, Input, Spinner, Table, useToast } from '../lib/ui';
import { useAuth } from '../App';

interface DadosEmpresa {
  id: string; name: string; legalName: string | null; cnpj: string | null; slug: string;
  phone: string | null; email: string | null; logoUrl: string | null;
}

interface SyncStatus {
  habilitado: boolean;
  motivoDesabilitado: string | null;
  planilhaId: string | null;
  ultimaSincronizacao: string | null;
  filaPendente: number;
  filaComErro: number;
  ultimosEventos: { sheetTab: string; rowKey: string; status: string; createdAt: string; sentAt: string | null; lastError: string | null }[];
  revertidosPeloGuardiao: { id: string; sheetTab: string; rowKey: string | null; detectedAt: string; action: string }[];
}

export default function Integracoes() {
  const [s, setS] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [empresa, setEmpresa] = useState<DadosEmpresa | null>(null);
  const [salvandoEmpresa, setSalvandoEmpresa] = useState(false);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { me } = useAuth();
  const podeEditarEmpresa = me?.user.role === 'OWNER' || me?.user.role === 'ADMIN';

  const load = () => api.get<SyncStatus>('/sync/status').then(setS);
  const carregarEmpresa = () => api.get<DadosEmpresa>('/auth/company').then(setEmpresa);
  useEffect(() => { void load(); void carregarEmpresa(); }, []);

  const salvarEmpresa = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setSalvandoEmpresa(true);
    try {
      const atualizada = await api.patch<DadosEmpresa>('/auth/company', {
        name: f.name, legalName: f.legalName || undefined, cnpj: f.cnpj || undefined,
        phone: f.phone || undefined, email: f.email || '',
      });
      setEmpresa(atualizada);
      toast({ kind: 'ok', title: 'Dados da empresa atualizados' });
    } catch (e) {
      toast({ kind: 'err', title: 'Não foi possível salvar', body: e instanceof ApiError ? e.message : undefined });
    } finally { setSalvandoEmpresa(false); }
  };

  const trocarLogo = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setEnviandoLogo(true);
    try {
      const dataUri = await comprimirImagem(arquivo, { maxLargura: 480, qualidade: 0.85 });
      const atualizada = await api.patch<DadosEmpresa>('/auth/company', { logoUrl: dataUri });
      setEmpresa(atualizada);
      toast({ kind: 'ok', title: 'Logotipo atualizado', body: 'Já sai assim nos próximos PDFs e Word das propostas.' });
    } catch (e) {
      toast({ kind: 'err', title: 'Não foi possível enviar o logotipo', body: e instanceof ApiError ? e.message : undefined });
    } finally {
      setEnviandoLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const run = async (path: string, label: string) => {
    setBusy(true);
    try {
      await api.post(path);
      toast({ kind: 'ok', title: label });
      await load();
    } catch (e) {
      toast({ kind: 'err', title: 'Falha na operação', body: e instanceof ApiError ? e.message : undefined });
    } finally { setBusy(false); }
  };

  if (!s) return <Spinner />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">Integrações</h1>
        <p className="mt-1 text-[14px] text-muted">Redundância dos dados em planilha espelho do Google Sheets.</p>
      </header>

      <Card title="Dados da empresa" subtitle="Nome, contato e logotipo — é o que sai no cabeçalho do PDF/Word das propostas">
        {!empresa ? <Spinner /> : (
          <div className="grid gap-5 sm:grid-cols-[120px_1fr]">
            <div>
              <span className="mb-1 block text-[11px] font-medium text-faint">LOGOTIPO</span>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void trocarLogo(e.target.files?.[0])}
                aria-label="Enviar logotipo da empresa"
              />
              {empresa.logoUrl ? (
                <div className="group relative h-[100px] w-[100px] overflow-hidden rounded-xl border border-line bg-white">
                  <img src={empresa.logoUrl} alt="" className="h-full w-full object-contain p-2" />
                  {podeEditarEmpresa && (
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="absolute inset-0 hidden place-items-center bg-black/50 text-[11px] font-medium text-white group-hover:grid"
                    >
                      Trocar
                    </button>
                  )}
                </div>
              ) : (
                <div className="h-[100px] w-[100px] rounded-xl border border-line bg-white p-2">
                  <p className="text-[10px] leading-tight text-faint">Usando o logotipo padrão da Jundiaquece nas exportações</p>
                </div>
              )}
              {podeEditarEmpresa && (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={enviandoLogo}
                  className="btn-ghost btn-sm mt-2 w-full gap-1.5"
                >
                  <Upload size={13} /> {empresa.logoUrl ? 'Trocar' : 'Enviar'}
                </button>
              )}
            </div>

            {podeEditarEmpresa ? (
              <form onSubmit={salvarEmpresa} className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome"><Input name="name" required defaultValue={empresa.name} /></Field>
                <Field label="Razão social"><Input name="legalName" defaultValue={empresa.legalName ?? ''} /></Field>
                <Field label="CNPJ"><Input name="cnpj" defaultValue={empresa.cnpj ?? ''} /></Field>
                <Field label="Telefone"><Input name="phone" defaultValue={empresa.phone ?? ''} placeholder="(11) 4522-6487" /></Field>
                <Field label="E-mail"><Input name="email" type="email" defaultValue={empresa.email ?? ''} /></Field>
                <div className="flex items-end sm:col-span-2">
                  <button type="submit" disabled={salvandoEmpresa} className="btn-primary btn-sm">
                    {salvandoEmpresa ? 'Salvando…' : 'Salvar dados da empresa'}
                  </button>
                </div>
              </form>
            ) : (
              <dl className="grid gap-2 text-[13.5px] sm:grid-cols-2">
                <div><dt className="text-faint">Nome</dt><dd>{empresa.name}</dd></div>
                <div><dt className="text-faint">Telefone</dt><dd>{empresa.phone ?? '—'}</dd></div>
                <div><dt className="text-faint">E-mail</dt><dd>{empresa.email ?? '—'}</dd></div>
              </dl>
            )}
          </div>
        )}
      </Card>

      <Card id="sync-status">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${s.habilitado ? 'bg-ok/12 text-ok' : 'bg-warn/12 text-warn'}`}>
              {s.habilitado ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
            </span>
            <div>
              <h2 className="text-[16px] font-semibold">
                Google Sheets · {s.habilitado ? 'sincronizando' : 'desativado'}
              </h2>
              <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-muted">
                {s.habilitado
                  ? 'Cada movimento gravado no Postgres é replicado para a planilha em segundos. O Postgres continua sendo a fonte da verdade.'
                  : s.motivoDesabilitado}
              </p>
              {s.planilhaId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${s.planilhaId}/edit`}
                  target="_blank" rel="noreferrer"
                  className="mt-2.5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand hover:underline"
                >
                  Abrir planilha espelho <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => run('/sync/run', 'Fila processada')} disabled={busy || !s.habilitado} className="btn-ghost btn-sm gap-2">
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Sincronizar agora
            </button>
            <button onClick={() => run('/sync/full', 'Reenvio completo enfileirado')} disabled={busy || !s.habilitado} className="btn-ghost btn-sm">
              Recriar planilha
            </button>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-raised p-4">
            <dt className="text-[12.5px] text-muted">Última sincronização</dt>
            <dd className="mt-1 text-[15px] font-semibold">{s.ultimaSincronizacao ? dt(s.ultimaSincronizacao) : '—'}</dd>
          </div>
          <div className="rounded-xl bg-raised p-4">
            <dt className="text-[12.5px] text-muted">Fila pendente</dt>
            <dd className="mt-1 text-[15px] font-semibold tnum">{s.filaPendente}</dd>
          </div>
          <div className="rounded-xl bg-raised p-4">
            <dt className="text-[12.5px] text-muted">Falhas acumuladas</dt>
            <dd className={`mt-1 text-[15px] font-semibold tnum ${s.filaComErro ? 'text-danger' : ''}`}>{s.filaComErro}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <div className="flex items-start gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand/12 text-brand"><Lock size={20} /></span>
          <div>
            <h2 className="text-[15px] font-semibold">A planilha só pode ser alterada pelo sistema</h2>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted">
              A planilha é um <b>espelho somente-leitura</b>. Um guardião relê o arquivo periodicamente,
              compara linha a linha com o Postgres e <b>reverte automaticamente</b> qualquer edição feita
              à mão, registrando o que foi alterado e quando. Compartilhe a planilha como
              <em> Leitor</em> para a equipe: só a conta de serviço do EstoqueFlow tem permissão de escrita.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Guardião da planilha" subtitle="Edições manuais detectadas e revertidas">
          <Table
            rows={s.revertidosPeloGuardiao}
            keyOf={(r) => r.id}
            empty={<Empty icon={<ShieldCheck size={24} />} title="Nenhuma alteração indevida" body="Ninguém tentou editar a planilha por fora do sistema." />}
            columns={[
              { key: 't', header: 'Aba', render: (r) => <Badge>{r.sheetTab}</Badge> },
              { key: 'k', header: 'Linha', render: (r) => <span className="font-mono text-[11.5px] text-faint">{r.rowKey?.slice(0, 20) ?? '—'}</span> },
              { key: 'a', header: 'Ação', render: (r) => <Badge tone="warn">{r.action}</Badge> },
              { key: 'd', header: 'Quando', align: 'right', render: (r) => <span className="text-[12.5px] text-faint">{dt(r.detectedAt)}</span> },
            ]}
          />
        </Card>

        <Card title="Últimos eventos de replicação">
          <Table
            rows={s.ultimosEventos}
            keyOf={(_, i) => String(i)}
            empty={<Empty title="Nenhum evento ainda" body="Registre uma movimentação para ver a replicação acontecer." />}
            columns={[
              { key: 't', header: 'Aba', render: (r) => <Badge>{r.sheetTab}</Badge> },
              { key: 's', header: 'Status', render: (r) => <Badge tone={r.status === 'ENVIADO' ? 'ok' : r.status === 'ERRO' ? 'danger' : 'warn'}>{r.status}</Badge> },
              { key: 'e', header: 'Erro', render: (r) => <span className="text-[12.5px] text-danger">{r.lastError?.slice(0, 40) ?? ''}</span> },
              { key: 'd', header: 'Criado', align: 'right', render: (r) => <span className="text-[12.5px] text-faint">{dt(r.createdAt)}</span> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
