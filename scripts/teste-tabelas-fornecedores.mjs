// Suite do pacote de 26/10/2026 — tabelas de preço dos fornecedores como
// produtos sob encomenda (parcelado + à vista, escolhido na hora na proposta)
// e o layout novo da proposta exportada (cabeçalho do papel timbrado, rodapé
// só na última página, e-mail da loja no lugar do e-mail de login).
//
// Roda contra a API local (BASE) num banco limpo. Não depende de psql.
const BASE = process.env.BASE || 'http://localhost:8080/api';
let passou = 0, falhou = 0;
const falhas = [];

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json') && !ct.includes('text')) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function check(nome, cond, extra) {
  if (cond) { passou++; console.log(`OK   ${nome}`); }
  else { falhou++; falhas.push(nome); console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

/** Texto de um PDF (pdfmake comprime os streams; usa pdftotext quando existir). */
async function textoPdf(buf) {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ef-pdf-'));
  const arq = join(dir, 'p.pdf');
  writeFileSync(arq, buf);
  try { return execFileSync('pdftotext', ['-layout', arq, '-']).toString(); } catch { return null; }
}

async function main() {
  const sufixo = Date.now().toString(36);
  const reg = await req('POST', '/auth/register', {
    companyName: `Jundiaquece ${sufixo}`, name: 'Ronaldo Bueno', email: `ronaldo.${sufixo}@iagentics.local`, password: 'senha12345',
  });
  check('register', reg.status === 200 && reg.data.token, reg);
  const tk = reg.data.token;

  // ── Seed das tabelas ─────────────────────────────────────────────
  const s1 = await req('POST', '/products/seed-tabelas-fornecedores', undefined, tk);
  check('seed cria os 171 produtos das 8 tabelas', s1.status === 200 && s1.data.criados === 171 && s1.data.atualizados === 0 && s1.data.tabelas.length === 8, s1.data);
  const s2 = await req('POST', '/products/seed-tabelas-fornecedores', undefined, tk);
  check('seed é idempotente (2ª vez só atualiza, não duplica)', s2.status === 200 && s2.data.criados === 0 && s2.data.atualizados === 171, s2.data);
  const lista = await req('GET', '/products?take=500', undefined, tk);
  check('catálogo tem exatamente 171 produtos, todos sob encomenda', lista.data.total === 171 && lista.data.items.every((p) => p.onDemand === true), lista.data.total);
  check('nenhum produto de tabela entrou com saldo', lista.data.items.every((p) => (p.totalStock ?? 0) === 0));

  const cats = await req('GET', '/categories', undefined, tk);
  check('categorias dos fornecedores criadas', ['Reservatórios térmicos (boilers)', 'Coletores solares', 'Bombas e pressurizadores', 'Trocadores de calor', 'Geradores de cloro', 'Aquecedores a gás', 'Filtros para piscina'].every((n) => cats.data.some((c) => c.name === n)), cats.data.map((c) => c.name));
  const forn = await req('GET', '/suppliers', undefined, tk);
  check('fornecedores SOLIS/SYLLENT/INOVA/THOLZ/SODRAMAR criados', ['SOLIS', 'SYLLENT', 'INOVA', 'THOLZ', 'SODRAMAR'].every((n) => forn.data.some((f) => f.name === n)), forn.data.map((f) => f.name));

  // ── Preços transcritos (amostras conferidas contra as planilhas) ──
  const porSku = Object.fromEntries(lista.data.items.map((p) => [p.sku, p]));
  check('Solis boiler Trópicos 500 L aço 304: 5.600 / 5.400', porSku['SOL-RH-TROP304-H-500']?.salePrice === 5600 && porSku['SOL-RH-TROP304-H-500']?.cashPrice === 5400, porSku['SOL-RH-TROP304-H-500']);
  check('Solis Watertight Meusol 1000 L vertical: 20.155 / 19.435', porSku['SOL-WT-MEUS304-V-1000']?.salePrice === 20155 && porSku['SOL-WT-MEUS304-V-1000']?.cashPrice === 19435);
  check('Solis coletor Trópicos 2x1 horizontal: 2.515 / 2.420', porSku['SOL-COL-TROP-2-00-X-1-00-H']?.salePrice === 2515 && porSku['SOL-COL-TROP-2-00-X-1-00-H']?.cashPrice === 2420);
  check('Solis coletor de piscina 3x1,12 (3,36 m² × 188/180)', porSku['SOL-COL-PISC-3-00-X-1-12']?.salePrice === 631.68 && porSku['SOL-COL-PISC-3-00-X-1-12']?.cashPrice === 604.8, porSku['SOL-COL-PISC-3-00-X-1-12']);
  check('Syllent inverter 1/2 CV: 2.100 e à vista com 5% (1.995)', porSku['SYL-PRESS-INVERTER-SIP65M050-220-ECO-1-2']?.salePrice === 2100 && porSku['SYL-PRESS-INVERTER-SIP65M050-220-ECO-1-2']?.cashPrice === 1995);
  check('Syllent filtro SYL400: 980 / 931', porSku['SYL-FILTRO-SYL400']?.salePrice === 980 && porSku['SYL-FILTRO-SYL400']?.cashPrice === 931);
  check('Inova IN 28D: 4.040 / 3.900', porSku['INOVA-DIG-IN-28D']?.salePrice === 4040 && porSku['INOVA-DIG-IN-28D']?.cashPrice === 3900);
  check('Inova GP 140: 1.600 e à vista 5% (1.520) — não o "0,05" da planilha', porSku['INOVA-GP-140']?.salePrice === 1600 && porSku['INOVA-GP-140']?.cashPrice === 1520);
  check('Tholz trocador X23 46.000 BTU: 19.300 / 18.700', porSku['THOLZ-TC-303400002']?.salePrice === 19300 && porSku['THOLZ-TC-303400002']?.cashPrice === 18700);
  check('Tholz gerador de cloro THC60: 3.600 / 3.500', porSku['THOLZ-GC-303900003']?.salePrice === 3600 && porSku['THOLZ-GC-303900003']?.cashPrice === 3500);
  check('Sodramar BM-50 trifásica (824): 810 / 770, marcada como desatualizada', porSku['SODRAMAR-BM-824']?.salePrice === 810 && porSku['SODRAMAR-BM-824']?.cashPrice === 770 && /desatualizada/i.test(porSku['SODRAMAR-BM-824']?.priceTable ?? '') && /CONFIRMAR PREÇO/.test(porSku['SODRAMAR-BM-824']?.description ?? ''), porSku['SODRAMAR-BM-824']);
  check('itens de preço único (união inox) têm os dois preços iguais', porSku['SOL-COL-UNIAO-INOX-304']?.salePrice === 80 && porSku['SOL-COL-UNIAO-INOX-304']?.cashPrice === 80);
  check('vigência e condição registradas', porSku['SOL-RH-TROP304-H-500']?.priceTable === 'SOLIS – Reservatórios horizontais – Julho/2026' && porSku['SOL-RH-TROP304-H-500']?.installmentTerms === 'até 10x sem juros (Master/Visa)');

  // ── Busca da proposta: sob encomenda aparece mesmo com comSaldo=true ──
  const busca = await req('GET', '/products/search?q=trocador%2046.000&comSaldo=true&take=5', undefined, tk);
  check('busca com comSaldo=true traz item sob encomenda sem saldo', busca.status === 200 && busca.data.items.some((p) => p.sku === 'THOLZ-TC-303400002' && p.onDemand && p.totalStock === 0), busca.data.items.map((p) => p.sku));
  const tholz = busca.data.items.find((p) => p.sku === 'THOLZ-TC-303400002');
  check('busca devolve os dois preços e a tabela de origem', tholz.salePrice === 19300 && tholz.cashPrice === 18700 && tholz.priceTable && tholz.supplier === 'THOLZ', tholz);

  // produto comum sem saldo continua escondido com comSaldo=true
  const comum = await req('POST', '/products', { name: 'Tubo cobre 22mm teste', unit: 'UN', salePrice: 25 }, tk);
  const busca2 = await req('GET', '/products/search?q=tubo%20cobre%2022mm&comSaldo=true', undefined, tk);
  check('produto comum sem saldo continua fora da busca comSaldo=true', !busca2.data.items.some((p) => p.id === comum.data.id));

  // ── Cadastro manual aceita os campos novos ───────────────────────
  const manual = await req('POST', '/products', { name: 'Item manual com à vista', unit: 'UN', salePrice: 100, cashPrice: 95, installmentTerms: 'em 3x', onDemand: true, supplierCode: 'X-1' }, tk);
  check('POST /products aceita cashPrice/installmentTerms/onDemand/supplierCode', manual.status === 200 || manual.status === 201, manual);
  const editado = await req('PATCH', `/products/${manual.data.id}`, { cashPrice: null, onDemand: false }, tk);
  check('PATCH /products zera o à vista (nulo) e desliga sob encomenda', editado.status === 200 && editado.data.cashPrice == null && editado.data.onDemand === false, editado.data);

  // ── Proposta com item sob encomenda ─────────────────────────────
  const cli = await req('POST', '/customers', { name: 'Rafael' }, tk);
  const pr = await req('POST', '/proposals', { customerId: cli.data.id, clientName: 'RAFAEL', clientLocal: 'ITUPEVA / SP', scopeTitle: 'SISTEMA DE AQUECIMENTO VIA SOLAR' }, tk);
  check('criar proposta', pr.status === 200, pr);
  const pid = pr.data.id;

  const semEstoque = await req('PUT', `/proposals/${pid}/itens`, { items: [{ quantity: 1, quantityText: '01', description: 'Tubo', unitPrice: 25, total: 25, productId: comum.data.id }] }, tk);
  check('item comum sem saldo continua travado (422)', semEstoque.status === 422, semEstoque);

  const itens = await req('PUT', `/proposals/${pid}/itens`, {
    items: [
      { quantity: 1, quantityText: '01', description: tholz.name, unitPrice: tholz.cashPrice, total: tholz.cashPrice, productId: tholz.id, priceMode: 'A_VISTA' },
      { quantity: 2, quantityText: '02', description: 'Mão de obra', unitPrice: 500, total: 1000 },
    ],
  }, tk);
  check('item sob encomenda sem saldo passa na trava de estoque', itens.status === 200, itens);
  check('priceMode A_VISTA gravado no item', itens.data.items?.[0]?.priceMode === 'A_VISTA', itens.data.items?.[0]);
  check('proposta devolve os dois preços do produto no item', itens.data.items?.[0]?.product?.salePrice === 19300 && itens.data.items?.[0]?.product?.cashPrice === 18700 && itens.data.items?.[0]?.product?.onDemand === true, itens.data.items?.[0]?.product);
  check('total = 18.700 + 1.000', itens.data.total === 19700, itens.data.total);

  const disp = await req('GET', `/proposals/${pid}/disponibilidade`, undefined, tk);
  check('disponibilidade não acusa falta para item sob encomenda', disp.status === 200 && (disp.data.problemas ?? disp.data.faltando ?? []).length === 0, disp.data);

  const dup = await req('POST', `/proposals/${pid}/duplicar`, undefined, tk);
  check('duplicar mantém priceMode do item', dup.status === 200 && dup.data.items?.[0]?.priceMode === 'A_VISTA', dup.data.items?.[0]);

  // ── Exportação: layout novo ─────────────────────────────────────
  await req('PATCH', `/proposals/${pid}`, { salesRep: 'Driele Roscia', paymentTerms: 'Parcelado em até 10x', deliveryTerms: '10 a 20 dias úteis' }, tk);
  const pdf = await req('GET', `/proposals/${pid}/export/pdf`, undefined, tk);
  check('PDF gerado', pdf.status === 200 && pdf.buf?.length > 10_000, pdf.status);
  const texto = await textoPdf(pdf.buf);
  if (texto) {
    check('PDF: cabeçalho traz "Jund Aquece" e a razão social com "– ME"', /Jund Aquece/.test(texto) && /Comércio de Aquecedores Ltda – ME/.test(texto));
    check('PDF: especialidades em duas linhas como no papel timbrado', /Aquecedores Solares – Aquecedores para Piscina/.test(texto) && /Aquecedores a Gás – Instalações de Hidráulica e Elétrica/.test(texto));
    check('PDF: rodapé usa o e-mail da loja, não o login do dono', /jundaquece@jundaquece\.com\.br/.test(texto) && !/iagentics/.test(texto));
    check('PDF: rodapé com CONTATO (não mais "PABX") e sem numeração de página', /CONTATO: \(11\) 4522-6487/.test(texto) && !/PABX/.test(texto) && !/página \d+ de \d+/.test(texto));
    const paginas = texto.split('\f').filter((p) => p.trim());
    check('PDF: rodapé aparece uma única vez (só na última página)', (texto.match(/CONTATO: \(11\)/g) || []).length === 1 && (texto.match(/Luiz Latorre/g) || []).length === 1, paginas.length);
  } else {
    console.log('(pdftotext indisponível — checagens de texto do PDF puladas)');
  }

  // PDF longo (muitos itens) → mais de uma página, rodapé continua só na última
  const muitos = Array.from({ length: 40 }, (_, i) => ({ quantity: 1, quantityText: '01', description: `Item de teste número ${i + 1} com descrição longa o bastante para ocupar espaço na tabela da proposta.`, unitPrice: 10, total: 10 }));
  await req('PUT', `/proposals/${pid}/itens`, { items: muitos }, tk);
  const pdf2 = await req('GET', `/proposals/${pid}/export/pdf`, undefined, tk);
  const texto2 = await textoPdf(pdf2.buf);
  if (texto2) {
    const paginas = texto2.split('\f').filter((p) => p.trim());
    check('PDF de várias páginas: rodapé só na última', paginas.length >= 2 && (texto2.match(/CONTATO: \(11\)/g) || []).length === 1 && /CONTATO/.test(paginas[paginas.length - 1]) && !/CONTATO/.test(paginas[0]), paginas.length);
  }

  const docx = await req('GET', `/proposals/${pid}/export/docx`, undefined, tk);
  check('Word gerado', docx.status === 200 && docx.buf?.length > 10_000);
  const xlsx = await req('GET', `/proposals/${pid}/export/xlsx`, undefined, tk);
  check('Excel gerado', xlsx.status === 200 && xlsx.buf?.length > 5_000);

  // Word: sem rodapé de seção (footer1.xml) e com o e-mail da loja no corpo
  {
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, mkdtempSync, existsSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ef-docx-'));
    writeFileSync(join(dir, 'p.docx'), docx.buf);
    try {
      execFileSync('unzip', ['-o', '-q', join(dir, 'p.docx'), '-d', join(dir, 'x')]);
      const temFooter = existsSync(join(dir, 'x', 'word', 'footer1.xml'));
      const corpo = readFileSync(join(dir, 'x', 'word', 'document.xml'), 'utf8');
      check('Word: sem rodapé de seção (nada repetido em toda página)', !temFooter);
      check('Word: endereço/e-mail/contato uma vez, no fim do corpo', (corpo.match(/Luiz Latorre/g) || []).length === 1 && corpo.includes('jundaquece@jundaquece.com.br') && !corpo.includes('iagentics'));
      check('Word: cabeçalho em vermelho com "– ME"', corpo.includes('Comércio de Aquecedores Ltda – ME') && corpo.includes('w:color w:val="FF0000"'));
    } catch (e) { console.log('(unzip indisponível — checagens do Word puladas)', String(e).slice(0, 80)); }
  }

  // E-mail cadastrado pela empresa que NÃO é login de ninguém: deve ser respeitado
  const empresa = await req('PATCH', '/auth/company', { email: 'vendas@jundaquece.com.br' }, tk);
  if (empresa.status === 200) {
    const pdf3 = await req('GET', `/proposals/${pid}/export/pdf`, undefined, tk);
    const t3 = await textoPdf(pdf3.buf);
    if (t3) check('e-mail institucional cadastrado em Dados da empresa é respeitado', /vendas@jundaquece\.com\.br/.test(t3));
  } else {
    console.log(`(PATCH /auth/company devolveu ${empresa.status} — checagem do e-mail cadastrado pulada)`);
  }

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
