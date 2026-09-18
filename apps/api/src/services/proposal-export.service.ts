/**
 * proposal-export.service
 *
 * Geração da proposta comercial da Jundiaquece em três formatos —
 * PDF (pdfmake), Word (docx) e Excel (exceljs) — reproduzindo o
 * documento comercial que a empresa já utiliza.
 *
 * Nenhum dos geradores depende de rede, de Chromium ou de arquivos de
 * imagem: o cabeçalho da empresa é resolvido só com tipografia.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import type {
  Content,
  ContentText,
  StyleDictionary,
  TableCell as PdfTableCell,
  TDocumentDefinitions,
  TFontDictionary,
} from 'pdfmake/interfaces.js';

/* ------------------------------------------------------------------ */
/* Contrato                                                            */
/* ------------------------------------------------------------------ */

export interface PropostaExport {
  numero: number;
  emissao: Date;
  cidade: string;
  cliente: { nome: string; telefone?: string | null; local?: string | null; email?: string | null };
  escopo: string;
  intro?: string | null;
  itens: { quantidadeTexto: string; descricao: string; total: number }[];
  total: number;
  totalPorExtenso: string;
  totalAVista?: number | null;
  condicoesPagamento?: string | null;
  condicoesAVista?: string | null;
  prazoEntrega?: string | null;
  validadeDias: number;
  fechamento?: string | null;
  notaImportante?: string | null;
  vendedor?: string | null;
  empresa: { nome: string; endereco: string; email: string; site: string; telefone: string };
}

/* ------------------------------------------------------------------ */
/* Constantes de marca / formatação                                    */
/* ------------------------------------------------------------------ */

const RAZAO_SOCIAL = 'Comércio de Aquecedores Ltda';
const ESPECIALIDADES =
  'Aquecedores Solares · Aquecedores para Piscina · Aquecedores a Gás · Instalações de Hidráulica e Elétrica';
const DEPARTAMENTO = 'Dpt°.: Vendas';

const CINZA_CABECALHO = 'E8E8E8';
const CINZA_BORDA = 'AAAAAA';
const CINZA_TEXTO = '555555';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const NUMERO_BR = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `7600` -> `R$ 7.600,00` (espaço normal, não NBSP). */
function moeda(valor: number): string {
  return `R$ ${NUMERO_BR.format(valor)}`;
}

