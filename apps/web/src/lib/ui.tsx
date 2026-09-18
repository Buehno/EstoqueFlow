import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes,
} from 'react';
import { AlertTriangle, Check, Info, Loader2, ScanLine, X } from 'lucide-react';

// ═══════════════════════════ formatação ═══════════════════════════
export const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
export const qty = (v: number) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(v || 0);
export const int = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);
export const dt = (v: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
export const dOnly = (v: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(v));

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ═══════════════════════════ toasts ═══════════════════════════
type Toast = { id: number; kind: 'ok' | 'err' | 'info'; title: string; body?: string };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p, { ...t, id }]);
    setTimeout(() => setItems((p) => p.filter((i) => i.id !== id)), 5200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border p-3.5 shadow-pop backdrop-blur',
              t.kind === 'ok' && 'border-ok/40 bg-ok/10',
              t.kind === 'err' && 'border-danger/40 bg-danger/10',
              t.kind === 'info' && 'border-line bg-raised',
            )}
          >
            <span className={cx('mt-0.5 shrink-0', t.kind === 'ok' ? 'text-ok' : t.kind === 'err' ? 'text-danger' : 'text-brand')}>
              {t.kind === 'ok' ? <Check size={18} /> : t.kind === 'err' ? <AlertTriangle size={18} /> : <Info size={18} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[13px] leading-snug text-muted">{t.body}</p>}
            </div>
            <button
              onClick={() => setItems((p) => p.filter((i) => i.id !== t.id))}
              className="-m-1 rounded-lg p-1 text-faint transition-colors hover:text-ink"
              aria-label="Fechar aviso"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ═══════════════════════════ campos ═══════════════════════════
export function Field({
  label, hint, error, children, required,
}: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-faint">{hint}</span>}
      {error && (
        <span className="mt-1 flex items-center gap-1 text-xs font-medium text-danger">
          <AlertTriangle size={12} /> {error}
        </span>
      )}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cx('field', p.className)} />
);

export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx('field cursor-pointer', p.className)} />
);

/** Campo de leitura por código de barras: foca sozinho e dispara no Enter. */
export function BarcodeField({
  onScan, placeholder = 'Bipe o código de barras ou digite o SKU', autoFocus = true, id,
}: { onScan: (code: string) => void; placeholder?: string; autoFocus?: boolean; id?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState('');
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <div className="relative" id={id}>
      <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand" size={19} aria-hidden />
      <input
        ref={ref}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim()) { onScan(v.trim()); setV(''); }
        }}
        placeholder={placeholder}
        aria-label="Leitor de código de barras"
        className="field h-12 pl-11 font-mono text-[15px] tracking-wide"
        inputMode="text"
        autoComplete="off"
      />
    </div>
  );
}

// ═══════════════════════════ blocos ═══════════════════════════
export function Card({ title, subtitle, action, children, className, id }: {
  title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  return (
    <section className={cx('card animate-fade-up', className)} id={id}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = 'default', icon }: {
  label: string; value: string; sub?: string; tone?: 'default' | 'ok' | 'warn' | 'danger'; icon?: ReactNode;
}) {
  return (
    <div className="card animate-fade-up p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        {icon && <span className="text-faint">{icon}</span>}
      </div>
      <p className={cx(
        'mt-2 text-[26px] font-bold leading-none tnum',
        tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger',
      )}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[13px] text-faint">{sub}</p>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: {
  children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand';
}) {
  const map = {
    neutral: 'bg-line/60 text-muted',
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/15 text-danger',
    info: 'bg-info/15 text-info',
    brand: 'bg-brand/15 text-brand',
  } as const;
  return <span className={cx('chip', map[tone])}>{children}</span>;
}

export function Empty({ icon, title, body, action }: {
  icon?: ReactNode; title: string; body?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="rounded-2xl bg-line/50 p-4 text-faint">{icon}</div>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {body && <p className="max-w-sm text-[13.5px] leading-relaxed text-muted">{body}</p>}
      {action}
    </div>
  );
}

export const Spinner = ({ label = 'Carregando…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2.5 py-12 text-muted">
    <Loader2 className="animate-spin" size={18} aria-hidden />
    <span className="text-sm">{label}</span>
  </div>
);

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
         role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx(
        'card max-h-[92vh] w-full animate-scale-in overflow-hidden rounded-b-none sm:rounded-2xl',
        wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
      )}>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="-m-2 rounded-lg p-2 text-faint transition-colors hover:text-ink" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="max-h-[calc(92vh-64px)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Table<T>({ columns, rows, empty, keyOf }: {
  columns: { key: string; header: string; align?: 'left' | 'right' | 'center'; render: (r: T) => ReactNode }[];
  rows: T[];
  empty?: ReactNode;
  keyOf: (r: T, i: number) => string;
}) {
  if (!rows.length) return <>{empty ?? <Empty title="Nenhum registro encontrado" />}</>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-full border-collapse">
        <thead className="border-b border-line">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cx('th', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={keyOf(r, i)} className="transition-colors hover:bg-line/25">
              {columns.map((c) => (
                <td key={c.key} className={cx('td', c.align === 'right' && 'text-right tnum', c.align === 'center' && 'text-center')}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════ tema ═══════════════════════════
export function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('ef.theme') !== 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ef.theme', dark ? 'dark' : 'light');
  }, [dark]);
  return useMemo(() => ({ dark, toggle: () => setDark((d) => !d) }), [dark]);
}
