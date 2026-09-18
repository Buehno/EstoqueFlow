/**
 * Cadastra os modelos de proposta da Jundiaquece a partir dos documentos que a
 * empresa já usa. Idempotente: se o modelo já existir pelo nome, não duplica.
 *
 *   BASE=... EMAIL=... SENHA=... node scripts/modelos-jundiaquece.mjs
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL || 'ronaldo.bueno@iagentics.com.br';
const SENHA = process.env.SENHA || 'Buh@1202';

const FECHAMENTO =
  'Sem mais para o momento nos colocamos a inteira disposição.\nAntecipadamente gratos.\nAtenciosamente,';
const NBR =
  'NBR 9575 - Esta Norma estabelece as exigências e recomendações relativas à seleção e projeto de ' +
  'impermeabilização, para que sejam atendidos os requisitos mínimos de proteção da construção contra a ' +
  'passagem de fluidos, bem como os requisitos de salubridade, segurança e conforto do usuário, de forma ' +
  'a ser garantida a estanqueidade dos elementos construtivos que a requeiram.';

const itensCasa = JSON.parse(readFileSync('/tmp/itens-solar-casa.json', 'utf8'));

const MODELOS = [
  {
    name: 'Solar Casa — Solis 400AP',
    scopeTitle: 'SISTEMA DE AQUECIMENTO VIA SOLAR PARA A ÁGUA DA CASA. FABRICANTE: SOLIS',
    paymentTerms: 'R$ 25.239,00 - podendo ser parcelado em até 10x’s sem juros nos cartões Master / Visa.',
    paymentCash: 'R$ 24.400,00 - para pagamento a vista.',
    deliveryTerms: '15 a 20 dias úteis a partir da data do pedido',
    validityDays: 10,
    closingNote: FECHAMENTO,
    footerNote: NBR,
    salesRep: 'SIMONE SALMAZO',
    city: 'Jundiaí',
    items: itensCasa,
  },
  {
    name: 'Solar Piscina — Coletores em polipropileno',
    scopeTitle: 'SISTEMA DE AQUECIMENTO SOLAR PARA PISCINA',
    paymentTerms: 'R$ 9.897,00 - parcelado em até 10x’s sem juros, nos cartões Visa e Master.',
    paymentCash: 'R$ 9.490,00 - para pagamento a vista.',
    deliveryTerms: '10 a 15 dias úteis a partir da data do pedido',
    validityDays: 10,
    closingNote: FECHAMENTO,
    salesRep: 'Simone Salmazo',
    city: 'Jundiaí',
    items: [
      {
        quantityText: '01', quantity: 1, unitPrice: 3612, total: 3612,
        description:
          'Coletores solares confeccionados em polipropileno, com proteção UV — classificação A no INMETRO. ' +
          'Garantia de fábrica de 10 anos.\n' +
          '- Fabricado com material atóxico, que não reage com os produtos químicos do tratamento da piscina;\n' +
          '- Tamanhos adaptáveis à necessidade de cada cliente;\n' +
          '- Altamente resistente, com a melhor tecnologia em matéria-prima e aditivos anti-UV;\n' +
          '- Vida útil longa, sem perder a cor, e baixa manutenção;\n' +
          '- Grande área de absorção de energia solar;\n' +
          '- Pigmentação resistente aos raios ultravioletas;\n' +
          '- Resistência à pressão até 40 mca.',
      },
      {
        quantityText: '01', quantity: 1, unitPrice: 400, total: 400,
        description:
          'Kit em polipropileno para a instalação e interligação dos coletores solares, contendo: ' +
          'abraçadeiras, adaptadores, tampões e válvula.',
      },
      { quantityText: '01', quantity: 1, unitPrice: 250, total: 250, description: 'Cantoneira em alumínio para fixação dos coletores no telhado.' },
      { quantityText: '01', quantity: 1, unitPrice: 1650, total: 1650, description: 'Bomba com pré-filtro, de 3/4 CV – Syllent.' },
      { quantityText: '01', quantity: 1, unitPrice: 650, total: 650, description: 'Quadro de comando digital para automatização do sistema.' },
      { quantityText: '01', quantity: 1, unitPrice: 335, total: 335, description: 'Manta térmica para piscina de 5,10 x 2,60.' },
      {
        quantityText: '01', quantity: 1, unitPrice: 1200, total: 1200,
        description:
          'Kit material hidráulico (tubos, registros e conexões) para instalação e interligação do sistema ' +
          'acima descrito, considerando feita toda a infra hidráulica e elétrica da casa de máquinas até o telhado.',
      },
      {
        quantityText: '*', quantity: 1, unitPrice: 1800, total: 1800,
        description:
          'Mão de obra para instalação e interligação do sistema acima descrito, considerando feita toda a ' +
          'infra hidráulica e elétrica da casa de máquinas até o telhado.',
      },
    ],
  },
];

let token = '';
const api = async (m, p, b) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(b ? { body: JSON.stringify(b) } : {}),
  });
  const t = await res.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!res.ok) throw new Error(`${m} ${p} → ${res.status}: ${JSON.stringify(d).slice(0, 240)}`);
  return d;
};

token = (await api('POST', '/auth/login', { email: EMAIL, password: SENHA })).token;
const existentes = await api('GET', '/proposal-templates');

for (const modelo of MODELOS) {
  const jaTem = existentes.find((t) => t.name === modelo.name);
  if (jaTem) {
    await api('PATCH', `/proposal-templates/${jaTem.id}`, modelo);
    console.log(`↻ atualizado: ${modelo.name} — ${modelo.items.length} itens`);
  } else {
    const criado = await api('POST', '/proposal-templates', modelo);
    console.log(`+ criado: ${modelo.name} — ${criado.items.length} itens`);
  }
}

const fim = await api('GET', '/proposal-templates');
console.log('\nModelos disponíveis:');
for (const t of fim) {
  console.log(`  ${t.name.padEnd(46)} ${String(t.items.length).padStart(2)} itens   R$ ${t.valorBase.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
}