/** `17/08/2026` */
function dataCurta(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `17 de agosto de 2026` */
function dataExtenso(d: Date): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** `2026-08-17` */
function dataIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function linhas(texto: string): string[] {
  return texto.split(/\r?\n/);
}

/** Remove acentos/pontuação e devolve MAIÚSCULAS-COM-HÍFEN. */
function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** O total por extenso sempre sai entre parênteses. */
function porExtenso(texto: string): string {
  const t = texto.trim();
  if (!t) return '';
  return /^\(.*\)$/.test(t) ? t : `(${t})`;
}

/** Linha "R$ x - para pagamento a vista." derivada de `totalAVista`. */
function linhaAVista(p: PropostaExport): string | null {
  if (p.condicoesAVista) return p.condicoesAVista;
  if (p.totalAVista != null) return `${moeda(p.totalAVista)} - para pagamento a vista.`;
  return null;
}

function numeroFormatado(p: PropostaExport): string {
  return String(p.numero).padStart(4, '0');
}

/* ------------------------------------------------------------------ */
/* Nome de arquivo                                                     */
/* ------------------------------------------------------------------ */

/** ex.: `PROPOSTA-0007-SR-FABIO-2026-08-17.pdf` */
export function nomeArquivo(p: PropostaExport, ext: 'pdf' | 'docx' | 'xlsx'): string {
  const cliente = slug(p.cliente.nome).slice(0, 48).replace(/-+$/, '') || 'CLIENTE';
  return `PROPOSTA-${numeroFormatado(p)}-${cliente}-${dataIso(p.emissao)}.${ext}`;
}

/* ------------------------------------------------------------------ */
/* PDF (pdfmake)                                                       */
/* ------------------------------------------------------------------ */

const requireCjs = createRequire(import.meta.url);

/**
 * pdfmake é CommonJS e exporta uma instância única (`module.exports = new pdfmake()`).
 * Em ESM os named imports não são detectáveis pelo lexer do Node, então o módulo é
 * carregado via createRequire — assim o runtime pega o objeto real e o TypeScript
 * mantém a tipagem de @types/pdfmake.
 */
const pdfMake = requireCjs('pdfmake') as typeof import('pdfmake');

let fontesRegistradas = false;

const ARQUIVOS_ROBOTO = {
  normal: 'Roboto-Regular.ttf',
  bold: 'Roboto-Medium.ttf',
  italics: 'Roboto-Italic.ttf',
  bolditalics: 'Roboto-MediumItalic.ttf',
} as const;

/**
 * Descobre o diretório com os TTFs do Roboto que acompanham o pdfmake.
 *
 * O pdfmake 0.3 exige que o descritor de fonte seja um caminho (string) — ele
 * passa cada valor pelo URLResolver antes de abrir o arquivo, então Buffer não
 * funciona. Em ESM também não dá para usar `pdfmake/build/vfs_fonts` direto
 * (`addVirtualFileSystem` só existe no bundle de browser), por isso o fallback
 * materializa os mesmos fontes base64 num diretório temporário e devolve o
 * caminho — o resultado é sempre um diretório com os quatro arquivos .ttf.
 */
function diretorioRoboto(): string {
  const dirPacote = join(dirname(requireCjs.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  const completo = Object.values(ARQUIVOS_ROBOTO).every((arquivo) => existsSync(join(dirPacote, arquivo)));
  if (completo) return dirPacote;

  const vfs = requireCjs('pdfmake/build/vfs_fonts') as Record<string, string>;
  const dirTemp = join(tmpdir(), 'jundiaquece-pdfmake-roboto');
  mkdirSync(dirTemp, { recursive: true });
  for (const arquivo of Object.values(ARQUIVOS_ROBOTO)) {
    const destino = join(dirTemp, arquivo);
    if (!existsSync(destino)) writeFileSync(destino, Buffer.from(vfs[arquivo] ?? '', 'base64'));
  }
  return dirTemp;
}

/** Registra o Roboto embutido no pdfmake e tranca os acessos externos. */
function registrarFontes(): void {
  if (fontesRegistradas) return;

  const dirRoboto = diretorioRoboto();
  const fontes: TFontDictionary = {
    Roboto: {
      normal: join(dirRoboto, ARQUIVOS_ROBOTO.normal),
      bold: join(dirRoboto, ARQUIVOS_ROBOTO.bold),
      italics: join(dirRoboto, ARQUIVOS_ROBOTO.italics),
      bolditalics: join(dirRoboto, ARQUIVOS_ROBOTO.bolditalics),
    },
  };

  pdfMake.setFonts(fontes);
  // O documento não carrega imagens nem recursos remotos: bloquear a rede evita
  // SSRF e liberar apenas a pasta das fontes limita o acesso ao disco. Definir as
  // duas políticas também silencia os avisos do pdfmake 0.3.
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.setLocalAccessPolicy((caminho: string) => caminho.startsWith(dirRoboto));

  fontesRegistradas = true;
}

const ESTILOS_PDF: StyleDictionary = {
  marca: { fontSize: 26, bold: true, alignment: 'center', characterSpacing: 3, color: '#1F3864' },
  marcaSub: { fontSize: 10, alignment: 'center', color: '#333333', margin: [0, 2, 0, 0] },
  marcaEspec: { fontSize: 7.5, alignment: 'center', color: CINZA_TEXTO, margin: [0, 3, 0, 0] },
  cliente: { fontSize: 10, alignment: 'left', margin: [0, 0, 0, 2] },
  titulo: { fontSize: 16, bold: true, alignment: 'center', characterSpacing: 1, margin: [0, 14, 0, 2] },
  tituloSub: { fontSize: 9.5, alignment: 'center', color: CINZA_TEXTO, margin: [0, 0, 0, 10] },
  escopo: { fontSize: 11, bold: true, alignment: 'center', margin: [0, 4, 0, 8] },
  corpo: { fontSize: 9.5, alignment: 'justify', margin: [0, 0, 0, 3] },
  secao: { fontSize: 10.5, bold: true, margin: [0, 10, 0, 3] },
  th: { fontSize: 9.5, bold: true, margin: [0, 4, 0, 4] },
  rodape: { fontSize: 7.5, alignment: 'center', color: CINZA_TEXTO },
};

const LAYOUT_TABELA = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => `#${CINZA_BORDA}`,
  vLineColor: () => `#${CINZA_BORDA}`,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 5,
  paddingBottom: () => 5,
};

function regua(margem: [number, number, number, number]): Content {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.8, lineColor: '#B5B5B5' }],
    margin: margem,
  };
}

