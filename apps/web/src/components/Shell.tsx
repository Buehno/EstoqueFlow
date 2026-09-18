import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, ChevronDown, ClipboardCheck, GraduationCap, LayoutDashboard, LogOut, Menu,
  FileText, Moon, Package, PackageMinus, PackagePlus, PlugZap, ScrollText, ShoppingCart, Sun, TrendingUp,
  Users, Warehouse, X,
} from 'lucide-react';
import { cx, useTheme } from '../lib/ui';
import { useAuth } from '../App';
import { api } from '../lib/api';

/** Operação do dia a dia — é isso que o time de logística usa o tempo todo. */
const NAV: { to: string; label: string; icon: typeof ShoppingCart; end?: boolean }[] = [
  { to: '/app/pdv', label: 'Saída Balcão', icon: ShoppingCart },
  { to: '/app/propostas', label: 'Propostas', icon: FileText },
  { to: '/app/movimentacoes/entrada', label: 'Entrada de Estoque', icon: PackagePlus },
  { to: '/app/movimentacoes/saida', label: 'Saída de Estoque', icon: PackageMinus },
  { to: '/app/movimentacoes/transferencia', label: 'Transferência entre Depósitos', icon: ArrowLeftRight },
  { to: '/app/movimentacoes', end: true, label: 'Movimentação de Estoque', icon: ScrollText },
];

/** Cadastros e gestão — fora do caminho, mas a um clique. */
const NAV_GESTAO: { to: string; label: string; icon: typeof ShoppingCart; end?: boolean }[] = [
  { to: '/app/painel', label: 'Painel', icon: LayoutDashboard },
  { to: '/app/produtos', label: 'Produtos', icon: Package },
  { to: '/app/depositos', label: 'Depósitos', icon: Warehouse },
  { to: '/app/inventario', label: 'Inventário', icon: ClipboardCheck },
  { to: '/app/relatorios', label: 'Relatórios', icon: TrendingUp },
  { to: '/app/integracoes', label: 'Integrações', icon: PlugZap },
  { to: '/app/equipe', label: 'Equipe', icon: Users },
];

export default function Shell() {
  const [open, setOpen] = useState(false);
  const [gestao, setGestao] = useState(false);
  const { dark, toggle } = useTheme();
  const { me, logout, reload } = useAuth();
  const nav = useNavigate();

  const refazerTutorial = async () => {
    await api.patch('/auth/me/tutorial', { step: 0, done: false });
    await reload();
    nav('/app/pdv');
  };

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium leading-tight transition-colors duration-150',
      isActive ? 'bg-brand/12 text-brand' : 'text-muted hover:bg-line/40 hover:text-ink',
    );

  return (
    <div className="flex h-full">
      {/* ───── Sidebar ───── */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-line bg-surface transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-5">
          <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
            <rect width="32" height="32" rx="8" className="fill-brand" />
            <path d="M8 12l8-4 8 4-8 4-8-4z" className="fill-brand-ink" />
            <path d="M8 16l8 4 8-4M8 20l8 4 8-4" className="stroke-brand-ink" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight">EstoqueFlow</p>
            <p className="truncate text-[11px] text-faint">{me?.company.name}</p>
          </div>
          <button onClick={() => setOpen(false)} className="ml-auto rounded-lg p-2 text-faint lg:hidden" aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} onClick={() => setOpen(false)} className={itemClass}>
                  <n.icon size={19} strokeWidth={1.9} className="shrink-0" aria-hidden />
                  <span>{n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-line pt-3">
            <button
              onClick={() => setGestao((g) => !g)}
              aria-expanded={gestao}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-[12px] font-semibold uppercase tracking-wider text-faint transition-colors hover:text-muted"
            >
              Cadastros e gestão
              <ChevronDown size={15} className={cx('ml-auto transition-transform duration-200', gestao && 'rotate-180')} aria-hidden />
            </button>
            {gestao && (
              <ul className="mt-1 space-y-0.5 animate-fade-up">
                {NAV_GESTAO.map((n) => (
                  <li key={n.to}>
                    <NavLink to={n.to} end={n.end} onClick={() => setOpen(false)} className={itemClass}>
                      <n.icon size={18} strokeWidth={1.9} className="shrink-0" aria-hidden />
                      <span className="truncate">{n.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>

        <div className="border-t border-line p-3">
          <button onClick={refazerTutorial} className="btn-ghost btn-sm w-full justify-start gap-2.5">
            <GraduationCap size={17} /> Refazer tutorial
          </button>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-raised p-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 text-[13px] font-bold text-brand">
              {me?.user.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight">{me?.user.name}</p>
              <p className="truncate text-[11px] text-faint">{me?.user.role}</p>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-faint transition-colors hover:text-danger" aria-label="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      {/* ───── Conteúdo ───── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:px-8">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-muted lg:hidden" aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggle}
              className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-raised text-muted transition-colors hover:text-ink"
              aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
