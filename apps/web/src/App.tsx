import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, clearToken, getToken, type Me, type Capacidade } from './lib/api';
import { Spinner } from './lib/ui';
import Shell, { primeiraRota } from './components/Shell';
import Tour from './components/Tour';

import Login from './pages/Login';
import TrocarSenha from './pages/TrocarSenha';
import Dashboard from './pages/Dashboard';
import Produtos from './pages/Produtos';
import Depositos from './pages/Depositos';
import Movimentar from './pages/Movimentar';
import Movimentacoes from './pages/Movimentacoes';
import PDV from './pages/PDV';
import Inventario from './pages/Inventario';
import Relatorios from './pages/Relatorios';
import Integracoes from './pages/Integracoes';
import Equipe from './pages/Equipe';
import Propostas from './pages/Propostas';
import PropostaEditor from './pages/PropostaEditor';

interface AuthCtx {
  me: Me | null;
  reload: () => Promise<void>;
  logout: () => void;
  /** `true` se a pessoa tem ao menos uma das capacidades. */
  pode: (...caps: Capacidade[]) => boolean;
}
const Ctx = createContext<AuthCtx>({ me: null, reload: async () => {}, logout: () => {}, pode: () => false });
export const useAuth = () => useContext(Ctx);

/** Protege uma rota por capacidade: sem ela, manda para a primeira tela permitida. */
function Pode({ caps, children }: { caps: Capacidade[]; children: ReactNode }) {
  const { pode } = useAuth();
  if (!pode(...caps)) return <Navigate to={primeiraRota(pode)} replace />;
  return <>{children}</>;
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  const reload = async () => {
    if (!getToken()) { setMe(null); setLoading(false); return; }
    try { setMe(await api.get<Me>('/auth/me')); } catch { setMe(null); }
    setLoading(false);
  };

  useEffect(() => { void reload(); }, []);

  const logout = () => { clearToken(); setMe(null); nav('/login'); };
  const pode = (...caps: Capacidade[]) => caps.some((c) => me?.user.caps?.includes(c));

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Abrindo o EstoqueFlow…" />
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ me, reload, logout, pode }}>
      <Routes>
        <Route path="/login" element={me ? <Navigate to="/app" replace /> : <Login onDone={reload} />} />
        <Route path="/" element={<Navigate to={me ? '/app' : '/login'} replace />} />
        <Route path="/app" element={<Guard><Shell /></Guard>}>
          {/* A operação começa no balcão: é a primeira tela depois do login. */}
          <Route index element={<Navigate to={primeiraRota(pode)} replace />} />
          <Route path="painel" element={<Pode caps={['VER_RELATORIO_RESUMIDO', 'VER_RELATORIO_COMPLETO', 'VER_ALERTAS']}><Dashboard /></Pode>} />
          <Route path="produtos" element={<Pode caps={['GERENCIAR_CADASTROS', 'MOVIMENTAR_ESTOQUE', 'GERENCIAR_PROPOSTAS']}><Produtos /></Pode>} />
          <Route path="depositos" element={<Pode caps={['MOVIMENTAR_ESTOQUE', 'GERENCIAR_INVENTARIO', 'VER_RELATORIO_COMPLETO']}><Depositos /></Pode>} />
          <Route path="movimentacoes" element={<Pode caps={['MOVIMENTAR_ESTOQUE', 'VER_RELATORIO_COMPLETO']}><Movimentacoes /></Pode>} />
          <Route path="movimentacoes/:tipo" element={<Pode caps={['MOVIMENTAR_ESTOQUE']}><Movimentar /></Pode>} />
          <Route path="pdv" element={<Pode caps={['VENDER_BALCAO']}><PDV /></Pode>} />
          <Route path="propostas" element={<Pode caps={['GERENCIAR_PROPOSTAS']}><Propostas /></Pode>} />
          <Route path="propostas/:id" element={<Pode caps={['GERENCIAR_PROPOSTAS']}><PropostaEditor /></Pode>} />
          <Route path="inventario" element={<Pode caps={['GERENCIAR_INVENTARIO']}><Inventario /></Pode>} />
          <Route path="relatorios" element={<Pode caps={['VER_RELATORIO_COMPLETO', 'VER_ALERTAS']}><Relatorios /></Pode>} />
          <Route path="integracoes" element={<Pode caps={['GERENCIAR_REGRAS_ALERTA']}><Integracoes /></Pode>} />
          <Route path="equipe" element={<Pode caps={['GERENCIAR_EQUIPE']}><Equipe /></Pode>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {me && <Tour />}
    </Ctx.Provider>
  );
}

function Guard({ children }: { children: ReactNode }) {
  const { me, reload } = useAuth();
  if (!me) return <Navigate to="/login" replace />;
  // Trava de segurança: senha inicial (definida por um administrador) ainda
  // não trocada — nada do sistema aparece até isso ser resolvido. O backend
  // já barra as rotas por conta própria; isto é só a experiência.
  if (me.user.mustChangePassword) {
    return <TrocarSenha email={me.user.email} onDone={reload} />;
  }
  return <>{children}</>;
}
