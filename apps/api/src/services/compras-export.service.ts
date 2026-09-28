/**
 * compras-export.service
 *
 * O relatório de reposição em planilha, pedido em 24/09: "super detalhado,
 * seguindo o formato de planilha, mas com várias visões diferentes".
 *
 * Sai um .xlsx com seis abas, todas partindo do MESMO número — o total somado
 * dos dois depósitos:
 *   1. Resumo            — os números da decisão numa tela só
 *   2. Alerta de compra  — total <= 50% do mínimo (comprar agora)
 *   3. Atenção           — total <= mínimo (programar)
 *   4. Posição completa  — todos os produtos, com saldo de cada depósito
 *   5. Por categoria     — onde está concentrada a falta
 *   6. Por fornecedor    — o rascunho do pedido de cada um
 *   7. Sem mínimo        — produtos que ainda não têm régua de reposição
 */
import ExcelJS from 'exceljs';
import { porCategoria, porFornecedor, type LinhaCompra, type posicaoCompra } from './compras.service.js';

type Posicao = Awaited<ReturnType<typeof posicaoCompra>>;

const MOEDA = '"R$" #,##0.00';
const CABECALHO = 'FFE8E8E8';
const ALERTA = 'FFFCE4E2';
const ATENCAO = 'FFFDF3DC';

const ROTULO: Record<string, string> = {
  ALERTA_COMPRA: 'ALERTA DE COMPRA',
  ATENCAO: 'ATENÇÃO',
  OK: 'OK',
  SEM_MINIMO: 'SEM MÍNIMO',
};

function cabecalho(ws: ExcelJS.Worksheet, colunas: { header: string; key: string; width: number }[]) {
  ws.columns = colunas;
  const linha = ws.getRow(1);
  linha.height = 22;
  linha.eachCell((c) => {
    c.font = { name: 'Calibri', bold: true, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CABECALHO } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Uma linha de produto, no formato usado pelas abas 2, 3, 4 e 7. */
function linhaProduto(i: LinhaCompra, depositos: Posicao['depositos']) {
  const base: Record<string, unknown> = {
    sku: i.sku,
    name: i.name,
    unit: i.unit,
    size: i.size ?? '',
    categoria: i.categoria ?? '',
    fornecedor: i.fornecedor ?? '',
  };
  for (const d of depositos) {
    base[`dep_${d.code}`] = i.depositos.find((x) => x.id === d.id)?.quantity ?? 0;
  }
  base.total = i.total;
  base.minStock = i.minStock;
  base.pontoCompra = i.pontoCompra;
  base.situacao = ROTULO[i.situacao] ?? i.situacao;
  base.comprar = i.comprarParaRepor;
  base.custoMedio = i.custoMedio;
  base.valorCompra = Number((i.comprarParaRepor * i.custoMedio).toFixed(2));
  base.valorEstoque = i.valorEstoque;
  base.saidas90 = i.saidas90;
  base.cobertura = i.coberturaDias ?? '';
  return base;
}

function colunasProduto(depositos: Posicao['depositos']) {
  return [
    { header: 'Código', key: 'sku', width: 14 },
    { header: 'Produto', key: 'name', width: 46 },
    { header: 'Un.', key: 'unit', width: 7 },
    { header: 'Tamanho', key: 'size', width: 12 },
    { header: 'Categoria', key: 'categoria', width: 18 },
    { header: 'Fornecedor', key: 'fornecedor', width: 20 },
    ...depositos.map((d) => ({ header: d.code, key: `dep_${d.code}`, width: 10 })),
    { header: 'TOTAL', key: 'total', width: 11 },
    { header: 'Estoque mínimo', key: 'minStock', width: 13 },
    { header: 'Ponto de compra (50%)', key: 'pontoCompra', width: 14 },
    { header: 'Situação', key: 'situacao', width: 18 },
    { header: 'Comprar p/ repor', key: 'comprar', width: 14 },
    { header: 'Custo médio', key: 'custoMedio', width: 12 },
    { header: 'Valor da compra', key: 'valorCompra', width: 14 },
    { header: 'Valor em estoque', key: 'valorEstoque', width: 14 },
    { header: 'Saídas 90 dias', key: 'saidas90', width: 12 },
    { header: 'Cobertura (dias)', key: 'cobertura', width: 13 },
  ];
}

function pintarPorSituacao(ws: ExcelJS.Worksheet) {
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const situacao = String(row.getCell('situacao').value ?? '');
    const cor = situacao === ROTULO.ALERTA_COMPRA ? ALERTA : situacao === ROTULO.ATENCAO ? ATENCAO : null;
    if (cor) row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } }; });
    for (const key of ['custoMedio', 'valorCompra', 'valorEstoque']) row.getCell(key).numFmt = MOEDA;
  });
}

