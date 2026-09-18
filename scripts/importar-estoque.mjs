/**
 * ════════════════════════════════════════════════════════════════════════════
 *  IMPORTADOR DE ESTOQUE (planilha .xlsx / .csv → EstoqueFlow)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Uso:
 *    node scripts/importar-estoque.mjs "ESTOQUE - 2023.xlsx"
 *
 *  Variáveis opcionais:
 *    BASE=https://estoqueflow-production.up.railway.app   (padrão)
 *    EMAIL / SENHA                                        credenciais
 *    ABA="Balcão"                                         aba a ler (padrão: a 1ª)
 *    DEPOSITO=DEP-1                                       onde lançar a carga inicial
 *    DRY_RUN=1                                            só mostra o que faria
 *
 *  O script:
 *    1. lê a planilha e detecta automaticamente a linha de cabeçalho;
 *    2. mapeia as colunas por sinônimos (código/descrição/quantidade/custo/…);
 *    3. cria/atualiza os produtos em lote;
 *    4. lança a ENTRADA de carga inicial no depósito escolhido — cada linha vira
 *       um movimento rastreável, nada é gravado "por fora" do sistema.
 *
 *  Se a planilha tiver colunas separadas por depósito (ex.: "SUPERIOR" e
 *  "INFERIOR"), o script reconhece e lança a entrada em cada um deles.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const BASE = process.env.BASE || 'https://estoqueflow-production.up.railway.app';
const EMAIL = process.env.EMAIL || 'demo@estoqueflow.app';
const SENHA = process.env.SENHA || 'estoque2026';
const DEPOSITO_PADRAO = process.env.DEPOSITO || 'DEP-1';
const DRY_RUN = Boolean(process.env.DRY_RUN);

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Uso: node scripts/importar-estoque.mjs <arquivo.xlsx>');
  process.exit(1);
}

// ─────────────────────── mapeamento de colunas ───────────────────────
const SINONIMOS = {
  sku: ['sku', 'codigo', 'código', 'cod', 'cód', 'ref', 'referencia', 'referência', 'item', 'produto id'],
  name: ['descricao', 'descrição', 'produto', 'nome', 'material', 'discriminacao', 'discriminação'],
  barcode: ['ean', 'codigo de barras', 'código de barras', 'barras', 'gtin'],
  unit: ['un', 'und', 'unid', 'unidade', 'medida', 'um'],
  quantity: ['qtd', 'qtde', 'quantidade', 'saldo', 'estoque', 'qte', 'quant'],
  costPrice: ['custo', 'valor unitario', 'valor unitário', 'preco de custo', 'preço de custo', 'vl unit', 'unitario', 'unitário'],
  salePrice: ['venda', 'preco', 'preço', 'preco de venda', 'preço de venda', 'valor venda'],
  minStock: ['minimo', 'mínimo', 'estoque minimo', 'estoque mínimo', 'min'],
  warehouseSup: ['superior', 'dep superior', 'deposito superior', 'depósito superior', 'deposito 1', 'depósito 1', 'dep 1', 'sup', 'cima'],
  warehouseInf: ['inferior', 'dep inferior', 'deposito inferior', 'depósito inferior', 'deposito 2', 'depósito 2', 'dep 2', 'inf', 'baixo', 'terreo', 'térreo'],
};

const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function detectarColunas(cabecalho) {
  const mapa = {};
  cabecalho.forEach((celula, i) => {
    const n = normalizar(celula);
    if (!n) return;
    for (const [campo, alternativas] of Object.entries(SINONIMOS)) {
      if (mapa[campo] != null) continue;
      if (alternativas.some((a) => n === normalizar(a) || n.startsWith(`${normalizar(a)} `) || n.includes(normalizar(a)))) {
        mapa[campo] = i;
        break;
      }
    }
  });
  return mapa;
}

/** Acha a linha que parece ser o cabeçalho (a que mais casa com os sinônimos). */
function acharCabecalho(linhas) {
  let melhor = { indice: 0, pontos: -1, mapa: {} };
  for (let i = 0; i < Math.min(linhas.length, 25); i++) {
    const mapa = detectarColunas(linhas[i] ?? []);
    const pontos = Object.keys(mapa).length;
    if (pontos > melhor.pontos) melhor = { indice: i, pontos, mapa };
  }
  return melhor;
}

