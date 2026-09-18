/**
 * Teste de fumaça do módulo de propostas: modelo → proposta → itens (com a
 * trava de estoque) → status → exportação em PDF/Word/Excel.
 */
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const EMAIL = process.env.EMAIL || 'ronaldo.bueno@iagentics.com.br';
const SENHA = process.env.SENHA || 'Buh@1202';
const DIR = process.env.DIR || '/tmp';

let token = '';
let pass = 0, fail = 0;

const call = async (m, p, b) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(b ? { body: JSON.stringify(b) } : {}),
  });
  const t = await res.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: res.status, data: d };
};
const ok = (c, m) => { if (!c) throw new Error(m); };
async function check(nome, fn) {
  try { await fn(); pass++; console.log(`  ✔ ${nome}`); }
  catch (e) { fail++; console.log(`  ✘ ${nome}\n      ${e.message}`); }
}

console.log(`\nPropostas · teste de fumaça contra ${BASE}\n`);

await check('login', async () => {
  const r = await call('POST', '/auth/login', { email: EMAIL, password: SENHA });
  ok(r.status === 200 && r.data.token, JSON.stringify(r.data).slice(0, 200));
  token = r.data.token;
});

let comEstoque, semEstoque;
await check('separa um produto COM saldo e um SEM saldo', async () => {
  const r = await call('GET', '/products?take=400');
  const itens = r.data.items;
  comEstoque = itens.find((p) => (p.totalStock ?? 0) >= 3);
  semEstoque = itens.find((p) => (p.totalStock ?? 0) === 0);
  ok(comEstoque, 'nenhum produto com saldo');
  ok(semEstoque, 'nenhum produto zerado');
});

let modeloId;
await check('POST /proposal-templates cria o modelo', async () => {
  const r = await call('POST', '/proposal-templates', {
    name: `Solar Casa Solis 400AP ${Date.now()}`,
    scopeTitle: 'SISTEMA DE AQUECIMENTO VIA SOLAR PARA A ÁGUA DA CASA. FABRICANTE: SOLIS',
    paymentTerms: 'R$ 25.239,00 - podendo ser parcelado em até 10x’s sem juros nos cartões Master / Visa.',
    paymentCash: 'R$ 24.400,00 - para pagamento a vista.',
    deliveryTerms: '15 a 20 dias úteis a partir da data do pedido',
    validityDays: 10,
    salesRep: 'SIMONE SALMAZO',
    footerNote: 'NBR 9575 - Esta Norma estabelece as exigências e recomendações relativas à seleção e projeto de impermeabilização.',
    items: [
      { quantity: 1, quantityText: '01', description: 'Reservatório solar tipo boiler Alta Pressão – 400 Litros – Aço 304:\n- Maior espessura de chapa do mercado.\n– Garantia de fábrica de 05 anos', unitPrice: 7600, total: 7600 },
      { quantity: 1, quantityText: '*', description: 'Mão de obra para instalação e interligação do sistema acima descrito.', unitPrice: 2500, total: 2500 },
    ],
  });
  ok(r.status === 200 && r.data.id, JSON.stringify(r.data).slice(0, 200));
  modeloId = r.data.id;
});

let propostaId, numero;
await check('POST /proposals cria a partir do modelo e já traz os itens', async () => {
  const r = await call('POST', '/proposals', {
    templateId: modeloId,
    clientName: 'SRº FABIO',
    clientPhone: '(11) 98245-7947',
    clientLocal: 'RESERVA DA MATA - JUNDIAÍ / SP',
  });
  ok(r.status === 200, JSON.stringify(r.data).slice(0, 200));
  ok(r.data.items.length === 2, `esperado 2 itens, veio ${r.data.items.length}`);
  ok(r.data.total === 10100, `total ${r.data.total}`);
  ok(/dez mil e cem reais/i.test(r.data.totalInWords), `extenso: ${r.data.totalInWords}`);
  propostaId = r.data.id; numero = r.data.number;
});

await check('cria a pasta do cliente automaticamente', async () => {
  const r = await call('GET', '/proposals/clientes');
  const pasta = r.data.find((p) => p.cliente === 'SRº FABIO');
  ok(pasta, 'pasta do cliente não criada');
  ok(pasta.propostas.length >= 1, 'pasta sem propostas');
});

await check('PUT itens aceita item livre + item do estoque com saldo', async () => {
  const r = await call('PUT', `/proposals/${propostaId}/itens`, {
    items: [
      { quantity: 1, quantityText: '01', description: 'Reservatório solar 400L', unitPrice: 7600, total: 7600 },
      { quantity: 2, quantityText: '02', description: comEstoque.name, unitPrice: 300, total: 600, productId: comEstoque.id },
      { quantity: 1, quantityText: '*', description: 'Mão de obra', unitPrice: 2500, total: 2500 },
    ],
  });
  ok(r.status === 200, JSON.stringify(r.data).slice(0, 260));
  ok(r.data.total === 10700, `total ${r.data.total}`);
  ok(r.data.items[1].stockAtInsert > 0, 'não guardou o saldo do momento');
});

await check('PUT itens BLOQUEIA produto sem estoque', async () => {
  const r = await call('PUT', `/proposals/${propostaId}/itens`, {
    items: [{ quantity: 5, description: semEstoque.name, unitPrice: 100, total: 500, productId: semEstoque.id }],
  });
  ok(r.status === 422, `esperado 422, veio ${r.status}`);
  ok(Array.isArray(r.data.details) && r.data.details.length === 1, 'não detalhou o item sem saldo');
  ok(r.data.details[0].disponivel === 0, 'disponível deveria ser 0');
});

