/**
 * compras-export.service — extrair o relatório de compras (27/10, pedido do
 * Ronaldo: "extrair relatórios é o ponto-chave").
 *
 * Regra: Estoque Sugerido = quantidade que deve haver. Quando o total dos
 * depósitos cai para 50% do sugerido ou menos, o item entra na lista de
 * compra, com a quantidade que falta para voltar ao sugerido.
 *
 * Três saídas, todas a partir da mesma `posicaoCompra`:
 * - **Excel completo**: abas "Lista de compra" (ordenada pela urgência),
 *   "Por fornecedor" (pedido pronto por fornecedor), "Por categoria",
 *   "Todos os produtos" (situação de cada um) e "Sem sugerido".
 * - **PDF**: a lista de compra para imprimir/mandar no WhatsApp — a lista
 *   inteira ou só a de UM fornecedor (vira o pedido daquele fornecedor).
 * - **CSV**: a lista de compra para quem quer colar em outra planilha.
 */
import ExcelJS from 'exceljs';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import type { LinhaCompra, posicaoCompra } from './compras.service.js';
import { pdfMake, registrarFontes } from './proposal-export.service.js';

export type Posicao = Awaited<ReturnType<typeof posicaoCompra>>;

const MOEDA = '"R$" #,##0.00';
const CINZA_CABECALHO = 'FFE8E8E8';
const VERMELHO_SUAVE = 'FFFCE4E2';
const AMARELO_SUAVE = 'FFFFF4D6';
const BORDA = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const ROTULO_URGENCIA: Record<string, string> = { ZERADO: 'ZERADO', CRITICO: 'Crítico (≤ 25%)', ALERTA: 'Alerta (≤ 50%)' };
const ROTULO_SITUACAO: Record<string, string> = { ALERTA_COMPRA: 'Comprar', OK: 'OK', SEM_MINIMO: 'Sem sugerido' };

const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (f: number | null) => (f == null ? '—' : `${Math.round(f * 100)}%`);

const valorCompra = (i: LinhaCompra) => Number((i.comprarParaRepor * i.custoMedio).toFixed(2));
const nomeFornecedor = (i: LinhaCompra) => i.fornecedor ?? '(sem fornecedor cadastrado)';

/** Filtra a lista de compra por fornecedor (nome exato, ou "(sem fornecedor cadastrado)"). */
export function listaDoFornecedor(posicao: Posicao, fornecedor?: string | null): LinhaCompra[] {
  if (!fornecedor) return posicao.alerta;
  return posicao.alerta.filter((i) => nomeFornecedor(i) === fornecedor);
}

/* ───────────────────────────── EXCEL ───────────────────────────── */

function estiloCabecalho(ws: ExcelJS.Worksheet, linha: number, nCols: number) {
  const row = ws.getRow(linha);
  row.height = 24;
  for (let c = 1; c <= nCols; c++) {
    const cel = row.getCell(c);
    cel.font = { name: 'Calibri', bold: true, size: 11 };
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CABECALHO } };
    cel.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
    cel.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
  }
}

function titulo(ws: ExcelJS.Worksheet, texto: string, sub: string, nCols: number) {
  ws.mergeCells(1, 1, 1, nCols);
  ws.getCell(1, 1).value = texto;
  ws.getCell(1, 1).font = { name: 'Calibri', bold: true, size: 16 };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, nCols);
  ws.getCell(2, 1).value = sub;
  ws.getCell(2, 1).font = { name: 'Calibri', size: 10, color: { argb: 'FF666666' } };
}