function conteudoPdf(p: PropostaExport): Content[] {
  const c: Content[] = [];

  // 1. Cabeçalho da empresa (só tipografia — não há arquivo de logotipo).
  c.push({ text: p.empresa.nome, style: 'marca' });
  c.push({ text: RAZAO_SOCIAL, style: 'marcaSub' });
  c.push({ text: ESPECIALIDADES, style: 'marcaEspec' });
  c.push(regua([0, 8, 0, 12]));

  // 2. Bloco do cliente.
  c.push({ text: [{ text: 'CLIENTE: ', bold: true }, p.cliente.nome], style: 'cliente' });
  if (p.cliente.telefone) c.push({ text: p.cliente.telefone, style: 'cliente' });
  if (p.cliente.email) c.push({ text: p.cliente.email, style: 'cliente' });
  if (p.cliente.local) c.push({ text: [{ text: 'LOCAL: ', bold: true }, p.cliente.local], style: 'cliente' });

  // 3. Título.
  c.push({ text: 'PROPOSTA COMERCIAL', style: 'titulo' });
  c.push({
    text: `Nº ${numeroFormatado(p)}   ·   ${p.cidade}, ${dataCurta(p.emissao)}`,
    style: 'tituloSub',
  });

  // 4. Escopo.
  c.push({ text: p.escopo, style: 'escopo' });

  // 5. Introdução.
  if (p.intro) {
    for (const linha of linhas(p.intro)) c.push({ text: linha, style: 'corpo' });
  }

  // 6. Tabela de itens.
  const body: PdfTableCell[][] = [
    [
      { text: 'QTD', style: 'th', alignment: 'center', fillColor: `#${CINZA_CABECALHO}` },
      { text: 'DESCRIÇÃO DE PRODUTOS', style: 'th', alignment: 'left', fillColor: `#${CINZA_CABECALHO}` },
      { text: 'TOTAL', style: 'th', alignment: 'right', fillColor: `#${CINZA_CABECALHO}` },
    ],
  ];
  for (const item of p.itens) {
    body.push([
      { text: item.quantidadeTexto, alignment: 'center', fontSize: 9.5 },
      // O `\n` é preservado pelo pdfmake — a descrição costuma ter várias linhas.
      { text: item.descricao, alignment: 'left', fontSize: 9, lineHeight: 1.2 },
      { text: moeda(item.total), alignment: 'right', fontSize: 9.5 },
    ]);
  }
  c.push({
    table: { headerRows: 1, widths: [34, '*', 82], body, dontBreakRows: true },
    layout: LAYOUT_TABELA,
    margin: [0, 6, 0, 0],
  });

  // 7. Valor total.
  c.push({
    columns: [
      {
        width: '*',
        text: 'Valor Total da Proposta:',
        bold: true,
        fontSize: 11,
        alignment: 'right',
        margin: [0, 6, 8, 0],
      },
      { width: 'auto', text: moeda(p.total), bold: true, fontSize: 17, alignment: 'right', margin: [0, 0, 0, 0] },
    ],
    margin: [0, 8, 0, 0],
  });
  c.push({
    text: porExtenso(p.totalPorExtenso),
    fontSize: 9,
    italics: true,
    alignment: 'right',
    margin: [0, 2, 0, 0],
  });

  // 8. Condições de pagamento.
  const aVista = linhaAVista(p);
  if (p.condicoesPagamento || aVista) {
    c.push({ text: 'Condições de Pagamento', style: 'secao' });
    if (p.condicoesPagamento) c.push({ text: p.condicoesPagamento, style: 'corpo' });
    if (aVista) c.push({ text: aVista, style: 'corpo' });
  }

  // 9. Prazo de entrega.
  if (p.prazoEntrega) {
    c.push({ text: 'Prazo de entrega', style: 'secao' });
    c.push({ text: p.prazoEntrega, style: 'corpo' });
  }

  // 10. Validade.
  c.push({ text: `Proposta válida por ${p.validadeDias} dias`, style: 'corpo', margin: [0, 8, 0, 0] });

  // 11 a 13. Fechamento, assinatura, data por extenso e nota: mantidos juntos
  // para a assinatura nunca ficar órfã no alto de uma página nova.
  const encerramento: Content[] = [];
  if (p.fechamento) {
    for (const linha of linhas(p.fechamento)) {
      encerramento.push({ text: linha, fontSize: 9.5, alignment: 'left', margin: [0, 0, 0, 2] });
    }
  }
  encerramento.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.6, lineColor: '#777777' }],
    margin: [0, 34, 0, 4],
  });
  if (p.vendedor) encerramento.push({ text: p.vendedor, bold: true, fontSize: 10 });
  encerramento.push({ text: DEPARTAMENTO, fontSize: 9, color: CINZA_TEXTO });

  // 12. Data por extenso.
  encerramento.push({
    text: `${p.cidade}, ${dataExtenso(p.emissao)}.`,
    fontSize: 9.5,
    margin: [0, 14, 0, 0],
  });

  // 13. Nota importante.
  if (p.notaImportante) {
    encerramento.push({
      text: [{ text: 'IMPORTANTE! ', bold: true, fontSize: 8.5 }, { text: p.notaImportante, fontSize: 8 }],
      alignment: 'justify',
      margin: [0, 14, 0, 0],
    });
  }

  c.push({ stack: encerramento, unbreakable: true, margin: [0, 10, 0, 0] });

  return c;
}

