#!/usr/bin/env node
/**
 * SÓ LEITURA — confere se a limpeza de 09/11/2026 foi aplicada:
 *   - nenhuma proposta no sistema;
 *   - nenhuma das 7 peças em duplicidade (ativa ou desativada);
 *   - aviso NBR 9575 nos modelos de sistema solar residência.
 * Não altera nada.
 *
 * PowerShell:
 *   $env:SENHA = "sua senha"
 *   node conferir-limpeza.mjs
 */
const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL || 'ronaldo.bueno@iagentics.com.br';
const SENHA = process.env.SENHA;
if (!SENHA) { console.error('\nFalta a senha. Rode antes:  $env:SENHA = "sua senha"\n'); process.exit(1); }

const PECAS = [
  { nome: 'Registro esfera de 1/2 - ALAVANCA - F/F - GAS', busca: 'registro esfera' },
  { nome: 'Niple metal 1/2', busca: 'niple' },
  { nome: 'TE Marrom Redutor - 32 × 25', busca: 'redutor' },
  { nome: 'Adaptador Solis - piscina', busca: 'adaptador solis' },
  { nome: 'Filtro de linha 1"', busca: 'filtro' },
  { nome: 'Filtro de linha 1/2"', busca: 'filtro' },
  { nome: 'Filtro de linha 3/4"', busca: 'filtro' },
];
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/×/g, 'x').replace(/[^a-z0-9/"]+/g, ' ').trim();

let token;
const api = async (method, rota, body) => {
  const res = await fetch(`${BASE}/api${rota}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = txt; }
  if (!res.ok) throw new Error(`${res.status}: ${data?.message ?? String(txt).slice(0, 200)}`);
  return data;
};

try { token = (await api('POST', '/auth/login', { email: EMAIL, password: SENHA })).token; }
catch (e) { console.error(`✘ Login recusado (${e.message}).`); process.exit(1); }

let tudoOk = true;

// propostas
const { total: nProp, items: props } = await api('GET', '/proposals?take=200');
if (nProp === 0) console.log('\n✔ Propostas: nenhuma no sistema.');
else {
  tudoOk = false;
  console.log(`\n✘ Propostas: ainda há ${nProp}.`);
  for (const p of props.slice(0, 20)) console.log(`   #${String(p.number).padStart(4, '0')}  ${p.vendedor}  ${p.status}  ${p.clientName}`);
}

// peças
const sobraram = [];
for (const alvo of PECAS) {
  const { items } = await api('GET', `/products?take=500&search=${encodeURIComponent(alvo.busca)}`);
  for (const p of items) if (norm(p.name) === norm(alvo.nome)) sobraram.push(p);
}
if (!sobraram.length) console.log('✔ Peças em duplicidade: as 7 foram excluídas.');
else {
  tudoOk = false;
  console.log(`✘ Peças em duplicidade: ainda há ${sobraram.length} cadastro(s):`);
  for (const p of sobraram) console.log(`   [${p.sku}] ${p.name} — ${p.active ? 'ATIVO' : 'desativado (não excluído)'}`);
}

// aviso NBR
const modelos = (await api('GET', '/proposal-templates')).filter((t) => {
  const x = norm(`${t.name} ${t.scopeTitle}`);
  return x.includes('solar') && (x.includes('agua da casa') || x.includes('solar agua'));
});
const semAviso = modelos.filter((t) => !norm(t.footerNote).includes('nbr 9575'));
if (!modelos.length) { tudoOk = false; console.log('✘ Aviso NBR: nenhum modelo de solar residência encontrado.'); }
else if (!semAviso.length) console.log(`✔ Aviso NBR 9575: presente nos ${modelos.length} modelo(s) de solar residência.`);
else { tudoOk = false; console.log(`✘ Aviso NBR 9575 faltando em: ${semAviso.map((t) => t.name).join(' · ')}`); }

console.log(tudoOk ? '\n▸ Tudo certo.\n' : '\n▸ Ainda há pendências acima.\n');