/** Aba com a tabela de itens (lista de compra ou todos os produtos). */
function abaItens(
  wb: ExcelJS.Workbook, nome: string, posicao: Posicao, itens: LinhaCompra[],
  opcoes: { tituloAba: string; sub: string; comSituacao?: boolean; vazio: string },
) {
  const ws = wb.addWorksheet(nome, { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const colunas = [
    ...(opcoes.comSituacao ? [{ header: 'Situação', width: 14 }] : [{ header: 'Urgência', width: 15 }]),
    { header: 'Código', width: 13 },
    { header: 'Produto', width: 46 },
    { header: 'Un.', width: 6 },
    { header: 'Categoria', width: 18 },
    { header: 'Fornecedor', width: 22 },
    ...posicao.depositos.map((d) => ({ header: d.code, width: 9 })),
    { header: 'TOTAL', width: 10 },
    { header: 'Estoque sugerido', width: 14 },
    { header: '% do sugerido', width: 12 },
    { header: 'Dispara em (50%)', width: 13 },
    { header: 'COMPRAR', width: 11 },
    { header: 'Custo médio', width: 12 },
    { header: 'Valor estimado', width: 14 },
    { header: 'Saídas 90 dias', width: 12 },
    { header: 'Cobertura (dias)', width: 13 },
  ];
  titulo(ws, opcoes.tituloAba, opcoes.sub, colunas.length);
  const cab = 4;
  ws.getRow(cab).values = colunas.map((c) => c.header);
  estiloCabecalho(ws, cab, colunas.length);
  colunas.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  if (!itens.length) {
    ws.mergeCells(5, 1, 5, colunas.length);
    ws.getCell(5, 1).value = opcoes.vazio;
    ws.getCell(5, 1).font = { name: 'Calibri', italic: true, size: 11 };
  }
  let linha = cab;
  const colComprar = 6 + posicao.depositos.length + 4;
  for (const i of itens) {
    linha += 1;
    const row = ws.getRow(linha);
    row.values = [
      opcoes.comSituacao ? ROTULO_SITUACAO[i.situacao] : ROTULO_URGENCIA[i.urgencia ?? ''] ?? '',
      i.sku, i.name, i.unit, i.categoria ?? '', i.fornecedor ?? '',
      ...posicao.depositos.map((d) => i.depositos.find((x) => x.id === d.id)?.quantity ?? 0),
      i.total, i.minStock, i.fracaoRestante ?? '', i.pontoCompra, i.comprarParaRepor, i.custoMedio, valorCompra(i), i.saidas90, i.coberturaDias ?? '',
    ];
    row.eachCell((c, col) => {
      c.font = { name: 'Calibri', size: 11 };
      c.alignment = { vertical: 'middle', horizontal: col <= 6 ? 'left' : 'right', wrapText: col === 3 };
      c.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
    });
    row.getCell(3).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(colComprar - 2).numFmt = '0%';
    row.getCell(colComprar + 1).numFmt = MOEDA;
    row.getCell(colComprar + 2).numFmt = MOEDA;
    if (i.situacao === 'ALERTA_COMPRA') {
      row.getCell(colComprar).font = { name: 'Calibri', size: 11, bold: true };
      row.getCell(colComprar).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO_SUAVE } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i.urgencia === 'ZERADO' ? VERMELHO_SUAVE : AMARELO_SUAVE } };
      row.getCell(1).font = { name: 'Calibri', size: 11, bold: i.urgencia === 'ZERADO' };
    }
  }
  const emAlerta = itens.filter((i) => i.situacao === 'ALERTA_COMPRA');
  if (emAlerta.length) {
    linha += 1;
    const total = ws.getRow(linha);
    ws.mergeCells(linha, 1, linha, colComprar - 1);
    total.getCell(1).value = `${emAlerta.length} item(ns) para comprar`;
    total.getCell(1).alignment = { horizontal: 'right' };
    total.getCell(colComprar + 1).value = 'Total estimado';
    total.getCell(colComprar + 1).alignment = { horizontal: 'right' };
    total.getCell(colComprar + 2).value = Number(emAlerta.reduce((a, i) => a + valorCompra(i), 0).toFixed(2));
    total.getCell(colComprar + 2).numFmt = MOEDA;
    total.height = 22;
    total.eachCell((c) => { c.font = { name: 'Calibri', bold: true, size: 11 }; c.border = { top: { style: 'double', color: { argb: 'FF999999' } } }; });
  }
  ws.autoFilter = { from: { row: cab, column: 1 }, to: { row: cab, column: colunas.length } };
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: cab, topLeftCell: `D${cab + 1}` }];
  return ws;
}

