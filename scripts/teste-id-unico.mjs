// Suite do ID único / master data (27/10/2026): prefixo de 3 letras por
// categoria + sequencial, código antigo preservado e achável, produtos novos
// já nascem com o ID, tabelas de fornecedor continuam idempotentes.
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
const ID = /^[A-Z]{3}-\d{5}$/;

async function main() {
  const reg = await req('POST', '/auth/register', { companyName: 'Jundiaquece ID', name: 'Owner', email: 'owner@id.local', password: 'senha12345' });
  const tk = reg.data.token;

  const cat = async (name) => (await req('POST', '/categories', { name }, tk)).data;
  const tubos = await cat('Tubos e conexões');
  const bombas = await cat('Bombas e pressurizadores');
  const geradores = await cat('Geradores de cloro');
  const gerais = (await req('GET', '/categories', undefined, tk)).data.find((c) => c.name === 'Geral'); // criada de fábrica

  // produtos com códigos antigos (JQ-xxxxx, P-xxxxx) e sem categoria
  const jq1 = (await req('POST', '/products', { sku: 'JQ-00001', name: 'Tubo marrom 25 mm', unit: 'UN', categoryId: tubos.id }, tk)).data;
  const jq2 = (await req('POST', '/products', { sku: 'JQ-00002', name: 'Tubo marrom 32 mm', unit: 'UN', categoryId: tubos.id }, tk)).data;
  const bm = (await req('POST', '/products', { sku: 'P-00009', name: 'Bomba 1/2 CV', unit: 'UN', categoryId: bombas.id }, tk)).data;
  const gc = (await req('POST', '/products', { sku: 'JQ-00777', name: 'Gerador THC30', unit: 'UN', categoryId: geradores.id }, tk)).data;
  const gr = (await req('POST', '/products', { sku: 'JQ-00778', name: 'Fita veda rosca', unit: 'UN', categoryId: gerais.id }, tk)).data;
  const semCat = (await req('POST', '/products', { sku: 'JQ-00900', name: 'Item sem categoria', unit: 'UN' }, tk)).data;

  // produto novo sem SKU já nasce com ID único
  const novo = (await req('POST', '/products', { name: 'Tubo marrom 40 mm', unit: 'UN', categoryId: tubos.id }, tk)).data;
  check('produto novo sem código nasce com ID único da categoria (TUB-00001)', novo.sku === 'TUB-00001', novo.sku);
  const novoSem = (await req('POST', '/products', { name: 'Avulso', unit: 'UN' }, tk)).data;
  check('produto novo sem categoria usa GER-', /^GER-\d{5}$/.test(novoSem.sku), novoSem.sku);

  // gerar para todos
  let r = await req('POST', '/products/gerar-ids-unicos', undefined, tk);
  check('gera IDs para os 6 sem formato e mantém os 2 que já tinham', r.status === 200 && r.data.gerados === 6 && r.data.mantidos === 2, r.data);
  const lista = (await req('GET', '/products?take=50', undefined, tk)).data.items;
  const por = Object.fromEntries(lista.map((p) => [p.id, p]));
  check('todos os produtos têm ID no formato AAA-00000', lista.every((p) => ID.test(p.sku)), lista.map((p) => p.sku));
  check('tubos: TUB-00002 e TUB-00003 na sequência depois do TUB-00001', [por[jq1.id].sku, por[jq2.id].sku].sort().join(',') === 'TUB-00002,TUB-00003', [por[jq1.id].sku, por[jq2.id].sku]);
  check('bomba: BOM-00001', por[bm.id].sku === 'BOM-00001', por[bm.id].sku);
  check('"Geradores de cloro" não colide com GER (Geral / sem categoria) e ganha outro prefixo', por[gc.id].sku.slice(0, 3) !== 'GER' && /^[A-Z]{3}-/.test(por[gc.id].sku), por[gc.id].sku);
  check('categoria "Geral" divide o GER com os sem categoria', /^GER-/.test(por[gr.id].sku), por[gr.id].sku);
  check('sem categoria: GER-', /^GER-/.test(por[semCat.id].sku), por[semCat.id].sku);
  check('código antigo preservado em legacySku', por[jq1.id].legacySku === 'JQ-00001' && por[bm.id].legacySku === 'P-00009', [por[jq1.id].legacySku, por[bm.id].legacySku]);
  check('produto que já nasceu com ID não tem legacySku', por[novo.id].legacySku == null, por[novo.id]);

  // idempotente
  r = await req('POST', '/products/gerar-ids-unicos', undefined, tk);
  check('rodar de novo não gera nada', r.data.gerados === 0 && r.data.mantidos === 8, r.data);
  check('categorias ganharam prefixo persistido', r.data.categorias.find((c) => c.name === 'Tubos e conexões')?.codePrefix === 'TUB' && r.data.categorias.find((c) => c.name === 'Bombas e pressurizadores')?.codePrefix === 'BOM', r.data.categorias);

  // busca pelo código antigo e pelo novo
  const b1 = await req('GET', '/products/search?q=JQ-00001', undefined, tk);
  check('busca exata pelo código antigo acha o produto', b1.data.items[0]?.id === jq1.id && b1.data.items[0]?.exato === true, b1.data.items?.[0]?.sku);
  const b2 = await req('GET', `/products/search?q=${por[jq1.id].sku}`, undefined, tk);
  check('busca exata pelo ID novo acha o produto', b2.data.items[0]?.id === jq1.id, b2.data.items?.[0]);
  const b3 = await req('GET', '/products/search?q=jq-00002', undefined, tk);
  check('busca por palavra acha pelo código antigo (minúsculo)', b3.data.items.some((p) => p.id === jq2.id), b3.data.items?.map((p) => p.sku));

  // prefixo editável e único
  r = await req('PATCH', `/categories/${tubos.id}`, { codePrefix: 'bom' }, tk);
  check('prefixo já usado por outra categoria é recusado', r.status === 409, r.data);
  r = await req('PATCH', `/categories/${tubos.id}`, { codePrefix: 'tbc' }, tk);
  check('prefixo pode ser trocado (vira maiúsculo)', r.status === 200 && r.data.codePrefix === 'TBC', r.data);
  const novo2 = (await req('POST', '/products', { name: 'Tubo marrom 50 mm', unit: 'UN', categoryId: tubos.id }, tk)).data;
  check('produto novo na categoria usa o prefixo trocado', novo2.sku === 'TBC-00001', novo2.sku);
  check('IDs antigos TUB- continuam válidos (não são reescritos)', por[jq1.id].sku.startsWith('TUB-'));

  // tabelas de fornecedor continuam idempotentes depois de gerar IDs
  await req('POST', '/products/seed-tabelas-fornecedores', undefined, tk);
  await req('POST', '/products/gerar-ids-unicos', undefined, tk);
  const seed2 = await req('POST', '/products/seed-tabelas-fornecedores', undefined, tk);
  check('seed das tabelas acha os produtos pelo código antigo (não duplica)', seed2.data.criados === 0 && seed2.data.atualizados === 171, seed2.data);
  const total = (await req('GET', '/products?take=500', undefined, tk)).data.total;
  check('total de produtos = 9 + 171', total === 180, total);

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
