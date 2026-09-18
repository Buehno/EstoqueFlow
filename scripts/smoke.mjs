/**
 * Teste de fumaça end-to-end: sobe contra a API já rodando e exercita
 * login → produtos → entrada → transferência → venda → inventário → relatórios.
 * Uso: BASE=http://localhost:8080 node scripts/smoke.mjs
 */
const BASE = process.env.BASE || 'http://localhost:8080';
const EMAIL = process.env.DEMO_EMAIL || 'demo@estoqueflow.app';
const PASS = process.env.DEMO_PASSWORD || 'estoque2026';

let token = '';
let pass = 0;
let fail = 0;

const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✘ ${name}\n      ${e.message}`);
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log(`\nEstoqueFlow · teste de fumaça contra ${BASE}\n`);

await check('GET /health responde ok', async () => {
  const r = await call('GET', '/health');
  assert(r.status === 200 && r.data.status === 'ok', `status ${r.status}`);
});

await check('POST /api/auth/login autentica o usuário demo', async () => {
  const r = await call('POST', '/api/auth/login', { email: EMAIL, password: PASS });
  assert(r.status === 200 && r.data.token, `status ${r.status}: ${JSON.stringify(r.data)}`);
  token = r.data.token;
});

await check('GET /api/auth/me devolve empresa e usuário', async () => {
  const r = await call('GET', '/api/auth/me');
  assert(r.status === 200 && r.data.company?.id, 'sem empresa');
});

await check('GET /api/tutorial devolve os passos do onboarding', async () => {
  const r = await call('GET', '/api/tutorial');
  assert(r.status === 200 && Array.isArray(r.data.steps) && r.data.steps.length >= 10, 'passos ausentes');
});

let warehouses = [];
await check('GET /api/warehouses lista os dois depósitos', async () => {
  const r = await call('GET', '/api/warehouses');
  warehouses = r.data;
  assert(r.status === 200 && warehouses.length >= 2, `${warehouses.length} depósito(s)`);
});

let produto;
await check('GET /api/products lista o catálogo', async () => {
  const r = await call('GET', '/api/products?take=5');
  produto = r.data.items[0];
  assert(r.status === 200 && produto?.id, 'catálogo vazio');
});

await check('GET /api/products/barcode/:code encontra por código de barras', async () => {
  const r = await call('GET', `/api/products/barcode/${produto.barcode ?? produto.sku}`);
  assert(r.status === 200 && r.data.id === produto.id, 'produto divergente');
});

const saldoDe = async (productId, warehouseId) => {
  const r = await call('GET', `/api/stock?warehouseId=${warehouseId}`);
  return r.data.find((s) => s.productId === productId)?.quantity ?? 0;
};

const [dep1, dep2] = warehouses;

await check('POST /api/movements/entrada soma ao saldo', async () => {
  const antes = await saldoDe(produto.id, dep1.id);
  const r = await call('POST', '/api/movements/entrada', {
    productId: produto.id, warehouseId: dep1.id, quantity: 10, unitCost: 5, reason: 'smoke test',
  });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.data)}`);
  const depois = await saldoDe(produto.id, dep1.id);
  assert(Math.round((depois - antes) * 1000) === 10000, `esperado +10, veio ${depois - antes}`);
});

await check('POST /api/movements/saida subtrai do saldo', async () => {
  const antes = await saldoDe(produto.id, dep1.id);
  const r = await call('POST', '/api/movements/saida', {
    productId: produto.id, warehouseId: dep1.id, quantity: 4, reason: 'smoke test',
  });
  assert(r.status === 200, `status ${r.status}`);
  const depois = await saldoDe(produto.id, dep1.id);
  assert(Math.round((antes - depois) * 1000) === 4000, `esperado -4, veio ${antes - depois}`);
});

await check('POST /api/movements/saida bloqueia saldo negativo', async () => {
  const r = await call('POST', '/api/movements/saida', {
    productId: produto.id, warehouseId: dep1.id, quantity: 999999, reason: 'deve falhar',
  });
  assert(r.status === 422, `esperado 422, veio ${r.status}`);
});

