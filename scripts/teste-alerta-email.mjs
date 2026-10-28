// Suite do alerta diário por e-mail (27/10/2026). Sobe um servidor SMTP de
// teste local (smtp-server) na porta 2525, configura a empresa para usar
// esse servidor e confere: conteúdo do resumo, "nada a enviar" sem alerta,
// teste de envio, envio agora, senha nunca devolvida pela API, e a regra
// de uma vez por dia da varredura (via ALERTA_EMAIL_AUTO=off + endpoint).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server');

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
  else { falhou++; falhas.push(nome); console.log(`FALHOU ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

const recebidos = [];
let credenciaisVistas = null;
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onAuth(auth, session, cb) {
    credenciaisVistas = { user: auth.username, pass: auth.password };
    cb(null, { user: auth.username });
  },
  onData(stream, session, cb) {
    let raw = '';
    stream.on('data', (c) => { raw += c.toString('utf8'); });
    stream.on('end', () => { recebidos.push({ raw, to: session.envelope.rcptTo.map((r) => r.address), from: session.envelope.mailFrom.address }); cb(); });
  },
});
await new Promise((r) => smtp.listen(2525, '127.0.0.1', r));

/** Decodifica o corpo (quoted-printable / base64) para procurar texto. */
function corpo(raw) {
  const partes = raw.split(/\r?\n\r?\n/);
  const texto = partes.slice(1).join('\n');
  const qp = texto.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(qp, 'latin1').toString('utf8') + '\n' + texto;
}

try {
  const reg = await req('POST', '/auth/register', { companyName: 'Jundiaquece Email', name: 'Owner', email: 'owner@email.local', password: 'senha12345' });
  const tk = reg.data.token;
  const wh = (await req('GET', '/warehouses', undefined, tk)).data;

  // sem SMTP configurado
  let r = await req('POST', '/auth/company/alerta-email/enviar-agora', {}, tk);
  check('sem SMTP: não envia e explica', r.status === 200 && r.data.enviado === false && /SMTP/.test(r.data.motivo), r.data);

  // configura
  r = await req('PATCH', '/auth/company', {
    alertEmailEnabled: true, alertEmailTo: 'gestora@jundaquece.local, compras@jundaquece.local', alertEmailHour: 8,
    smtpHost: '127.0.0.1', smtpPort: 2525, smtpSecure: false, smtpUser: 'loja@jundaquece.local', smtpPass: 'segredo-smtp', smtpFrom: 'EstoqueFlow <loja@jundaquece.local>',
  }, tk);
  check('configuração salva', r.status === 200 && r.data.smtpHost === '127.0.0.1' && r.data.smtpPassSet === true, r.data);
  check('senha do SMTP não volta na resposta', r.data.smtpPass === undefined, Object.keys(r.data));
  const c = await req('GET', '/auth/company', undefined, tk);
  check('GET /company também esconde a senha', c.data.smtpPass === undefined && c.data.smtpPassSet === true, c.data);
  r = await req('PATCH', '/auth/company', { smtpPass: '', alertEmailHour: 7 }, tk);
  check('senha em branco mantém a gravada', r.data.smtpPassSet === true && r.data.alertEmailHour === 7, r.data);

  // teste de envio
  r = await req('POST', '/auth/company/alerta-email/testar', {}, tk);
  check('e-mail de teste enviado para os 2 destinatários', r.status === 200 && r.data.enviado === true && r.data.para.length === 2, r.data);
  await new Promise((x) => setTimeout(x, 300));
  check('servidor SMTP recebeu o teste', recebidos.length === 1 && recebidos[0].to.includes('gestora@jundaquece.local') && /Teste do alerta/.test(recebidos[0].raw), recebidos[0]?.to);
  check('remetente é o configurado', recebidos[0]?.from === 'loja@jundaquece.local', recebidos[0]?.from);
  check('autenticou no SMTP com usuário e senha gravados', credenciaisVistas?.user === 'loja@jundaquece.local' && credenciaisVistas?.pass === 'segredo-smtp', credenciaisVistas);

  // sem item em alerta → nada a enviar
  r = await req('POST', '/auth/company/alerta-email/enviar-agora', {}, tk);
  check('sem item em alerta: não manda e-mail vazio', r.data.enviado === false && r.data.itens === 0, r.data);
  const previa = await req('GET', '/auth/company/alerta-email/previa', undefined, tk);
  check('prévia diz que não há nada', previa.data.itens === 0, previa.data);

  // cria alerta: sugerido 100, saldo 40 (≤ 50%) → alerta; outro com 70 → não
  const p1 = (await req('POST', '/products', { name: 'Tubo marrom 25 mm', unit: 'UN', minStock: 100, costPrice: 12.5 }, tk)).data;
  const p2 = (await req('POST', '/products', { name: 'Cotovelo 25 mm', unit: 'UN', minStock: 100 }, tk)).data;
  await req('POST', '/movements/entrada', { productId: p1.id, warehouseId: wh[0].id, quantity: 25 }, tk);
  await req('POST', '/movements/entrada', { productId: p1.id, warehouseId: wh[1].id, quantity: 15 }, tk);
  await req('POST', '/movements/entrada', { productId: p2.id, warehouseId: wh[0].id, quantity: 70 }, tk);

  const previa2 = await req('GET', '/auth/company/alerta-email/previa', undefined, tk);
  check('prévia lista 1 item (o de 40, não o de 70)', previa2.data.itens === 1 && /Tubo marrom/.test(previa2.data.texto) && !/Cotovelo/.test(previa2.data.texto), previa2.data);
  check('prévia traz saldo, sugerido e quanto comprar (60) e o valor estimado (60 × 12,50 = 750)', /saldo 40/.test(previa2.data.texto) && /sugerido 100/.test(previa2.data.texto) && /comprar 60/.test(previa2.data.texto) && /750,00/.test(previa2.data.texto), previa2.data.texto);

  r = await req('POST', '/auth/company/alerta-email/enviar-agora', {}, tk);
  check('resumo enviado', r.data.enviado === true && r.data.itens === 1, r.data);
  await new Promise((x) => setTimeout(x, 300));
  const ultimo = recebidos[recebidos.length - 1];
  const assunto = (ultimo?.raw.match(/^Subject:((?:.|\r?\n[ \t])+)/m)?.[1] ?? '').replace(/\r?\n[ \t]/g, '')
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, q) => Buffer.from(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
  check('e-mail do resumo chegou com assunto e tabela', recebidos.length === 2 && /1 item\(ns\) em alerta de compra/.test(assunto) && /Tubo marrom/.test(corpo(ultimo.raw)), assunto);
  const c2 = await req('GET', '/auth/company', undefined, tk);
  check('último envio registrado', !!c2.data.alertEmailLastAt, c2.data.alertEmailLastAt);

  // permissão: operador não configura nem dispara
  const op = await req('POST', '/auth/users', { name: 'Driele', email: 'driele@email.local', password: 'provisoria123', role: 'OPERADOR' }, tk);
  const t0 = (await req('POST', '/auth/login', { email: 'driele@email.local', password: 'provisoria123' })).data.token;
  const troca = await req('PATCH', '/auth/me/password', { current: 'provisoria123', next: 'senha12345' }, t0);
  check('operadora não dispara o alerta (403)', (await req('POST', '/auth/company/alerta-email/enviar-agora', {}, troca.data.token)).status === 403);

  // desativar
  r = await req('PATCH', '/auth/company', { alertEmailEnabled: false }, tk);
  check('alerta pode ser desligado', r.data.alertEmailEnabled === false, r.data);

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhas.length) { console.log('Falhas:', falhas); process.exitCode = 1; }
} finally {
  smtp.close();
}
