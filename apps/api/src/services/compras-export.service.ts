/**
 * compras-export.service
 *
 * A lista de reposição em planilha.
 *
 * Nasceu em 24/09 com sete abas (resumo, alerta, atenção, posição completa,
 * por categoria, por fornecedor, sem mínimo). Na revisão de 30/09 o pedido
 * ficou claro e mais simples: **uma lista só, do que precisa ser comprado
 * agora** — os itens cujo total somado dos dois depósitos caiu para metade
 * do estoque mínimo ou menos. As outras visões continuam na tela, em
 * Relatórios; a planilha é o papel que vai para a compra.
 *
 * Uma aba, uma linha por peça, ordenada pela mais urgente (a que está
 * proporcionalmente mais longe do mínimo), e uma linha de total no fim.
 */
import ExcelJS from 'exceljs';
import type { LinhaCompra, posicaoCompra } from './compras.service.js';

type Posicao = Awaited<ReturnType<typeof posicaoCompra>>;

const MOEDA = '"R$" #,##0.00';
const CINZA_CABECALHO = 'FFE8E8E8';
const VERMELHO_SUAVE = 'FFFCE4E2';
const BORDA = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };

/** Urgência: quanto menor a fração do mínimo que ainda resta, mais em cima. */
function porUrgencia(a: LinhaCompra, b: LinhaCompra) {
  const fa = a.minStock > 0 ? a.total / a.minStock : 1;
  const fb = b.minStock > 0 ? b.total / b.minStock : 1;
  return fa - fb || b.comprarParaRepor * b.custoMedio - a.comprarParaRepor * a.custoMedio;
}

export async function gerarRelatorioCompras(posicao: Posicao, empresa: string): Promise<Buffer> {
  const itens = [...posicao.alerta].sort(porUrgencia);
  const hoje = new Date();

  const wb = new ExcelJS.Workbook();
  wb.creator = empresa;
  wb.created = hoje;

  const ws = wb.addWorksheet('Repor agora', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colunas = [
    { header: 'Código', key: 'sku', width: 13 },
    { header: 'Produto', key: 'name', width: 48 },
    { header: 'Un.', key: 'unit', width: 6 },
    { header: 'Categoria', key: 'categoria', width: 18 },
    { header: 'Fornecedor', key: 'fornecedor', width: 20 },
    ...posicao.depositos.map((d) => ({ header: d.code, key: `dep_${d.code}`, width: 9 })),
    { header: 'TOTAL', key: 'total', width: 10 },
    { header: 'Estoque mínimo', key: 'minStock', width: 13 },
    { header: 'Dispara em (50%)', key: 'pontoCompra', width: 13 },
    { header: 'COMPRAR', key: 'comprar', width: 11 },
    { header: 'Custo médio', key: 'custoMedio', width: 12 },
    { header: 'Valor estimado', key: 'valorCompra', width: 14 },
    { header: 'Saídas 90 dias', key: 'saidas90', width: 12 },
    { header: 'Cobertura (dias)', key: 'cobertura', width: 13 },
  ];

  // ── Título ───────────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, colunas.length);
  const titulo = ws.getCell(1, 1);
  titulo.value = 'Lista de reposição — itens no ponto de compra';
  titulo.font = { name: 'Calibri', bold: true, size: 16 };
  titulo.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, colunas.length);
  const sub = ws.getCell(2, 1);
  sub.value =
    `${empresa} · ${hoje.toLocaleString('pt-BR')} · ` +
    'critério: total somado dos depósitos igual ou abaixo de 50% do estoque mínimo';
  sub.font = { name: 'Calibri', size: 10, color: { argb: 'FF666666' } };

  ws.addRow([]);

  // ── Cabeçalho da tabela ──────────────────────────────────────────────────
  const linhaCabecalho = 4;
  const cab = ws.getRow(linhaCabecalho);
  cab.values = colunas.map((c) => c.header);
  cab.height = 24;
  cab.eachCell((c) => {
    c.font = { name: 'Calibri', bold: true, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA_CABECALHO } };
    c.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
    c.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
  });
  // as larguras seguem a ordem das colunas declaradas acima
  colunas.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // ── Linhas ───────────────────────────────────────────────────────────────
  if (!itens.length) {
    ws.mergeCells(5, 1, 5, colunas.length);
    const vazio = ws.getCell(5, 1);
    vazio.value = 'Nenhum item atingiu o ponto de compra — nada a repor agora.';
    vazio.font = { name: 'Calibri', italic: true, size: 11 };
  }

  let linha = linhaCabecalho;
  for (const i of itens) {
    linha += 1;
    const valores: (string | number)[] = [
      i.sku,
      i.name,
      i.unit,
      i.categoria ?? '',
      i.fornecedor ?? '',
      ...posicao.depositos.map((d) => i.depositos.find((x) => x.id === d.id)?.quantity ?? 0),
      i.total,
      i.minStock,
      i.pontoCompra,
      i.comprarParaRepor,
      i.custoMedio,
      Number((i.comprarParaRepor * i.custoMedio).toFixed(2)),
      i.saidas90,
      i.coberturaDias ?? '',
    ];
    const row = ws.getRow(linha);
    row.values = valores;
    row.eachCell((c, col) => {
      c.font = { name: 'Calibri', size: 11 };
      c.alignment = { vertical: 'middle', horizontal: col <= 5 ? 'left' : 'right', wrapText: col === 2 };
      c.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
    });
    // destaque na peça e no que comprar
    row.getCell(2).font = { name: 'Calibri', size: 11, bold: true };
    const colComprar = 5 + posicao.depositos.length + 4;
    row.getCell(colComprar).font = { name: 'Calibri', size: 11, bold: true };
    row.getCell(colComprar).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO_SUAVE } };
    row.getCell(colComprar + 1).numFmt = MOEDA;
    row.getCell(colComprar + 2).numFmt = MOEDA;
  }

  // ── Total ────────────────────────────────────────────────────────────────
  if (itens.length) {
    linha += 1;
    const total = ws.getRow(linha);
    const colComprar = 5 + posicao.depositos.length + 4;
    ws.mergeCells(linha, 1, linha, colComprar - 1);
    total.getCell(1).value = `${itens.length} item(ns) para repor`;
    total.getCell(1).alignment = { horizontal: 'right' };
    total.getCell(colComprar + 1).value = 'Total estimado';
    total.getCell(colComprar + 1).alignment = { horizontal: 'right' };
    total.getCell(colComprar + 2).value = Number(
      itens.reduce((a, i) => a + i.comprarParaRepor * i.custoMedio, 0).toFixed(2),
    );
    total.getCell(colComprar + 2).numFmt = MOEDA;
    total.height = 22;
    total.eachCell((c) => {
      c.font = { name: 'Calibri', bold: true, size: 11 };
      c.border = { top: { style: 'double', color: { argb: 'FF999999' } } };
    });
  }

  ws.autoFilter = { from: { row: linhaCabecalho, column: 1 }, to: { row: linhaCabecalho, column: colunas.length } };
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: linhaCabecalho, topLeftCell: `C${linhaCabecalho + 1}` }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as unknown as ArrayBuffer);
}
