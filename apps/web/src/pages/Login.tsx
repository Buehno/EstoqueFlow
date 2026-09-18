import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api, setToken, ApiError } from '../lib/api';
import { Field, Input, useToast } from '../lib/ui';

export default function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      const payload =
        mode === 'login'
          ? { email: f.get('email'), password: f.get('password') }
          : {
              companyName: f.get('companyName'),
              name: f.get('name'),
              email: f.get('email'),
              password: f.get('password'),
            };
      const res = await api.post<{ token: string }>(`/auth/${mode}`, payload);
      setToken(res.token);
      await onDone();
      toast({ kind: 'ok', title: mode === 'login' ? 'Bem-vindo de volta!' : 'Conta criada com sucesso' });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      {/* painel de marca */}
      <div className="relative hidden overflow-hidden bg-surface lg:block">
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 25% 20%, rgb(var(--c-brand)/.22), transparent 45%), radial-gradient(circle at 80% 75%, rgb(var(--c-info)/.18), transparent 40%)',
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(rgb(var(--c-line)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-line)) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse at center, black, transparent 75%)',
          }}
          aria-hidden
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden>
              <rect width="32" height="32" rx="8" className="fill-brand" />
              <path d="M8 12l8-4 8 4-8 4-8-4z" className="fill-brand-ink" />
              <path d="M8 16l8 4 8-4M8 20l8 4 8-4" className="stroke-brand-ink" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-xl font-bold">EstoqueFlow</span>
          </div>

          <div className="max-w-md">
            <h1 className="text-[38px] font-bold leading-[1.1] tracking-tight">
              Um estoque só.
              <br />
              <span className="text-brand">Dois depósitos.</span>
              <br />
              Zero planilha solta.
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-muted">
              A plataforma responsável pela gestão de estoque entre os depósitos da sua operação:
              entrada, saída, transferência, venda balcão e inventário — cada movimento rastreado,
              cada saldo auditável.
            </p>
            <ul className="mt-8 space-y-3 text-[14px] text-muted">
              {[
                'Transferência atômica entre depósitos, com custo médio junto',
                'PDV de balcão com leitor de código de barras',
                'Inventário cíclico com apuração de divergências',
                'Redundância automática em planilha espelho somente-leitura',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[12px] text-faint">iAgentics · Postgres + Google Sheets · deploy em Railway</p>
        </div>
      </div>

      {/* formulário */}
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px] animate-fade-up">
          <div className="mb-8 lg:hidden">
            <svg viewBox="0 0 32 32" className="h-11 w-11" aria-hidden>
              <rect width="32" height="32" rx="8" className="fill-brand" />
              <path d="M8 12l8-4 8 4-8 4-8-4z" className="fill-brand-ink" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold tracking-tight">
            {mode === 'login' ? 'Entrar na plataforma' : 'Criar conta da empresa'}
          </h2>
          <p className="mt-1.5 text-[14px] text-muted">
            {mode === 'login'
              ? 'Use o e-mail cadastrado pela sua equipe de logística.'
              : 'Criamos dois depósitos padrão e o tutorial guiado para você.'}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === 'register' && (
              <>
                <Field label="Nome da empresa" required>
                  <Input name="companyName" required placeholder="Logística Alfa Ltda" autoComplete="organization" />
                </Field>
                <Field label="Seu nome" required>
                  <Input name="name" required placeholder="Ronaldo Bueno" autoComplete="name" />
                </Field>
              </>
            )}
            <Field label="E-mail" required>
              <Input name="email" type="email" required placeholder="voce@empresa.com.br" autoComplete="email" />
            </Field>
            <Field label="Senha" required hint={mode === 'register' ? 'Mínimo de 8 caracteres' : undefined}>
              <Input
                name="password"
                type="password"
                required
                minLength={mode === 'register' ? 8 : 1}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </Field>

            {err && (
              <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13.5px] font-medium text-danger">
                {err}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 className="animate-spin" size={18} /> : null}
              {mode === 'login' ? 'Entrar' : 'Criar conta'}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null); }}
            className="mt-5 w-full text-[13.5px] text-muted transition-colors hover:text-ink"
          >
            {mode === 'login' ? 'Não tem conta? Cadastre sua empresa' : 'Já tem conta? Entrar'}
          </button>

          {mode === 'login' && (
            <div className="mt-8 rounded-xl border border-line bg-raised p-3.5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">Ambiente de demonstração</p>
              <p className="mt-1.5 font-mono text-[13px] text-muted">demo@estoqueflow.app</p>
              <p className="font-mono text-[13px] text-muted">estoque2026</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
