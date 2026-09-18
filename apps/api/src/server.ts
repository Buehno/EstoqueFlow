import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { env, isProd } from './env.js';
import { prisma } from './lib/prisma.js';
import { AppError } from './lib/errors.js';
import { startSyncWorkers } from './services/sync.service.js';

import authRoutes from './routes/auth.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import stockRoutes from './routes/stock.routes.js';
import salesRoutes from './routes/sales.routes.js';
import countsRoutes from './routes/counts.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import tutorialRoutes from './routes/tutorial.routes.js';
import proposalRoutes from './routes/proposals.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/server.js → apps/api/dist → ../../web/dist
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

const app = Fastify({
  logger: {
    level: isProd ? 'info' : 'debug',
    transport: isProd ? undefined : undefined,
  },
  trustProxy: true,
  bodyLimit: 5 * 1024 * 1024,
});

// POST/PATCH sem corpo (ex.: ações que não precisam de payload) não devem quebrar
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body: string, done) => {
  if (!body || !body.trim()) return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    (err as { statusCode?: number }).statusCode = 400;
    done(err as Error, undefined);
  }
});

await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
await app.register(cors, {
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
  credentials: true,
});
await app.register(cookie);
await app.register(rateLimit, {
  max: 600,
  timeWindow: '1 minute',
  allowList: (req) => req.url.startsWith('/health'),
});

// ─────────────────────────── Erros ───────────────────────────
app.setErrorHandler((error, req, reply) => {
  if (error instanceof ZodError) {
    return reply.status(422).send({
      error: 'Dados inválidos',
      code: 'VALIDATION_ERROR',
      details: error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    });
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return reply.status(409).send({ error: 'Registro duplicado.', code: 'DUPLICATE' });
    }
    if (error.code === 'P2025') {
      return reply.status(404).send({ error: 'Registro não encontrado.', code: 'NOT_FOUND' });
    }
  }
  req.log.error({ err: error }, 'Erro não tratado');
  const e = error as { statusCode?: number; message?: string };
  const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
  return reply.status(status).send({
    error: isProd && status >= 500 ? 'Erro interno no servidor.' : (e.message ?? 'Erro inesperado.'),
    code: 'INTERNAL_ERROR',
  });
});

// ─────────────────────────── Health ───────────────────────────
app.get('/health', async () => {
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return {
    status: 'ok',
    service: 'EstoqueFlow API',
    version: '1.0.0',
    db: `ok (${Date.now() - started}ms)`,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
});

app.get('/api', async () => ({
  name: 'EstoqueFlow API',
  version: '1.0.0',
  docs: '/api/docs',
  endpoints: [
    'POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me',
    'GET /api/tutorial',
    'GET|POST /api/products', 'GET /api/products/barcode/:code',
    'GET /api/warehouses', 'GET /api/stock',
    'POST /api/movements/entrada', 'POST /api/movements/saida',
    'POST /api/movements/transferencia', 'POST /api/movements/ajuste',
    'POST /api/sales', 'GET /api/sales',
    'POST /api/counts', 'POST /api/counts/:id/aplicar',
    'GET /api/reports/dashboard', 'GET /api/reports/abc', 'GET /api/reports/giro',
    'GET /api/sync/status',
  ],
}));

// ─────────────────────────── Rotas ───────────────────────────
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(tutorialRoutes, { prefix: '/api' });
await app.register(catalogRoutes, { prefix: '/api' });
await app.register(stockRoutes, { prefix: '/api' });
await app.register(salesRoutes, { prefix: '/api' });
await app.register(countsRoutes, { prefix: '/api' });
await app.register(reportsRoutes, { prefix: '/api' });
await app.register(proposalRoutes, { prefix: '/api' });

// ─────────────────────── Frontend (SPA) ───────────────────────
if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
      return reply.status(404).send({ error: 'Rota não encontrada.', code: 'NOT_FOUND' });
    }
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn(`Build do frontend não encontrado em ${WEB_DIST} — servindo apenas a API.`);
}

// ─────────────────────────── Boot ───────────────────────────
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Encerrando...');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * Abre o socket em dual-stack quando o host suporta IPv6 (caso do Railway, cuja
 * rede privada é IPv6-only) e cai para IPv4 puro quando não suporta.
 */
async function listenResilient(): Promise<string> {
  const candidates = env.HOST === '::' ? ['::', '0.0.0.0'] : [env.HOST, '::', '0.0.0.0'];
  let lastError: unknown;
  for (const host of candidates) {
    try {
      await app.listen({ port: env.PORT, host });
      return host;
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string }).code;
      if (code !== 'EAFNOSUPPORT' && code !== 'EADDRNOTAVAIL' && code !== 'ERR_SOCKET_BAD_PORT') throw err;
      // eslint-disable-next-line no-console
      console.warn(`[boot] host ${host} indisponível (${code}); tentando o próximo…`);
    }
  }
  throw lastError;
}

try {
  // console.log cru: garante rastro no boot mesmo antes do logger da plataforma
  // eslint-disable-next-line no-console
  console.log(`[boot] EstoqueFlow · node ${process.version} · porta ${env.PORT}`);
  const boundHost = await listenResilient();
  // eslint-disable-next-line no-console
  console.log(`[boot] escutando em ${boundHost}:${env.PORT}`);
  app.log.info(`EstoqueFlow no ar em http://${boundHost}:${env.PORT}`);

  // O seed roda DEPOIS que a porta já está aberta: o healthcheck da plataforma
  // não fica esperando a carga inicial do banco terminar.
  if (env.SEED_DEMO) {
    const seedPath = path.resolve(process.cwd(), 'prisma/seed.mjs');
    if (existsSync(seedPath)) {
      const child = spawn(process.execPath, [seedPath], { stdio: 'inherit', env: process.env });
      child.on('exit', (code) =>
        code === 0
          ? app.log.info('Seed inicial concluído.')
          : app.log.warn({ code }, 'Seed inicial terminou com erro (a aplicação continua no ar).'),
      );
      child.on('error', (e) => app.log.warn({ err: String(e) }, 'Não foi possível executar o seed.'));
    }
  }

  startSyncWorkers(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
