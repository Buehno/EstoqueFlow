/**
 * ════════════════════════════════════════════════════════════════════════════
 *  IMPORTADOR — planilha "ESTOQUE 2023.xls" da Jundiaquece
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Layout da aba de trabalho (padrão "2026"):
 *
 *    A  descrição                          ← linha em CAIXA ALTA sozinha = categoria
 *    B  SUPERIOR      (entradas no dep. 1)
 *    C  INFERIOR      (entradas no dep. 2)
 *    D  VALOR PAGO
 *    E  SOMA          (= B + C)
 *    F  SAIDA
 *    G  SALDO         (= E - F)  ← saldo atual de verdade
 *    H  SALDO EM BARRA
 *    I  REGULADOR     ← estoque mínimo
 *
 *  Regras de importação:
 *    · o saldo importado é o da coluna SALDO;
 *    · ele é dividido entre os dois depósitos na mesma proporção das entradas
 *      (SUPERIOR × INFERIOR). Sem entradas registradas, vai tudo para o
 *      Depósito 2 · Inferior, que é a loja;
 *    · saldo negativo na planilha entra como zero e é listado no relatório final
 *      para conferência física;
 *    · o produto é identificado pela DESCRIÇÃO. Como o estoque não tem etiqueta,
 *      o código interno é gerado aqui (JQ-00001, JQ-00002, …) só para o sistema
 *      ter uma chave — ninguém precisa decorar.
 *
 *  Uso:
 *    ABA=2026 EMAIL=... SENHA=... node scripts/importar-jundiaquece.mjs arquivo.xls
 * ════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL;
const SENHA = process.env.SENHA;
const ABA = process.env.ABA || '2026';
/** Prefixo do código interno. Cada aba precisa do seu, para não sobrescrever a outra. */
const PREFIXO = process.env.PREFIXO || 'JQ';
/** Só atualiza o catálogo, sem lançar entradas (para reprocessar descrições). */
const SOMENTE_CATALOGO = Boolean(process.env.SOMENTE_CATALOGO);
const DRY_RUN = Boolean(process.env.DRY_RUN);
const arquivo = process.argv[2];

if (!arquivo) {
  console.error('Uso: node scripts/importar-jundiaquece.mjs <arquivo.xls>');
  process.exit(1);
}