const numero = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// ─────────────────────── leitura ───────────────────────
const wb = XLSX.read(readFileSync(arquivo), { cellDates: true });
const nomeAba = process.env.ABA || wb.SheetNames[0];
if (!wb.SheetNames.includes(nomeAba)) {
  console.error(`Aba "${nomeAba}" não existe. Abas disponíveis: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}
console.log(`▸ Arquivo: ${path.basename(arquivo)}`);
console.log(`  Abas: ${wb.SheetNames.join(', ')}`);
console.log(`  Lendo: ${nomeAba}`);

const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, blankrows: false, defval: '' });
const { indice, mapa, pontos } = acharCabecalho(linhas);
console.log(`  Cabeçalho na linha ${indice + 1} (${pontos} coluna(s) reconhecida(s)):`);
console.log('   ', JSON.stringify(mapa));

if (mapa.name == null && mapa.sku == null) {
  console.error('\n✘ Não consegui identificar nem a coluna de descrição nem a de código.');
  console.error('  Primeiras linhas do arquivo, para conferência:');
  linhas.slice(0, 8).forEach((l, i) => console.error(`   ${i + 1}: ${JSON.stringify(l.slice(0, 12))}`));
  process.exit(1);
}

const registros = [];
let semNome = 0;
for (const linha of linhas.slice(indice + 1)) {
  const name = String(linha[mapa.name] ?? '').trim();
  const skuBruto = String(linha[mapa.sku] ?? '').trim();
  if (!name && !skuBruto) continue;
  if (!name) { semNome++; continue; }

  const sku = skuBruto || `IMP-${String(registros.length + 1).padStart(5, '0')}`;
  const qtdSup = mapa.warehouseSup != null ? numero(linha[mapa.warehouseSup]) : null;
  const qtdInf = mapa.warehouseInf != null ? numero(linha[mapa.warehouseInf]) : null;
  const qtdGeral = mapa.quantity != null ? numero(linha[mapa.quantity]) : 0;

  registros.push({
    sku,
    name,
    barcode: mapa.barcode != null ? String(linha[mapa.barcode] ?? '').trim() || undefined : undefined,
    unit: (mapa.unit != null ? String(linha[mapa.unit] ?? '').trim() : '') || 'UN',
    costPrice: mapa.costPrice != null ? numero(linha[mapa.costPrice]) : 0,
    salePrice: mapa.salePrice != null ? numero(linha[mapa.salePrice]) : 0,
    minStock: mapa.minStock != null ? numero(linha[mapa.minStock]) : 0,
    saldos: qtdSup != null || qtdInf != null
      ? [['DEP-1', qtdSup ?? 0], ['DEP-2', qtdInf ?? 0]].filter(([, q]) => q > 0)
      : qtdGeral > 0 ? [[DEPOSITO_PADRAO, qtdGeral]] : [],
  });
}

console.log(`\n▸ ${registros.length} produto(s) lido(s)${semNome ? ` · ${semNome} linha(s) ignorada(s) sem descrição` : ''}`);
console.log('  Amostra:');
registros.slice(0, 5).forEach((r) =>
  console.log(`   ${r.sku.padEnd(14)} ${r.name.slice(0, 40).padEnd(42)} ${r.unit.padEnd(4)} custo ${r.costPrice} · saldos ${JSON.stringify(r.saldos)}`),
);

if (DRY_RUN) {
  console.log('\nDRY_RUN ativo — nada foi enviado.');
  process.exit(0);
}

// ─────────────────────── envio ───────────────────────
let token = '';
const api = async (method, rota, body) => {
  const res = await fetch(`${BASE}/api${rota}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = txt; }
  if (!res.ok) throw new Error(`${method} ${rota} → ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
};

console.log(`\n▸ Autenticando em ${BASE}…`);
token = (await api('POST', '/auth/login', { email: EMAIL, password: SENHA })).token;

const depositos = await api('GET', '/warehouses');
const porCodigo = new Map(depositos.map((d) => [d.code, d.id]));
console.log(`  Depósitos: ${depositos.map((d) => `${d.code} (${d.name})`).join(' · ')}`);

console.log('▸ Criando/atualizando produtos…');
const LOTE = 200;
for (let i = 0; i < registros.length; i += LOTE) {
  const fatia = registros.slice(i, i + LOTE).map(({ saldos, ...p }) => p);
  const r = await api('POST', '/products/bulk', { items: fatia });
  console.log(`  ${Math.min(i + LOTE, registros.length)}/${registros.length} — ${r.criados} criado(s), ${r.atualizados} atualizado(s)`);
}

const catalogo = await api('GET', '/products?take=500');
const porSku = new Map(catalogo.items.map((p) => [p.sku, p.id]));

console.log('▸ Lançando a carga inicial de estoque…');
let ok = 0, pulados = 0, erros = 0;
for (const r of registros) {
  const productId = porSku.get(r.sku);
  if (!productId) { pulados++; continue; }
  for (const [codigo, quantidade] of r.saldos) {
    const warehouseId = porCodigo.get(codigo);
    if (!warehouseId || quantidade <= 0) { pulados++; continue; }
    try {
      await api('POST', '/movements/entrada', {
        productId, warehouseId, quantity: quantidade,
        unitCost: r.costPrice || undefined,
        reason: 'Carga inicial — importação da planilha',
        document: path.basename(arquivo),
      });
      ok++;
    } catch (e) {
      erros++;
      if (erros <= 5) console.log(`  ✘ ${r.sku}: ${e.message.slice(0, 140)}`);
    }
  }
}

console.log(`\n═══════════════════════════════════════════════`);
console.log(` Importação concluída`);
console.log(`  produtos ......: ${registros.length}`);
console.log(`  entradas ......: ${ok}`);
console.log(`  puladas .......: ${pulados}`);
console.log(`  erros .........: ${erros}`);
console.log(`═══════════════════════════════════════════════`);
