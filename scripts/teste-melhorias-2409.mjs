// Testes das melhorias pedidas em 24/09: regra nova de alerta de compra pelo
// total dos dois depósitos, trava de quantidade quebrada em item de unidade,
// arredondamento dos saldos que já estavam quebrados, e desativação de
// cadastro duplicado sem perder o rastro.
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:8080/api';
let passou = 0, falhou = 0;

async function req(method, path, body, token, raw = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function check(nome, cond, extra) {
  if (cond) { passou++; console.log(`OK   ${nome}`); }
  else { falhou++; console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

const sql = (q) => execSync(`sudo -u postgres psql -d estoqueflow_full -qtAc ${JSON.stringify(q)}`).toString().trim();

async function main() {
  const reg = await req('POST', '/auth/register', {
    companyName: 'Teste Melhorias 24/09', name: 'Owner', email: 'owner@melhorias.local', password: 'senha12345',
  });
  const token = reg.data.token;
  const wh = await req('GET', '/warehouses', undefined, token);
  const A = wh.data.find((w) => w.isDefault) ?? wh.data[0];
  const B = wh.data.find((w) => w.id !== A.id);

  // ── 1. Regra nova: o que decide é o TOTAL dos dois depósitos ────────────
  const p1 = await req('POST', '/products', { name: 'Cotovelo de cobre 22mm', unit: 'UN', minStock: 100, costPrice: 4 }, token);
  await req('POST', '/movements/entrada', { productId: p1.data.id, warehouseId: A.id, quantity: 60 }, token);
  await req('POST', '/movements/entrada', { productId: p1.data.id, warehouseId: B.id, quantity: 60 }, token);

  let compras = await req('GET', '/reports/compras', undefined, token);
  let linha = compras.data.itens.find((i) => i.productId === p1.data.id);
  check('60 + 60 com mínimo 100 fica OK (a regra antiga acusaria falta nos dois)', linha.total === 120 && linha.situacao === 'OK', linha);

  // cai para 70 no total → ATENÇÃO (<= mínimo, acima da metade)
  await req('POST', '/movements/saida', { productId: p1.data.id, warehouseId: A.id, quantity: 50, reason: 'consumo' }, token);
  compras = await req('GET', '/reports/compras', undefined, token);
  linha = compras.data.itens.find((i) => i.productId === p1.data.id);
  check('total 70 com mínimo 100 → ATENÇÃO', linha.total === 70 && linha.situacao === 'ATENCAO', linha);

  // cai para 50 = metade do mínimo → ALERTA DE COMPRA (o limite conta)
  await req('POST', '/movements/saida', { productId: p1.data.id, warehouseId: B.id, quantity: 20, reason: 'consumo' }, token);
  compras = await req('GET', '/reports/compras', undefined, token);
  linha = compras.data.itens.find((i) => i.productId === p1.data.id);
  check('total 50 (exatamente 50% de 100) → ALERTA DE COMPRA', linha.total === 50 && linha.situacao === 'ALERTA_COMPRA', linha);
  check('mostra o saldo de cada depósito junto do total', linha.depositos.length === 2 && linha.depositos.reduce((a, d) => a + d.quantity, 0) === 50, linha.depositos);
  check('calcula quanto comprar para voltar ao mínimo', linha.comprarParaRepor === 50, linha);

  // produto sem mínimo vai para a lista separada
  const p2 = await req('POST', '/products', { name: 'Fita isolante preta', unit: 'UN', minStock: 0 }, token);
  compras = await req('GET', '/reports/compras', undefined, token);
  check('produto sem mínimo sai do alerta e vai para "sem mínimo"',
    compras.data.semMinimo.some((i) => i.productId === p2.data.id) &&
    !compras.data.alerta.some((i) => i.productId === p2.data.id), compras.data.resumo);

  const painel = await req('GET', '/reports/dashboard', undefined, token);
  check('painel usa a mesma régua (alertaCompra / atencao / semMinimo)',
    painel.data.alertas.alertaCompra === 1 && typeof painel.data.alertas.semMinimo === 'number', painel.data.alertas);

  // ── 2. Quantidade quebrada em item de unidade ───────────────────────────
  const frac = await req('POST', '/movements/entrada', { productId: p1.data.id, warehouseId: A.id, quantity: 3.5 }, token);
  check('entrada fracionada em item UN é recusada', frac.status === 400, frac.data);

  const pm = await req('POST', '/products', { name: 'Tubo de cobre 22mm', unit: 'MT', minStock: 0 }, token);
  const fracOk = await req('POST', '/movements/entrada', { productId: pm.data.id, warehouseId: A.id, quantity: 12.5 }, token);
  check('entrada fracionada em item MT continua permitida', fracOk.status === 200, fracOk.data);

  const venda = await req('POST', '/sales', { warehouseId: A.id, items: [{ productId: p1.data.id, quantity: 2.5, unitPrice: 10 }] }, token);
  check('venda fracionada em item UN é recusada no PDV', venda.status === 400, venda.data);

  // ── 3. Arredondar o que já estava quebrado ──────────────────────────────
  // simula o estado que veio da contagem: saldo 33,845 num item de unidade
  sql(`UPDATE stock_items SET quantity = 33.845 WHERE product_id = '${p1.data.id}' AND warehouse_id = '${A.id}'`);
  const quebrados = await req('GET', '/reports/saldos-quebrados', undefined, token);
  check('detecta o saldo quebrado do item de unidade', quebrados.data.total === 1 && quebrados.data.itens[0].arredondado === 34, quebrados.data.itens);

  const previa = await req('POST', '/reports/saldos-quebrados/arredondar', {}, token);
  check('sem confirmar, só devolve a prévia (não aplica)', previa.data.dryRun === true && previa.data.aplicados === 0, previa.data);
  check('prévia não mexeu no saldo', sql(`SELECT quantity FROM stock_items WHERE product_id='${p1.data.id}' AND warehouse_id='${A.id}'`).startsWith('33.845'));

  const aplicado = await req('POST', '/reports/saldos-quebrados/arredondar', { confirmar: true }, token);
  check('confirmando, arredonda', aplicado.data.aplicados === 1, aplicado.data);
  check('saldo virou 34', sql(`SELECT quantity FROM stock_items WHERE product_id='${p1.data.id}' AND warehouse_id='${A.id}'`).startsWith('34'));
  check('gerou movimento de AJUSTE rastreável',
    Number(sql(`SELECT count(*) FROM movements WHERE product_id='${p1.data.id}' AND type='AJUSTE'`)) === 1);
  check('a lista de quebrados fica vazia depois', (await req('GET', '/reports/saldos-quebrados', undefined, token)).data.total === 0);

  // ── 4. Duplicados ───────────────────────────────────────────────────────
  const dupA = await req('POST', '/products', { name: 'Niple metal 1/2', unit: 'UN' }, token);
  const dupB = await req('POST', '/products', { name: 'NIPLE  METAL 1/2 ', unit: 'UN' }, token);
  await req('POST', '/movements/entrada', { productId: dupB.data.id, warehouseId: A.id, quantity: 100 }, token);

  const dups = await req('GET', '/reports/duplicados', undefined, token);
  const grupo = dups.data.grupos.find((g) => g.produtos.some((p) => p.id === dupA.data.id));
  check('acha a duplicidade mesmo com espaço e maiúscula diferentes', !!grupo && grupo.produtos.length === 2, dups.data.grupos);
  check('mostra o saldo de cada cadastro do grupo', grupo.produtos.find((p) => p.id === dupB.data.id).total === 100);

  const desativado = await req('POST', `/reports/duplicados/${dupB.data.id}/desativar`, {}, token);
  check('desativa o cadastro duplicado', desativado.status === 200, desativado.data);
  check('zera o saldo que existia, por ajuste', desativado.data.saldosZerados.length === 1 && desativado.data.saldosZerados[0].de === 100, desativado.data);
  check('produto fica inativo, não apagado',
    sql(`SELECT active FROM products WHERE id='${dupB.data.id}'`) === 'f' &&
    Number(sql(`SELECT count(*) FROM products WHERE id='${dupB.data.id}'`)) === 1);
  check('o histórico do produto desativado continua existindo',
    Number(sql(`SELECT count(*) FROM movements WHERE product_id='${dupB.data.id}'`)) >= 2);
  check('registra quem desativou e por quê no log de auditoria',
    Number(sql(`SELECT count(*) FROM audit_logs WHERE entity='Product' AND entity_id='${dupB.data.id}'`)) === 1);

  // ── 5. Item zerado precisa mostrar custo estimado (revisão de 30/09) ────
  // Antes, o custo médio de um item sem saldo dava zero e o valor da compra
  // saía R$ 0,00 justamente no item mais crítico. Agora cai no custo do
  // cadastro quando não há saldo para ponderar.
  const zerado = await req('POST', '/products', { name: 'Registro esfera 3/4 zerado', unit: 'UN', minStock: 20, costPrice: 12.5 }, token);
  const comprasZ = await req('GET', '/reports/compras', undefined, token);
  const linhaZ = comprasZ.data.itens.find((i) => i.productId === zerado.data.id);
  check('item zerado entra no alerta de compra', linhaZ.situacao === 'ALERTA_COMPRA' && linhaZ.comprarParaRepor === 20, linhaZ);
  check('item zerado usa o custo de cadastro, não R$ 0,00', linhaZ.custoMedio === 12.5, linhaZ);

  // ── 6. A planilha é UMA lista só: o que precisa repor agora ─────────────
  const planilha = await req('GET', '/reports/compras/planilha', undefined, token, true);
  const buf = Buffer.from(await planilha.arrayBuffer());
  check('planilha de reposição é gerada', planilha.status === 200 && buf.length > 5000, { status: planilha.status, tamanho: buf.length });
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/reposicao.xlsx', buf);

  const nomesAbas = execSync('cd /tmp && python3 -c "import openpyxl,json;print(json.dumps(openpyxl.load_workbook(\'/tmp/reposicao.xlsx\').sheetnames))"').toString();
  check('a planilha tem uma aba só, "Repor agora"', JSON.parse(nomesAbas).length === 1 && JSON.parse(nomesAbas)[0] === 'Repor agora', nomesAbas);

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) process.exit(1);
}

main().catch((e) => { console.error('ERRO FATAL', e); process.exit(1); });
