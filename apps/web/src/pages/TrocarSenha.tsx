import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { api, setToken, ApiError } from '../lib/api';
import { Field, Input, useToast } from '../lib/ui';

/**
 * Tela de troca de senha obrigatória — aparece no lugar do sistema inteiro
 * quando `me.user.mustChangePassword` vem `true` (conta criada por um
 * administrador, que escolheu a senha inicial). Corrige a falha de
 * segurança encontrada em produção: antes disso, dava para usar o sistema
 * inteiro com a senha provisória para sempre.
 *
 * O backend também trava isso (`middleware` em `lib/auth.ts` barra qualquer
 * rota fora de /auth/me e /auth/me/password com 403 SENHA_PROVISORIA) — esta
 * tela é só a experiência; a regra de verdade já existe no servidor mesmo
 * que alguém tente pular esta tela.
 */
export default function TrocarSenha({ email, onDone }: { email: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr(null);
    const f = new FormData(e.currentTarget);
    const atual = String(f.get('current') ?? '');
    const nova = String(f.get('next') ?? '');
    const confirma = String(f.get('confirm') ?? '');
    if (nova !== confirma) {
      setErr('A confirmação não confere com a nova senha.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.patch<{ ok: true; token: string }>('/auth/me/password', { current: atual, next: nova });
      setToken(res.token);
      toast({ kind: 'ok', title: 'Senha alterada', body: 'Agora é só continuar.' });
      await onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível trocar a senha.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center px-5">
      <div className="w-full max-w-[380px] animate-fade-up">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
            <KeyRound size={20} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Troque sua senha</h1>
            <p className="text-[13px] text-muted">{email}</p>
          </div>
        </div>
        <p className="mb-6 text-[14px] leading-relaxed text-muted">
          Sua conta foi criada com uma senha definida por um administrador. Antes de continuar,
          defina uma senha nova que só você conhece.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Senha atual" required>
            <Input name="current" type="password" required autoComplete="current-password" autoFocus />
          </Field>
          <Field label="Nova senha" required hint="Mínimo de 8 caracteres">
            <Input name="next" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Confirmar nova senha" required>
            <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
          </Field>

          {err && (
            <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13.5px] font-medium text-danger">
              {err}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? <Loader2 className="animate-spin" size={18} /> : null}
            Salvar e continuar
          </button>
        </form>
      </div>
    </div>
  );
}
