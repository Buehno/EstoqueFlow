/**
 * Alerta diário por e-mail — pedido do Ronaldo (27/10).
 *
 * Todo dia, no horário configurado (padrão 8h, horário de Brasília), a
 * gestora recebe um resumo com os itens em ALERTA DE COMPRA (total somado dos
 * depósitos ≤ 50% do estoque aceitável) e quanto comprar para voltar ao
 * aceitável. Sem item em alerta, não manda nada (ninguém quer e-mail vazio).
 *
 * O remetente é configurável por empresa em Integrações (SMTP genérico:
 * Gmail com senha de app, Terra, Locaweb…). A senha fica no banco e nunca
 * volta para a tela (a API devolve só "está configurada").
 *
 * A varredura roda a cada 10 min e manda no máximo uma vez por dia por
 * empresa (`alertEmailLastAt`), então reiniciar o servidor não repete o envio.
 */
import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { posicaoCompra, type LinhaCompra } from './compras.service.js';

const FUSO = 'America/Sao_Paulo';

const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Hora (0–23) e data (YYYY-MM-DD) de `agora` no horário de Brasília. */
export function agoraEmBrasilia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(agora);
  const pegar = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return { data: `${pegar('year')}-${pegar('month')}-${pegar('day')}`, hora: Number(pegar('hour')) % 24 };
}

export interface ConfigSmtp {
  host: string;
  port: number;
  secure: boolean;
  user?: string | null;
  pass?: string | null;
  from: string;
}

export function configSmtpDaEmpresa(c: {
  smtpHost: string | null; smtpPort: number | null; smtpSecure: boolean;
  smtpUser: string | null; smtpPass: string | null; smtpFrom: string | null; email: string | null;
}): ConfigSmtp | null {
  if (!c.smtpHost) return null;
  const port = c.smtpPort ?? (c.smtpSecure ? 465 : 587);
  const from = c.smtpFrom || c.smtpUser || c.email;
  if (!from) return null;
  return { host: c.smtpHost, port, secure: c.smtpSecure, user: c.smtpUser, pass: c.smtpPass, from };
}

function transporte(cfg: ConfigSmtp) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

