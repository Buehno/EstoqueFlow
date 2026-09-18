/**
 * Valor por extenso em português do Brasil.
 * A proposta impressa traz o total escrito entre parênteses logo abaixo do
 * número — "(Vinte e cinco mil, duzentos e trinta e nove reais)" — e é isso
 * que esta função produz.
 */
const UNIDADES = [
  '', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove',
];
const DEZENAS = [
  '', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta',
  'oitenta', 'noventa',
];
const CENTENAS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
];
const ESCALAS: [string, string][] = [
  ['', ''],
  ['mil', 'mil'],
  ['milhão', 'milhões'],
  ['bilhão', 'bilhões'],
];

/** Escreve um grupo de até três dígitos (1..999). */
function grupo(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

/** Parte inteira por extenso, sem a moeda. */
export function inteiroPorExtenso(valor: number): string {
  const n = Math.floor(Math.abs(valor));
  if (n === 0) return 'zero';

  // quebra em grupos de três, do menos para o mais significativo
  const grupos: number[] = [];
  let resto = n;
  while (resto > 0) {
    grupos.push(resto % 1000);
    resto = Math.floor(resto / 1000);
  }

  const partes: string[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    const [singular, plural] = ESCALAS[i] ?? ['', ''];
    // "mil" não leva "um" na frente: 1.000 é "mil", não "um mil"
    const texto = i === 1 && g === 1 ? 'mil' : `${grupo(g)}${singular ? ` ${g === 1 ? singular : plural}` : ''}`;
    partes.push(texto.trim());
  }

  // vírgula entre os grupos; "e" antes do último quando ele é pequeno ou redondo:
  // "vinte e cinco mil, duzentos e trinta e nove" mas "um milhão e quinhentos mil"
  if (partes.length === 1) return partes[0];
  const ultimo = partes[partes.length - 1];
  const anteriores = partes.slice(0, -1).join(', ');
  const ultimoGrupo = grupos.find((g) => g > 0) ?? 0; // grupo falado mais à direita
  const ligacao = ultimoGrupo < 100 || ultimoGrupo % 100 === 0 ? ' e ' : ', ';
  return `${anteriores}${ligacao}${ultimo}`;
}

/**
 * Valor monetário por extenso, com a primeira letra maiúscula.
 * `porExtensoReais(25239)` → "Vinte e cinco mil, duzentos e trinta e nove reais"
 * `porExtensoReais(1234.56)` → "Mil, duzentos e trinta e quatro reais e cinquenta e seis centavos"
 */
export function porExtensoReais(valor: number): string {
  const negativo = valor < 0;
  const absoluto = Math.abs(valor);
  const inteiro = Math.floor(absoluto);
  const centavos = Math.round((absoluto - inteiro) * 100);

  const partes: string[] = [];
  if (inteiro > 0) {
    // milhões e bilhões exatos pedem a preposição: "um milhão DE reais"
    const exatoEmEscalaGrande = inteiro >= 1_000_000 && inteiro % 1_000_000 === 0;
    const moeda = inteiro === 1 ? 'real' : exatoEmEscalaGrande ? 'de reais' : 'reais';
    partes.push(`${inteiroPorExtenso(inteiro)} ${moeda}`);
  }
  if (centavos > 0) {
    partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  }
  if (!partes.length) partes.push('zero reais');

  const texto = partes.join(' e ');
  const capitalizado = texto.charAt(0).toUpperCase() + texto.slice(1);
  return negativo ? `Menos ${capitalizado.toLowerCase()}` : capitalizado;
}

/** Como aparece no documento: entre parênteses. */
export const porExtensoEntreParenteses = (valor: number) => `(${porExtensoReais(valor)})`;
