// Testes do pedido de 06/10: ajuste manual de saldo pela tela de depósitos e
// varredura de TODO dado quebrado do sistema — arredondando o que é unidade
// e preservando o que é metragem, inclusive quando a unidade foi cadastrada
// com outra grafia ("MTS", "metro", "m²", "Kg").
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:8080/api';
let passou = 0, falhou = 0;

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function check(nome, cond, extra) {
  if (cond) { passou++; console.log(`OK   ${nome}`); }
  else { falhou++; console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

// PSQL: comando psql do ambiente (padrão: o Postgres local de teste usado nas sessões anteriores).
const PSQL = process.env.PSQL || 'sudo -u postgres psql -d estoqueflow_full';
const sql = (q) => execSync(`${PSQL} -qtAc ${JSON.stringify(q)}`).toString().trim();

async function main() {
  const reg = await req('POST', '/auth/register', {
    companyName: 'Teste Dados Quebrados', name: 'Owner', email: 'owner@quebrados.local', password: 'senha12345',
  });
  const token = reg.data.token;
  const wh = await req('GET', '/warehouses', undefined, token);
  const A = wh.data.find((w) => w.isDefault) ?? wh.data[0];
  const B = wh.data.find((w) => w.id !== A.id);

  // ── 1. Ajuste manual de saldo (tela de depósitos) ────────────────────────
  const peca = await req('POST', '/products', { name: 'Niple metal 1/2', unit: 'UN', minStock: 10, costPrice: 3 }, token);
  await req('POST', '/movements/entrada', { productId: peca.data.id, warehouseId: A.id, quantity: 20 }, token);

  const aj = await req('POST', '/movements/ajuste', {
    productId: peca.data.id, warehouseId: A.id, newQuantity: 17, reason: 'recontagem na prateleira',
  }, token);
  check('ajuste manual grava o novo saldo', aj.status === 200 && sql(`SELECT quantity FROM stock_items WHERE product_id='${peca.data.id}' AND warehouse_id='${A.id}'`).startsWith('17'), aj.data);
  // `balanceFrom`/`balanceTo` guardam o saldo RESULTANTE do depósito de
  // origem/destino (mesma convenção de entrada, saída e transferência). Num
  // ajuste para baixo o depósito é a origem: quantidade 3 e saldo final 17 —
  // de onde se reconstrói o saldo anterior (17 + 3 = 20).
  check('ajuste manual deixa rastro de AJUSTE com a diferença e o saldo final',
    Number(sql(`SELECT count(*) FROM movements WHERE product_id='${peca.data.id}' AND type='AJUSTE' AND quantity = 3 AND balance_from = 17 AND balance_to IS NULL`)) === 1,
    sql(`SELECT quantity, balance_from, balance_to FROM movements WHERE product_id='${peca.data.id}' AND type='AJUSTE'`));
  check('ajuste manual guarda o motivo digitado',
    sql(`SELECT reason FROM movements WHERE product_id='${peca.data.id}' AND type='AJUSTE'`) === 'recontagem na prateleira');

  const ajFrac = await req('POST', '/movements/ajuste', { productId: peca.data.id, warehouseId: A.id, newQuantity: 2.333 }, token);
  check('ajuste manual recusa saldo quebrado em item de unidade', ajFrac.status === 400, ajFrac.data);

  // ── 2. Grafias de unidade de medida ─────────────────────────────────────
  const medidas = ['MTS', 'metro', 'm²', ' Kg ', 'LT', 'Metro Linear', 'mm'];
  const idsMedida = [];
  for (const [i, u] of medidas.entries()) {
    const p = await req('POST', '/products', { name: `Tubo medida ${i} ${u}`, unit: u }, token);
    idsMedida.push({ id: p.data.id, unit: u });
    const e = await req('POST', '/movements/entrada', { productId: p.data.id, warehouseId: A.id, quantity: 12.5 }, token);
    check(`unidade "${u}" aceita entrada fracionada`, e.status === 200, e.data);
  }

  const unidades = ['UN', 'PC', 'PÇ', 'CX', 'BR', 'RL', 'JG'];
  for (const [i, u] of unidades.entries()) {
    const p = await req('POST', '/products', { name: `Peca avulsa ${i} ${u}`, unit: u }, token);
    const e = await req('POST', '/movements/entrada', { productId: p.data.id, warehouseId: A.id, quantity: 1.5 }, token);
    check(`unidade "${u}" recusa entrada fracionada`, e.status === 400, e.data);
    sql(`INSERT INTO stock_items (id, product_id, warehouse_id, quantity, reserved, avg_cost, updated_at) VALUES (gen_random_uuid(), '${p.data.id}', '${B.id}', 2.333, 0, 0, now())`);
  }

  // ── 3. Radiografia: o que arredonda e o que preserva ────────────────────
  const radio = await req('GET', '/reports/fracionados', undefined, token);
  const medida = radio.data.unidades.filter((u) => u.medida).map((u) => u.normalizada).sort();
  const arredonda = radio.data.unidades.filter((u) => !u.medida).map((u) => u.normalizada).sort();
  check('radiografia marca metro, m², kg, litro e mm como medida',
    ['KG', 'LT', 'M2', 'METROLINEAR', 'METRO', 'MM', 'MTS'].every((u) => medida.includes(u)), medida);
  check('radiografia marca UN, PC, PÇ, CX, BR, RL e JG como unidade',
    ['BR', 'CX', 'JG', 'PC', 'RL', 'UN'].every((u) => arredonda.includes(u)), arredonda);
  check('radiografia conta quantos saldos serão arredondados', radio.data.aArredondar === 7, radio.data.aArredondar);
  check('radiografia conta quantos saldos ficam preservados', radio.data.preservados === medidas.length, radio.data.preservados);

  // ── 4. A varredura corrige tudo que é unidade e não toca na medida ──────
  const quebrados = await req('GET', '/reports/saldos-quebrados', undefined, token);
  check('a lista de saldos quebrados traz só item de unidade', quebrados.data.total === 7, quebrados.data.total);
  check('2,333 vira 2', quebrados.data.itens.every((i) => i.arredondado === 2), quebrados.data.itens);

  const aplicado = await req('POST', '/reports/saldos-quebrados/arredondar', { confirmar: true }, token);
  check('arredonda os 7 de uma vez', aplicado.data.aplicados === 7, aplicado.data);
  check('nenhum saldo quebrado sobra em item de unidade',
    Number(sql(`SELECT count(*) FROM stock_items s JOIN products p ON p.id = s.product_id WHERE p.name LIKE 'Peca avulsa%' AND s.quantity <> round(s.quantity)`)) === 0);
  check('os 12,5 metros continuam 12,5',
    Number(sql(`SELECT count(*) FROM stock_items s JOIN products p ON p.id = s.product_id WHERE p.name LIKE 'Tubo medida%' AND s.quantity = 12.5`)) === medidas.length);

  // ── 5. Saldo positivo nunca vira zero ──────────────────────────────────
  const migalha = await req('POST', '/products', { name: 'Adaptador soldavel 25mm', unit: 'UN' }, token);
  await req('POST', '/movements/entrada', { productId: migalha.data.id, warehouseId: A.id, quantity: 5 }, token);
  sql(`UPDATE stock_items SET quantity = 0.4 WHERE product_id='${migalha.data.id}' AND warehouse_id='${A.id}'`);
  const previa = await req('GET', '/reports/saldos-quebrados', undefined, token);
  const linha = previa.data.itens.find((i) => i.productId === migalha.data.id);
  check('0,4 peça vira 1, não zero (não apaga estoque real)', linha.arredondado === 1, linha);

  await req('POST', '/reports/saldos-quebrados/arredondar', { confirmar: true }, token);
  check('o saldo virou 1 no banco', sql(`SELECT quantity FROM stock_items WHERE product_id='${migalha.data.id}' AND warehouse_id='${A.id}'`).startsWith('1'));

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) process.exit(1);
}

main().catch((e) => { console.error('ERRO FATAL', e); process.exit(1); });