const destinatarios = (texto: string | null | undefined) =>
  (texto ?? '').split(/[,;\s]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

/** Monta assunto, texto e HTML do resumo. `null` quando não há nada em alerta. */
export async function montarResumo(companyId: string) {
  const empresa = await prisma.company.findUnique({ where: { id: companyId } });
  if (!empresa) return null;
  const compras = await posicaoCompra(companyId);
  const alerta = compras.alerta;
  if (!alerta.length) return null;

  const { data } = agoraEmBrasilia();
  const dataBr = data.split('-').reverse().join('/');
  const assunto = `[${empresa.name}] ${alerta.length} item(ns) em alerta de compra — ${dataBr}`;

  const linha = (i: LinhaCompra) =>
    `${i.name}${i.size ? ` ${i.size}` : ''} — saldo ${NUM.format(i.total)} ${i.unit} (aceitável ${NUM.format(i.minStock)}) → comprar ${NUM.format(i.comprarParaRepor)} ${i.unit}` +
    (i.fornecedor ? ` · ${i.fornecedor}` : '');

  const texto = [
    `Bom dia! Estes itens chegaram a 50% do estoque aceitável (total dos depósitos) e pedem compra:`,
    '',
    ...alerta.map((i, n) => `${n + 1}. ${linha(i)}`),
    '',
    `Reposição estimada: ${BRL.format(compras.resumo.valorAComprar)}.`,
    compras.resumo.semMinimo ? `${compras.resumo.semMinimo} produto(s) ainda sem estoque aceitável definido ficam fora deste alerta.` : '',
    '',
    `— EstoqueFlow · ${empresa.name}`,
  ].filter((l) => l !== undefined).join('\n');

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const linhasHtml = alerta.map((i) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.name)}${i.size ? ` <span style="color:#666">${esc(i.size)}</span>` : ''}${i.fornecedor ? `<br><span style="color:#888;font-size:12px">${esc(i.fornecedor)}</span>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:#c00"><b>${NUM.format(i.total)}</b> ${esc(i.unit)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${NUM.format(i.minStock)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right"><b>${NUM.format(i.comprarParaRepor)}</b> ${esc(i.unit)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${i.depositos.map((d) => `${esc(d.code)}: ${NUM.format(d.quantity)}`).join('<br>')}</td>
    </tr>`).join('');
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;max-width:720px">
    <p>Bom dia! Estes itens chegaram a <b>50% do estoque aceitável</b> (total dos depósitos) e pedem compra:</p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr style="background:#f3f3f3;font-size:12px;text-transform:uppercase;color:#555">
        <th style="padding:6px 8px;text-align:left">Produto</th><th style="padding:6px 8px;text-align:right">Saldo</th>
        <th style="padding:6px 8px;text-align:right">Aceitável</th><th style="padding:6px 8px;text-align:right">Comprar</th><th style="padding:6px 8px;text-align:right">Por depósito</th>
      </tr></thead>
      <tbody>${linhasHtml}</tbody>
    </table>
    <p style="margin-top:14px">Reposição estimada: <b>${BRL.format(compras.resumo.valorAComprar)}</b>.</p>
    ${compras.resumo.semMinimo ? `<p style="color:#666;font-size:12px">${compras.resumo.semMinimo} produto(s) ainda sem estoque aceitável definido ficam fora deste alerta.</p>` : ''}
    <p style="color:#888;font-size:12px;margin-top:20px">— EstoqueFlow · ${esc(empresa.name)}</p>
  </div>`;

  return { assunto, texto, html, itens: alerta.length, valor: compras.resumo.valorAComprar };
}

export interface ResultadoEnvio {
  enviado: boolean;
  motivo?: string;
  para?: string[];
  itens?: number;
  messageId?: string;
}

/**
 * Envia o resumo do dia para a empresa. Com `forcar`, manda mesmo que já
 * tenha ido hoje e mesmo fora do horário (botão "enviar agora").
 */
export async function enviarAlerta(companyId: string, opcoes: { forcar?: boolean } = {}): Promise<ResultadoEnvio> {
  const empresa = await prisma.company.findUnique({ where: { id: companyId } });
  if (!empresa) return { enviado: false, motivo: 'Empresa não encontrada.' };
  const cfg = configSmtpDaEmpresa(empresa);
  if (!cfg) return { enviado: false, motivo: 'SMTP não configurado (Integrações → Alerta por e-mail).' };
  const para = destinatarios(empresa.alertEmailTo);
  if (!para.length) return { enviado: false, motivo: 'Nenhum destinatário válido cadastrado.' };

  const resumo = await montarResumo(companyId);
  if (!resumo) return { enviado: false, motivo: 'Nenhum item em alerta de compra — nada a enviar.', para, itens: 0 };

  const info = await transporte(cfg).sendMail({ from: cfg.from, to: para, subject: resumo.assunto, text: resumo.texto, html: resumo.html });
  await prisma.company.update({ where: { id: companyId }, data: { alertEmailLastAt: new Date() } });
  return { enviado: true, para, itens: resumo.itens, messageId: info.messageId };
}

/** E-mail de teste da configuração — não depende de haver alerta. */
export async function enviarTeste(companyId: string, destino?: string): Promise<ResultadoEnvio> {
  const empresa = await prisma.company.findUnique({ where: { id: companyId } });
  if (!empresa) return { enviado: false, motivo: 'Empresa não encontrada.' };
  const cfg = configSmtpDaEmpresa(empresa);
  if (!cfg) return { enviado: false, motivo: 'SMTP não configurado.' };
  const para = destino ? destinatarios(destino) : destinatarios(empresa.alertEmailTo);
  if (!para.length) return { enviado: false, motivo: 'Nenhum destinatário válido.' };
  const info = await transporte(cfg).sendMail({
    from: cfg.from, to: para,
    subject: `[${empresa.name}] Teste do alerta por e-mail do EstoqueFlow`,
    text: `Se você recebeu esta mensagem, o envio de e-mail do EstoqueFlow está funcionando.\nO resumo diário sai às ${empresa.alertEmailHour}h (horário de Brasília) quando houver item em alerta de compra.`,
  });
  return { enviado: true, para, messageId: info.messageId };
}

/** Já foi enviado hoje (data de Brasília)? */
function enviadoHoje(ultimo: Date | null, hoje: string) {
  return !!ultimo && agoraEmBrasilia(ultimo).data === hoje;
}

/**
 * Varredura periódica: para cada empresa com o alerta ligado e SMTP
 * configurado, manda uma vez por dia a partir do horário escolhido.
 */
export async function varreduraAlertasEmail(log?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void }, agora = new Date()) {
  const { data: hoje, hora } = agoraEmBrasilia(agora);
  const empresas = await prisma.company.findMany({
    where: { active: true, alertEmailEnabled: true, smtpHost: { not: null } },
    select: { id: true, name: true, alertEmailHour: true, alertEmailLastAt: true },
  });
  const resultados: { empresa: string; resultado: ResultadoEnvio | 'fora-do-horario' | 'ja-enviado' }[] = [];
  for (const e of empresas) {
    if (hora < e.alertEmailHour) { resultados.push({ empresa: e.name, resultado: 'fora-do-horario' }); continue; }
    if (enviadoHoje(e.alertEmailLastAt, hoje)) { resultados.push({ empresa: e.name, resultado: 'ja-enviado' }); continue; }
    try {
      const r = await enviarAlerta(e.id);
      // Sem item em alerta também conta como "feito hoje": evita tentar de 10 em 10 min.
      if (!r.enviado && r.itens === 0) await prisma.company.update({ where: { id: e.id }, data: { alertEmailLastAt: agora } });
      resultados.push({ empresa: e.name, resultado: r });
      log?.info({ empresa: e.name, ...r }, 'alerta por e-mail');
    } catch (err) {
      log?.warn({ empresa: e.name, err: String(err) }, 'alerta por e-mail falhou');
      resultados.push({ empresa: e.name, resultado: { enviado: false, motivo: String(err) } });
    }
  }
  return resultados;
}
