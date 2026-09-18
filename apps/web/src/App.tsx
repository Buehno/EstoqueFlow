import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, clearToken, getToken, type Me } from './lib/api';
import { Spinner } from './lib/ui';
import Shell from './components/Shell';
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
}
const Ctx = createContext<AuthCtx>({ me: null, reload: async () => {}, logout: () => {} });
export const useAuth = () => useContext(Ctx);

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

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Abrindo o EstoqueFlow…" />
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ me, reload, logout }}>
      <Routes>
        <Route path="/login" element={me ? <Navigate to="/app" replace /> : <Login onDone={reload} />} />
        <Route path="/" element={<Navigate to={me ? '/app' : '/login'} replace />} />
        <Route path="/app" element={<Guard><Shell /></Guard>}>
          {/* A operação começa no balcão: é a primeira tela depois do login. */}
          <Route index element={<Navigate to="/app/pdv" replace />} />
          <Route path="painel" element={<Dashboard />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="depositos" element={<Depositos />} />
          <Route path="movimentacoes" element={<Movimentacoes />} />
          <Route path="movimentacoes/:tipo" element={<Movimentar />} />
          <Route path="pdv" element={<PDV />} />
          <Route path="propostas" element={<Propostas />} />
          <Route path="propostas/:id" element={<PropostaEditor />} />
          <Route path="inventario" element={<Inventario />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="integracoes" element={<Integracoes />} />
          <Route path="equipe" element={<Equipe />} />
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
