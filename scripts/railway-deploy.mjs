/**
 * Provisiona e publica o EstoqueFlow no Railway usando a API pública.
 *
 *   RAILWAY_TOKEN=<token da conta> node scripts/railway-deploy.mjs
 *
 * O que ele faz, em ordem:
 *   1. cria (ou reaproveita) o projeto
 *   2. sobe um serviço Postgres com volume persistente
 *   3. cria o serviço da aplicação e injeta as variáveis de ambiente
 *   4. envia o código-fonte (tar.gz) para o builder do Railway
 *   5. gera o domínio público e devolve a URL
 */
import { createGzip } from 'node:zlib';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const TOKEN = process.env.RAILWAY_TOKEN;
if (!TOKEN) {
  console.error('Defina RAILWAY_TOKEN com o token da sua conta Railway.');
  process.exit(1);
}

const HOSTS = ['https://backboard.railway.app', 'https://backboard.railway.com'];
let HOST = process.env.RAILWAY_HOST || HOSTS[0];

const PROJECT_NAME = process.env.RAILWAY_PROJECT_NAME || 'estoqueflow';
const APP_SERVICE = 'estoqueflow-app';
const DB_SERVICE = 'Postgres';

async function gql(query, variables = {}, { quiet = false } = {}) {
  const res = await fetch(`${HOST}/graphql/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join(' | ');
    if (!quiet) console.error(`   ↳ GraphQL: ${msg}`);
    throw new Error(msg);
  }
  return json.data;
}

const log = (s) => console.log(s);

// ── 1. projeto ──────────────────────────────────────────────────────────────
log('▸ Verificando projetos existentes…');
const { projects } = await gql(`query { projects { edges { node { id name } } } }`);
let project = projects.edges.map((e) => e.node).find((p) => p.name === PROJECT_NAME);

if (project) {
  log(`  já existe: ${project.name} (${project.id})`);
} else {
  log(`▸ Criando projeto "${PROJECT_NAME}"…`);
  const r = await gql(
    `mutation($input: ProjectCreateInput!) {
       projectCreate(input: $input) { id name }
     }`,
    { input: { name: PROJECT_NAME, description: 'SaaS de controle de estoque multi-depósito' } },
  );
  project = r.projectCreate;
  log(`  criado: ${project.id}`);
}

const detail = await gql(
  `query($id: String!) {
     project(id: $id) {
       id name
       environments { edges { node { id name } } }
       services { edges { node { id name } } }
     }
   }`,
  { id: project.id },
);

const environment =
  detail.project.environments.edges.map((e) => e.node).find((e) => e.name === 'production') ??
  detail.project.environments.edges[0].node;
log(`  ambiente: ${environment.name} (${environment.id})`);

const services = new Map(detail.project.services.edges.map((e) => [e.node.name, e.node.id]));

// ── 2. Postgres ─────────────────────────────────────────────────────────────
const PG_PASSWORD = process.env.PG_PASSWORD || randomBytes(16).toString('hex');
let dbId = services.get(DB_SERVICE);

if (!dbId) {
  log('▸ Provisionando Postgres…');
  const r = await gql(
    `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
    {
      input: {
        projectId: project.id,
        name: DB_SERVICE,
        source: { image: 'ghcr.io/railwayapp-templates/postgres-ssl:16' },
        variables: {
          POSTGRES_USER: 'postgres',
          POSTGRES_PASSWORD: PG_PASSWORD,
          POSTGRES_DB: 'railway',
          PGDATA: '/var/lib/postgresql/data/pgdata',
          PGPORT: '5432',
        },
      },
    },
  );
  dbId = r.serviceCreate.id;
  log(`  serviço criado: ${dbId}`);

  await gql(
    `mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`,
    {
      input: {
        projectId: project.id,
        environmentId: environment.id,
        serviceId: dbId,
        mountPath: '/var/lib/postgresql/data',
      },
    },
  ).then(() => log('  volume persistente montado em /var/lib/postgresql/data'))
   .catch((e) => log(`  (volume) ${e.message}`));
} else {
  log(`▸ Postgres já provisionado (${dbId})`);
}

