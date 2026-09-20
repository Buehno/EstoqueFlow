// Teste dirigido às novidades de 20/09: foto por item de proposta, logotipo
// da empresa, exportação PDF/Word com imagem embutida, e a correção de
// motivo/documento/observações de um movimento (sem mexer em quantidade).
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:8080/api';
let passou = 0, falhou = 0;

async function req(method, path, body, token, raw = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function check(nome, cond, extra) {
  if (cond) { passou++; console.log(`OK   ${nome}`); }
  else { falhou++; console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

// 1x1 px JPEG vermelho válido, em data URI — suficiente pra exercitar o
// parser de dimensões e os geradores sem depender de arquivo externo.
const FOTO_TESTE =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

async function main() {
  const reg = await req('POST', '/auth/register', {
    companyName: 'Teste Imagens Ltda', name: 'Owner Imagens', email: 'owner@imagens.local', password: 'senha12345',
  });
  check('register OK', reg.status === 200 && reg.data.token, reg);
  const token = reg.data.token;

  // ── Logotipo da empresa ────────────────────────────────────────────
  const patchLogo = await req('PATCH', '/auth/company', { logoUrl: FOTO_TESTE }, token);
  check('PATCH /auth/company aceita logoUrl', patchLogo.status === 200 && patchLogo.data.logoUrl === FOTO_TESTE, patchLogo);

  const getCompany = await req('GET', '/auth/company', undefined, token);
  check('GET /auth/company devolve logoUrl', getCompany.data.logoUrl === FOTO_TESTE);

  // ── Item de proposta com foto ───────────────────────────────────────
  const prop = await req('POST', '/proposals', { clientName: 'Cliente Teste Fotos' }, token);
  check('proposta criada', prop.status === 200, prop);
  const propId = prop.data.id;

  const putItens = await req('PUT', `/proposals/${propId}/itens`, {
    items: [{ quantity: 1, quantityText: '01', description: 'Item com foto de teste', unitPrice: 100, total: 100, imageUrl: FOTO_TESTE }],
  }, token);
  check('PUT itens aceita imageUrl', putItens.status === 200, putItens);
  check('item salvo devolve imageUrl', putItens.data.items?.[0]?.imageUrl === FOTO_TESTE, putItens.data.items?.[0]);

  const getProp = await req('GET', `/proposals/${propId}`, undefined, token);
  check('GET proposta mantém imageUrl do item', getProp.data.items?.[0]?.imageUrl === FOTO_TESTE);

  // ── Exportação com imagem embutida (não pode quebrar o gerador) ─────
  for (const formato of ['pdf', 'docx', 'xlsx']) {
    const res = await req('GET', `/proposals/${propId}/export/${formato}`, undefined, token, true);
    const buf = Buffer.from(await res.arrayBuffer());
    check(`export ${formato} com foto/logo gera arquivo não vazio`, res.status === 200 && buf.length > 500, { status: res.status, tamanho: buf.length });
    if (res.status === 200) writeFileSync(`/tmp/teste-export.${formato}`, buf);
  }

  // ── Modelo de proposta reutilizável com foto ─────────────────────────
  const modelo = await req('POST', '/proposal-templates', {
    name: 'Modelo com foto',
    scopeTitle: 'TESTE DE MODELO COM FOTO',
    items: [{ quantity: 1, description: 'Item modelo', unitPrice: 50, imageUrl: FOTO_TESTE }],
  }, token);
  check('modelo criado com imageUrl no item', modelo.status === 200 && modelo.data.items?.[0]?.imageUrl === FOTO_TESTE, modelo.data);

  const propDeModelo = await req('POST', '/proposals', { clientName: 'Cliente Via Modelo', templateId: modelo.data.id }, token);
  check('proposta criada a partir do modelo herda a foto do item', propDeModelo.data.items?.[0]?.imageUrl === FOTO_TESTE, propDeModelo.data.items);

  // ── Correção de movimento (metadados apenas) ─────────────────────────
  const wh = await req('GET', '/warehouses', undefined, token);
  const whA = wh.data.find((w) => w.isDefault) ?? wh.data[0];
  const prod = await req('POST', '/products', { name: 'Produto Teste Correção', unit: 'UN', costPrice: 10, salePrice: 20 }, token);
  const entrada = await req('POST', '/movements/entrada', {
    productId: prod.data.id, warehouseId: whA.id, quantity: 10, reason: 'Motivo digitado errado',
  }, token);
  check('entrada criada', entrada.status === 200, entrada);
  const movId = entrada.data.id;

  const correcao = await req('PATCH', `/movements/${movId}`, { reason: 'Motivo corrigido', document: 'NF-1234', notes: 'Corrigido via teste' }, token);
  check('PATCH /movements/:id corrige motivo/documento/observações', correcao.status === 200 && correcao.data.reason === 'Motivo corrigido' && correcao.data.document === 'NF-1234', correcao);
  check('quantidade do movimento continua intacta após a correção', Number(correcao.data.quantity) === 10, correcao.data.quantity);

  // tenta "corrigir" quantidade — o endpoint deve simplesmente ignorar o
  // campo (não existe no schema de validação), não deve mudar nada no saldo
  const posAntes = await req('GET', `/stock?warehouseId=${whA.id}`, undefined, token);
  const saldoAntes = posAntes.data.find((s) => s.productId === prod.data.id)?.quantity;
  await req('PATCH', `/movements/${movId}`, { quantity: 999 }, token);
  const posDepois = await req('GET', `/stock?warehouseId=${whA.id}`, undefined, token);
  const saldoDepois = posDepois.data.find((s) => s.productId === prod.data.id)?.quantity;
  check('tentativa de mandar "quantity" no PATCH não altera o saldo (campo não existe no schema)', saldoAntes === saldoDepois, { saldoAntes, saldoDepois });

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) process.exit(1);
}

main().catch((e) => { console.error('ERRO FATAL', e); process.exit(1); });