/** Aba "Por fornecedor": um bloco por fornecedor, pronto para virar pedido. */
function abaPorFornecedor(wb: ExcelJS.Workbook, posicao: Posicao, sub: string) {
  const ws = wb.addWorksheet('Por fornecedor', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const cols = ['Código', 'Produto', 'Un.', 'Saldo', 'Sugerido', 'COMPRAR', 'Custo médio', 'Valor estimado'];
  [14, 50, 6, 9, 10, 11, 12, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  titulo(ws, 'Pedidos de compra por fornecedor', sub, cols.length);
  let linha = 3;
  const grupos = new Map<string, LinhaCompra[]>();
  for (const i of posicao.alerta) { const k = nomeFornecedor(i); grupos.set(k, [...(grupos.get(k) ?? []), i]); }
  if (!grupos.size) { ws.getCell(4, 1).value = 'Nenhum item em alerta de compra.'; ws.getCell(4, 1).font = { italic: true }; }
  for (const [forn, itens] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    linha += 1;
    ws.mergeCells(linha, 1, linha, cols.length);
    const cab = ws.getCell(linha, 1);
    cab.value = `${forn} — ${itens.length} item(ns) · ${BRL.format(itens.reduce((a, i) => a + valorCompra(i), 0))}`;
    cab.font = { name: 'Calibri', bold: true, size: 13 };
    ws.getRow(linha).height = 24;
    linha += 1;
    ws.getRow(linha).values = cols;
    estiloCabecalho(ws, linha, cols.length);
    for (const i of itens) {
      linha += 1;
      const row = ws.getRow(linha);
      row.values = [i.sku, i.name, i.unit, i.total, i.minStock, i.comprarParaRepor, i.custoMedio, valorCompra(i)];
      row.eachCell((c, col) => {
        c.font = { name: 'Calibri', size: 11, bold: col === 6 };
        c.alignment = { vertical: 'middle', horizontal: col <= 3 ? 'left' : 'right', wrapText: col === 2 };
        c.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
      });
      row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO_SUAVE } };
      row.getCell(7).numFmt = MOEDA; row.getCell(8).numFmt = MOEDA;
    }
    linha += 1;
  }
  return ws;
}

function abaPorCategoria(wb: ExcelJS.Workbook, posicao: Posicao, sub: string) {
  const ws = wb.addWorksheet('Por categoria');
  const cols = ['Categoria', 'Produtos', 'Em alerta', 'Unidades em estoque', 'Valor em estoque', 'Valor a comprar'];
  [28, 10, 10, 18, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  titulo(ws, 'Resumo por categoria', sub, cols.length);
  ws.getRow(4).values = cols;
  estiloCabecalho(ws, 4, cols.length);
  let linha = 4;
  for (const c of posicao.porCategoria) {
    linha += 1;
    const row = ws.getRow(linha);
    row.values = [c.categoria, c.produtos, c.alerta, c.total, c.valor, c.comprar];
    row.eachCell((cel, col) => {
      cel.font = { name: 'Calibri', size: 11, bold: col === 3 && c.alerta > 0 };
      cel.alignment = { horizontal: col === 1 ? 'left' : 'right' };
      cel.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
    });
    row.getCell(5).numFmt = MOEDA; row.getCell(6).numFmt = MOEDA;
    if (c.alerta > 0) row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO_SUAVE } };
  }
  return ws;
}

function abaResumo(wb: ExcelJS.Workbook, posicao: Posicao, empresa: string, hoje: Date) {
  const ws = wb.addWorksheet('Resumo', { properties: { tabColor: { argb: 'FFC00000' } } });
  ws.getColumn(1).width = 34; ws.getColumn(2).width = 20;
  titulo(ws, 'Relatório de compras', `${empresa} · ${hoje.toLocaleString('pt-BR')}`, 2);
  const r = posicao.resumo;
  const linhas: [string, string | number][] = [
    ['Regra', 'Estoque sugerido = quantidade que deve haver. Total dos depósitos ≤ 50% do sugerido → entra na lista de compra, com o que falta para voltar ao sugerido.'],
    ['Produtos ativos', r.produtos],
    ['Itens em alerta de compra', r.alertaCompra],
    ['   dos quais ZERADOS', r.zerados],
    ['   dos quais críticos (≤ 25%)', r.criticos],
    ['Fornecedores envolvidos', r.fornecedoresEnvolvidos],
    ['Valor estimado da compra', BRL.format(r.valorAComprar)],
    ['Produtos OK', r.ok],
    ['Sem estoque sugerido definido', r.semMinimo],
    ['Valor total em estoque', BRL.format(r.valorEstoque)],
  ];
  let linha = 3;
  for (const [k, v] of linhas) {
    linha += 1;
    ws.getCell(linha, 1).value = k; ws.getCell(linha, 1).font = { name: 'Calibri', bold: !k.startsWith('   '), size: 11 };
    ws.getCell(linha, 2).value = v; ws.getCell(linha, 2).alignment = { horizontal: typeof v === 'number' ? 'right' : 'left', wrapText: true };
    if (k === 'Regra') { ws.mergeCells(linha, 2, linha, 6); ws.getRow(linha).height = 44; }
  }
  return ws;
}