function rodapePdf(p: PropostaExport) {
  return (paginaAtual: number, totalPaginas: number): Content => ({
    margin: [40, 6, 40, 0],
    stack: [
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: '#B5B5B5' }] },
      { text: p.empresa.endereco, style: 'rodape', margin: [0, 4, 0, 0] },
      { text: `${p.empresa.email}  ·  ${p.empresa.site}`, style: 'rodape' },
      { text: `PABX: ${p.empresa.telefone}`, style: 'rodape' },
      {
        text: `página ${paginaAtual} de ${totalPaginas}`,
        fontSize: 7,
        alignment: 'center',
        color: '#8A8A8A',
        margin: [0, 2, 0, 0],
      } as ContentText,
    ],
  });
}

export async function gerarPdf(p: PropostaExport): Promise<Buffer> {
  registrarFontes();

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 78],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.15, color: '#1A1A1A' },
    styles: ESTILOS_PDF,
    info: {
      title: `Proposta ${numeroFormatado(p)} — ${p.cliente.nome}`,
      author: p.empresa.nome,
      subject: p.escopo,
    },
    content: conteudoPdf(p),
    footer: rodapePdf(p),
  };

  return pdfMake.createPdf(doc).getBuffer();
}

/* ------------------------------------------------------------------ */
/* DOCX (docx v9)                                                      */
/* ------------------------------------------------------------------ */

const FONTE_DOCX = 'Calibri';

type AlinhamentoDocx = (typeof AlignmentType)[keyof typeof AlignmentType];

interface OpcoesParagrafo {
  bold?: boolean;
  italics?: boolean;
  size?: number; // em pontos
  align?: AlinhamentoDocx;
  color?: string;
  antes?: number; // espaçamento antes, em pontos
  depois?: number; // espaçamento depois, em pontos
  spacingLinha?: number;
  caracteres?: number; // character spacing (twips)
}

function par(texto: string, o: OpcoesParagrafo = {}): Paragraph {
  return new Paragraph({
    alignment: o.align ?? AlignmentType.LEFT,
    spacing: {
      before: Math.round((o.antes ?? 0) * 20),
      after: Math.round((o.depois ?? 2) * 20),
      line: o.spacingLinha,
    },
    children: [
      new TextRun({
        text: texto,
        bold: o.bold,
        italics: o.italics,
        size: Math.round((o.size ?? 10) * 2),
        color: o.color,
        font: FONTE_DOCX,
        characterSpacing: o.caracteres,
      }),
    ],
  });
}

