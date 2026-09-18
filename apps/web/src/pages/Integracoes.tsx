import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Badge, Card, dt, Empty, Spinner, Table, useToast } from '../lib/ui';

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
  const toast = useToast();

  const load = () => api.get<SyncStatus>('/sync/status').then(setS);
  useEffect(() => { void load(); }, []);

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