await check('POST /api/movements/transferencia move entre os dois depósitos', async () => {
  const a1 = await saldoDe(produto.id, dep1.id);
  const a2 = await saldoDe(produto.id, dep2.id);
  const r = await call('POST', '/api/movements/transferencia', {
    productId: produto.id, fromWarehouseId: dep1.id, toWarehouseId: dep2.id, quantity: 3,
  });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.data)}`);
  const d1 = await saldoDe(produto.id, dep1.id);
  const d2 = await saldoDe(produto.id, dep2.id);
  assert(Math.round((a1 - d1) * 1000) === 3000, 'origem não baixou 3');
  assert(Math.round((d2 - a2) * 1000) === 3000, 'destino não subiu 3');
});

await check('POST /api/movements/transferencia recusa origem = destino', async () => {
  const r = await call('POST', '/api/movements/transferencia', {
    productId: produto.id, fromWarehouseId: dep1.id, toWarehouseId: dep1.id, quantity: 1,
  });
  assert(r.status === 400, `esperado 400, veio ${r.status}`);
});

let vendaId;
await check('POST /api/sales registra venda balcão e baixa o estoque', async () => {
  const antes = await saldoDe(produto.id, dep1.id);
  const r = await call('POST', '/api/sales', {
    warehouseId: dep1.id,
    items: [{ productId: produto.id, quantity: 2 }],
    payment: 'PIX',
  });
  assert(r.status === 200 && r.data.number, `status ${r.status}: ${JSON.stringify(r.data)}`);
  vendaId = r.data.id;
  const depois = await saldoDe(produto.id, dep1.id);
  assert(Math.round((antes - depois) * 1000) === 2000, `esperado -2, veio ${antes - depois}`);
});

await check('POST /api/sales/:id/cancel devolve ao estoque', async () => {
  const antes = await saldoDe(produto.id, dep1.id);
  const r = await call('POST', `/api/sales/${vendaId}/cancel`, { reason: 'smoke test' });
  assert(r.status === 200, `status ${r.status}`);
  const depois = await saldoDe(produto.id, dep1.id);
  assert(Math.round((depois - antes) * 1000) === 2000, 'estoque não voltou');
});

await check('POST /api/movements/ajuste acerta o saldo para o valor contado', async () => {
  const r = await call('POST', '/api/movements/ajuste', {
    productId: produto.id, warehouseId: dep2.id, newQuantity: 77, reason: 'smoke test',
  });
  assert(r.status === 200, `status ${r.status}`);
  const saldo = await saldoDe(produto.id, dep2.id);
  assert(Math.round(saldo) === 77, `esperado 77, veio ${saldo}`);
});

let countId;
await check('POST /api/counts abre uma contagem com o saldo esperado', async () => {
  const r = await call('POST', '/api/counts', { warehouseId: dep2.id, name: 'Smoke test' });
  assert(r.status === 200 && r.data.id, `status ${r.status}`);
  countId = r.data.id;
});

await check('PATCH /api/counts/:id/items lança a quantidade contada', async () => {
  const r = await call('PATCH', `/api/counts/${countId}/items`, { productId: produto.id, counted: 70 });
  assert(r.status === 200, `status ${r.status}`);
});

await check('POST /api/counts/:id/apurar calcula a divergência', async () => {
  const r = await call('POST', `/api/counts/${countId}/apurar`);
  assert(r.status === 200 && r.data.divergencias.length === 1, 'divergência não apurada');
  assert(r.data.divergencias[0].diff === -7, `esperado -7, veio ${r.data.divergencias[0].diff}`);
});

await check('POST /api/counts/:id/aplicar ajusta o estoque', async () => {
  const r = await call('POST', `/api/counts/${countId}/aplicar`);
  assert(r.status === 200 && r.data.ajustados === 1, 'nenhum ajuste aplicado');
  const saldo = await saldoDe(produto.id, dep2.id);
  assert(Math.round(saldo) === 70, `esperado 70, veio ${saldo}`);
});

await check('GET /api/reports/dashboard traz os KPIs', async () => {
  const r = await call('GET', '/api/reports/dashboard');
  assert(r.status === 200 && r.data.depositos.length >= 2, 'dashboard incompleto');
  assert(typeof r.data.valorTotalEstoque === 'number', 'sem valor de estoque');
});

await check('GET /api/reports/abc devolve a curva ABC', async () => {
  const r = await call('GET', '/api/reports/abc?dias=90');
  assert(r.status === 200 && Array.isArray(r.data), 'ABC inválida');
});

await check('GET /api/reports/giro devolve giro e cobertura', async () => {
  const r = await call('GET', '/api/reports/giro?dias=90');
  assert(r.status === 200 && Array.isArray(r.data), 'giro inválido');
});

await check('GET /api/reports/export/estoque devolve CSV', async () => {
  const res = await fetch(`${BASE}/api/reports/export/estoque`, { headers: { Authorization: `Bearer ${token}` } });
  const txt = await res.text();
  assert(res.status === 200 && txt.includes('SKU'), 'CSV inválido');
});

await check('GET /api/sync/status informa o estado da planilha espelho', async () => {
  const r = await call('GET', '/api/sync/status');
  assert(r.status === 200 && 'habilitado' in r.data, 'status ausente');
});

await check('rotas protegidas exigem token', async () => {
  const saved = token;
  token = '';
  const r = await call('GET', '/api/products');
  token = saved;
  assert(r.status === 401, `esperado 401, veio ${r.status}`);
});

await check('isolamento multi-tenant: nova empresa nasce sem dados da outra', async () => {
  const email = `t${Date.now()}@teste.com`;
  const reg = await call('POST', '/api/auth/register', {
    companyName: 'Empresa Teste', name: 'Teste', email, password: 'senha12345',
  });
  assert(reg.status === 200 && reg.data.token, `status ${reg.status}`);
  const saved = token;
  token = reg.data.token;
  const prods = await call('GET', '/api/products');
  const whs = await call('GET', '/api/warehouses');
  token = saved;
  assert(prods.data.total === 0, `vazou ${prods.data.total} produto(s) entre empresas`);
  assert(whs.data.length === 2, 'depósitos padrão não criados');
});

console.log(`\n${pass} teste(s) OK · ${fail} falha(s)\n`);
process.exit(fail ? 1 : 0);
