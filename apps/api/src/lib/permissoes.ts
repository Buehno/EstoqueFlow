/**
 * Permissões por pessoa — pedido de 18/09 (§5 do plano), implementado em 27/10.
 *
 * Papel = ponto de partida; cada capacidade pode ser ligada/desligada por
 * pessoa (`User.permissionOverrides`). A tela de Equipe mostra tudo num lugar
 * só: papel + botões de liga/desliga.
 *
 * Papéis novos (os antigos continuam válidos para quem já existe):
 *   OWNER          Proprietário — tudo, não editável.
 *   GESTOR         Gestora — acesso completo (estoque, propostas, relatórios
 *                  detalhados, regras de alerta, equipe inteira).
 *   ADMINISTRADOR  Administradora — opera o dia a dia, vê relatórios e
 *                  alertas resumidos e gerencia as permissões das Operadoras.
 *   OPERADOR       Operadora — só o operacional (entrada, saída, transferência,
 *                  balcão, propostas).
 *   ADMIN / ESTOQUISTA / VENDEDOR / LEITURA — papéis antigos: ADMIN vale como
 *   GESTOR; ESTOQUISTA e VENDEDOR como OPERADOR; LEITURA só consulta.
 */
export type Role = 'OWNER' | 'GESTOR' | 'ADMINISTRADOR' | 'OPERADOR' | 'ADMIN' | 'ESTOQUISTA' | 'VENDEDOR' | 'LEITURA';

export const CAPACIDADES = [
  'MOVIMENTAR_ESTOQUE',
  'VENDER_BALCAO',
  'GERENCIAR_PROPOSTAS',
  'GERENCIAR_CADASTROS',
  'GERENCIAR_INVENTARIO',
  'VER_RELATORIO_RESUMIDO',
  'VER_RELATORIO_COMPLETO',
  'VER_ALERTAS',
  'GERENCIAR_REGRAS_ALERTA',
  'GERENCIAR_EQUIPE',
] as const;
export type Capacidade = (typeof CAPACIDADES)[number];

export const ROTULO_CAPACIDADE: Record<Capacidade, { titulo: string; descricao: string }> = {
  MOVIMENTAR_ESTOQUE: { titulo: 'Movimentar estoque', descricao: 'Entrada, saída, transferência, ajuste e histórico' },
  VENDER_BALCAO: { titulo: 'Vender no balcão', descricao: 'Registrar saída balcão (PDV)' },
  GERENCIAR_PROPOSTAS: { titulo: 'Propostas', descricao: 'Criar, editar, exportar e acompanhar propostas' },
  GERENCIAR_CADASTROS: { titulo: 'Cadastros', descricao: 'Produtos, categorias, fornecedores, clientes e tabelas de preço' },
  GERENCIAR_INVENTARIO: { titulo: 'Inventário', descricao: 'Abrir contagens, apurar e aplicar diferenças' },
  VER_RELATORIO_RESUMIDO: { titulo: 'Relatório resumido', descricao: 'Painel com números agregados, sem custo nem margem' },
  VER_RELATORIO_COMPLETO: { titulo: 'Relatório completo', descricao: 'Relatórios detalhados: custo, margem, exportações, limpeza da base' },
  VER_ALERTAS: { titulo: 'Ver alertas de compra', descricao: 'Lista de reposição (itens em 50% do estoque aceitável)' },
  GERENCIAR_REGRAS_ALERTA: { titulo: 'Regras de alerta', descricao: 'Estoque aceitável dos produtos, estornos, correções e e-mail diário' },
  GERENCIAR_EQUIPE: { titulo: 'Equipe', descricao: 'Adicionar, editar, excluir pessoas e ligar/desligar permissões' },
};

const TUDO = new Set<Capacidade>(CAPACIDADES);
const OPERACIONAL = new Set<Capacidade>(['MOVIMENTAR_ESTOQUE', 'VENDER_BALCAO', 'GERENCIAR_PROPOSTAS']);