// ── 3. aplicação ────────────────────────────────────────────────────────────
let appId = services.get(APP_SERVICE);
if (!appId) {
  log('▸ Criando serviço da aplicação…');
  const r = await gql(
    `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
    { input: { projectId: project.id, name: APP_SERVICE } },
  );
  appId = r.serviceCreate.id;
  log(`  serviço criado: ${appId}`);
} else {
  log(`▸ Serviço da aplicação já existe (${appId})`);
}

log('▸ Publicando variáveis de ambiente…');
const vars = {
  NODE_ENV: 'production',
  PORT: '8080',
  // Railway usa rede privada IPv6: escutar em :: aceita IPv4 e IPv6 (dual-stack)
  HOST: '::',
  DATABASE_URL: `postgresql://postgres:${PG_PASSWORD}@\${{${DB_SERVICE}.RAILWAY_PRIVATE_DOMAIN}}:5432/railway`,
  JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
  CORS_ORIGIN: '*',
  SHEET_SYNC_ENABLED: process.env.SHEET_SYNC_ENABLED || 'true',
  SHEET_SYNC_INTERVAL_MS: '30000',
  SHEET_GUARD_INTERVAL_MS: '300000',
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '',
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  DEMO_EMAIL: process.env.DEMO_EMAIL || 'demo@estoqueflow.app',
  DEMO_PASSWORD: process.env.DEMO_PASSWORD || 'estoque2026',
};

await gql(
  `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
  { input: { projectId: project.id, environmentId: environment.id, serviceId: appId, variables: vars } },
);
log(`  ${Object.keys(vars).length} variáveis publicadas`);

log('▸ Ajustando build e healthcheck…');
await gql(
  `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
     serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
   }`,
  {
    environmentId: environment.id,
    serviceId: appId,
    input: {
      healthcheckPath: process.env.SKIP_HEALTHCHECK ? '' : '/health',
      healthcheckTimeout: 300,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      startCommand: 'sh scripts/entrypoint.sh',
    },
  },
).then(() => log('  ok')).catch((e) => log(`  (ignorado) ${e.message}`));

// ── 4. upload do código ─────────────────────────────────────────────────────
log('▸ Empacotando o código-fonte…');
const tarball = await new Promise((resolve, reject) => {
  const chunks = [];
  const tar = spawn('tar', [
    '-cf', '-',
    '--exclude=./node_modules', '--exclude=./.git',
    '--exclude=./apps/web/node_modules', '--exclude=./apps/api/node_modules',
    '--exclude=./apps/web/dist', '--exclude=./apps/api/dist',
    '--exclude=./pg',
    '.',
  ], { cwd: process.cwd() });
  const gz = createGzip({ level: 6 });
  tar.stdout.pipe(gz);
  gz.on('data', (c) => chunks.push(c));
  gz.on('end', () => resolve(Buffer.concat(chunks)));
  gz.on('error', reject);
  tar.on('error', reject);
});
log(`  ${(tarball.length / 1024 / 1024).toFixed(2)} MB`);

log('▸ Enviando para o builder do Railway…');
const upUrl = `${HOST}/project/${project.id}/environment/${environment.id}/up?serviceId=${appId}`;
const upRes = await fetch(upUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'multipart/form-data',
    'X-Source': 'cli',
  },
  body: tarball,
});
const upText = await upRes.text();
log(`  HTTP ${upRes.status} ${upText.slice(0, 400)}`);
if (!upRes.ok) {
  console.error('\n✘ Falha no upload do código.');
  process.exit(1);
}

// ── 5. domínio público ──────────────────────────────────────────────────────
log('▸ Garantindo domínio público…');
let domain = null;
try {
  const d = await gql(
    `query($environmentId: String!, $serviceId: String!, $projectId: String!) {
       domains(environmentId: $environmentId, serviceId: $serviceId, projectId: $projectId) {
         serviceDomains { domain }
         customDomains { domain }
       }
     }`,
    { environmentId: environment.id, serviceId: appId, projectId: project.id },
  );
  domain = d.domains.serviceDomains[0]?.domain ?? null;
} catch { /* ignora */ }

if (!domain) {
  const r = await gql(
    `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
    { input: { environmentId: environment.id, serviceId: appId, targetPort: 8080 } },
  );
  domain = r.serviceDomainCreate.domain;
}

console.log('\n' + '═'.repeat(70));
console.log(' DEPLOY ENVIADO');
console.log('═'.repeat(70));
console.log(` Projeto ......: https://railway.com/project/${project.id}`);
console.log(` Aplicação ....: https://${domain}`);
console.log(` Health .......: https://${domain}/health`);
console.log(` Login ........: ${vars.DEMO_EMAIL} / ${vars.DEMO_PASSWORD}`);
console.log('═'.repeat(70));
console.log(JSON.stringify({ projectId: project.id, environmentId: environment.id, appId, dbId, domain, pgPassword: PG_PASSWORD }, null, 2));