await check('itens continuam intactos após a tentativa bloqueada', async () => {
  const r = await call('GET', `/proposals/${propostaId}`);
  ok(r.data.items.length === 3, `esperado 3 itens, veio ${r.data.items.length}`);
  ok(r.data.total === 10700, `total ${r.data.total}`);
});

await check('PUT itens bloqueia quantidade acima do saldo', async () => {
  const r = await call('PUT', `/proposals/${propostaId}/itens`, {
    items: [{ quantity: 999999, description: comEstoque.name, unitPrice: 10, total: 10, productId: comEstoque.id }],
  });
  ok(r.status === 422, `esperado 422, veio ${r.status}`);
});

await check('GET /disponibilidade confirma que está tudo certo', async () => {
  const r = await call('GET', `/proposals/${propostaId}/disponibilidade`);
  ok(r.status === 200 && r.data.ok === true, JSON.stringify(r.data).slice(0, 200));
  ok(r.data.itensVinculados === 1 && r.data.itensLivres === 2, JSON.stringify(r.data));
});

await check('PATCH edita cabeçalho e recalcula validade', async () => {
  const r = await call('PATCH', `/proposals/${propostaId}`, { discount: 700, validityDays: 15, cashTotal: 9500 });
  ok(r.status === 200, JSON.stringify(r.data).slice(0, 200));
  ok(r.data.total === 10000, `total com desconto: ${r.data.total}`);
  ok(/dez mil reais/i.test(r.data.totalInWords), `extenso: ${r.data.totalInWords}`);
  ok(r.data.validityDays === 15, 'validade não atualizou');
});

await check('status → ENVIADA registra a data de envio', async () => {
  const r = await call('POST', `/proposals/${propostaId}/status`, { status: 'ENVIADA', message: 'Enviada por WhatsApp' });
  ok(r.status === 200 && r.data.status === 'ENVIADA', JSON.stringify(r.data).slice(0, 200));
  ok(r.data.sentAt, 'sentAt não gravado');
});

await check('retorno do cliente entra na linha do tempo', async () => {
  const r = await call('POST', `/proposals/${propostaId}/eventos`, {
    type: 'RETORNO_CLIENTE',
    message: 'Cliente pediu desconto e prazo maior',
    followUpAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  });
  ok(r.status === 200, JSON.stringify(r.data).slice(0, 200));
  ok(r.data.respondedAt, 'respondedAt não gravado');
  ok(r.data.events.some((e) => e.type === 'RETORNO_CLIENTE'), 'evento não registrado');
});

await check('funil soma valores por estágio', async () => {
  const r = await call('GET', '/proposals/resumo');
  ok(r.status === 200, JSON.stringify(r.data).slice(0, 200));
  ok(r.data.totalAberto >= 10000, `aberto: ${r.data.totalAberto}`);
});

for (const [fmt, assinatura] of [['pdf', '%PDF'], ['docx', 'PK'], ['xlsx', 'PK']]) {
  await check(`exporta em ${fmt.toUpperCase()}`, async () => {
    const res = await fetch(`${BASE}/api/proposals/${propostaId}/export/${fmt}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    ok(res.status === 200, `status ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    ok(buf.length > 5000, `arquivo pequeno demais: ${buf.length} bytes`);
    ok(buf.subarray(0, assinatura.length).toString('latin1') === assinatura, 'assinatura do arquivo não confere');
    const cd = res.headers.get('content-disposition') ?? '';
    ok(/PROPOSTA-\d{4}-/.test(cd), `nome do arquivo: ${cd}`);
    writeFileSync(`${DIR}/proposta-${numero}.${fmt}`, buf);
  });
}

await check('duplicar gera nova proposta em rascunho', async () => {
  const r = await call('POST', `/proposals/${propostaId}/duplicar`);
  ok(r.status === 200 && r.data.status === 'RASCUNHO', JSON.stringify(r.data).slice(0, 200));
  ok(r.data.number !== numero, 'número repetido');
  ok(r.data.items.length === 3, 'itens não copiados');
});

await check('salvar como modelo cria um novo template', async () => {
  const r = await call('POST', `/proposals/${propostaId}/salvar-como-modelo`, { name: `Modelo do Fabio ${Date.now()}` });
  ok(r.status === 200 && r.data.items.length === 3, JSON.stringify(r.data).slice(0, 200));
});

await check('proposta ACEITA fica travada para edição', async () => {
  await call('POST', `/proposals/${propostaId}/status`, { status: 'ACEITA' });
  const r = await call('PUT', `/proposals/${propostaId}/itens`, { items: [] });
  ok(r.status === 422, `esperado 422, veio ${r.status}`);
});

await check('outra empresa não enxerga a proposta', async () => {
  const email = `p${Date.now()}@teste.com`;
  const reg = await call('POST', '/auth/register', { companyName: 'Outra Cia', name: 'Teste Isolamento', email, password: 'senha12345' });
  const meu = token; token = reg.data.token;
  const r = await call('GET', `/proposals/${propostaId}`);
  const lista = await call('GET', '/proposals');
  token = meu;
  ok(r.status === 404, `vazou a proposta: ${r.status}`);
  ok(lista.data.total === 0, `vazou ${lista.data.total} proposta(s)`);
});

console.log(`\n${pass} teste(s) OK · ${fail} falha(s)\n`);
process.exit(fail ? 1 : 0);