/**
 * Pasta de trabalho completa; com `fornecedor`, só a lista daquele fornecedor
 * (uma aba, pronta para mandar como pedido).
 */
export async function gerarRelatorioCompras(posicao: Posicao, empresa: string, fornecedor?: string | null): Promise<Buffer> {
  const hoje = new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = empresa; wb.created = hoje;
  const sub = `${empresa} · ${hoje.toLocaleString('pt-BR')} · regra: total dos depósitos ≤ 50% do estoque sugerido entra na lista`;

  if (fornecedor) {
    const itens = listaDoFornecedor(posicao, fornecedor);
    abaItens(wb, 'Pedido', posicao, itens, { tituloAba: `Pedido de compra — ${fornecedor}`, sub, vazio: 'Nenhum item deste fornecedor em alerta.' });
  } else {
    abaResumo(wb, posicao, empresa, hoje);
    abaItens(wb, 'Lista de compra', posicao, posicao.alerta, { tituloAba: 'Lista de compra — itens que atingiram 50% do estoque sugerido', sub, vazio: 'Nenhum item atingiu o ponto de compra — nada a repor agora.' });
    abaPorFornecedor(wb, posicao, sub);
    abaPorCategoria(wb, posicao, sub);
    abaItens(wb, 'Todos os produtos', posicao, posicao.itens, { tituloAba: 'Posição de todos os produtos', sub, comSituacao: true, vazio: 'Nenhum produto ativo.' });
    abaItens(wb, 'Sem sugerido', posicao, posicao.semMinimo, { tituloAba: 'Produtos sem estoque sugerido definido (fora do alerta)', sub, comSituacao: true, vazio: 'Todos os produtos têm estoque sugerido definido.' });
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as unknown as ArrayBuffer);
}

/* ───────────────────────────── CSV ───────────────────────────── */

export function gerarCsvCompras(posicao: Posicao, fornecedor?: string | null): string {
  const itens = listaDoFornecedor(posicao, fornecedor);
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ['urgencia', 'codigo', 'produto', 'unidade', 'categoria', 'fornecedor', ...posicao.depositos.map((d) => d.code), 'total', 'estoque_sugerido', 'pct_do_sugerido', 'dispara_em', 'comprar', 'custo_medio', 'valor_estimado', 'saidas_90d', 'cobertura_dias'];
  const rows = itens.map((i) => [
    i.urgencia ?? '', i.sku, i.name, i.unit, i.categoria ?? '', i.fornecedor ?? '',
    ...posicao.depositos.map((d) => i.depositos.find((x) => x.id === d.id)?.quantity ?? 0),
    i.total, i.minStock, i.fracaoRestante == null ? '' : Math.round(i.fracaoRestante * 100), i.pontoCompra, i.comprarParaRepor,
    i.custoMedio, valorCompra(i), i.saidas90, i.coberturaDias ?? '',
  ].map(esc).join(';'));
  return `﻿${[header.join(';'), ...rows].join('\n')}`;
}

/* ───────────────────────────── PDF ───────────────────────────── */

/**
 * Lista de compra em PDF — para imprimir ou mandar no WhatsApp do
 * fornecedor. Com `fornecedor`, vira o pedido daquele fornecedor.
 */
