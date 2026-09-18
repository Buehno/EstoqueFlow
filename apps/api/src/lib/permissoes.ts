/**
 * Regras de papel e permissão da Equipe (pedido de 18/09).
 *
 * Modelo: cada pessoa tem um PAPEL (Role), que define um conjunto padrão de
 * permissões. Além disso, Gestor/Administrador podem LIGAR/DESLIGAR
 * permissões individuais por pessoa — a sobrescrita (`overrides`) sempre
 * vence o padrão do papel quando não é `null`/`undefined`.
 *
 * Este módulo é lógica pura (sem Prisma, sem Fastify) pra poder ser testado
 * isoladamente e reusado tanto no backend (autorização das rotas) quanto,
 * se precisar, no frontend (mostrar/esconder controles).
 */

export type Role = "OWNER" | "GESTOR" | "ADMINISTRADOR" | "OPERADOR";

export const PAPEIS: { valor: Role; rotulo: string }[] = [
  { valor: "OWNER", rotulo: "Proprietário" },
  { valor: "GESTOR", rotulo: "Gestor" },
  { valor: "ADMINISTRADOR", rotulo: "Administrador" },
  { valor: "OPERADOR", rotulo: "Operador" },
];

export const PERMISSAO_CHAVES = [
  "estoqueMovimentar",
  "balcaoVender",
  "propostasGerenciar",
  "relatoriosVerResumido",
  "relatoriosVerCompleto",
  "alertasVer",
  "alertasGerenciarRegras",
  "inventarioGerenciar",
  "equipeGerenciar",
  "configuracoesEmpresa",
] as const;

export type PermissaoChave = (typeof PERMISSAO_CHAVES)[number];

export const PERMISSAO_ROTULOS: Record<PermissaoChave, string> = {
  estoqueMovimentar: "Movimentar estoque (entrada/saída/transferência)",
  balcaoVender: "Vender no balcão (PDV)",
  propostasGerenciar: "Gerenciar propostas",
  relatoriosVerResumido: "Ver relatórios resumidos",
  relatoriosVerCompleto: "Ver relatórios completos (custo/margem)",
  alertasVer: "Ver alertas de estoque",
  alertasGerenciarRegras: "Gerenciar regras de alerta",
  inventarioGerenciar: "Gerenciar inventário",
  equipeGerenciar: "Gerenciar equipe",
  configuracoesEmpresa: "Configurações da empresa",
};

/** Sobrescritas por pessoa: cada chave é `true`/`false` (explícito) ou `null`/`undefined` (usa o padrão do papel). */
export type PermissaoOverrides = Partial<Record<PermissaoChave, boolean | null | undefined>>;

/** Permissões já resolvidas (sempre boolean, nunca null) — o que a tela usa pra habilitar/desabilitar algo. */
export type PermissoesResolvidas = Record<PermissaoChave, boolean>;

const TUDO_LIGADO: PermissoesResolvidas = Object.fromEntries(
  PERMISSAO_CHAVES.map((chave) => [chave, true]),
) as PermissoesResolvidas;

const PADRAO_POR_PAPEL: Record<Role, PermissoesResolvidas> = {
  OWNER: TUDO_LIGADO,
  GESTOR: {
    estoqueMovimentar: true,
    balcaoVender: true,
    propostasGerenciar: true,
    relatoriosVerResumido: true,
    relatoriosVerCompleto: true,
    alertasVer: true,
    alertasGerenciarRegras: true,
    inventarioGerenciar: true,
    equipeGerenciar: true,
    configuracoesEmpresa: false,
  },
  ADMINISTRADOR: {
    estoqueMovimentar: true,
    balcaoVender: true,
    propostasGerenciar: true,
    relatoriosVerResumido: true,
    relatoriosVerCompleto: false,
    alertasVer: true,
    alertasGerenciarRegras: false,
    inventarioGerenciar: true,
    equipeGerenciar: true, // só sobre Operadores — ver `podeGerenciarPapel`
    configuracoesEmpresa: false,
  },
  OPERADOR: {
    estoqueMovimentar: true,
    balcaoVender: true,
    propostasGerenciar: true,
    relatoriosVerResumido: false,
    relatoriosVerCompleto: false,
    alertasVer: false,
    alertasGerenciarRegras: false,
    inventarioGerenciar: false,
    equipeGerenciar: false,
    configuracoesEmpresa: false,
  },
};

/** Papel = ponto de partida; sobrescritas por pessoa vencem quando definidas (não-null). */
export function resolverPermissoes(role: Role, overrides?: PermissaoOverrides | null): PermissoesResolvidas {
  const base = PADRAO_POR_PAPEL[role];
  if (!overrides) return { ...base };

  const resolvidas = { ...base };
  for (const chave of PERMISSAO_CHAVES) {
    const valor = overrides[chave];
    if (valor === true || valor === false) {
      resolvidas[chave] = valor;
    }
  }
  return resolvidas;
}

/** Hierarquia pra decidir quem pode editar/excluir/trocar o papel de quem. Maior número = mais alto. */
const NIVEL: Record<Role, number> = { OWNER: 3, GESTOR: 2, ADMINISTRADOR: 1, OPERADOR: 0 };

/**
 * Regra combinada do pedido: "Owner, Administrador e Gestor" gerenciam a
 * equipe, mas ninguém gerencia alguém do mesmo nível ou acima — e
 * Administrador só gerencia Operador (não outro Administrador, nem Gestor),
 * conforme já descrito na seção 5 do plano ("Administradora... pode
 * gerenciar as permissões das Operadoras — mas não vê o que é exclusivo da
 * Gestora"). OWNER nunca é alvo de edição/exclusão por ninguém, nem por si
 * mesmo via essa tela (evita se auto-rebaixar/travar o próprio acesso).
 */
export function podeGerenciar(quem: Role, alvo: Role): boolean {
  if (alvo === "OWNER") return false;
  if (quem === "OWNER") return true;
  if (quem === "GESTOR") return alvo !== "GESTOR"; // OWNER já foi excluído acima
  if (quem === "ADMINISTRADOR") return alvo === "OPERADOR";
  return false; // OPERADOR nunca gerencia ninguém
}

/** Só quem tem `equipeGerenciar` resolvido igual a true (e além disso respeita `podeGerenciar`) mexe na equipe. */
export function podeAbrirPainelEquipe(role: Role, overrides?: PermissaoOverrides | null): boolean {
  return resolverPermissoes(role, overrides).equipeGerenciar;
}

/** Papéis que `quem` pode atribuir a alguém — nunca pode promover a um papel igual/maior que o seu, nem a OWNER. */
export function papeisAtribuiveis(quem: Role): Role[] {
  return PAPEIS.map((p) => p.valor).filter((role) => role !== "OWNER" && podeGerenciar(quem, role));
}
