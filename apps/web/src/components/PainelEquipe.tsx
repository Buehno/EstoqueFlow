import { useEffect, useMemo, useState, type CSSProperties } from "react";

/**
 * "Equipe" — página única pedida em 18/09: Owner/Gestor/Administrador
 * adicionam, editam, excluem e atualizam pessoas, e trocam papel e
 * permissões individuais, tudo na mesma tela (sem ir a um lugar pra
 * cadastro e outro pra permissões).
 *
 * Consome as rotas de `equipe.routes.ts`. Cada linha da tabela já mostra o
 * papel (select editável) e um grid de toggles de permissão — o toggle
 * reflete o valor JÁ RESOLVIDO (papel + sobrescrita); mexer nele grava uma
 * sobrescrita explícita para aquela pessoa.
 */

type Role = "OWNER" | "GESTOR" | "ADMINISTRADOR" | "OPERADOR";

interface PermissaoChave {
  chave: string;
  rotulo: string;
}

interface Pessoa {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  permissoesResolvidas: Record<string, boolean>;
  permissoesOverride: Record<string, boolean | null>;
  editavelPorMim: boolean;
}

interface RespostaEquipe {
  papeisDisponiveis: { valor: Role; rotulo: string }[];
  permissoesDisponiveis: string[];
  pessoas: Pessoa[];
}

const ROTULO_PERMISSAO: Record<string, string> = {
  estoqueMovimentar: "Movimentar estoque",
  balcaoVender: "Vender no balcão",
  propostasGerenciar: "Gerenciar propostas",
  relatoriosVerResumido: "Relatório resumido",
  relatoriosVerCompleto: "Relatório completo",
  alertasVer: "Ver alertas",
  alertasGerenciarRegras: "Gerenciar regras de alerta",
  inventarioGerenciar: "Gerenciar inventário",
  equipeGerenciar: "Gerenciar equipe",
  configuracoesEmpresa: "Configurações da empresa",
};

interface Api {
  get: (url: string) => Promise<any>;
  post: (url: string, body: unknown) => Promise<any>;
  patch: (url: string, body: unknown) => Promise<any>;
  del: (url: string) => Promise<void>;
}