export async function gerarPdfCompras(posicao: Posicao, empresa: string, fornecedor?: string | null): Promise<Buffer> {
  registrarFontes();
  const hoje = new Date();
  const itens = listaDoFornecedor(posicao, fornecedor);
  const totalValor = itens.reduce((a, i) => a + valorCompra(i), 0);
  const corUrg = (u: string | null) => (u === 'ZERADO' ? '#B00020' : u === 'CRITICO' ? '#C2410C' : '#1A1A1A');

  const grupos = new Map<string, LinhaCompra[]>();
  for (const i of itens) { const k = nomeFornecedor(i); grupos.set(k, [...(grupos.get(k) ?? []), i]); }

  const tabela = (lista: LinhaCompra[]): Content => ({
    table: {
      headerRows: 1,
      widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        ['Código', 'Produto', 'Un.', 'Saldo', 'Sugerido', 'COMPRAR', 'Valor est.'].map((h, idx): TableCell => ({ text: h, bold: true, fontSize: 8.5, fillColor: '#E8E8E8', alignment: idx >= 3 ? 'right' : 'left' })),
        ...lista.map((i): TableCell[] => [
          { text: i.sku, fontSize: 8.5 },
          { text: [{ text: i.name, bold: true }, i.urgencia === 'ZERADO' ? { text: '  ZERADO', color: '#B00020', bold: true } : i.urgencia === 'CRITICO' ? { text: '  crítico', color: '#C2410C' } : ''], fontSize: 8.5 },
          { text: i.unit, fontSize: 8.5 },
          { text: `${NUM.format(i.total)} (${PCT(i.fracaoRestante)})`, fontSize: 8.5, alignment: 'right', color: corUrg(i.urgencia) },
          { text: NUM.format(i.minStock), fontSize: 8.5, alignment: 'right' },
          { text: NUM.format(i.comprarParaRepor), fontSize: 9.5, bold: true, alignment: 'right', fillColor: '#FCE4E2' },
          { text: BRL.format(valorCompra(i)), fontSize: 8.5, alignment: 'right' },
        ]),
      ],
    },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#BFBFBF', vLineColor: () => '#BFBFBF', paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 4, 0, 10],
  });

  const content: Content[] = [
    { text: fornecedor ? `Pedido de compra — ${fornecedor}` : 'Lista de compra', fontSize: 16, bold: true },
    { text: `${empresa} · ${hoje.toLocaleString('pt-BR')}`, fontSize: 9, color: '#555555', margin: [0, 2, 0, 2] },
    { text: 'Regra: o item entra quando o total dos depósitos chega a 50% do estoque sugerido; a coluna COMPRAR é o que falta para voltar ao sugerido.', fontSize: 8, color: '#555555', margin: [0, 0, 0, 8] },
    {
      columns: [
        { text: [{ text: `${itens.length}`, fontSize: 18, bold: true, color: itens.length ? '#B00020' : '#1A1A1A' }, { text: ' item(ns) para comprar', fontSize: 9 }] },
        { text: [{ text: `${itens.filter((i) => i.urgencia === 'ZERADO').length}`, fontSize: 18, bold: true, color: '#B00020' }, { text: ' zerado(s)', fontSize: 9 }] },
        { text: [{ text: BRL.format(totalValor), fontSize: 18, bold: true }, { text: ' estimado', fontSize: 9 }], alignment: 'right' },
      ],
      margin: [0, 0, 0, 10],
    },
  ];
  if (!itens.length) content.push({ text: 'Nenhum item atingiu o ponto de compra — nada a repor agora.', italics: true, margin: [0, 10, 0, 0] });
  else if (fornecedor) content.push(tabela(itens));
  else {
    for (const [forn, lista] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      content.push({ text: `${forn} · ${lista.length} item(ns) · ${BRL.format(lista.reduce((a, i) => a + valorCompra(i), 0))}`, fontSize: 11, bold: true, margin: [0, 8, 0, 0] });
      content.push(tabela(lista));
    }
  }

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 48],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#1A1A1A' },
    info: { title: fornecedor ? `Pedido de compra — ${fornecedor}` : 'Lista de compra', author: empresa },
    content,
    footer: (atual: number, total: number) => ({ text: `EstoqueFlow · ${empresa} · página ${atual} de ${total}`, alignment: 'center', fontSize: 7.5, color: '#8A8A8A', margin: [0, 12, 0, 0] }),
  };
  return pdfMake.createPdf(doc).getBuffer();
}
