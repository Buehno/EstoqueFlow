#!/usr/bin/env node
/**
 * Limpeza pedida em 09/11/2026, tudo de uma vez:
 *   1. EXCLUI DE VEZ as 7 peças em duplicidade (todas as cópias com o mesmo
 *      nome, ativas ou já desativadas) — cadastro, saldo e histórico;
 *   2. EXCLUI DE VEZ todas as propostas criadas pela Daniele;
 *   3. põe o aviso NBR 9575 nos modelos de sistema solar residência.
 *
 * Mostra a lista completa e só apaga depois de você digitar SIM.
 *
 * PowerShell:
 *   $env:SENHA = "sua senha"
 *   node limpar-jundiaquece.mjs
 */
import readline from 'node:readline/promises';

const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL || 'ronaldo.bueno@iagentics.com.br';
const SENHA = process.env.SENHA;
const DONA_PROPOSTAS = 'vendas1@jundaquece.com.br';

const PECAS = [
  { nome: 'Registro esfera de 1/2 - ALAVANCA - F/F - GAS', busca: 'registro esfera' },
  { nome: 'Niple metal 1/2', busca: 'niple' },
  { nome: 'TE Marrom Redutor - 32 × 25', busca: 'redutor' },
  { nome: 'Adaptador Solis - piscina', busca: 'adaptador solis' },
  { nome: 'Filtro de linha 1"', busca: 'filtro' },
  { nome: 'Filtro de linha 1/2"', busca: 'filtro' },
  { nome: 'Filtro de linha 3/4"', busca: 'filtro' },
];
const AVISO_NBR =
  'NBR 9575 - Esta Norma estabelece as exigências e recomendações relativas à seleção e projeto de impermeabilização, para que sejam atendidos os requisitos mínimos de proteção da construção contra a passagem de fluidos, bem como os requisitos de salubridade, segurança e conforto do usuário, de forma a ser garantida a estanqueidade dos elementos construtivos que a requeiram.';

if (!SENHA) {
  console.error('\nFalta a senha. Rode antes:  $env:SENHA = "sua senha"\n');
  process.exit(1);
}

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/×/g, 'x').replace(/[^a-z0-9/"]+/g, ' ').trim();
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let token;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, rota, body, tentativa = 1) => {
  const res = await fetch(`${BASE}/api${rota}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 429 && tentativa <= 6) {
    await dormir(((Number(res.headers.get('retry-after')) || 5) + 1) * 1000);
    return api(method, rota, body, tentativa + 1);
  }
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (!res.ok) throw new Error(`${res.status}: ${data?.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
};

console.log(`\n▸ Entrando em ${BASE}…`);
try {
  token = (await api('POST', '/auth/login', { email: EMAIL, password: SENHA })).token;
} catch (e) {
  console.error(`✘ Login recusado (${e.message}). Confira a senha em $env:SENHA.\n`);
  process.exit(1);
}

// ── 1. peças ──
const pecas = [];
const vistos = new Set();
for (const alvo of PECAS) {
  const { items } = await api('GET', `/products?take=500&search=${encodeURIComponent(alvo.busca)}`);
  for (const p of items) {
    if (norm(p.name) === norm(alvo.nome) && !vistos.has(p.id)) { vistos.add(p.id); pecas.push(p); }
  }
}

// ── 2. propostas da Daniele ──
const equipe = await api('GET', '/auth/users');
const dona = equipe.find((u) => String(u.email).toLowerCase() === DONA_PROPOSTAS);
const propostas = dona ? await api('GET', `/proposals/por-usuario/${dona.id}`) : { total: 0, valor: 0, itens: [] };

// ── 3. modelos sem o aviso ──
const modelos = (await api('GET', '/proposal-templates')).filter((t) => {
  const x = norm(`${t.name} ${t.scopeTitle}`);
  return x.includes('solar') && (x.includes('agua da casa') || x.includes('solar agua')) && !norm(t.footerNote).includes('nbr 9575');
});

console.log(`\n━━ ${pecas.length} peça(s) para EXCLUIR DE VEZ`);
for (const p of pecas) {
  const saldo = p.stockByWarehouse.filter((s) => s.quantity).map((s) => `${s.code}: ${s.quantity}`).join(' · ') || 'sem saldo';
  console.log(`   [${p.sku}] ${p.name} — ${saldo}${p.active ? '' : ' (já desativada)'}`);
}
console.log(`\n━━ ${propostas.total} proposta(s) da ${dona?.name ?? 'Daniele'} para EXCLUIR DE VEZ (${brl(propostas.valor)})`);
for (const p of propostas.itens) {
  console.log(`   #${String(p.number).padStart(4, '0')}  ${p.status.padEnd(18)} ${brl(p.total).padStart(14)}  ${p.clientName}`);
}
console.log(`\n━━ ${modelos.length} modelo(s) solar residência recebem o aviso NBR 9575`);
for (const t of modelos) console.log(`   ${t.name}`);

if (!pecas.length && !propostas.total && !modelos.length) {
  console.log('\n✔ Nada a fazer — já está tudo limpo.\n');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const resp = (await rl.question('\nA exclusão não tem volta. Digite SIM para apagar tudo acima: ')).trim().toUpperCase();
rl.close();
if (resp !== 'SIM') { console.log('\nCancelado. Nada foi alterado.\n'); process.exit(0); }

let okP = 0;
for (const p of pecas) {
  try { await api('DELETE', `/products/${p.id}`); okP++; console.log(`   ✔ peça excluída: ${p.name}`); }
  catch (e) { console.log(`   ✘ ${p.name} — ${e.message}`); }
}
let okProp = 0;
if (dona && propostas.total) {
  try { okProp = (await api('POST', `/proposals/por-usuario/${dona.id}/excluir`, { confirmar: true })).excluidas; console.log(`   ✔ ${okProp} proposta(s) excluída(s)`); }
  catch (e) { console.log(`   ✘ propostas — ${e.message}`); }
}
for (const t of modelos) {
  try { await api('PATCH', `/proposal-templates/${t.id}`, { footerNote: AVISO_NBR }); console.log(`   ✔ aviso NBR em: ${t.name}`); }
  catch (e) { console.log(`   ✘ ${t.name} — ${e.message}`); }
}
console.log(`\n▸ Pronto: ${okP} peça(s) e ${okProp} proposta(s) excluídas. Aperte F5 no sistema.\n`);
