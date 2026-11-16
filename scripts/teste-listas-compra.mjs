// Suíte das listas de compra (16/11/2026): carrinho montado a partir do
// alerta, salvar com nome, itens, status ABERTA → PEDIDA → COMPRADA com
// entrada no estoque, cancelar, duplicar, exportar PDF/Excel e permissões.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const BASE = process.env.BASE || 'http://localhost:8080/api';
let passou = 0, falhou = 0;
const falhas = [];
async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json') && !ct.includes('text/plain')) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), ct, cd: res.headers.get('content-disposition') };
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, ct };
}
function check(nome, cond, extra) {
  if (cond) { passou++; console.log(`OK   ${nome}`); }
  else { falhou++; falhas.push(nome); console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); }
}
async function textoPdf(buf) {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ef-lista-'));
  writeFileSync(join(dir, 'p.pdf'), buf);
  try { return execFileSync('pdftotext', ['-layout', join(dir, 'p.pdf'), '-']).toString(); } catch { return null; }
}

async function main() {
  const reg = await req('POST', '/auth/register', { companyName: 'Jundiaquece Listas', name: 'Gestora', email: 'gestora@listas.local', password: 'senha12345' });
  const tk = reg.data.token;
  const [A, B] = (await req('GET', '/warehouses', undefined, tk)).data;
  const solis = (await req('POST', '/suppliers', { name: 'SOLIS' }, tk)).data;
  const tigre = (await req('POST', '/suppliers', { name: 'TIGRE' }, tk)).data;
  const prod = async (name, minStock, extra = {}) => (await req('POST', '/products', { name, unit: 'UN', minStock, costPrice: 10, ...extra }, tk)).data;
  const boiler = await prod('Boiler 200 L', 4, { supplierId: solis.id, costPrice: 1000 });      // zerado → comprar 4
  const tubo25 = await prod('Tubo marrom 25 mm', 100, { supplierId: tigre.id, costPrice: 12 }); // 20 → comprar 80
  const tubo32 = await prod('Tubo marrom 32 mm', 100, { supplierId: tigre.id, costPrice: 15 }); // 50 → comprar 50
  await req('POST', '/movements/entrada', { productId: tubo25.id, warehouseId: A.id, quantity: 20, unitCost: 12 }, tk);
  await req('POST', '/movements/entrada', { productId: tubo32.id, warehouseId: A.id, quantity: 50, unitCost: 15 }, tk);

  // ── montar o carrinho a partir do alerta ──
  const alerta = (await req('GET', '/reports/compras', undefined, tk)).data.alerta;
  check('relatório traz os 3 itens em alerta para montar o carrinho', alerta.length === 3, alerta.map((i) => i.name));

  let r = await req('POST', '/purchase-lists', { items: [] }, tk);
  check('lista sem itens é recusada (422)', r.status === 422, r.data);

  r = await req('POST', '/purchase-lists', {
    supplierId: tigre.id,
    items: [
      { productId: tubo25.id, quantity: 80 },
      { productId: tubo32.id, quantity: 60, notes: 'pedir barras de 6 m' },
    ],
  }, tk);
  const L1 = r.data;
  check('cria a lista (201) com número 1, status ABERTA e nome padrão com o fornecedor', r.status === 201 && L1.number === 1 && L1.status === 'ABERTA' && /^Compra \d{2}\/\d{2} — TIGRE$/.test(L1.name), [r.status, L1?.name, L1?.status]);
  check('itens com retrato do produto (código, unidade, fornecedor, saldo e sugerido na hora)',
    L1.items.length === 2 && L1.items[0].sku === tubo25.sku && L1.items[0].unit === 'UN' && L1.items[0].supplierName === 'TIGRE' && L1.items[0].stockAtAdd === 20 && L1.items[0].minStockAtAdd === 100, L1.items[0]);
  check('custo vem do custo médio (12 e 15) e total = 80×12 + 60×15 = 1.860', L1.items[0].unitCost === 12 && L1.items[1].unitCost === 15 && Math.abs(L1.total - 1860) < 0.01, [L1.items.map((i) => i.unitCost), L1.total]);
  check('quem montou fica registrado', L1.createdByName === 'Gestora', L1.createdByName);

  // ── itens: somar, alterar, remover ──
  r = await req('POST', `/purchase-lists/${L1.id}/itens`, { items: [{ productId: tubo25.id, quantity: 20 }, { productId: boiler.id, quantity: 2, unitCost: 950 }] }, tk);
  check('adicionar produto que já está soma a quantidade (80 + 20 = 100) e novo item entra com custo informado', r.data.items.length === 3 && r.data.items.find((i) => i.productId === tubo25.id).quantity === 100 && r.data.items.find((i) => i.productId === boiler.id).unitCost === 950, r.data.items.map((i) => [i.name, i.quantity, i.unitCost]));
  check('total recalculado = 100×12 + 60×15 + 2×950 = 4.000', Math.abs(r.data.total - 4000) < 0.01, r.data.total);
  const itemBoiler = r.data.items.find((i) => i.productId === boiler.id);
  r = await req('PATCH', `/purchase-lists/${L1.id}/itens/${itemBoiler.id}`, { quantity: 4 }, tk);
  check('alterar quantidade do item recalcula (4×950 = 3.800 → total 5.900)', r.data.items.find((i) => i.id === itemBoiler.id).total === 3800 && Math.abs(r.data.total - 5900) < 0.01, r.data.total);
  r = await req('PATCH', `/purchase-lists/${L1.id}/itens/${itemBoiler.id}`, { quantity: 0 }, tk);
  check('quantidade zero é recusada (422)', r.status === 422);
  r = await req('POST', `/purchase-lists/${L1.id}/itens`, { items: [{ name: 'Frete transportadora', quantity: 1, unitCost: 100 }] }, tk);
  check('item livre (sem cadastro) entra pela descrição', r.status === 200 && r.data.items.some((i) => i.name === 'Frete transportadora' && i.productId === null), r.data?.items?.map((i) => i.name));
  const frete = r.data.items.find((i) => i.name === 'Frete transportadora');
  r = await req('DELETE', `/purchase-lists/${L1.id}/itens/${frete.id}`, undefined, tk);
  check('remover item tira da lista e recalcula', r.data.items.length === 3 && Math.abs(r.data.total - 5900) < 0.01, r.data.total);

  r = await req('PATCH', `/purchase-lists/${L1.id}`, { name: 'Pedido TIGRE novembro', notes: 'entregar na loja' }, tk);
  check('renomear e anotar a lista', r.data.name === 'Pedido TIGRE novembro' && r.data.notes === 'entregar na loja');

  // ── relatório sabe que o produto já está numa lista ──
  const em = (await req('GET', '/purchase-lists/em-aberto-por-produto', undefined, tk)).data;
  check('mapa produto → listas pendentes aponta a lista #1 para os 3 produtos', em[tubo25.id]?.[0]?.number === 1 && em[boiler.id]?.length === 1, em);

  // ── status: ABERTA → PEDIDA → COMPRADA com entrada ──
  r = await req('POST', `/purchase-lists/${L1.id}/status`, { status: 'PEDIDA' }, tk);
  check('marcar como PEDIDA grava quem e quando', r.data.status === 'PEDIDA' && r.data.orderedByName === 'Gestora' && !!r.data.orderedAt, r.data);
  r = await req('POST', `/purchase-lists/${L1.id}/itens`, { items: [{ productId: boiler.id, quantity: 1 }] }, tk);
  check('lista PEDIDA não aceita mais itens (409)', r.status === 409, r.data);
  r = await req('POST', `/purchase-lists/${L1.id}/status`, { status: 'ABERTA' }, tk);
  check('PEDIDA pode voltar para ABERTA (pedido não foi)', r.data.status === 'ABERTA' && r.data.orderedAt === null);
  await req('POST', `/purchase-lists/${L1.id}/status`, { status: 'PEDIDA' }, tk);

  r = await req('POST', `/purchase-lists/${L1.id}/status`, { status: 'COMPRADA', darEntrada: true }, tk);
  check('COMPRADA com entrada sem depósito é recusada (400)', r.status === 400, r.data);
  r = await req('POST', `/purchase-lists/${L1.id}/status`, { status: 'COMPRADA', darEntrada: true, warehouseId: B.id, documento: 'NF 1234' }, tk);
  check('COMPRADA com entrada: 3 entradas lançadas, quem/quando e depósito gravados', r.status === 200 && r.data.status === 'COMPRADA' && r.data.entradasLancadas === 3 && r.data.boughtByName === 'Gestora' && r.data.stockedWarehouseId === B.id, r.data);
  const stock = (await req('GET', '/stock?take=1000', undefined, tk)).data;
  const saldo = (pid, wid) => stock.find((s) => s.productId === pid && s.warehouseId === wid)?.quantity ?? 0;
  check('saldo no DEP-B subiu: tubo25 +100, tubo32 +60, boiler +4', saldo(tubo25.id, B.id) === 100 && saldo(tubo32.id, B.id) === 60 && saldo(boiler.id, B.id) === 4, [saldo(tubo25.id, B.id), saldo(tubo32.id, B.id), saldo(boiler.id, B.id)]);
  const movs = (await req('GET', `/movements?productId=${boiler.id}&take=10`, undefined, tk)).data;
  const movList = Array.isArray(movs) ? movs : movs.items ?? [];
  check('a entrada cita a lista no motivo e leva o documento', movList.some((m) => m.type === 'ENTRADA' && /lista #0001/.test(m.reason ?? '') && m.document === 'NF 1234'), movList.map((m) => [m.type, m.reason, m.document]));
  const depois = (await req('GET', '/reports/compras', undefined, tk)).data;
  check('depois da entrada, nada mais em alerta', depois.resumo.alertaCompra === 0, depois.alerta.map((i) => i.name));
  r = await req('POST', `/purchase-lists/${L1.id}/status`, { status: 'ABERTA' }, tk);
  check('COMPRADA não volta atrás (409)', r.status === 409);
  r = await req('DELETE', `/purchase-lists/${L1.id}`, undefined, tk);
  check('lista COMPRADA não pode ser excluída (409) — histórico fica', r.status === 409);

  // ── COMPRADA sem entrada; cancelar; duplicar ──
  r = await req('POST', '/purchase-lists', { name: 'Compra avulsa', items: [{ productId: boiler.id, quantity: 1 }] }, tk);
  const L2 = r.data;
  check('segunda lista recebe número 2', L2.number === 2);
  r = await req('POST', `/purchase-lists/${L2.id}/status`, { status: 'COMPRADA', darEntrada: false }, tk);
  check('COMPRADA sem entrada: status muda, nenhuma entrada, sem depósito', r.data.status === 'COMPRADA' && r.data.entradasLancadas === 0 && r.data.stockedAt === null, r.data);
  check('saldo do boiler não mudou (continua 4)', (await req('GET', '/stock?take=1000', undefined, tk)).data.find((s) => s.productId === boiler.id && s.warehouseId === B.id)?.quantity === 4);

  r = await req('POST', `/purchase-lists/${L2.id}/duplicar`, undefined, tk);
  const L3 = r.data;
  check('duplicar gera lista ABERTA nº 3 "(cópia)" com os mesmos itens', r.status === 201 && L3.number === 3 && L3.status === 'ABERTA' && /\(cópia\)$/.test(L3.name) && L3.items.length === 1, L3);
  r = await req('POST', `/purchase-lists/${L3.id}/status`, { status: 'CANCELADA' }, tk);
  check('cancelar grava quem e quando', r.data.status === 'CANCELADA' && r.data.canceledByName === 'Gestora' && !!r.data.canceledAt);
  r = await req('DELETE', `/purchase-lists/${L3.id}`, undefined, tk);
  check('lista cancelada pode ser excluída', r.status === 200 && r.data.ok === true);

  // ── listagem e contadores ──
  r = await req('GET', '/purchase-lists', undefined, tk);
  check('listagem: 2 listas, contadores por status (2 compradas, somando 5.900 + 950)', r.data.items.length === 2 && r.data.porStatus.COMPRADA.listas === 2 && Math.abs(r.data.porStatus.COMPRADA.valor - 6850) < 0.01 && r.data.porStatus.ABERTA.listas === 0, r.data.porStatus);
  r = await req('GET', '/purchase-lists?status=PENDENTES', undefined, tk);
  check('filtro PENDENTES (aberta + pedida) vem vazio agora', r.data.items.length === 0);
  r = await req('GET', '/purchase-lists?status=COMPRADA', undefined, tk);
  check('filtro COMPRADA traz as 2', r.data.items.length === 2);

  // ── exportação ──
  r = await req('GET', `/purchase-lists/${L1.id}/export/pdf`, undefined, tk);
  check('PDF do pedido baixa com nome pedido-0001-tigre.pdf', r.status === 200 && /pdf/.test(r.ct) && /pedido-0001-tigre\.pdf/.test(r.cd), r.cd);
  const txt = await textoPdf(r.buf);
  if (txt) check('PDF traz título, itens com quantidade decidida (100) e total 5.900', /Pedido de compra #0001 — TIGRE/.test(txt) && /Tubo marrom 25 mm/.test(txt) && /\b100\b/.test(txt) && /5\.900,00/.test(txt), txt.slice(0, 600));
  else console.log('     (pdftotext ausente — conteúdo do PDF não conferido)');
  r = await req('GET', `/purchase-lists/${L1.id}/export/xlsx`, undefined, tk);
  check('Excel do pedido baixa', r.status === 200 && /spreadsheetml/.test(r.ct) && /pedido-0001-tigre\.xlsx/.test(r.cd), r.cd);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf);
  const ws = wb.getWorksheet('Pedido');
  const linhas = []; ws.eachRow((row, n) => { if (n >= 5 && !/^Observa/.test(String(row.getCell(1).value ?? ''))) linhas.push(row.values.slice(1)); });
  check('Excel: 3 itens + linha de total com 5.900', linhas.length === 4 && linhas.slice(0, 3).every((l) => typeof l[3] === 'number') && linhas[3].some((v) => typeof v === 'number' && Math.abs(v - 5900) < 0.01), linhas);

  // ── permissões ──
  const op = await req('POST', '/auth/users', { name: 'Operadora', email: 'op@listas.local', password: 'provisoria123', role: 'OPERADOR' }, tk);
  const t0 = (await req('POST', '/auth/login', { email: 'op@listas.local', password: 'provisoria123' })).data.token;
  const tOp = (await req('PATCH', '/auth/me/password', { current: 'provisoria123', next: 'senha12345' }, t0)).data.token;
  check('operadora sem "ver alertas" não vê listas (403)', (await req('GET', '/purchase-lists', undefined, tOp)).status === 403);
  await req('PATCH', `/auth/users/${op.data.id}`, { permissionOverrides: { VER_ALERTAS: true, MOVIMENTAR_ESTOQUE: false } }, tk);
  r = await req('POST', '/purchase-lists', { items: [{ productId: boiler.id, quantity: 2 }] }, tOp);
  check('com "ver alertas", monta lista', r.status === 201, r.data);
  r = await req('POST', `/purchase-lists/${r.data.id}/status`, { status: 'COMPRADA', darEntrada: true, warehouseId: A.id }, tOp);
  check('sem "movimentar estoque", não dá entrada (403) — a lista continua aberta', r.status === 403, r.data);

  // ── isolamento entre empresas ──
  const outra = await req('POST', '/auth/register', { companyName: 'Outra Loja', name: 'Xavier', email: 'x@outra.local', password: 'senha12345' });
  check('outra empresa não enxerga a lista (404)', (await req('GET', `/purchase-lists/${L1.id}`, undefined, outra.data.token)).status === 404);

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
