// Suite barra × metro (27/10/2026) — regra do §4 do plano: peças inteiras +
// sobra em metros por depósito; sobras se acumulam e fecham peça; saldo
// sempre em m e cm; movimentações em peças ou em metros; PDV por metragem.
const BASE = process.env.BASE || 'http://localhost:8080/api';
let passou = 0, falhou = 0;
const falhas = [];
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
  else { falhou++; falhas.push(nome); console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
const perto = (a, b) => Math.abs(a - b) < 0.0011;

async function main() {
  const reg = await req('POST', '/auth/register', { companyName: 'Jundiaquece Barra', name: 'Owner', email: 'owner@barra.local', password: 'senha12345' });
  const tk = reg.data.token;
  const wh = (await req('GET', '/warehouses', undefined, tk)).data;
  const [A, B] = wh;

  // ── famílias padrão ──────────────────────────────────────────────
  const cobre = (await req('POST', '/products', { name: 'Tubo de cobre 22 mm', unit: 'BR', salePrice: 250 }, tk)).data;
  const marrom = (await req('POST', '/products', { name: 'Tubo marrom 25 mm', unit: 'BR' }, tk)).data;
  const eluma = (await req('POST', '/products', { name: 'Elumaflex 1/2"', unit: 'RL' }, tk)).data;
  const cotovelo = (await req('POST', '/products', { name: 'Cotovelo de cobre 22 mm', unit: 'UN' }, tk)).data;
  const jaTem = (await req('POST', '/products', { name: 'Tubo PPR 20 mm', unit: 'BR', packType: 'BARRA', packLength: 4 }, tk)).data;
  const fam = await req('POST', '/products/aplicar-embalagens-padrao', undefined, tk);
  check('famílias padrão aplicadas (cobre 5 m, marrom 6 m, elumaflex rolo 2 m)', fam.status === 200 && fam.data.total === 3, fam.data);
  const lista = (await req('GET', '/products?take=50', undefined, tk)).data.items;
  const porId = Object.fromEntries(lista.map((p) => [p.id, p]));
  check('tubo de cobre virou BARRA de 5 m', porId[cobre.id].packType === 'BARRA' && porId[cobre.id].packLength === 5, porId[cobre.id]);
  check('tubo marrom virou BARRA de 6 m', porId[marrom.id].packType === 'BARRA' && porId[marrom.id].packLength === 6);
  check('elumaflex virou ROLO de 2 m', porId[eluma.id].packType === 'ROLO' && porId[eluma.id].packLength === 2);
  check('cotovelo de cobre NÃO ganhou embalagem (não é tubo)', porId[cotovelo.id].packType == null);
  check('produto que já tinha embalagem não foi sobrescrito (PPR 4 m)', porId[jaTem.id].packLength === 4);
  check('rodar de novo não muda nada', (await req('POST', '/products/aplicar-embalagens-padrao', undefined, tk)).data.total === 0);

  // ── entradas: peças e metros ─────────────────────────────────────
  let r = await req('POST', '/movements/entrada', { productId: cobre.id, warehouseId: A.id, quantity: 2 }, tk);
  check('entrada de 2 barras inteiras', r.status === 200 && r.data.quantity === '2' || Number(r.data.quantity) === 2, r.data);
  r = await req('POST', '/movements/entrada', { productId: cobre.id, warehouseId: A.id, meters: 3 }, tk);
  check('entrada de 3 m não fecha barra: 0 peça a mais, sobra 3 m', Number(r.data.quantity) === 0 && Number(r.data.meters) === 3 && Number(r.data.remnantTo) === 3, r.data);
  const pos = async (id, w) => (await req('GET', `/stock?warehouseId=${w}`, undefined, tk)).data.find((x) => x.productId === id);
  let p = await pos(cobre.id, A.id);
  check('posição: 2 inteiras + 3 m em aberto = 3 barras contadas, total 13 m (1.300 cm)',
    p.quantity === 2 && p.embalagem.pecasInteiras === 2 && perto(p.embalagem.sobraM, 3) && p.embalagem.pecasContadas === 3 && perto(p.embalagem.totalM, 13), p.embalagem);
  check('texto da posição traz m e cm lado a lado', /3 m \(300 cm\)/.test(p.embalagem.sobra) && /13 m \(1\.300 cm\)/.test(p.embalagem.total), p.embalagem);

  // sobras se acumulam: +2 m → 5 m fecha 1 barra, sobra 0
  r = await req('POST', '/movements/entrada', { productId: cobre.id, warehouseId: A.id, meters: 2 }, tk);
  check('+2 m fecha uma barra (3 + 2 = 5): movimento registra +1 peça e sobra 0', Number(r.data.quantity) === 1 && Number(r.data.remnantTo) === 0, r.data);
  p = await pos(cobre.id, A.id);
  check('posição: 3 inteiras, sobra 0, total 15 m', p.quantity === 3 && perto(p.embalagem.sobraM, 0) && perto(p.embalagem.totalM, 15), p.embalagem);
  // 2 + 2 + 1,2 = 5,2 → fecha 1, sobra 0,2
  for (const m of [2, 2, 1.2]) await req('POST', '/movements/entrada', { productId: cobre.id, warehouseId: A.id, meters: m }, tk);
  p = await pos(cobre.id, A.id);
  check('restos 2 + 2 + 1,2 = 5,2 m → +1 barra fechada, 0,2 m (20 cm) em aberto', p.quantity === 4 && perto(p.embalagem.sobraM, 0.2) && /0,2 m \(20 cm\)/.test(p.embalagem.sobra), p.embalagem);

  // ── saídas em metros ─────────────────────────────────────────────
  r = await req('POST', '/movements/saida', { productId: cobre.id, warehouseId: A.id, meters: 0.1 }, tk);
  check('saída de 0,1 m sai da sobra, sem abrir barra', Number(r.data.quantity) === 0 && perto(Number(r.data.remnantFrom), 0.1), r.data);
  r = await req('POST', '/movements/saida', { productId: cobre.id, warehouseId: A.id, meters: 2 }, tk);
  check('saída de 2 m com 0,1 de sobra abre 1 barra: sobra vira 3,1 m', Number(r.data.quantity) === 1 && perto(Number(r.data.remnantFrom), 3.1), r.data);
  p = await pos(cobre.id, A.id);
  check('posição: 3 inteiras + 3,1 m = 4 barras contadas, total 18,1 m', p.quantity === 3 && perto(p.embalagem.sobraM, 3.1) && p.embalagem.pecasContadas === 4 && perto(p.embalagem.totalM, 18.1), p.embalagem);
  r = await req('POST', '/movements/saida', { productId: cobre.id, warehouseId: A.id, meters: 12 }, tk);
  check('saída de 12 m abre 2 barras (3,1 + 10 = 13,1 → sobra 1,1)', Number(r.data.quantity) === 2 && perto(Number(r.data.remnantFrom), 1.1), r.data);
  r = await req('POST', '/movements/saida', { productId: cobre.id, warehouseId: A.id, meters: 100 }, tk);
  check('saída maior que a metragem total é recusada com o resumo', r.status === 422 && /Metragem insuficiente/.test(r.data.error) && /em aberto/.test(r.data.error), r.data);
  r = await req('POST', '/movements/saida', { productId: cobre.id, warehouseId: A.id, quantity: 1.5 }, tk);
  check('peça quebrada é recusada (ou inteira, ou em metros)', r.status === 400, r.data);
  r = await req('POST', '/movements/saida', { productId: cobre.id, warehouseId: A.id, quantity: 1 }, tk);
  check('saída de 1 barra inteira mantém a sobra', Number(r.data.quantity) === 1 && perto(Number(r.data.remnantFrom), 1.1), r.data);

  // ── transferência em metros ──────────────────────────────────────
  // A: 0 inteiras? vejamos: 3 - 2 - 1 = 0 inteiras, sobra 1,1. Entra mais 2 barras.
  await req('POST', '/movements/entrada', { productId: cobre.id, warehouseId: A.id, quantity: 2 }, tk);
  r = await req('POST', '/movements/transferencia', { productId: cobre.id, fromWarehouseId: A.id, toWarehouseId: B.id, meters: 6 }, tk);
  check('transferência de 6 m', r.status === 200 && Number(r.data.meters) === 6, r.data);
  const pa = await pos(cobre.id, A.id), pb = await pos(cobre.id, B.id);
  check('origem: 1,1 + 10 (2 barras) − 6 = 5,1 m → 1 inteira + 0,1 m', pa.quantity === 1 && perto(pa.embalagem.sobraM, 0.1), pa.embalagem);
  check('destino: 6 m = 1 inteira + 1 m', pb.quantity === 1 && perto(pb.embalagem.sobraM, 1), pb.embalagem);
  check('metragem total se conserva (5,1 + 6 = 11,1)', perto(pa.embalagem.totalM + pb.embalagem.totalM, 11.1));

  // ── estorno em metros ────────────────────────────────────────────
  const est = await req('POST', `/movements/${r.data.id}/estorno`, {}, tk);
  check('estorno da transferência em metros', est.status === 200, est.data);
  const pa2 = await pos(cobre.id, A.id), pb2 = await pos(cobre.id, B.id);
  check('estorno devolve a metragem: origem 11,1 m, destino 0', perto(pa2.embalagem.totalM, 11.1) && perto(pb2.embalagem.totalM, 0), [pa2.embalagem, pb2.embalagem]);

  // ── ajuste com sobra ─────────────────────────────────────────────
  r = await req('POST', '/movements/ajuste', { productId: cobre.id, warehouseId: A.id, newQuantity: 2, newRemnantMeters: 7.5, reason: 'contagem' }, tk);
  check('ajuste 2 inteiras + 7,5 m normaliza para 3 inteiras + 2,5 m', r.status === 200, r.data);
  p = await pos(cobre.id, A.id);
  check('posição após ajuste: 3 + 2,5 m (250 cm)', p.quantity === 3 && perto(p.embalagem.sobraM, 2.5) && /250 cm/.test(p.embalagem.sobra), p.embalagem);

  // ── PDV por metragem ─────────────────────────────────────────────
  const venda = await req('POST', '/sales', { warehouseId: A.id, items: [{ productId: cobre.id, meters: 4 }], payment: 'DINHEIRO' }, tk);
  check('venda de 4 m no balcão', venda.status === 200 || venda.status === 201, venda.data);
  const item = venda.data.items?.[0];
  check('preço por metro = preço da barra ÷ 5 (250/5 = 50) → total 200', item && perto(Number(item.unitPrice), 50) && perto(Number(item.total), 200), item);
  p = await pos(cobre.id, A.id);
  check('estoque após a venda: 17,5 − 4 = 13,5 m (2 inteiras + 3,5 m)', perto(p.embalagem.totalM, 13.5) && p.quantity === 2 && perto(p.embalagem.sobraM, 3.5), p.embalagem);
  const canc = await req('POST', `/sales/${venda.data.id ?? venda.data.sale?.id}/cancel`, {}, tk);
  check('cancelamento da venda', canc.status === 200, canc.data);
  p = await pos(cobre.id, A.id);
  check('cancelar devolve os 4 m: volta a 17,5 m (3 + 2,5)', perto(p.embalagem.totalM, 17.5) && p.quantity === 3, p.embalagem);

  // ── busca e produto comum intactos ───────────────────────────────
  const busca = await req('GET', '/products/search?q=tubo%20cobre', undefined, tk);
  const b = busca.data.items.find((x) => x.id === cobre.id);
  check('busca traz a embalagem com peças, sobra e total em m/cm', b && b.packType === 'BARRA' && b.embalagem && /m \(/.test(b.embalagem.descricao), b);
  r = await req('POST', '/movements/entrada', { productId: cotovelo.id, warehouseId: A.id, quantity: 10 }, tk);
  check('produto comum continua em unidades', r.status === 200 && Number(r.data.quantity) === 10 && r.data.meters == null, r.data);
  r = await req('POST', '/movements/entrada', { productId: cotovelo.id, warehouseId: A.id, meters: 3 }, tk);
  check('metros num produto sem embalagem é ignorado/recusado (quantidade zero)', r.status === 400, r.data);

  const movs = await req('GET', '/movements?take=5', undefined, tk);
  check('histórico expõe a metragem do lançamento', movs.data.items.some((m) => m.meters != null), movs.data.items?.[0]);

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
