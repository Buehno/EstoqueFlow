// Suite das permissões por pessoa (27/10/2026): papéis GESTOR / ADMINISTRADOR /
// OPERADOR, liga/desliga de capacidade por usuário, hierarquia de quem mexe
// em quem, e enforcement nas rotas. Roda contra a API local num banco limpo.
const BASE = process.env.BASE || 'http://localhost:8080/api';
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
const login = async (email) => (await req('POST', '/auth/login', { email, password: 'senha12345' })).data.token;
/** Cria a pessoa e já troca a senha provisória (login devolve token com troca pendente). */
async function pessoa(ownerTk, nome, role, overrides) {
  const email = `${nome.toLowerCase()}@perm.local`;
  const r = await req('POST', '/auth/users', { name: nome, email, password: 'provisoria123', role, permissionOverrides: overrides }, ownerTk);
  if (r.status !== 200) throw new Error(`criar ${nome}: ${r.status} ${JSON.stringify(r.data)}`);
  const t0 = (await req('POST', '/auth/login', { email, password: 'provisoria123' })).data.token;
  const troca = await req('PATCH', '/auth/me/password', { current: 'provisoria123', next: 'senha12345' }, t0);
  return { id: r.data.id, email, token: troca.data.token, criado: r.data };
}

async function main() {
  const reg = await req('POST', '/auth/register', { companyName: 'Jundiaquece Perm', name: 'Owner', email: 'owner@perm.local', password: 'senha12345' });
  const owner = reg.data.token;
  check('register', reg.status === 200 && owner, reg);

  const me = await req('GET', '/auth/me', undefined, owner);
  check('/auth/me devolve caps e roleLabel', Array.isArray(me.data.user.caps) && me.data.user.caps.length === 10 && me.data.user.roleLabel === 'Proprietário', me.data.user);

  const cat = await req('GET', '/auth/users/catalogo', undefined, owner);
  check('catálogo: 4 papéis atribuíveis e 10 capacidades', cat.data.papeis.length === 4 && cat.data.capacidades.length === 10, cat.data);

  // ── papéis ───────────────────────────────────────────────────────
  const gestora = await pessoa(owner, 'Edneia', 'GESTOR');
  const admin = await pessoa(owner, 'Daniele', 'ADMINISTRADOR');
  const oper = await pessoa(owner, 'Driele', 'OPERADOR');
  const leitura = await pessoa(owner, 'Visita', 'LEITURA');

  const capsDe = async (t) => (await req('GET', '/auth/me', undefined, t)).data.user.caps;
  check('Gestora tem tudo', (await capsDe(gestora.token)).length === 10);
  const capsAdmin = await capsDe(admin.token);
  check('Administradora: operacional + cadastros + inventário + resumido + alertas + equipe, sem relatório completo nem regras',
    capsAdmin.includes('VER_RELATORIO_RESUMIDO') && capsAdmin.includes('VER_ALERTAS') && capsAdmin.includes('GERENCIAR_EQUIPE') &&
    !capsAdmin.includes('VER_RELATORIO_COMPLETO') && !capsAdmin.includes('GERENCIAR_REGRAS_ALERTA'), capsAdmin);
  const capsOper = await capsDe(oper.token);
  check('Operadora: só movimentar, vender e propostas', capsOper.length === 3 && capsOper.includes('MOVIMENTAR_ESTOQUE') && capsOper.includes('VENDER_BALCAO') && capsOper.includes('GERENCIAR_PROPOSTAS'), capsOper);

  // ── enforcement nas rotas ────────────────────────────────────────
  const wh = (await req('GET', '/warehouses', undefined, owner)).data;
  const prod = await req('POST', '/products', { name: 'Tubo teste', unit: 'UN', minStock: 10 }, owner);
  const ent = await req('POST', '/movements/entrada', { productId: prod.data.id, warehouseId: wh[0].id, quantity: 20 }, oper.token);
  check('Operadora movimenta estoque', ent.status === 200 || ent.status === 201, ent);
  check('Operadora NÃO vê o painel', (await req('GET', '/reports/dashboard', undefined, oper.token)).status === 403);
  check('Operadora NÃO vê relatório de compras', (await req('GET', '/reports/compras', undefined, oper.token)).status === 403);
  check('Operadora NÃO cadastra produto', (await req('POST', '/products', { name: 'X', unit: 'UN' }, oper.token)).status === 403);
  check('Operadora NÃO abre a equipe', (await req('GET', '/auth/users', undefined, oper.token)).status === 403);
  check('Operadora NÃO estorna (regras de alerta)', (await req('POST', `/movements/${ent.data.id ?? ent.data.movement?.id}/estorno`, {}, oper.token)).status === 403);
  check('Leitura vê o painel', (await req('GET', '/reports/dashboard', undefined, leitura.token)).status === 200);
  check('Leitura NÃO movimenta', (await req('POST', '/movements/entrada', { productId: prod.data.id, warehouseId: wh[0].id, quantity: 1 }, leitura.token)).status === 403);
  check('Administradora vê compras mas não o relatório completo', (await req('GET', '/reports/compras', undefined, admin.token)).status === 200 && (await req('GET', '/reports/abc', undefined, admin.token)).status === 403);
  const mensagem = (await req('GET', '/reports/abc', undefined, admin.token)).data;
  check('403 explica qual permissão falta', /permissão/.test(mensagem.error ?? '') && /Relatório completo/.test(mensagem.error ?? ''), mensagem);

  // ── liga/desliga por pessoa ──────────────────────────────────────
  let r = await req('PATCH', `/auth/users/${oper.id}`, { permissionOverrides: { VER_ALERTAS: true, VENDER_BALCAO: false } }, owner);
  check('owner liga VER_ALERTAS e desliga VENDER_BALCAO na operadora', r.status === 200 && r.data.permissoes.find((p) => p.cap === 'VER_ALERTAS').efetiva === true && r.data.permissoes.find((p) => p.cap === 'VENDER_BALCAO').efetiva === false, r.data.permissoes);
  check('resposta marca o override por cima do papel', r.data.permissoes.find((p) => p.cap === 'VER_ALERTAS').override === true && r.data.permissoes.find((p) => p.cap === 'VER_ALERTAS').padrao === false);
  check('vale na hora, sem novo login: operadora agora vê compras', (await req('GET', '/reports/compras', undefined, oper.token)).status === 200);
  const venda = await req('POST', '/sales', { warehouseId: wh[0].id, items: [{ productId: prod.data.id, quantity: 1, unitPrice: 10 }], paymentMethod: 'DINHEIRO' }, oper.token);
  check('vale na hora: operadora não vende mais no balcão', venda.status === 403, venda);
  r = await req('PATCH', `/auth/users/${oper.id}`, { permissionOverrides: {} }, owner);
  check('override vazio volta ao padrão do papel', r.status === 200 && r.data.permissoes.every((p) => p.override === null) && r.data.permissionOverrides == null, r.data);
  check('operadora volta a não ver compras', (await req('GET', '/reports/compras', undefined, oper.token)).status === 403);

  // ── hierarquia ───────────────────────────────────────────────────
  check('Administradora NÃO edita a Gestora', (await req('PATCH', `/auth/users/${gestora.id}`, { name: 'Nome Teste' }, admin.token)).status === 409);
  check('Administradora edita a Operadora', (await req('PATCH', `/auth/users/${oper.id}`, { name: 'Driele Roscia' }, admin.token)).status === 200);
  const negado = await req('PATCH', `/auth/users/${oper.id}`, { permissionOverrides: { VER_RELATORIO_COMPLETO: true } }, admin.token);
  check('Administradora NÃO liga para outra pessoa o que ela mesma não tem', negado.status === 409 && /não tem essa permissão/.test(negado.data.error), negado.data);
  check('Administradora liga para a Operadora o que ela tem (VER_ALERTAS)', (await req('PATCH', `/auth/users/${oper.id}`, { permissionOverrides: { VER_ALERTAS: true } }, admin.token)).status === 200);
  check('Administradora NÃO promove alguém a Gestora', (await req('PATCH', `/auth/users/${oper.id}`, { role: 'GESTOR' }, admin.token)).status === 409);
  check('catálogo da Administradora só oferece papéis abaixo dela', (await req('GET', '/auth/users/catalogo', undefined, admin.token)).data.papeis.every((p) => ['OPERADOR', 'LEITURA'].includes(p.role)));
  check('Gestora cria Administradora', (await req('POST', '/auth/users', { name: 'Gabriele', email: 'gabriele@perm.local', password: 'provisoria123', role: 'ADMINISTRADOR' }, gestora.token)).status === 200);
  check('Gestora NÃO cria outra Gestora', (await req('POST', '/auth/users', { name: 'G2', email: 'g2@perm.local', password: 'provisoria123', role: 'GESTOR' }, gestora.token)).status === 409);
  check('ninguém muda o próprio papel', (await req('PATCH', `/auth/users/${gestora.id}`, { role: 'OPERADOR' }, gestora.token)).status === 409);
  check('ninguém edita o proprietário', (await req('PATCH', `/auth/users/${me.data.user.id}`, { name: 'Nome Teste' }, gestora.token)).status === 409);

  // ── papéis antigos continuam valendo ─────────────────────────────
  const antigo = await pessoa(owner, 'Antigo', 'ADMIN');
  check('papel antigo ADMIN vale como Gestor (tudo)', (await capsDe(antigo.token)).length === 10);
  const vend = await pessoa(owner, 'Vendedor', 'VENDEDOR');
  const capsVend = await capsDe(vend.token);
  check('papel antigo VENDEDOR: balcão + propostas', capsVend.length === 2 && capsVend.includes('VENDER_BALCAO'), capsVend);

  // ── desativar derruba na hora ────────────────────────────────────
  await req('PATCH', `/auth/users/${oper.id}`, { active: false }, owner);
  check('pessoa desativada perde o acesso mesmo com token válido', (await req('GET', '/auth/me', undefined, oper.token)).status === 401);
  check('não dá para se desativar', (await req('PATCH', `/auth/users/${gestora.id}`, { active: false }, gestora.token)).status === 409);

  const lista = await req('GET', '/auth/users', undefined, owner);
  check('lista traz permissoes detalhadas por pessoa', lista.data.every((u) => Array.isArray(u.permissoes) && u.permissoes.length === 10 && u.roleLabel));

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