function abaProdutos(wb: ExcelJS.Workbook, nome: string, itens: LinhaCompra[], depositos: Posicao['depositos'], vazio: string) {
  const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
  cabecalho(ws, colunasProduto(depositos));
  if (!itens.length) {
    ws.addRow({ name: vazio });
    return ws;
  }
  for (const i of itens) ws.addRow(linhaProduto(i, depositos));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  pintarPorSituacao(ws);
  return ws;
}

export async function gerarRelatorioCompras(posicao: Posicao, empresa: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = empresa;
  wb.created = new Date();

  // 1. Resumo
  const resumo = wb.addWorksheet('1. Resumo');
  resumo.columns = [{ width: 38 }, { width: 22 }];
  const titulo = resumo.addRow(['Relatório de reposição de estoque', '']);
  titulo.font = { name: 'Calibri', bold: true, size: 16 };
  resumo.addRow([empresa, new Date().toLocaleString('pt-BR')]);
  resumo.addRow([]);
  resumo.addRow(['Regra', 'Total dos dois depósitos']);
  resumo.addRow(['Atenção', 'total igual ou abaixo do estoque mínimo']);
  resumo.addRow(['Alerta de compra', 'total igual ou abaixo de 50% do mínimo']);
  resumo.addRow([]);
  const linhas: [string, number | string][] = [
    ['Produtos ativos', posicao.resumo.produtos],
    ['Em ALERTA DE COMPRA', posicao.resumo.alertaCompra],
    ['Em ATENÇÃO', posicao.resumo.atencao],
    ['OK', posicao.resumo.ok],
    ['Sem mínimo definido', posicao.resumo.semMinimo],
    ['Valor estimado da reposição', posicao.resumo.valorAComprar],
    ['Valor total em estoque', posicao.resumo.valorEstoque],
  ];
  for (const [rotulo, valor] of linhas) {
    const r = resumo.addRow([rotulo, valor]);
    r.getCell(1).font = { name: 'Calibri', bold: true };
    if (String(rotulo).startsWith('Valor')) r.getCell(2).numFmt = MOEDA;
    if (rotulo === 'Em ALERTA DE COMPRA') r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALERTA } }; });
    if (rotulo === 'Em ATENÇÃO') r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ATENCAO } }; });
  }

  // 2 a 4 e 7. Listas de produtos
  abaProdutos(wb, '2. Alerta de compra', posicao.alerta, posicao.depositos, 'Nenhum produto no alerta de compra.');
  abaProdutos(wb, '3. Atencao', posicao.atencao, posicao.depositos, 'Nenhum produto em atenção.');
  abaProdutos(wb, '4. Posicao completa', posicao.itens, posicao.depositos, 'Nenhum produto cadastrado.');

  // 5. Por categoria
  const cat = wb.addWorksheet('5. Por categoria');
  cabecalho(cat, [
    { header: 'Categoria', key: 'categoria', width: 28 },
    { header: 'Produtos', key: 'produtos', width: 11 },
    { header: 'Em alerta', key: 'alerta', width: 11 },
    { header: 'Em atenção', key: 'atencao', width: 11 },
    { header: 'Unidades', key: 'total', width: 13 },
    { header: 'Valor em estoque', key: 'valor', width: 16 },
    { header: 'Valor a comprar', key: 'comprar', width: 16 },
  ]);
  for (const l of porCategoria(posicao.itens)) {
    const r = cat.addRow(l);
    r.getCell('valor').numFmt = MOEDA;
    r.getCell('comprar').numFmt = MOEDA;
  }

  // 6. Por fornecedor
  const forn = wb.addWorksheet('6. Por fornecedor');
  cabecalho(forn, [
    { header: 'Fornecedor', key: 'fornecedor', width: 32 },
    { header: 'Itens para comprar', key: 'itensParaComprar', width: 16 },
    { header: 'Valor estimado', key: 'valor', width: 16 },
  ]);
  for (const l of porFornecedor(posicao.itens)) {
    const r = forn.addRow(l);
    r.getCell('valor').numFmt = MOEDA;
  }

  // 7. Sem mínimo
  abaProdutos(wb, '7. Sem minimo definido', posicao.semMinimo, posicao.depositos, 'Todos os produtos têm estoque mínimo definido.');

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as unknown as ArrayBuffer);
}