// ─────────────────────────── leitura ───────────────────────────
const wb = XLSX.read(readFileSync(arquivo), { cellDates: false });
if (!wb.SheetNames.includes(ABA)) {
  console.error(`Aba "${ABA}" não existe. Disponíveis: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[ABA], { header: 1, blankrows: false, defval: '' });

const num = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const semAcento = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Qual conjunto de colunas usar: o padrão anual ou o da aba BOMBAS. */
const COLUNAS = process.env.COLUNAS || (ABA.toUpperCase() === 'BOMBAS' ? 'bombas' : '2026');
const COLS_ESTOQUE = COLUNAS === 'bombas' ? [1, 2, 3, 4] : [1, 2, 4, 5, 6, 8];

/** Linha de categoria: texto sem nenhum número nas colunas de estoque E em CAIXA ALTA. */
const ehCategoria = (r) => {
  const texto = String(r[0] ?? '').trim();
  if (!texto) return false;
  const temNumero = COLS_ESTOQUE.some((c) => num(r[c]) !== null);
  if (temNumero) return false;
  const limpo = semAcento(texto);
  return !/[a-z]/.test(limpo); // só maiúsculas → é título de seção
};

/** Extrai o tamanho/bitola da descrição: "20 mm", "1/2", "3/8", "nº 40". */
function extrairTamanho(nome) {
  const t = nome.replace(/\s+/g, ' ');
  const padroes = [
    // frações primeiro: em "22 x 1/2" o tamanho é 1/2, não 2
    /(\d+\s+\d+\/\d+)\s*[”"']?/,
    /(\d+\/\d+)\s*[”"']?/,
    /([½¼¾⅜⅝⅞])\s*[”"']?/,
    /(\d+[.,]?\d*)\s*(mm|cm|m²|m2|pol|")/i,
    /n[ºo°]\s*(\d+)/i,
    /(\d+)\s*x\s*(\d+)/i,
  ];
  for (const p of padroes) {
    const m = t.match(p);
    if (m) return m[0].trim().replace(/\s+/g, ' ');
  }
  return null;
}

/** Unidade: itens vendidos por metro vêm marcados com "(mt)" ou na seção de metro. */
function extrairUnidade(nome, categoria) {
  const n = semAcento(nome).toLowerCase();
  const c = semAcento(categoria ?? '').toLowerCase();
  if (/\(\s*mt\s*\)/.test(n) || /valor por\s*(a\d+:b\d+)?\s*metro/.test(c)) return 'MT';
  if (/\bkg\b/.test(n)) return 'KG';
  if (/\brolo\b|\brl\b/.test(n)) return 'RL';
  if (/\bbarra\b/.test(n)) return 'BR';
  return 'UN';
}

// ─────────────────────────── parsing ───────────────────────────
const produtos = [];
const negativos = [];
let categoriaAtual = null;
let categoriaRaw = null;
let categorias = 0;

for (const r of linhas) {
  const descricao = String(r[0] ?? '').trim().replace(/\s+/g, ' ');
  if (!descricao) continue;

  if (ehCategoria(r)) {
    categoriaRaw = descricao; // guarda o título cru — é ele que diz "VALOR POR METRO"
    categoriaAtual = descricao.replace(/\s*\(.*?\)\s*/g, '').trim() || descricao;
    categorias++;
    continue;
  }

  // Layout "2026": B=SUPERIOR C=INFERIOR G=SALDO I=REGULADOR
  // Layout "BOMBAS": B=ENTRADA C=SAIDAS D=ESTOQUE FISICO E=REGULADOR
  const layoutBombas = COLUNAS === 'bombas';
  const superior = layoutBombas ? 0 : num(r[1]) ?? 0;
  const inferior = layoutBombas ? 0 : num(r[2]) ?? 0;
  const saldoBruto = layoutBombas ? num(r[3]) : num(r[6]);
  const minimo = (layoutBombas ? num(r[4]) : num(r[8])) ?? 0;

  // sem coluna de saldo preenchida, usa a soma das entradas
  const saldo = saldoBruto != null ? saldoBruto : superior + inferior;
  if (saldo < 0) negativos.push({ descricao, saldo });

  const efetivo = Math.max(0, saldo);
  const baseEntradas = superior + inferior;
  let qtdSup = 0;
  let qtdInf = 0;
  if (efetivo > 0) {
    if (baseEntradas > 0) {
      qtdSup = Math.round(((superior / baseEntradas) * efetivo + Number.EPSILON) * 1000) / 1000;
      qtdInf = Math.round((efetivo - qtdSup + Number.EPSILON) * 1000) / 1000;
    } else {
      qtdInf = efetivo; // sem histórico de entrada → fica na loja (inferior)
    }
  }

  produtos.push({
    sku: `${PREFIXO}-${String(produtos.length + 1).padStart(5, '0')}`,
    name: descricao,
    categoria: categoriaAtual ?? 'GERAL',
    unit: extrairUnidade(descricao, categoriaRaw),
    size: extrairTamanho(descricao) ?? undefined,
    minStock: Math.max(0, minimo),
    saldos: [
      ['DEP-1', qtdSup],
      ['DEP-2', qtdInf],
    ].filter(([, q]) => q > 0),
  });
}

const comSaldo = produtos.filter((p) => p.saldos.length);
const totalUnidades = produtos.reduce((a, p) => a + p.saldos.reduce((b, [, q]) => b + q, 0), 0);

console.log('═'.repeat(72));
console.log(` Planilha: ${path.basename(arquivo)} · aba "${ABA}"`);
console.log('═'.repeat(72));
console.log(` Categorias .........: ${categorias}`);
console.log(` Produtos ...........: ${produtos.length}`);
console.log(` Com saldo ..........: ${comSaldo.length}`);
console.log(` Unidades totais ....: ${totalUnidades.toLocaleString('pt-BR')}`);
console.log(` Saldos negativos ...: ${negativos.length} (entram como zero)`);
console.log('');
console.log(' Amostra:');
produtos.slice(0, 8).forEach((p) =>
  console.log(
    `  ${p.name.slice(0, 44).padEnd(46)} ${String(p.size ?? '—').padEnd(10)} ${p.unit.padEnd(3)} ` +
      `min ${String(p.minStock).padEnd(6)} ${JSON.stringify(p.saldos)}`,
  ),
);
if (negativos.length) {
  console.log('\n Negativos na planilha (conferir fisicamente):');
  negativos.slice(0, 15).forEach((n) => console.log(`  ${n.saldo.toString().padStart(8)}  ${n.descricao}`));
  if (negativos.length > 15) console.log(`  … e mais ${negativos.length - 15}`);
}

if (DRY_RUN) {
  console.log('\nDRY_RUN — nada foi enviado.');
  process.exit(0);
}
if (!EMAIL || !SENHA) {
  console.error('\nDefina EMAIL e SENHA para enviar.');
  process.exit(1);
}

// ─────────────────────────── envio ───────────────────────────
let token = '';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cliente com recuo automático: a API tem limite de requisições por minuto e
 * uma carga inicial dispara centenas de lançamentos seguidos. Ao levar 429 (ou
 * um erro temporário de rede), espera e tenta de novo em vez de perder a linha.
 */
const api = async (method, rota, body, tentativa = 1) => {
  let res;
  try {
    res = await fetch(`${BASE}/api${rota}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (erroRede) {
    if (tentativa > 4) throw erroRede;
    await dormir(2000 * tentativa);
    return api(method, rota, body, tentativa + 1);
  }

  if (res.status === 429 && tentativa <= 6) {
    const espera = Number(res.headers.get('retry-after')) || Math.min(60, 5 * tentativa);
    process.stdout.write(`\r  limite da API atingido — aguardando ${espera}s…            `);
    await dormir((espera + 1) * 1000);
    return api(method, rota, body, tentativa + 1);
  }
  if (res.status >= 500 && tentativa <= 3) {
    await dormir(1500 * tentativa);
    return api(method, rota, body, tentativa + 1);
  }

  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (!res.ok) throw new Error(`${method} ${rota} → ${res.status}: ${JSON.stringify(data).slice(0, 260)}`);
  return data;
};

console.log(`\n▸ Autenticando em ${BASE}…`);
token = (await api('POST', '/auth/login', { email: EMAIL, password: SENHA })).token;

const depositos = await api('GET', '/warehouses');
const porCodigo = new Map(depositos.map((d) => [d.code, d.id]));
console.log(`  Depósitos: ${depositos.map((d) => `${d.code} (${d.name})`).join(' · ')}`);
if (!porCodigo.get('DEP-1') || !porCodigo.get('DEP-2')) {
  console.error('  ✘ Faltam os depósitos DEP-1 e DEP-2 nesta empresa.');
  process.exit(1);
}

console.log('▸ Enviando o catálogo…');
const LOTE = 150;
for (let i = 0; i < produtos.length; i += LOTE) {
  const fatia = produtos.slice(i, i + LOTE).map(({ saldos, ...p }) => p);
  const r = await api('POST', '/products/bulk', { items: fatia });
  console.log(`  ${Math.min(i + LOTE, produtos.length)}/${produtos.length} — ${r.criados} novo(s), ${r.atualizados} atualizado(s)`);
}

const catalogo = await api('GET', '/products?take=500&skip=0');
const todos = [...catalogo.items];
for (let skip = 500; skip < catalogo.total; skip += 500) {
  const pagina = await api('GET', `/products?take=500&skip=${skip}`);
  todos.push(...pagina.items);
}
const porSku = new Map(todos.map((p) => [p.sku, p.id]));
console.log(`  catálogo confirmado: ${porSku.size} produto(s)`);

if (SOMENTE_CATALOGO) {
  console.log('\nSOMENTE_CATALOGO — descrições atualizadas, nenhuma entrada lançada.');
  process.exit(0);
}

console.log('▸ Lançando a carga inicial de estoque…');
let ok = 0, erros = 0;
const falhas = [];
for (const p of produtos) {
  const productId = porSku.get(p.sku);
  if (!productId) { falhas.push(`${p.sku} não encontrado`); erros++; continue; }
  for (const [codigo, quantidade] of p.saldos) {
    try {
      await api('POST', '/movements/entrada', {
        productId,
        warehouseId: porCodigo.get(codigo),
        quantity: quantidade,
        reason: `Carga inicial — planilha ${ABA}`,
        document: path.basename(arquivo),
      });
      ok++;
      if (ok % 100 === 0) console.log(`  ${ok} entradas lançadas…`);
    } catch (e) {
      erros++;
      if (falhas.length < 10) falhas.push(`${p.name}: ${e.message.slice(0, 120)}`);
    }
  }
}

console.log('\n' + '═'.repeat(72));
console.log(' IMPORTAÇÃO CONCLUÍDA');
console.log('═'.repeat(72));
console.log(` produtos ............: ${produtos.length}`);
console.log(` entradas lançadas ...: ${ok}`);
console.log(` erros ...............: ${erros}`);
if (falhas.length) falhas.forEach((f) => console.log(`   ✘ ${f}`));
console.log('═'.repeat(72));