function parRico(partes: { texto: string; bold?: boolean; size?: number; color?: string }[], o: OpcoesParagrafo = {}): Paragraph {
  return new Paragraph({
    alignment: o.align ?? AlignmentType.LEFT,
    spacing: { before: Math.round((o.antes ?? 0) * 20), after: Math.round((o.depois ?? 2) * 20) },
    children: partes.map(
      (parte) =>
        new TextRun({
          text: parte.texto,
          bold: parte.bold,
          size: Math.round((parte.size ?? o.size ?? 10) * 2),
          color: parte.color,
          font: FONTE_DOCX,
        }),
    ),
  });
}

const BORDA_CELULA = {
  top: { style: BorderStyle.SINGLE, size: 4, color: CINZA_BORDA },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: CINZA_BORDA },
  left: { style: BorderStyle.SINGLE, size: 4, color: CINZA_BORDA },
  right: { style: BorderStyle.SINGLE, size: 4, color: CINZA_BORDA },
};

// Larguras em DXA (twips). Página A4 útil ≈ 9.360 twips.
const LARGURAS_DOCX = [900, 6800, 1660];

function celula(
  filhos: Paragraph[],
  largura: number,
  opcoes: { cabecalho?: boolean } = {},
): TableCell {
  return new TableCell({
    width: { size: largura, type: WidthType.DXA },
    borders: BORDA_CELULA,
    verticalAlign: VerticalAlign.TOP,
    shading: opcoes.cabecalho
      ? { type: ShadingType.CLEAR, fill: CINZA_CABECALHO, color: 'auto' }
      : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: filhos,
  });
}