/** Capacidades que cada papel tem de fábrica. */
export const PADRAO_POR_PAPEL: Record<Role, ReadonlySet<Capacidade>> = {
  OWNER: TUDO,
  GESTOR: TUDO,
  ADMIN: TUDO,
  ADMINISTRADOR: new Set<Capacidade>([
    ...OPERACIONAL, 'GERENCIAR_CADASTROS', 'GERENCIAR_INVENTARIO',
    'VER_RELATORIO_RESUMIDO', 'VER_ALERTAS', 'GERENCIAR_EQUIPE',
  ]),
  OPERADOR: OPERACIONAL,
  ESTOQUISTA: new Set<Capacidade>([...OPERACIONAL, 'GERENCIAR_CADASTROS', 'GERENCIAR_INVENTARIO']),
  VENDEDOR: new Set<Capacidade>(['VENDER_BALCAO', 'GERENCIAR_PROPOSTAS']),
  LEITURA: new Set<Capacidade>(['VER_RELATORIO_RESUMIDO']),
};

export const ROTULO_PAPEL: Record<Role, { label: string; desc: string; legado?: boolean }> = {
  OWNER: { label: 'Proprietário', desc: 'Acesso total à conta; não pode ser alterado' },
  GESTOR: { label: 'Gestor(a)', desc: 'Acesso completo: estoque, propostas, relatórios detalhados, regras de alerta e equipe inteira' },
  ADMINISTRADOR: { label: 'Administrador(a)', desc: 'Opera o dia a dia, vê relatórios e alertas resumidos e gerencia as permissões dos operadores' },
  OPERADOR: { label: 'Operador(a)', desc: 'Só o operacional: entrada, saída, transferência, balcão e propostas' },
  ADMIN: { label: 'Administrador (antigo)', desc: 'Papel antigo — equivale a Gestor(a)', legado: true },
  ESTOQUISTA: { label: 'Estoquista (antigo)', desc: 'Papel antigo — operacional + cadastros + inventário', legado: true },
  VENDEDOR: { label: 'Vendedor (antigo)', desc: 'Papel antigo — balcão e propostas', legado: true },
  LEITURA: { label: 'Somente leitura', desc: 'Só consulta o painel resumido' },
};

/** Papéis que aparecem para escolha na tela (os antigos ficam só para quem já tem). */
export const PAPEIS_ATRIBUIVEIS: Role[] = ['GESTOR', 'ADMINISTRADOR', 'OPERADOR', 'LEITURA'];

/** Nível hierárquico — quem gerencia só mexe em quem está abaixo. */
export function nivelDoPapel(role: Role): number {
  switch (role) {
    case 'OWNER': return 4;
    case 'GESTOR': case 'ADMIN': return 3;
    case 'ADMINISTRADOR': return 2;
    case 'OPERADOR': case 'ESTOQUISTA': case 'VENDEDOR': return 1;
    case 'LEITURA': return 0;
  }
}

export type Overrides = Partial<Record<Capacidade, boolean>>;

/** Limpa o JSON vindo do banco/da tela: só capacidades conhecidas, só booleanos. */
export function normalizarOverrides(raw: unknown): Overrides {
  const out: Overrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((CAPACIDADES as readonly string[]).includes(k) && typeof v === 'boolean') out[k as Capacidade] = v;
  }
  return out;
}

/** Capacidades efetivas = padrão do papel, sobrescrito pelo que foi ligado/desligado na pessoa. */
export function capacidadesEfetivas(role: Role, overrides: unknown): Set<Capacidade> {
  const base = new Set<Capacidade>(PADRAO_POR_PAPEL[role] ?? OPERACIONAL);
  if (role === 'OWNER') return base; // proprietário nunca perde nada
  for (const [cap, ligado] of Object.entries(normalizarOverrides(overrides)) as [Capacidade, boolean][]) {
    if (ligado) base.add(cap);
    else base.delete(cap);
  }
  return base;
}

/** Para a tela: cada capacidade com o padrão do papel, o override e o valor efetivo. */
export function detalharPermissoes(role: Role, overrides: unknown) {
  const o = normalizarOverrides(overrides);
  const efetivas = capacidadesEfetivas(role, o);
  return CAPACIDADES.map((cap) => ({
    cap,
    ...ROTULO_CAPACIDADE[cap],
    padrao: PADRAO_POR_PAPEL[role]?.has(cap) ?? false,
    override: o[cap] ?? null,
    efetiva: efetivas.has(cap),
  }));
}
