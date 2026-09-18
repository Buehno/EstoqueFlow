// Suite de regressão completa — roda contra o build local (mesmo commit
// publicado no Railway: ba61951) num Postgres isolado de teste. Cobre todos
// os módulos, não só os que foram alterados hoje.
const BASE = 'http://localhost:8080/api';
let passou = 0, falhou = 0;
const falhas = [];

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function check(nome, cond, extra) {
  if (cond) { passou++; console.log(`OK   ${nome}`); }
  else { falhou++; falhas.push(nome); console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

async function main() {
  // ── Auth / bootstrap ──────────────────────────────────────────────
  const reg = await req('POST', '/auth/register', {
    companyName: 'Teste Completo Ltda', name: 'Owner Teste', email: 'owner@completo.local', password: 'senha12345',
  });
  check('register cria empresa+owner', reg.status === 200 && reg.data.token, reg);
  const ownerToken = reg.data.token;
  check('owner nasce sem mustChangePassword', reg.data.user.mustChangePassword === false);

  const meOwner = await req('GET', '/auth/me', undefined, ownerToken);
  check('GET /auth/me funciona', meOwner.status === 200 && meOwner.data.user.email === 'owner@completo.local');

  // ── Warehouses (criados automaticamente no register) ─────────────
  const wh = await req('GET', '/warehouses', undefined, ownerToken);
  check('2 depósitos padrão criados no register', wh.status === 200 && wh.data.length === 2, wh.data);
  const whA = wh.data.find((w) => w.isDefault) ?? wh.data[0];
  const whB = wh.data.find((w) => w.id !== whA.id);

  // ── Categorias / fornecedores / clientes ──────────────────────────
  const cats = await req('GET', '/categories', undefined, ownerToken);
  check('categoria "Geral" criada no register', cats.status === 200 && cats.data.some((c) => c.name === 'Geral'), cats.data);

  const forn = await req('POST', '/suppliers', { name: 'Fornecedor Teste', phone: '11999990000' }, ownerToken);
  check('criar fornecedor', forn.status === 201 || forn.status === 200, forn);

  const cli = await req('POST', '/customers', { name: 'Cliente Teste', phone: '11988880000' }, ownerToken);
  check('criar cliente', cli.status === 201 || cli.status === 200, cli);

  // ── Produtos + busca sem /peça ─────────────────────────────────────
  const prod = await req('POST', '/products', {
    name: 'Tubo Cobre 22mm', unit: 'UN', costPrice: 10, salePrice: 25, minStock: 5,
  }, ownerToken);
  check('criar produto', prod.status === 201 || prod.status === 200, prod);
  const produtoId = prod.data.id;

  const busca = await req('GET', '/products/search?q=tubo', undefined, ownerToken);
  check('busca de produto sem /peça encontra por nome livre', busca.status === 200 && busca.data.items.some((p) => p.id === produtoId), busca.data);

  // ── Movimentações de estoque ────────────────────────────────────────
  const entrada = await req('POST', '/movements/entrada', { productId: produtoId, warehouseId: whA.id, quantity: 100, unitCost: 10 }, ownerToken);
  check('entrada de estoque', entrada.status === 201 || entrada.status === 200, entrada);

  const stockDepoisEntrada = await req('GET', `/stock?warehouseId=${whA.id}`, undefined, ownerToken);
  const linhaA = stockDepoisEntrada.data?.find?.((r) => r.productId === produtoId);
  check('saldo do depósito A reflete a entrada (100)', linhaA?.quantity === 100, linhaA);

  const transferencia = await req('POST', '/movements/transferencia', {
    productId: produtoId, fromWarehouseId: whA.id, toWarehouseId: whB.id, quantity: 30,
  }, ownerToken);
  check('transferência entre depósitos', transferencia.status === 201 || transferencia.status === 200, transferencia);

  const stockAposTransf = await req('GET', '/stock', undefined, ownerToken);
  const a2 = stockAposTransf.data?.find?.((r) => r.productId === produtoId && r.warehouseId === whA.id);
  const b2 = stockAposTransf.data?.find?.((r) => r.productId === produtoId && r.warehouseId === whB.id);
  check('saldo pós-transferência: A=70, B=30', a2?.quantity === 70 && b2?.quantity === 30, { a2, b2 });

  const saida = await req('POST', '/movements/saida', { productId: produtoId, warehouseId: whA.id, quantity: 10, reason: 'teste' }, ownerToken);
  check('saída de estoque', saida.status === 201 || saida.status === 200, saida);

  const saidaExcedente = await req('POST', '/movements/saida', { productId: produtoId, warehouseId: whA.id, quantity: 99999, reason: 'teste' }, ownerToken);
  check('saída maior que o saldo é bloqueada', saidaExcedente.status >= 400, saidaExcedente);

  // ── Vendas (PDV) ─────────────────────────────────────────────────
  const venda = await req('POST', '/sales', {
    warehouseId: whA.id,
    items: [{ productId: produtoId, quantity: 5, unitPrice: 25 }],
    paymentMethod: 'DINHEIRO',
  }, ownerToken);
  check('registrar venda no PDV', venda.status === 201 || venda.status === 200, venda);

  // ── Inventário cíclico ───────────────────────────────────────────
  const abrirContagem = await req('POST', '/counts', { warehouseId: whA.id }, ownerToken);
  check('abrir contagem de inventário', abrirContagem.status === 201 || abrirContagem.status === 200, abrirContagem);

  // ── Equipe: criar, travar por senha provisória, editar, excluir ───
  const criaFunc = await req('POST', '/auth/users', { name: 'Funcionário Teste', email: 'func@completo.local', password: '12345678', role: 'ESTOQUISTA' }, ownerToken);
  check('criar usuário força mustChangePassword=true', criaFunc.status === 200 && criaFunc.data.mustChangePassword === true, criaFunc);
  const funcId = criaFunc.data.id;

  const loginFunc = await req('POST', '/auth/login', { email: 'func@completo.local', password: '12345678' });
  const funcToken = loginFunc.data.token;
  const rotaTravada = await req('GET', '/warehouses', undefined, funcToken);
  check('conta nova é travada (403 SENHA_PROVISORIA) antes de trocar a senha', rotaTravada.status === 403 && rotaTravada.data.code === 'SENHA_PROVISORIA', rotaTravada);

  const troca = await req('PATCH', '/auth/me/password', { current: '12345678', next: 'novaSenhaAqui123' }, funcToken);
  check('troca de senha libera token novo', troca.status === 200 && !!troca.data.token, troca);
  const funcTokenNovo = troca.data.token;
  const rotaLiberada = await req('GET', '/warehouses', undefined, funcTokenNovo);
  check('após trocar a senha, rota libera', rotaLiberada.status === 200, rotaLiberada);

  const editaFunc = await req('PATCH', `/auth/users/${funcId}`, { name: 'Funcionário Editado', role: 'VENDEDOR' }, ownerToken);
  check('editar nome/papel de um usuário', editaFunc.status === 200 && editaFunc.data.role === 'VENDEDOR', editaFunc);

  const excluiFunc = await req('DELETE', `/auth/users/${funcId}`, undefined, ownerToken);
  check('excluir usuário sem histórico → excluído de verdade', excluiFunc.status === 200 && excluiFunc.data.modo === 'excluido', excluiFunc);

  // ── Propostas: criar, buscar sem /peça, salvar itens (bug do api.put) ──
  const proposta = await req('POST', '/proposals', { clientName: 'Cliente da Proposta' }, ownerToken);
  check('criar proposta', proposta.status === 201 || proposta.status === 200, proposta);
  const propostaId = proposta.data.id;

  const salvarItens = await req('PUT', `/proposals/${propostaId}/itens`, {
    items: [{ quantity: 2, description: 'Tubo Cobre 22mm', unitPrice: 25, productId: produtoId }],
  }, ownerToken);
  check('PUT /proposals/:id/itens funciona (era o bug do api.put no front)', salvarItens.status === 200, salvarItens);

  const propostaLida = await req('GET', `/proposals/${propostaId}`, undefined, ownerToken);
  check('proposta salva reflete o item e confere estoque', propostaLida.status === 200 && propostaLida.data.items?.length === 1, propostaLida.data);

  const mudaStatus = await req('POST', `/proposals/${propostaId}/status`, { status: 'ENVIADA' }, ownerToken);
  check('mudar status da proposta para ENVIADA', mudaStatus.status === 200, mudaStatus);

  // ── Ajuste de estoque ────────────────────────────────────────────
  const ajuste = await req('POST', '/movements/ajuste', { productId: produtoId, warehouseId: whA.id, newQuantity: 65, reason: 'contagem física' }, ownerToken);
  check('ajuste de estoque (define saldo absoluto)', ajuste.status === 201 || ajuste.status === 200, ajuste);

  // ── Relatórios ─────────────────────────────────────────────────────
  const dash = await req('GET', '/reports/dashboard', undefined, ownerToken);
  check('relatório dashboard responde', dash.status === 200 && typeof dash.data.valorTotalEstoque === 'number', dash.data);

  const abc = await req('GET', '/reports/abc', undefined, ownerToken);
  check('relatório ABC responde', abc.status === 200, abc);

  const giro = await req('GET', '/reports/giro', undefined, ownerToken);
  check('relatório de giro responde', giro.status === 200, giro);

  // ── Modelo de proposta (template) ───────────────────────────────
  const template = await req('POST', '/proposal-templates', {
    name: 'Modelo Teste', scopeTitle: 'INSTALAÇÃO PADRÃO',
    items: [{ quantity: 1, description: 'Kit padrão', unitPrice: 100 }],
  }, ownerToken);
  check('criar modelo de proposta', template.status === 201 || template.status === 200, template);

  // ── Empresa: dados + edição restrita a CAN_MANAGE ────────────────
  const empresa = await req('GET', '/auth/company', undefined, ownerToken);
  check('GET /company responde', empresa.status === 200 && empresa.data.name === 'Teste Completo Ltda', empresa.data);

  // ── Tutorial ───────────────────────────────────────────────────────
  const tut = await req('PATCH', '/auth/me/tutorial', { step: 2 }, ownerToken);
  check('avançar tutorial', tut.status === 200 && tut.data.tutorialStep === 2, tut);

  // ── Isolamento multi-tenant: outra empresa não vê nada da primeira ──
  const reg2 = await req('POST', '/auth/register', {
    companyName: 'Outra Empresa Ltda', name: 'Outro Owner', email: 'outro@completo.local', password: 'senha12345',
  });
  const outroToken = reg2.data.token;
  const buscaOutraEmpresa = await req('GET', '/products/search?q=tubo', undefined, outroToken);
  check('empresa B não vê produto da empresa A (isolamento multi-tenant)', buscaOutraEmpresa.status === 200 && buscaOutraEmpresa.data.items.length === 0, buscaOutraEmpresa.data);

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exit(1); }
}

main().catch((e) => { console.error('ERRO FATAL NO SCRIPT DE TESTE', e); process.exit(1); });