function tabelaDocx(p: PropostaExport): Table {
  const cabecalho = new TableRow({
    tableHeader: true,
    children: [
      celula([par('QTD', { bold: true, size: 10, align: AlignmentType.CENTER })], LARGURAS_DOCX[0]!, { cabecalho: true }),
      celula([par('DESCRIÇÃO DE PRODUTOS', { bold: true, size: 10 })], LARGURAS_DOCX[1]!, { cabecalho: true }),
      celula([par('TOTAL', { bold: true, size: 10, align: AlignmentType.RIGHT })], LARGURAS_DOCX[2]!, { cabecalho: true }),
    ],
  });

  const corpo = p.itens.map(
    (item) =>
      new TableRow({
        children: [
          celula([par(item.quantidadeTexto, { size: 10, align: AlignmentType.CENTER })], LARGURAS_DOCX[0]!),
          // Uma linha da descrição por parágrafo — preserva as quebras de `\n`.
          celula(
            linhas(item.descricao).map((linha) => par(linha, { size: 9.5, depois: 1 })),
            LARGURAS_DOCX[1]!,
          ),
          celula([par(moeda(item.total), { size: 10, align: AlignmentType.RIGHT })], LARGURAS_DOCX[2]!),
        ],
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: LARGURAS_DOCX,
    rows: [cabecalho, ...corpo],
  });
}

export async function gerarDocx(p: PropostaExport): Promise<Buffer> {
  const filhos: (Paragraph | Table)[] = [];

  // 1. Cabeçalho da empresa.
  filhos.push(par(p.empresa.nome, { bold: true, size: 26, align: AlignmentType.CENTER, color: '1F3864', caracteres: 40, depois: 2 }));
  filhos.push(par(RAZAO_SOCIAL, { size: 10, align: AlignmentType.CENTER, color: '333333', depois: 1 }));
  filhos.push(par(ESPECIALIDADES, { size: 7.5, align: AlignmentType.CENTER, color: CINZA_TEXTO, depois: 10 }));

  // 2. Cliente.
  filhos.push(parRico([{ texto: 'CLIENTE: ', bold: true }, { texto: p.cliente.nome }], { size: 10 }));
  if (p.cliente.telefone) filhos.push(par(p.cliente.telefone, { size: 10 }));
  if (p.cliente.email) filhos.push(par(p.cliente.email, { size: 10 }));
  if (p.cliente.local) filhos.push(parRico([{ texto: 'LOCAL: ', bold: true }, { texto: p.cliente.local }], { size: 10 }));

  // 3. Título.
  filhos.push(par('PROPOSTA COMERCIAL', { bold: true, size: 16, align: AlignmentType.CENTER, antes: 12, depois: 2, caracteres: 20 }));
  filhos.push(
    par(`Nº ${numeroFormatado(p)}   ·   ${p.cidade}, ${dataCurta(p.emissao)}`, {
      size: 9.5,
      align: AlignmentType.CENTER,
      color: CINZA_TEXTO,
      depois: 8,
    }),
  );

  // 4. Escopo.
  filhos.push(par(p.escopo, { bold: true, size: 11, align: AlignmentType.CENTER, depois: 8 }));

  // 5. Introdução.
  if (p.intro) {
    for (const linha of linhas(p.intro)) {
      filhos.push(par(linha, { size: 9.5, align: AlignmentType.JUSTIFIED, depois: 3 }));
    }
  }

  // 6. Tabela.
  filhos.push(tabelaDocx(p));

  // 7. Total.
  filhos.push(
    parRico(
      [
        { texto: 'Valor Total da Proposta:   ', bold: true, size: 11 },
        { texto: moeda(p.total), bold: true, size: 17 },
      ],
      { align: AlignmentType.RIGHT, antes: 8, depois: 1 },
    ),
  );
  filhos.push(par(porExtenso(p.totalPorExtenso), { size: 9, italics: true, align: AlignmentType.RIGHT, depois: 4 }));

  // 8. Condições de pagamento.
  const aVista = linhaAVista(p);
  if (p.condicoesPagamento || aVista) {
    filhos.push(par('Condições de Pagamento', { bold: true, size: 10.5, antes: 10, depois: 3 }));
    if (p.condicoesPagamento) filhos.push(par(p.condicoesPagamento, { size: 9.5 }));
    if (aVista) filhos.push(par(aVista, { size: 9.5 }));
  }

  // 9. Prazo de entrega.
  if (p.prazoEntrega) {
    filhos.push(par('Prazo de entrega', { bold: true, size: 10.5, antes: 10, depois: 3 }));
    filhos.push(par(p.prazoEntrega, { size: 9.5 }));
  }

  // 10. Validade.
  filhos.push(par(`Proposta válida por ${p.validadeDias} dias`, { size: 9.5, antes: 8 }));

  // 11. Fechamento + assinatura.
  if (p.fechamento) {
    for (const linha of linhas(p.fechamento)) filhos.push(par(linha, { size: 9.5, antes: 0, depois: 2 }));
  }
  filhos.push(par('', { size: 9.5, antes: 24 }));
  filhos.push(par('__________________________________', { size: 10, color: '777777', depois: 2 }));
  if (p.vendedor) filhos.push(par(p.vendedor, { bold: true, size: 10, depois: 1 }));
  filhos.push(par(DEPARTAMENTO, { size: 9, color: CINZA_TEXTO }));

  // 12. Data por extenso.
  filhos.push(par(`${p.cidade}, ${dataExtenso(p.emissao)}.`, { size: 9.5, antes: 14 }));

  // 13. Nota importante.
  if (p.notaImportante) {
    filhos.push(
      parRico([{ texto: 'IMPORTANTE! ', bold: true, size: 8.5 }, { texto: p.notaImportante, size: 8 }], {
        align: AlignmentType.JUSTIFIED,
        antes: 14,
      }),
    );
  }

  // 14. Rodapé.
  const rodape = new Footer({
    children: [
      par(p.empresa.endereco, { size: 7.5, align: AlignmentType.CENTER, color: CINZA_TEXTO, depois: 0 }),
      par(`${p.empresa.email}  ·  ${p.empresa.site}`, { size: 7.5, align: AlignmentType.CENTER, color: CINZA_TEXTO, depois: 0 }),
      par(`PABX: ${p.empresa.telefone}`, { size: 7.5, align: AlignmentType.CENTER, color: CINZA_TEXTO, depois: 0 }),
    ],
  });

  const doc = new Document({
    creator: p.empresa.nome,
    title: `Proposta ${numeroFormatado(p)} — ${p.cliente.nome}`,
    description: p.escopo,
    styles: { default: { document: { run: { font: FONTE_DOCX, size: 19 } } } },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, right: 720, bottom: 900, left: 720 } },
        },
        footers: { default: rodape },
        children: filhos,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/* ------------------------------------------------------------------ */
/* XLSX (exceljs)                                                      */
/* ------------------------------------------------------------------ */

const FORMATO_MOEDA = '"R$" #,##0.00';
const LARGURA_DESCRICAO = 78; // caracteres

export async function gerarXlsx(p: PropostaExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = p.empresa.nome;
  wb.created = p.emissao;

  const ws = wb.addWorksheet('Proposta', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = LARGURA_DESCRICAO;
  ws.getColumn(3).width = 18;

  let linha = 1;

  const escreverFaixa = (
    texto: string,
    opcoes: {
      bold?: boolean;
      size?: number;
      align?: 'left' | 'center' | 'right';
      color?: string;
      italic?: boolean;
      altura?: number;
    } = {},
  ): number => {
    const atual = linha++;
    ws.mergeCells(atual, 1, atual, 3);
    const celula = ws.getCell(atual, 1);
    celula.value = texto;
    celula.font = {
      name: 'Calibri',
      bold: opcoes.bold,
      italic: opcoes.italic,
      size: opcoes.size ?? 10,
      color: opcoes.color ? { argb: `FF${opcoes.color}` } : undefined,
    };
    celula.alignment = { horizontal: opcoes.align ?? 'left', vertical: 'middle', wrapText: true };
    if (opcoes.altura) ws.getRow(atual).height = opcoes.altura;
    return atual;
  };

  // 1. Cabeçalho da empresa.
  escreverFaixa(p.empresa.nome, { bold: true, size: 20, align: 'center', color: '1F3864', altura: 28 });
  escreverFaixa(RAZAO_SOCIAL, { size: 10, align: 'center' });
  escreverFaixa(ESPECIALIDADES, { size: 8, align: 'center', color: CINZA_TEXTO, altura: 16 });
  linha++;

  // 2. Cliente.
  escreverFaixa(`CLIENTE: ${p.cliente.nome}`, { bold: true, size: 11 });
  if (p.cliente.telefone) escreverFaixa(p.cliente.telefone, { size: 10 });
  if (p.cliente.email) escreverFaixa(p.cliente.email, { size: 10 });
  if (p.cliente.local) escreverFaixa(`LOCAL: ${p.cliente.local}`, { size: 10 });
  linha++;

  // 3. Título.
  escreverFaixa('PROPOSTA COMERCIAL', { bold: true, size: 14, align: 'center', altura: 22 });
  escreverFaixa(`Nº ${numeroFormatado(p)}   ·   ${p.cidade}, ${dataCurta(p.emissao)}`, {
    size: 10,
    align: 'center',
    color: CINZA_TEXTO,
  });

  // 4. Escopo.
  escreverFaixa(p.escopo, { bold: true, size: 11, align: 'center', altura: 30 });

  // 5. Introdução.
  if (p.intro) escreverFaixa(p.intro, { size: 10, altura: 15 * linhas(p.intro).length });
  linha++;

  // 6. Tabela de itens.
  const linhaCabecalho = linha++;
  const cabecalho = ws.getRow(linhaCabecalho);
  cabecalho.values = ['QTD', 'DESCRIÇÃO DE PRODUTOS', 'TOTAL'];
  cabecalho.height = 20;
  for (let col = 1; col <= 3; col++) {
    const celula = cabecalho.getCell(col);
    celula.font = { name: 'Calibri', bold: true, size: 10 };
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${CINZA_CABECALHO}` } };
    celula.alignment = {
      horizontal: col === 1 ? 'center' : col === 3 ? 'right' : 'left',
      vertical: 'middle',
      wrapText: true,
    };
    celula.border = {
      top: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
      bottom: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
      left: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
      right: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
    };
  }

  for (const item of p.itens) {
    const atual = linha++;
    const row = ws.getRow(atual);
    row.getCell(1).value = item.quantidadeTexto;
    row.getCell(2).value = item.descricao;
    row.getCell(3).value = item.total;
    row.getCell(3).numFmt = FORMATO_MOEDA;
    row.height = alturaEstimada(item.descricao);
    for (let col = 1; col <= 3; col++) {
      const celula = row.getCell(col);
      celula.font = { name: 'Calibri', size: 10 };
      celula.alignment = {
        horizontal: col === 1 ? 'center' : col === 3 ? 'right' : 'left',
        vertical: 'top',
        wrapText: true,
      };
      celula.border = {
        top: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
        bottom: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
        left: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
        right: { style: 'thin', color: { argb: `FF${CINZA_BORDA}` } },
      };
    }
  }

  // 7. Total.
  const linhaTotal = linha++;
  const rowTotal = ws.getRow(linhaTotal);
  ws.mergeCells(linhaTotal, 1, linhaTotal, 2);
  rowTotal.getCell(1).value = 'Valor Total da Proposta:';
  rowTotal.getCell(1).font = { name: 'Calibri', bold: true, size: 11 };
  rowTotal.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
  rowTotal.getCell(3).value = p.total;
  rowTotal.getCell(3).numFmt = FORMATO_MOEDA;
  rowTotal.getCell(3).font = { name: 'Calibri', bold: true, size: 12 };
  rowTotal.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
  rowTotal.height = 20;

  escreverFaixa(porExtenso(p.totalPorExtenso), { size: 9, italic: true, align: 'right' });
  linha++;

  // 8. Condições de pagamento.
  const aVista = linhaAVista(p);
  if (p.condicoesPagamento || aVista) {
    escreverFaixa('Condições de Pagamento', { bold: true, size: 11 });
    if (p.condicoesPagamento) escreverFaixa(p.condicoesPagamento, { size: 10 });
    if (aVista) escreverFaixa(aVista, { size: 10 });
    linha++;
  }

  // 9. Prazo de entrega.
  if (p.prazoEntrega) {
    escreverFaixa('Prazo de entrega', { bold: true, size: 11 });
    escreverFaixa(p.prazoEntrega, { size: 10 });
    linha++;
  }

  // 10. Validade.
  escreverFaixa(`Proposta válida por ${p.validadeDias} dias`, { size: 10 });
  linha++;

  // 11. Fechamento + assinatura.
  if (p.fechamento) for (const l of linhas(p.fechamento)) escreverFaixa(l, { size: 10 });
  linha += 2;
  escreverFaixa('__________________________________', { size: 10, color: '777777' });
  if (p.vendedor) escreverFaixa(p.vendedor, { bold: true, size: 10 });
  escreverFaixa(DEPARTAMENTO, { size: 9, color: CINZA_TEXTO });

  // 12. Data por extenso.
  linha++;
  escreverFaixa(`${p.cidade}, ${dataExtenso(p.emissao)}.`, { size: 10 });

  // 13. Nota importante.
  if (p.notaImportante) {
    linha++;
    escreverFaixa('IMPORTANTE!', { bold: true, size: 9 });
    escreverFaixa(p.notaImportante, { size: 8, altura: alturaEstimada(p.notaImportante) });
  }

  // 14. Rodapé.
  linha++;
  escreverFaixa(p.empresa.endereco, { size: 8, align: 'center', color: CINZA_TEXTO });
  escreverFaixa(`${p.empresa.email}  ·  ${p.empresa.site}`, { size: 8, align: 'center', color: CINZA_TEXTO });
  escreverFaixa(`PABX: ${p.empresa.telefone}`, { size: 8, align: 'center', color: CINZA_TEXTO });

  // Painel congelado no cabeçalho da tabela de itens.
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: linhaCabecalho, topLeftCell: `A${linhaCabecalho + 1}`, activeCell: 'A1' }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as unknown as ArrayBuffer);
}

/** Altura aproximada da linha considerando quebras `\n` e wrap da coluna. */
function alturaEstimada(texto: string): number {
  const total = linhas(texto).reduce(
    (soma, l) => soma + Math.max(1, Math.ceil(l.length / (LARGURA_DESCRICAO - 4))),
    0,
  );
  return Math.min(400, Math.max(16, total * 14));
}
