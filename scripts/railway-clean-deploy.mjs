/**
 * Deploy limpo: cria um serviço novo, publica as variáveis, espera a
 * propagação e só então envia o código — sem mexer em configuração depois,
 * para não disparar redeploys concorrentes de snapshots antigos.
 */
import { createGzip } from 'node:zlib';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const TOKEN = process.env.RAILWAY_TOKEN;
const HOST = 'https://backboard.railway.app';
const PROJECT = process.env.PROJECT_ID;
const ENVIRONMENT = process.env.ENVIRONMENT_ID;
const SERVICE_NAME = process.env.SERVICE_NAME || `estoqueflow-${Date.now().toString(36)}`;
const PG_PASSWORD = process.env.PG_PASSWORD;
const DB_SERVICE = process.env.DB_SERVICE || 'Postgres';

const gql = async (query, variables = {}) => {
  const r = await fetch(`${HOST}/graphql/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join(' | '));
  return j.data;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`▸ Criando serviço ${SERVICE_NAME}…`);
const { serviceCreate } = await gql(
  `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
  { input: { projectId: PROJECT, name: SERVICE_NAME } },
);
const serviceId = serviceCreate.id;
console.log(`  ${serviceId}`);

const vars = {
  NODE_ENV: 'production',
  PORT: '8080',
  HOST: '::',
  DATABASE_URL: `postgresql://postgres:${PG_PASSWORD}@\${{${DB_SERVICE}.RAILWAY_PRIVATE_DOMAIN}}:5432/railway`,
  JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
  CORS_ORIGIN: '*',
  SHEET_SYNC_ENABLED: process.env.SHEET_SYNC_ENABLED || 'false',
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '',
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  DEMO_EMAIL: process.env.DEMO_EMAIL || 'demo@estoqueflow.app',
  DEMO_PASSWORD: process.env.DEMO_PASSWORD || 'estoque2026',
};
await gql(
  `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
  { input: { projectId: PROJECT, environmentId: ENVIRONMENT, serviceId, variables: vars } },
);
console.log('  variáveis publicadas');

const { serviceDomainCreate } = await gql(
  `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
  { input: { environmentId: ENVIRONMENT, serviceId, targetPort: 8080 } },
);
console.log(`  domínio: ${serviceDomainCreate.domain}`);

console.log('▸ Aguardando propagação da configuração (20s)…');
await sleep(20_000);

console.log('▸ Empacotando…');
const tarball = await new Promise((resolve, reject) => {
  const chunks = [];
  const tar = spawn('tar', [
    '-cf', '-',
    '--exclude=./node_modules', '--exclude=./.git', '--exclude=./pg',
    '--exclude=./apps/web/node_modules', '--exclude=./apps/api/node_modules',
    '--exclude=./apps/web/dist', '--exclude=./apps/api/dist',
    '.',
  ]);
  const gz = createGzip({ level: 6 });
  tar.stdout.pipe(gz);
  gz.on('data', (c) => chunks.push(c));
  gz.on('end', () => resolve(Buffer.concat(chunks)));
  gz.on('error', reject);
});
console.log(`  ${(tarball.length / 1024 / 1024).toFixed(2)} MB`);

const up = await fetch(`${HOST}/project/${PROJECT}/environment/${ENVIRONMENT}/up?serviceId=${serviceId}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'multipart/form-data' },
  body: tarball,
});
const upBody = await up.text();
console.log(`▸ Upload: HTTP ${up.status}`);
const deploymentId = (() => { try { return JSON.parse(upBody).deploymentId; } catch { return null; } })();

console.log(JSON.stringify({ serviceId, deploymentId, domain: serviceDomainCreate.domain }, null, 2));
