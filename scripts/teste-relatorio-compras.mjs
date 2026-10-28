// Suite do relatório de compras (28/10/2026): regra "estoque sugerido → 50%
// entra na lista", urgência, agrupamentos, e as três extrações (Excel com 6
// abas, PDF, CSV) — inteira e por fornecedor.
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
  else { falhou++; falhas.push(nome); console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
async function textoPdf(buf) {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ef-compras-'));
  writeFileSync(join(dir, 'p.pdf'), buf);
  try { return execFileSync('pdftotext', ['-layout', join(dir, 'p.pdf'), '-']).toString(); } catch { return null; }
}

async function main() {
  const reg = await req('POST', '/auth/register', { companyName: 'Jundiaquece Compras', name: 'Owner', email: 'owner@compras.local', password: 'senha12345' });
  const tk = reg.data.token;
  const wh = (await req('GET', '/warehouses', undefined, tk)).data;
  const [A, B] = wh;
  const forn = async (name) => (await req('POST', '/suppliers', { name }, tk)).data;
  const solis = await forn('SOLIS'), tigre = await forn('TIGRE');
  const cat = async (name) => (await req('POST', '/categories', { name }, tk)).data;
  const tubos = await cat('Tubos'), boilers = await cat('Boilers');
  const prod = async (name, minStock, extra = {}) => (await req('POST', '/products', { name, unit: 'UN', minStock, costPrice: 10, ...extra }, tk)).data;
  const zerado = await prod('Boiler 200 L', 4, { supplierId: solis.id, categoryId: boilers.id, costPrice: 1000 });           // 0 → ZERADO
  const critico = await prod('Tubo marrom 25 mm', 100, { supplierId: tigre.id, categoryId: tubos.id, costPrice: 12 });     // 20 → CRITICO (20%)
  const alerta = await prod('Tubo marrom 32 mm', 100, { supplierId: tigre.id, categoryId: tubos.id, costPrice: 15 });      // 50 → ALERTA (50%)
  const ok = await prod('Cotovelo 25 mm', 100, { supplierId: tigre.id, categoryId: tubos.id });                            // 60 → OK
  const semSug = await prod('Fita veda rosca', 0);                                                                           // sem sugerido
  const semForn = await prod('Abraçadeira', 10, { categoryId: tubos.id });                                                   // 2 → alerta, sem fornecedor
  await req('POST', '/movements/entrada', { productId: critico.id, warehouseId: A.id, quantity: 12 }, tk);
  await req('POST', '/movements/entrada', { productId: critico.id, warehouseId: B.id, quantity: 8 }, tk);
  await req('POST', '/movements/entrada', { productId: alerta.id, warehouseId: A.id, quantity: 50 }, tk);
  await req('POST', '/movements/entrada', { productId: ok.id, warehouseId: A.id, quantity: 60 }, tk);
  await req('POST', '/movements/entrada', { productId: semForn.id, warehouseId: B.id, quantity: 2 }, tk);

  const c = (await req('GET', '/reports/compras', undefined, tk)).data;
  const por = Object.fromEntries(c.itens.map((i) => [i.productId, i]));
  check('regra: 0/4 zerado, 20/100 crítico, 50/100 alerta, 60/100 OK, sem sugerido fora',
    por[zerado.id].urgencia === 'ZERADO' && por[critico.id].urgencia === 'CRITICO' && por[alerta.id].urgencia === 'ALERTA' && por[ok.id].situacao === 'OK' && por[semSug.id].situacao === 'SEM_MINIMO',
    Object.values(por).map((i) => [i.name, i.situacao, i.urgencia]));
  check('comprar = o que falta para voltar ao sugerido (4, 80, 50, 8)', por[zerado.id].comprarParaRepor === 4 && por[critico.id].comprarParaRepor === 80 && por[alerta.id].comprarParaRepor === 50 && por[semForn.id].comprarParaRepor === 8);
  check('fração restante calculada (0, 0,2, 0,5, 0,6)', por[zerado.id].fracaoRestante === 0 && por[critico.id].fracaoRestante === 0.2 && por[alerta.id].fracaoRestante === 0.5 && por[ok.id].fracaoRestante === 0.6);
  check('resumo: 4 em alerta, 1 zerado, 2 críticos (20% e 2/10), 3 fornecedores (incl. sem fornecedor)', c.resumo.alertaCompra === 4 && c.resumo.zerados === 1 && c.resumo.criticos === 2 && c.resumo.fornecedoresEnvolvidos === 3, c.resumo);
  check('lista de alerta ordenada pela urgência (zerado primeiro, OK não entra)', c.alerta[0].productId === zerado.id && c.alerta[1].productId === critico.id && !c.alerta.some((i) => i.productId === ok.id), c.alerta.map((i) => i.name));
  check('valor estimado = 4×1000 + 80×12 + 50×15 + 8×10 = 5.790', Math.abs(c.resumo.valorAComprar - 5790) < 0.01, c.resumo.valorAComprar);
  check('por fornecedor: TIGRE 2 itens, SOLIS 1 (zerado), sem fornecedor 1', c.porFornecedor.find((f) => f.fornecedor === 'TIGRE')?.itensParaComprar === 2 && c.porFornecedor.find((f) => f.fornecedor === 'SOLIS')?.zerados === 1 && c.porFornecedor.some((f) => f.fornecedor === '(sem fornecedor cadastrado)'), c.porFornecedor);
  check('por categoria: Tubos com 3 em alerta de 4', c.porCategoria.find((x) => x.categoria === 'Tubos')?.alerta === 3 && c.porCategoria.find((x) => x.categoria === 'Tubos')?.produtos === 4, c.porCategoria);

  // ── Excel completo ──
  let r = await req('GET', '/reports/compras/extrair?formato=xlsx', undefined, tk);
  check('Excel completo baixa com nome relatorio-de-compras', r.status === 200 && /spreadsheetml/.test(r.ct) && /relatorio-de-compras-\d{4}-\d{2}-\d{2}\.xlsx/.test(r.cd), r.cd);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf);
  const abas = wb.worksheets.map((w) => w.name);
  check('6 abas: Resumo, Lista de compra, Por fornecedor, Por categoria, Todos os produtos, Sem sugerido', JSON.stringify(abas) === JSON.stringify(['Resumo', 'Lista de compra', 'Por fornecedor', 'Por categoria', 'Todos os produtos', 'Sem sugerido']), abas);
  const lista = wb.getWorksheet('Lista de compra');
  const linhasLista = []; lista.eachRow((row, n) => { if (n > 4) linhasLista.push(row.values.slice(1)); });
  check('aba Lista: 4 itens + linha de total; zerado primeiro com rótulo ZERADO', linhasLista.length === 5 && linhasLista[0][0] === 'ZERADO' && linhasLista[0][2] === 'Boiler 200 L', linhasLista.map((l) => l.slice(0, 3)));
  const cab = lista.getRow(4).values.slice(1);
  check('cabeçalho usa "Estoque sugerido" e "% do sugerido"', cab.includes('Estoque sugerido') && cab.includes('% do sugerido') && cab.includes('COMPRAR'), cab);
  const ultima = linhasLista[linhasLista.length - 1];
  check('linha de total = R$ 5.790', ultima.some((v) => typeof v === 'number' && Math.abs(v - 5790) < 0.01), ultima);
  const pf = wb.getWorksheet('Por fornecedor'); const textoPf = []; pf.eachRow((row) => textoPf.push(row.values.slice(1).join('|')));
  check('aba Por fornecedor tem bloco da TIGRE com 2 itens e da SOLIS', textoPf.some((t) => /^TIGRE — 2 item/.test(t)) && textoPf.some((t) => /^SOLIS — 1 item/.test(t)), textoPf.filter((t) => /—/.test(t)));
  const todos = wb.getWorksheet('Todos os produtos'); let nTodos = 0; todos.eachRow((row, n) => { if (n > 4 && row.getCell(2).value) nTodos++; });
  check('aba Todos os produtos lista os 6 produtos com situação', nTodos >= 6, nTodos);
  const resumo = wb.getWorksheet('Resumo'); const textoResumo = []; resumo.eachRow((row) => textoResumo.push(row.values.slice(1).join('|')));
  check('aba Resumo explica a regra do estoque sugerido', textoResumo.some((t) => /Estoque sugerido = quantidade que deve haver/.test(t)), textoResumo.slice(0, 4));

  // ── Excel de um fornecedor ──
  r = await req('GET', '/reports/compras/extrair?formato=xlsx&fornecedor=TIGRE', undefined, tk);
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(r.buf);
  const ped = wb2.getWorksheet('Pedido'); const linhasPed = []; ped.eachRow((row, n) => { if (n > 4 && /^[A-Z]{3}-\d{5}$/.test(String(row.getCell(2).value ?? ""))) linhasPed.push(String(row.getCell(3).value)); });
  check('pedido em Excel do fornecedor: 1 aba "Pedido" só com os 2 itens da TIGRE', wb2.worksheets.length === 1 && linhasPed.length === 2 && linhasPed.every((n) => /Tubo marrom/.test(n)) && /pedido-de-compra-tigre/.test(r.cd), [linhasPed, r.cd]);

  // ── PDF ──
  r = await req('GET', '/reports/compras/extrair?formato=pdf', undefined, tk);
  check('PDF baixa', r.status === 200 && /pdf/.test(r.ct) && r.buf.length > 5000, r.ct);
  const t = await textoPdf(r.buf);
  if (t) {
    check('PDF: título, regra, 4 itens, agrupado por fornecedor, zerado marcado', /Lista de compra/.test(t) && /50% do estoque sugerido/.test(t) && /4\s+item\(ns\) para comprar/.test(t) && /SOLIS/.test(t) && /TIGRE/.test(t) && /ZERADO/.test(t), t.slice(0, 600));
    check('PDF: valor estimado R$ 5.790,00', /5\.790,00/.test(t));
  }
  r = await req('GET', '/reports/compras/extrair?formato=pdf&fornecedor=SOLIS', undefined, tk);
  const t2 = await textoPdf(r.buf);
  if (t2) check('PDF do fornecedor: "Pedido de compra — SOLIS" só com o boiler', /Pedido de compra — SOLIS/.test(t2) && /Boiler 200 L/.test(t2) && !/Tubo marrom/.test(t2), t2.slice(0, 400));

  // ── CSV ──
  r = await req('GET', '/reports/compras/extrair?formato=csv', undefined, tk);
  const csv = r.buf ? r.buf.toString('utf8') : r.data;
  const linhasCsv = csv.replace(/^﻿/, '').split('\n');
  check('CSV: cabeçalho + 4 linhas, separador ;, colunas estoque_sugerido/comprar', linhasCsv.length === 5 && /^urgencia;codigo;produto/.test(linhasCsv[0]) && /estoque_sugerido/.test(linhasCsv[0]) && linhasCsv[1].startsWith('ZERADO;'), linhasCsv.slice(0, 2));

  // ── compatibilidade e permissão ──
  r = await req('GET', '/reports/compras/planilha', undefined, tk);
  check('rota antiga /planilha continua entregando o Excel', r.status === 200 && /spreadsheetml/.test(r.ct));
  const op = await req('POST', '/auth/users', { name: 'Driele', email: 'driele@compras.local', password: 'provisoria123', role: 'OPERADOR' }, tk);
  const t0 = (await req('POST', '/auth/login', { email: 'driele@compras.local', password: 'provisoria123' })).data.token;
  const tr = await req('PATCH', '/auth/me/password', { current: 'provisoria123', next: 'senha12345' }, t0);
  check('operadora sem "ver alertas" não extrai (403)', (await req('GET', '/reports/compras/extrair?formato=pdf', undefined, tr.data.token)).status === 403);
  await req('PATCH', `/auth/users/${op.data.id}`, { permissionOverrides: { VER_ALERTAS: true } }, tk);
  check('com "ver alertas" ligado, extrai', (await req('GET', '/reports/compras/extrair?formato=csv', undefined, tr.data.token)).status === 200);

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
