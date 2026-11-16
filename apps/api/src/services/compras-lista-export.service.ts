/**
 * Exportação de UMA lista de compra (16/11/2026): o pedido que vai para o
 * fornecedor, em PDF (imprimir / WhatsApp) ou Excel. Mesmo visual do pedido
 * extraído do relatório de compras, só que com as quantidades e custos que o
 * comprador decidiu, não os calculados.
 */
import ExcelJS from 'exceljs';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { pdfMake, registrarFontes } from './proposal-export.service.js';
import { ROTULO_STATUS_LISTA, type ListaSerializada } from './compras-lista.service.js';

const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BORDA = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const MOEDA = '"R$" #,##0.00';

const numeroLista = (l: ListaSerializada) => `#${String(l.number).padStart(4, '0')}`;
const dataBR = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString('pt-BR') : '—');

/** Nome de arquivo seguro: pedido-0007-solis.pdf */
export function nomeArquivoLista(l: ListaSerializada, ext: string) {
  const slug = (l.supplierName ?? l.name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `pedido-${String(l.number).padStart(4, '0')}${slug ? `-${slug}` : ''}.${ext}`;
}

export async function gerarPdfLista(l: ListaSerializada, empresa: string): Promise<Buffer> {
  registrarFontes();
  const tabela: Content = {
    table: {
      headerRows: 1,
      widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'],
      body: [
        ['Código', 'Produto', 'Un.', 'Quantidade', 'Custo unit.', 'Total'].map((h, idx): TableCell => ({ text: h, bold: true, fontSize: 8.5, fillColor: '#E8E8E8', alignment: idx >= 3 ? 'right' : 'left' })),
        ...l.items.map((i): TableCell[] => [
          { text: i.sku ?? '—', fontSize: 8.5 },
          { text: [{ text: i.name, bold: true }, i.notes ? { text: `\n${i.notes}`, fontSize: 7.5, color: '#555555' } : ''], fontSize: 8.5 },
          { text: i.unit, fontSize: 8.5 },
          { text: NUM.format(i.quantity), fontSize: 9.5, bold: true, alignment: 'right', fillColor: '#FCE4E2' },
          { text: BRL.format(i.unitCost), fontSize: 8.5, alignment: 'right' },
          { text: BRL.format(i.total), fontSize: 8.5, alignment: 'right' },
        ]),
        [
          { text: '', colSpan: 4, border: [false, false, false, false] }, {}, {}, {},
          { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right' },
          { text: BRL.format(l.total), bold: true, fontSize: 10, alignment: 'right' },
        ],
      ],
    },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#BFBFBF', vLineColor: () => '#BFBFBF', paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 6, 0, 10],
  };

  const content: Content[] = [
    { text: `Pedido de compra ${numeroLista(l)}${l.supplierName ? ` — ${l.supplierName}` : ''}`, fontSize: 16, bold: true },
    { text: l.name, fontSize: 11, color: '#333333', margin: [0, 2, 0, 0] },
    { text: `${empresa} · emitido em ${new Date().toLocaleString('pt-BR')} · status: ${ROTULO_STATUS_LISTA[l.status]}`, fontSize: 9, color: '#555555', margin: [0, 2, 0, 6] },
    {
      columns: [
        { text: [{ text: `${l.items.length}`, fontSize: 18, bold: true }, { text: ' item(ns)', fontSize: 9 }] },
        { text: [{ text: BRL.format(l.total), fontSize: 18, bold: true }, { text: ' total', fontSize: 9 }], alignment: 'right' },
      ],
      margin: [0, 0, 0, 4],
    },
    tabela,
  ];
  if (l.notes) content.push({ text: 'Observações', bold: true, fontSize: 9.5, margin: [0, 4, 0, 2] }, { text: l.notes, fontSize: 9 });
  content.push({
    text: `Montada por ${l.createdByName} em ${dataBR(l.createdAt)}${l.orderedAt ? ` · pedida por ${l.orderedByName} em ${dataBR(l.orderedAt)}` : ''}${l.boughtAt ? ` · comprada por ${l.boughtByName} em ${dataBR(l.boughtAt)}` : ''}`,
    fontSize: 7.5, color: '#8A8A8A', margin: [0, 10, 0, 0],
  });

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 48],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#1A1A1A' },
    info: { title: `Pedido de compra ${numeroLista(l)}`, author: empresa },
    content,
    footer: (atual: number, total: number) => ({ text: `EstoqueFlow · ${empresa} · página ${atual} de ${total}`, alignment: 'center', fontSize: 7.5, color: '#8A8A8A', margin: [0, 12, 0, 0] }),
  };
  return pdfMake.createPdf(doc).getBuffer();
}

export async function gerarExcelLista(l: ListaSerializada, empresa: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = empresa; wb.created = new Date();
  const ws = wb.addWorksheet('Pedido', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const colunas = [
    { header: 'Código', width: 14 }, { header: 'Produto', width: 48 }, { header: 'Un.', width: 6 },
    { header: 'Quantidade', width: 12 }, { header: 'Custo unit.', width: 13 }, { header: 'Total', width: 14 }, { header: 'Observação', width: 30 },
  ];
  ws.mergeCells(1, 1, 1, colunas.length);
  ws.getCell(1, 1).value = `Pedido de compra ${numeroLista(l)}${l.supplierName ? ` — ${l.supplierName}` : ''}`;
  ws.getCell(1, 1).font = { name: 'Calibri', bold: true, size: 16 };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, colunas.length);
  ws.getCell(2, 1).value = `${l.name} · ${empresa} · ${new Date().toLocaleString('pt-BR')} · ${ROTULO_STATUS_LISTA[l.status]}`;
  ws.getCell(2, 1).font = { name: 'Calibri', size: 10, color: { argb: 'FF666666' } };

  const cab = 4;
  ws.getRow(cab).values = colunas.map((c) => c.header);
  colunas.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  ws.getRow(cab).eachCell((cel) => {
    cel.font = { name: 'Calibri', bold: true, size: 11 };
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    cel.alignment = { vertical: 'middle', horizontal: 'center' };
    cel.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
  });
  let linha = cab;
  for (const i of l.items) {
    linha += 1;
    const row = ws.getRow(linha);
    row.values = [i.sku ?? '', i.name, i.unit, i.quantity, i.unitCost, i.total, i.notes ?? ''];
    row.eachCell((c, col) => {
      c.font = { name: 'Calibri', size: 11, bold: col === 2 || col === 4 };
      c.alignment = { vertical: 'middle', horizontal: col >= 4 && col <= 6 ? 'right' : 'left', wrapText: col === 2 || col === 7 };
      c.border = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
    });
    row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E2' } };
    row.getCell(5).numFmt = MOEDA; row.getCell(6).numFmt = MOEDA;
  }
  linha += 1;
  ws.getCell(linha, 5).value = 'TOTAL'; ws.getCell(linha, 5).font = { name: 'Calibri', bold: true, size: 11 }; ws.getCell(linha, 5).alignment = { horizontal: 'right' };
  ws.getCell(linha, 6).value = l.total; ws.getCell(linha, 6).numFmt = MOEDA; ws.getCell(linha, 6).font = { name: 'Calibri', bold: true, size: 12 };
  if (l.notes) {
    linha += 2;
    ws.mergeCells(linha, 1, linha, colunas.length);
    ws.getCell(linha, 1).value = `Observações: ${l.notes}`;
    ws.getCell(linha, 1).alignment = { wrapText: true };
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as unknown as ArrayBuffer);
}
