#!/usr/bin/env node
/**
 * Exclui DE VEZ todas as propostas da empresa, de todas as pessoas
 * (pedido de 09/11/2026). Itens e linha do tempo vão junto. Modelos de
 * proposta, produtos e estoque NÃO são tocados.
 *
 * Mostra a lista completa e só apaga depois de você digitar SIM.
 *
 * PowerShell:
 *   $env:SENHA = "sua senha"
 *   node apagar-todas-propostas.mjs
 */
import readline from 'node:readline/promises';

const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL || 'ronaldo.bueno@iagentics.com.br';
const SENHA = process.env.SENHA;

if (!SENHA) {
  console.error('\nFalta a senha. Rode antes:  $env:SENHA = "sua senha"\n');
  process.exit(1);
}

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

const todas = [];
for (let skip = 0; ; skip += 200) {
  const { items, total } = await api('GET', `/proposals?take=200&skip=${skip}`);
  todas.push(...items);
  if (todas.length >= total || items.length === 0) break;
}
todas.sort((a, b) => a.number - b.number);

if (!todas.length) {
  console.log('\n✔ Não há nenhuma proposta no sistema.\n');
  process.exit(0);
}

console.log(`\n━━ ${todas.length} proposta(s) para EXCLUIR DE VEZ\n`);
let soma = 0;
for (const p of todas) {
  soma += p.totalValue;
  console.log(`   #${String(p.number).padStart(4, '0')}  ${String(p.vendedor ?? '').padEnd(12).slice(0, 12)}  ${p.status.padEnd(18)} ${brl(p.totalValue).padStart(14)}  ${p.clientName}`);
}
console.log(`\n   Valor somado: ${brl(soma)}`);
const vivas = todas.filter((p) => ['ENVIADA', 'AGUARDANDO_RETORNO', 'EM_NEGOCIACAO', 'ACEITA'].includes(p.status)).length;
if (vivas) console.log(`   ⚠ ${vivas} delas estão enviadas, em negociação ou aceitas.`);
console.log('   Modelos de proposta, produtos e estoque não serão alterados.');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const resp = (await rl.question('\nA exclusão não tem volta. Digite SIM para apagar todas: ')).trim().toUpperCase();
rl.close();
if (resp !== 'SIM') { console.log('\nCancelado. Nada foi alterado.\n'); process.exit(0); }

let ok = 0;
for (const p of todas) {
  try { await api('DELETE', `/proposals/${p.id}`); ok++; }
  catch (e) { console.log(`   ✘ #${String(p.number).padStart(4, '0')} — ${e.message}`); }
}
console.log(`\n▸ ${ok} de ${todas.length} propostas excluídas. Aperte F5 no sistema.\n`);
