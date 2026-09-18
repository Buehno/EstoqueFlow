// Teste de força: concorrência real (não só volume) nos pontos mais
// arriscados — numeração sequencial (nextNumber) e saldo de estoque sob
// escritas simultâneas. Roda contra o mesmo build local do que está em
// produção.
const BASE = 'http://localhost:8080/api';

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

async function main() {
  const reg = await req('POST', '/auth/register', {
    companyName: 'Teste Forca Ltda', name: 'Owner Forca', email: 'owner@forca.local', password: 'senha12345',
  });
  const token = reg.data.token;
  const wh = (await req('GET', '/warehouses', undefined, token)).data;
  const whA = wh[0];
  const prod = await req('POST', '/products', { name: 'Produto Forca', unit: 'UN', costPrice: 5, salePrice: 10 }, token);
  const produtoId = prod.data.id;
  await req('POST', '/movements/entrada', { productId: produtoId, warehouseId: whA.id, quantity: 10000, unitCost: 5 }, token);

  // ── 1) 50 propostas criadas em paralelo: a numeração sequencial não
  //    pode duplicar nem pular sob concorrência real. ──────────────────
  const N = 50;
  console.log(`Disparando ${N} criações de proposta em paralelo...`);
  const t0 = Date.now();
  const propostas = await Promise.all(
    Array.from({ length: N }, () => req('POST', '/proposals', { clientName: 'Cliente Forca' }, token)),
  );
  const t1 = Date.now();
  const numeros = propostas.map((p) => p.data?.number).filter((n) => n != null);
  const unicos = new Set(numeros);
  console.log(`  ${propostas.filter((p) => p.status === 200 || p.status === 201).length}/${N} sucesso, em ${t1 - t0}ms`);
  console.log(`  números gerados: ${numeros.length}, únicos: ${unicos.size} ${numeros.length === unicos.size ? '(OK, sem duplicata/colisão)' : '(FALHOU: numeração duplicada sob concorrência!)'}`);

  // ── 2) 100 movimentações de saída concorrentes de 1 unidade cada:
  //    saldo final tem que bater exatamente (sem perda por race condition
  //    na leitura+escrita do saldo). ────────────────────────────────────
  const saldoAntes = (await req('GET', `/stock?warehouseId=${whA.id}`, undefined, token)).data
    .find((r) => r.productId === produtoId).quantity;
  const M = 100;
  console.log(`\nSaldo antes: ${saldoAntes}. Disparando ${M} saídas concorrentes de 1 unidade...`);
  const t2 = Date.now();
  const saidas = await Promise.all(
    Array.from({ length: M }, () => req('POST', '/movements/saida', { productId: produtoId, warehouseId: whA.id, quantity: 1, reason: 'forca' }, token)),
  );
  const t3 = Date.now();
  const okSaidas = saidas.filter((s) => s.status === 200 || s.status === 201).length;
  const saldoDepois = (await req('GET', `/stock?warehouseId=${whA.id}`, undefined, token)).data
    .find((r) => r.productId === produtoId).quantity;
  const esperado = saldoAntes - okSaidas;
  console.log(`  ${okSaidas}/${M} saídas aceitas, em ${t3 - t2}ms`);
  console.log(`  saldo depois: ${saldoDepois}, esperado: ${esperado} ${saldoDepois === esperado ? '(OK, saldo consistente sob concorrência)' : '(FALHOU: saldo divergente — possível race condition!)'}`);

  // ── 3) Rajada de leituras (rota mais comum no dia a dia: busca de
  //    produto) — mede throughput/latência sob carga, sem afirmar limite
  //    de capacidade real do Railway (isto roda local). ─────────────────
  const L = 300;
  console.log(`\nRajada de ${L} buscas de produto em paralelo...`);
  const t4 = Date.now();
  const buscas = await Promise.all(Array.from({ length: L }, () => req('GET', '/products/search?q=forca', undefined, token)));
  const t5 = Date.now();
  const okBuscas = buscas.filter((b) => b.status === 200).length;
  console.log(`  ${okBuscas}/${L} OK em ${t5 - t4}ms (${((t5 - t4) / L).toFixed(1)}ms/req em média, tudo em paralelo)`);

  // ── 4) Transferências opostas simultâneas (A->B e B->A) do mesmo
  //    produto: valida que a ordem fixa de lock evita deadlock. ─────────
  const whB = wh[1] ?? (await req('POST', '/warehouses', { code: 'DEP-TESTE', name: 'Depósito Teste' }, token)).data;
  await req('POST', '/movements/entrada', { productId: produtoId, warehouseId: whB.id, quantity: 500, unitCost: 5 }, token);
  console.log('\nDisparando 20 transferências A->B e 20 B->A simultâneas do mesmo produto...');
  const t6 = Date.now();
  const transfs = await Promise.all([
    ...Array.from({ length: 20 }, () => req('POST', '/movements/transferencia', { productId: produtoId, fromWarehouseId: whA.id, toWarehouseId: whB.id, quantity: 1 }, token)),
    ...Array.from({ length: 20 }, () => req('POST', '/movements/transferencia', { productId: produtoId, fromWarehouseId: whB.id, toWarehouseId: whA.id, quantity: 1 }, token)),
  ]);
  const t7 = Date.now();
  const okTransfs = transfs.filter((t) => t.status === 200 || t.status === 201).length;
  const erros = transfs.filter((t) => t.status >= 500);
  console.log(`  ${okTransfs}/40 aceitas em ${t7 - t6}ms, ${erros.length} erro(s) de servidor/deadlock ${erros.length === 0 ? '(OK)' : '(FALHOU)'}`);

  // ── 5) Vendas concorrentes do mesmo produto (PDV real: duas pessoas
  //    vendendo o mesmo item ao mesmo tempo). ───────────────────────────
  console.log('\nDisparando 30 vendas concorrentes de 1 unidade cada...');
  const saldoAntesVenda = (await req('GET', `/stock?warehouseId=${whA.id}`, undefined, token)).data.find((r) => r.productId === produtoId).quantity;
  const t8 = Date.now();
  const vendas = await Promise.all(
    Array.from({ length: 30 }, () => req('POST', '/sales', { warehouseId: whA.id, items: [{ productId: produtoId, quantity: 1, unitPrice: 10 }], paymentMethod: 'DINHEIRO' }, token)),
  );
  const t9 = Date.now();
  const okVendas = vendas.filter((v) => v.status === 200 || v.status === 201).length;
  const saldoDepoisVenda = (await req('GET', `/stock?warehouseId=${whA.id}`, undefined, token)).data.find((r) => r.productId === produtoId).quantity;
  const esperadoVenda = saldoAntesVenda - okVendas;
  console.log(`  ${okVendas}/30 vendas aceitas em ${t9 - t8}ms`);
  console.log(`  saldo depois: ${saldoDepoisVenda}, esperado: ${esperadoVenda} ${saldoDepoisVenda === esperadoVenda ? '(OK, sem perda de baixa concorrente no PDV)' : '(FALHOU: baixa perdida sob concorrência no PDV!)'}`);

  const tudoOk = numeros.length === unicos.size && saldoDepois === esperado && okBuscas === L && okSaidas === M
    && erros.length === 0 && saldoDepoisVenda === esperadoVenda;
  console.log(`\n${tudoOk ? 'TESTE DE FORÇA OK — nenhuma quebra encontrada sob concorrência.' : 'TESTE DE FORÇA ENCONTROU PROBLEMA — ver acima.'}`);
  process.exit(tudoOk ? 0 : 1);
}

main().catch((e) => { console.error('ERRO FATAL', e); process.exit(1); });
