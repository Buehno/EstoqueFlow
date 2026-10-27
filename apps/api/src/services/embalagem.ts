/**
 * Barra × metro — regra definida pelo Ronaldo (§4 do plano, 18/09):
 *
 * - Produto com embalagem por comprimento (BARRA ou ROLO de N metros) tem o
 *   saldo contado em PEÇAS inteiras + uma SOBRA em metros por depósito.
 * - Uma peça com sobra de metragem ainda conta como 1 peça: 8 m de tubo de
 *   cobre (barra de 5 m) = 1 inteira + 3 m em aberto = 2 peças na tela.
 * - As sobras se acumulam entre si: assim que a soma dos restos atinge o
 *   comprimento cheio, +1 peça inteira "fecha" automaticamente e o que passou
 *   continua em aberto para o próximo fechamento (2 + 2 + 1,2 = 5,2 m →
 *   fecha 1 barra, sobram 0,2 m).
 * - A tela mostra SEMPRE metros e centímetros lado a lado, tanto para o total
 *   quanto para a sobra.
 *
 * Funções puras — o stock.service aplica o resultado dentro da transação.
 */

export const TIPOS_EMBALAGEM = ['BARRA', 'ROLO'] as const;
export type TipoEmbalagem = (typeof TIPOS_EMBALAGEM)[number];

/**
 * Famílias padrão da Jundiaquece (comprimentos definidos pelo Ronaldo). A
 * primeira regra cuja palavra-chave aparece no nome do produto vence; produto
 * que já tem embalagem cadastrada não é tocado.
 */
export const FAMILIAS_PADRAO: { familia: string; palavras: string[]; tipo: TipoEmbalagem; metros: number }[] = [
  { familia: 'Tubo de cobre', palavras: ['cobre'], tipo: 'BARRA', metros: 5 },
  { familia: 'Tubo aquatherm', palavras: ['aquatherm', 'aquaterm'], tipo: 'BARRA', metros: 3 },
  { familia: 'Tubo marrom (PVC soldável)', palavras: ['marrom'], tipo: 'BARRA', metros: 6 },
  { familia: 'Tubo condulete', palavras: ['condulete', 'eletroduto'], tipo: 'BARRA', metros: 3 },
  { familia: 'Tubo PPR', palavras: ['ppr'], tipo: 'BARRA', metros: 3 },
  { familia: 'Elumaflex', palavras: ['elumaflex', 'eluma flex'], tipo: 'ROLO', metros: 2 },
];

export interface EstadoEmbalagem {
  /** Peças INTEIRAS (barras/rolos fechados). */
  pecas: number;
  /** Sobra em metros ainda em aberto (0 ≤ sobra < comprimento). */
  sobraM: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Fecha peças inteiras a partir da sobra acumulada. */
export function normalizar(e: EstadoEmbalagem, comprimento: number): EstadoEmbalagem {
  let pecas = e.pecas;
  let sobra = r3(e.sobraM);
  if (comprimento > 0) {
    const fechadas = Math.floor(sobra / comprimento + 1e-9);
    if (fechadas > 0) { pecas += fechadas; sobra = r3(sobra - fechadas * comprimento); }
  }
  if (sobra < 0.0005) sobra = 0;
  return { pecas, sobraM: sobra };
}

/** Entrada em metros: soma à sobra e fecha o que der. */
export function entrarMetros(e: EstadoEmbalagem, metros: number, comprimento: number): EstadoEmbalagem {
  if (metros <= 0) throw new Error('metragem deve ser positiva');
  return normalizar({ pecas: e.pecas, sobraM: e.sobraM + metros }, comprimento);
}

/**
 * Saída em metros: consome a sobra primeiro; se não bastar, abre peças
 * inteiras (quantas forem precisas) e o que passou vira a nova sobra.
 * Devolve null quando a metragem total não cobre o pedido.
 */
export function sairMetros(e: EstadoEmbalagem, metros: number, comprimento: number): EstadoEmbalagem | null {
  if (metros <= 0) throw new Error('metragem deve ser positiva');
  const total = totalMetros(e, comprimento);
  if (total + 1e-9 < metros) return null;
  if (e.sobraM + 1e-9 >= metros) return normalizar({ pecas: e.pecas, sobraM: e.sobraM - metros }, comprimento);
  const falta = metros - e.sobraM;
  const abrir = Math.ceil(falta / comprimento - 1e-9);
  return normalizar({ pecas: e.pecas - abrir, sobraM: abrir * comprimento - falta }, comprimento);
}

export function totalMetros(e: EstadoEmbalagem, comprimento: number): number {
  return r3(e.pecas * comprimento + e.sobraM);
}

/** Peças como a equipe conta: inteiras + 1 se há sobra em aberto. */
export function pecasContadas(e: EstadoEmbalagem): number {
  return e.pecas + (e.sobraM > 0 ? 1 : 0);
}

const fmt = (n: number, casas: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
/** "5,2 m (520 cm)" — sempre os dois formatos juntos. */
export function metrosECm(m: number): string {
  return `${fmt(r3(m), 3)} m (${fmt(Math.round(m * 100), 0)} cm)`;
}

/** Resumo pronto para a tela/API. */
export function resumo(e: EstadoEmbalagem, comprimento: number, tipo: TipoEmbalagem | string) {
  const total = totalMetros(e, comprimento);
  const nomePeca = tipo === 'ROLO' ? 'rolo' : 'barra';
  return {
    tipo,
    comprimentoM: comprimento,
    comprimento: metrosECm(comprimento),
    pecasInteiras: e.pecas,
    sobraM: r3(e.sobraM),
    sobra: metrosECm(e.sobraM),
    pecasContadas: pecasContadas(e),
    totalM: total,
    total: metrosECm(total),
    descricao:
      `${pecasContadas(e)} ${nomePeca}${pecasContadas(e) === 1 ? '' : 's'}` +
      (e.sobraM > 0 ? ` (${e.pecas} inteira${e.pecas === 1 ? '' : 's'} + ${metrosECm(e.sobraM)} em aberto)` : '') +
      ` · total ${metrosECm(total)}`,
  };
}

/** Converte a quantidade digitada (peças, metros ou centímetros) para metros. */
export function paraMetros(valor: number, unidade: 'PECAS' | 'M' | 'CM', comprimento: number): number {
  if (unidade === 'M') return valor;
  if (unidade === 'CM') return valor / 100;
  return valor * comprimento;
}
