#!/usr/bin/env node
/**
 * Duas correções pedidas pela Jundiaquece (09/11/2026):
 *
 * 1. DUPLICIDADE — remove TODOS os produtos ativos cujo nome é igual a um dos 7
 *    da lista "PEÇAS PARA SER EXCLUÍDA – DUPLICIDADE" (se houver 2 ou 3 cópias
 *    com o mesmo nome, saem todas). Para cada cópia:
 *      - zera o saldo de cada depósito com um movimento de AJUSTE (fica no
 *        histórico com motivo e usuário);
 *      - marca o cadastro como inativo (some da busca, balcão, /peça,
 *        propostas novas e lista de compra; histórico e propostas antigas
 *        continuam intactos).
 *
 * 2. AVISO NBR 9575 — coloca o bloco IMPORTANTE! em todos os modelos de
 *    proposta de sistema solar para residência ("água da casa") que ainda não
 *    têm o aviso.
 *
 * Roda em SIMULAÇÃO por padrão (só mostra o que faria).
 *
 *   EMAIL=ronaldo.bueno@iagentics.com.br SENHA='sua-senha' node limpeza-duplicados-e-aviso-nbr.mjs
 *   CONFIRMAR=1 EMAIL=... SENHA='...' node limpeza-duplicados-e-aviso-nbr.mjs
 */

const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL;
const SENHA = process.env.SENHA;
const APLICAR = process.env.CONFIRMAR === '1';
const MOTIVO = 'Remoção de cadastro em duplicidade — pedido 09/11/2026';

const ALVOS = [
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

if (!EMAIL || !SENHA) {
  console.error('Informe EMAIL e SENHA (usuário com permissão de cadastros, estoque e propostas).');
  process.exit(1);
}

// minúsculo, sem acento, só letras/números/barra/aspas — "1/2\"" ≠ "1\"", "32 × 25" = "32 x 25"
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9/"]+/g, ' ')
    .trim();

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

console.log(`\n▸ ${APLICAR ? 'APLICANDO' : 'SIMULAÇÃO (nada será alterado)'} em ${BASE}`);
token = (await api('POST', '/auth/login', { email: EMAIL, password: SENHA })).token;

// ───────────────────────── 1. duplicidade ─────────────────────────
console.log('\n━━ 1. Peças em duplicidade');
const vistos = new Set();
let removidos = 0;
const naoAchados = [];

for (const alvo of ALVOS) {
  const { items } = await api('GET', `/products?active=true&take=500&search=${encodeURIComponent(alvo.busca)}`);
  const copias = items.filter((p) => norm(p.name) === norm(alvo.nome) && !vistos.has(p.id));

  if (copias.length === 0) {
    naoAchados.push(alvo.nome);
    console.log(`\n✘ ${alvo.nome} — nenhum cadastro ativo com esse nome`);
    continue;
  }
  console.log(`\n• ${alvo.nome} — ${copias.length} cadastro(s) com esse nome`);

  for (const p of copias) {
    vistos.add(p.id);
    const comSaldo = p.stockByWarehouse.filter((s) => s.quantity !== 0);
    const saldoTxt = comSaldo.length ? comSaldo.map((s) => `${s.code}: ${s.quantity}`).join(' · ') : 'sem saldo';
    console.log(`    [${p.sku}] ${saldoTxt}`);

    for (const s of p.stockByWarehouse) {
      if (s.quantity === 0 && !p.packType) continue;
      console.log(`      ${s.code}: ${s.quantity} → 0 (AJUSTE)`);
      if (APLICAR) {
        await api('POST', '/movements/ajuste', {
          productId: p.id,
          warehouseId: s.warehouseId,
          newQuantity: 0,
          ...(p.packType ? { newRemnantMeters: 0 } : {}),
          reason: MOTIVO,
        });
      }
    }
    console.log('      cadastro → inativo');
    if (APLICAR) await api('PATCH', `/products/${p.id}`, { active: false });
    removidos++;
  }
}

// ───────────────────────── 2. aviso NBR ─────────────────────────
console.log('\n━━ 2. Aviso NBR 9575 nos modelos de sistema solar residência');
const modelos = await api('GET', '/proposal-templates');
const solarCasa = modelos.filter((t) => {
  const texto = norm(`${t.name} ${t.scopeTitle}`);
  return texto.includes('solar') && (texto.includes('agua da casa') || texto.includes('solar agua'));
});
let avisados = 0;
if (!solarCasa.length) console.log('  Nenhum modelo de solar residência encontrado — confira os nomes na tela de Modelos.');
for (const t of solarCasa) {
  if (norm(t.footerNote).includes('nbr 9575')) {
    console.log(`  ✔ ${t.name} — já tem o aviso`);
    continue;
  }
  console.log(`  + ${t.name} — aviso NBR 9575 adicionado`);
  if (APLICAR) await api('PATCH', `/proposal-templates/${t.id}`, { footerNote: AVISO_NBR });
  avisados++;
}

// ───────────────────────── resumo ─────────────────────────
console.log(`\n▸ Resumo`);
console.log(`  ${removidos} cadastro(s) ${APLICAR ? 'removidos' : 'a remover'}.`);
console.log(`  ${avisados} modelo(s) ${APLICAR ? 'receberam' : 'vão receber'} o aviso NBR 9575.`);
if (naoAchados.length) console.log(`  Não encontrados: ${naoAchados.join(' · ')}`);
if (!APLICAR) console.log('  Para aplicar de verdade: rode de novo com CONFIRMAR=1 na frente.\n');