export function PainelEquipe({ api }: { api: Api }) {
  const [dados, setDados] = useState<RespostaEquipe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null);

  async function recarregar() {
    setCarregando(true);
    try {
      const resposta = await api.get("/equipe");
      setDados(resposta);
      setErro(null);
    } catch (e: any) {
      setErro(e?.message ?? "Não foi possível carregar a equipe.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function trocarPapel(pessoa: Pessoa, novoRole: Role) {
    await api.patch(`/equipe/${pessoa.id}`, { role: novoRole });
    await recarregar();
  }

  async function alternarAtiva(pessoa: Pessoa) {
    await api.patch(`/equipe/${pessoa.id}`, { active: !pessoa.active });
    await recarregar();
  }

  async function alternarPermissao(pessoa: Pessoa, chave: string) {
    const valorAtual = pessoa.permissoesResolvidas[chave];
    await api.patch(`/equipe/${pessoa.id}/permissoes`, { [chave]: !valorAtual });
    await recarregar();
  }

  async function excluir(pessoa: Pessoa) {
    if (!confirm(`Excluir ${pessoa.name}? Essa ação não pode ser desfeita.`)) return;
    await api.del(`/equipe/${pessoa.id}`);
    await recarregar();
  }

  async function adicionar(form: { name: string; email: string; role: Role }) {
    const resposta = await api.post("/equipe", form);
    setSenhaGerada({ email: resposta.email, senha: resposta.senhaProvisoria });
    setFormAberto(false);
    await recarregar();
  }

  const permissoes = useMemo(() => dados?.permissoesDisponiveis ?? [], [dados]);

  if (carregando) return <p>Carregando equipe…</p>;
  if (erro) return <p style={{ color: "#E5484D" }}>{erro}</p>;
  if (!dados) return null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Equipe</h2>
        <button onClick={() => setFormAberto(true)}>+ Adicionar pessoa</button>
      </div>

      {senhaGerada && (
        <div
          style={{
            background: "#173352",
            border: "1px solid #2B5A8A",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <strong>{senhaGerada.email}</strong> criado com a senha provisória{" "}
          <code>{senhaGerada.senha}</code> — a pessoa é obrigada a trocá-la no primeiro
          login. Copie e envie agora; ela não aparece de novo.
          <button style={{ marginLeft: 12 }} onClick={() => setSenhaGerada(null)}>
            Ok, copiei
          </button>
        </div>
      )}

      {formAberto && (
        <FormularioNovaPessoa
          papeis={dados.papeisDisponiveis}
          onCancelar={() => setFormAberto(false)}
          onSalvar={adicionar}
        />
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={celulaCabecalho}>Nome</th>
            <th style={celulaCabecalho}>E-mail</th>
            <th style={celulaCabecalho}>Papel</th>
            <th style={celulaCabecalho}>Status</th>
            {permissoes.map((chave) => (
              <th key={chave} style={{ ...celulaCabecalho, fontSize: 11, whiteSpace: "nowrap" }}>
                {ROTULO_PERMISSAO[chave] ?? chave}
              </th>
            ))}
            <th style={celulaCabecalho}></th>
          </tr>
        </thead>
        <tbody>
          {dados.pessoas.map((pessoa) => (
            <tr key={pessoa.id} style={{ opacity: pessoa.active ? 1 : 0.5 }}>
              <td style={celula}>{pessoa.name}</td>
              <td style={celula}>{pessoa.email}</td>
              <td style={celula}>
                {pessoa.editavelPorMim ? (
                  <select
                    value={pessoa.role}
                    onChange={(e) => trocarPapel(pessoa, e.target.value as Role)}
                  >
                    {dados.papeisDisponiveis.map((p) => (
                      <option key={p.valor} value={p.valor}>
                        {p.rotulo}
                      </option>
                    ))}
                  </select>
                ) : (
                  dados.papeisDisponiveis.find((p) => p.valor === pessoa.role)?.rotulo ?? pessoa.role
                )}
              </td>
              <td style={celula}>
                {pessoa.editavelPorMim ? (
                  <button onClick={() => alternarAtiva(pessoa)}>
                    {pessoa.active ? "Ativo" : "Inativo — reativar"}
                  </button>
                ) : pessoa.active ? (
                  "Ativo"
                ) : (
                  "Inativo"
                )}
                {pessoa.mustChangePassword && (
                  <div style={{ fontSize: 11, color: "#F5A623" }}>troca de senha pendente</div>
                )}
              </td>
              {permissoes.map((chave) => (
                <td key={chave} style={{ ...celula, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={pessoa.permissoesResolvidas[chave] ?? false}
                    disabled={!pessoa.editavelPorMim}
                    onChange={() => alternarPermissao(pessoa, chave)}
                  />
                </td>
              ))}
              <td style={celula}>
                {pessoa.editavelPorMim && (
                  <button onClick={() => excluir(pessoa)} style={{ color: "#E5484D" }}>
                    Excluir
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormularioNovaPessoa({
  papeis,
  onCancelar,
  onSalvar,
}: {
  papeis: { valor: Role; rotulo: string }[];
  onCancelar: () => void;
  onSalvar: (form: { name: string; email: string; role: Role }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(papeis[papeis.length - 1]?.valor ?? "OPERADOR");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSalvar({ name, email, role });
      }}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        marginBottom: 16,
        padding: 12,
        border: "1px solid #1E3A5F",
        borderRadius: 8,
      }}
    >
      <input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
      <input
        placeholder="E-mail"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {papeis.map((p) => (
          <option key={p.valor} value={p.valor}>
            {p.rotulo}
          </option>
        ))}
      </select>
      <button type="submit">Salvar</button>
      <button type="button" onClick={onCancelar}>
        Cancelar
      </button>
    </form>
  );
}

const celulaCabecalho: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #1E3A5F",
  color: "#9FB3C8",
  fontSize: 13,
};

const celula: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #16293F",
};
