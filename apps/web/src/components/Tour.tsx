import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, GraduationCap, X } from 'lucide-react';
import { api, type TutorialStep } from '../lib/api';
import { cx } from '../lib/ui';
import { useAuth } from '../App';

interface TutorialResponse {
  steps: TutorialStep[];
  currentStep: number;
  done: boolean;
  checklist: { produtosCadastrados: number; movimentacoesFeitas: number; vendasRealizadas: number; contagensAbertas: number };
}

/**
 * Tutorial guiado servido pelo próprio sistema. Aparece automaticamente no
 * primeiro login e informa, passo a passo, tudo o que o usuário precisa fazer.
 */
export default function Tour() {
  const { me, reload } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState<TutorialResponse | null>(null);
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!me || me.user.tutorialDone) return;
    api.get<TutorialResponse>('/tutorial').then((d) => {
      setData(d);
      setI(Math.min(d.currentStep, d.steps.length - 1));
      setVisible(true);
    });
  }, [me?.user.tutorialDone, me?.user.id]);

  if (!visible || !data) return null;

  const step = data.steps[i];
  const last = i === data.steps.length - 1;
  const pct = Math.round(((i + 1) / data.steps.length) * 100);

  const save = (step: number, done = false) =>
    api.patch('/auth/me/tutorial', { step, done }).catch(() => {});

  const next = async () => {
    if (last) {
      await save(data.steps.length, true);
      setVisible(false);
      await reload();
      return;
    }
    const n = i + 1;
    setI(n);
    await save(n);
    const target = data.steps[n];
    if (target.route) nav(target.route);
  };

  const skip = async () => {
    await save(i, true);
    setVisible(false);
    await reload();
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-[1px]" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="fixed inset-x-0 bottom-0 z-[80] mx-auto w-full max-w-lg animate-fade-up p-4 sm:bottom-6 sm:right-6 sm:left-auto sm:mx-0"
      >
        <div className="card overflow-hidden shadow-pop">
          <div className="h-1 w-full bg-line">
            <div
              className="h-full bg-brand transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progresso do tutorial"
            />
          </div>

          <div className="flex items-start gap-3 px-5 pt-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
              <GraduationCap size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
                Tutorial · passo {i + 1} de {data.steps.length}
              </p>
              <h2 id="tour-title" className="mt-0.5 text-[16px] font-bold leading-tight">
                {step.title}
              </h2>
            </div>
            <button onClick={skip} className="-m-2 rounded-lg p-2 text-faint transition-colors hover:text-ink" aria-label="Pular tutorial">
              <X size={18} />
            </button>
          </div>

          <p className="px-5 pt-3 text-[14px] leading-relaxed text-muted">{step.body}</p>

          {i === 0 && (
            <ul className="mx-5 mt-4 space-y-1.5 rounded-xl bg-raised p-3.5 text-[13px] text-muted">
              <li className="flex items-center gap-2">
                <Check size={14} className="text-ok" /> {data.checklist.produtosCadastrados} produto(s) cadastrado(s)
              </li>
              <li className="flex items-center gap-2">
                <Check size={14} className="text-ok" /> {data.checklist.movimentacoesFeitas} movimentação(ões) registrada(s)
              </li>
              <li className="flex items-center gap-2">
                <Check size={14} className="text-ok" /> {data.checklist.vendasRealizadas} venda(s) no balcão
              </li>
            </ul>
          )}

          <div className="mt-5 flex items-center gap-2 border-t border-line px-5 py-4">
            <div className="flex gap-1.5" aria-hidden>
              {data.steps.map((_, k) => (
                <span key={k} className={cx('h-1.5 rounded-full transition-all duration-200', k === i ? 'w-5 bg-brand' : 'w-1.5 bg-line')} />
              ))}
            </div>
            <button onClick={skip} className="btn-ghost btn-sm ml-auto">Pular</button>
            <button onClick={next} className="btn-primary btn-sm gap-1.5">
              {step.action} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
