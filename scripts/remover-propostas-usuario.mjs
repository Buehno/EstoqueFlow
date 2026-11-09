#!/usr/bin/env node
/**
 * Exclui DE VEZ todas as propostas criadas por um usuário da equipe
 * (padrão: Daniele — vendas1@jundaquece.com.br). Pedido de 09/11/2026.
 *
 * A exclusão leva junto os itens e a linha do tempo da proposta e NÃO tem
 * volta. Modelos de proposta, produtos e estoque não são tocados.
 *
 * Roda em SIMULAÇÃO por padrão: lista cada proposta (número, cliente, status,
 * valor) sem apagar nada. Para apagar de verdade: $env:CONFIRMAR = "1".
 *
 *   PowerShell:
 *   $env:EMAIL = "ronaldo.bueno@iagentics.com.br"
 *   $env:SENHA = "sua senha"
 *   node remover-propostas-usuario.mjs
 *
 *   Outro usuário: $env:DONO = "email@da.pessoa"
 */

const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL;
const SENHA = process.env.SENHA;
const DONO = (process.env.DONO || 'vendas1@jundaquece.com.br').trim().toLowerCase();
const APLICAR = process.env.CONFIRMAR === '1';

if (!EMAIL || !SENHA) {
  console.error('Informe EMAIL e SENHA (usuário com permissão de gerenciar equipe e propostas).');
  process.exit(1);
}

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
  if (!res.ok) throw new Error(`${method} ${rota} → ${res.status}: ${JSON.stringify(data).slice(0, 260)}`);
  return data;
};

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

console.log(`\n▸ ${APLICAR ? 'APLICANDO — exclusão definitiva' : 'SIMULAÇÃO (nada será apagado)'} em ${BASE}`);
token = (await api('POST', '/auth/login', { email: EMAIL, password: SENHA })).token;

// Quem é a dona das propostas
const equipe = await api('GET', '/auth/users');
const dona = equipe.find((u) => String(u.email).toLowerCase() === DONO);
if (!dona) {
  console.error(`✘ Nenhum usuário com o e-mail ${DONO}.`);
  process.exit(1);
}
const homonimos = equipe.filter((u) => u.name === dona.name);
if (homonimos.length > 1) {
  console.error(`✘ Há ${homonimos.length} usuários chamados "${dona.name}" — não dá para separar as propostas com segurança. Nada foi feito.`);
  process.exit(1);
}
console.log(`  Usuária: ${dona.name} <${dona.email}>`);

// Todas as propostas da empresa, em páginas
const todas = [];
for (let skip = 0; ; skip += 200) {
  const { items, total } = await api('GET', `/proposals?take=200&skip=${skip}`);
  todas.push(...items);
  if (todas.length >= total || items.length === 0) break;
}
const dela = todas.filter((p) => p.vendedor === dona.name).sort((a, b) => a.number - b.number);

if (!dela.length) {
  console.log(`\n  Nenhuma proposta criada por ${dona.name}. Nada a fazer.\n`);
  process.exit(0);
}

console.log(`\n  ${dela.length} proposta(s) de ${dona.name} (de ${todas.length} no sistema):\n`);
let soma = 0;
for (const p of dela) {
  soma += p.totalValue;
  const data = new Date(p.createdAt).toLocaleDateString('pt-BR');
  console.log(`   #${String(p.number).padStart(4, '0')}  ${data}  ${p.status.padEnd(18)} ${brl(p.totalValue).padStart(14)}  ${p.clientName}`);
}
console.log(`\n  Valor somado: ${brl(soma)}`);

const ativas = dela.filter((p) => ['ENVIADA', 'AGUARDANDO_RETORNO', 'EM_NEGOCIACAO', 'ACEITA'].includes(p.status));
if (ativas.length) console.log(`  ⚠ ${ativas.length} delas estão enviadas, em negociação ou aceitas.`);

if (!APLICAR) {
  console.log('\n  Para apagar de verdade: $env:CONFIRMAR = "1" e rode de novo.\n');
  process.exit(0);
}

let ok = 0;
for (const p of dela) {
  try {
    await api('DELETE', `/proposals/${p.id}`);
    ok++;
    console.log(`   ✔ #${String(p.number).padStart(4, '0')} apagada`);
  } catch (e) {
    console.log(`   ✘ #${String(p.number).padStart(4, '0')} — ${e.message}`);
  }
}
console.log(`\n▸ ${ok} de ${dela.length} propostas apagadas.\n`);
