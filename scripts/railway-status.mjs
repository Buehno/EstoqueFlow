/** Acompanha o deploy no Railway e imprime os logs de build/deploy. */
const TOKEN = process.env.RAILWAY_TOKEN;
const HOST = 'https://backboard.railway.app';
const DEPLOYMENT = process.env.DEPLOYMENT_ID;
const PROJECT = process.env.PROJECT_ID;
const SERVICE = process.env.SERVICE_ID;
const ENVIRONMENT = process.env.ENVIRONMENT_ID;

const gql = async (query, variables = {}) => {
  const res = await fetch(`${HOST}/graphql/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join(' | '));
  return j.data;
};

const d = await gql(
  `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
     deployments(first: 3, input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }) {
       edges { node { id status createdAt staticUrl canRedeploy } }
     }
   }`,
  { projectId: PROJECT, environmentId: ENVIRONMENT, serviceId: SERVICE },
);

const deployments = d.deployments.edges.map((e) => e.node);
console.log(JSON.stringify(deployments, null, 2));

const id = DEPLOYMENT || deployments[0]?.id;
if (!id) process.exit(0);

for (const [label, q] of [
  ['BUILD', `query($id: String!) { buildLogs(deploymentId: $id, limit: 120) { message severity } }`],
  ['DEPLOY', `query($id: String!) { deploymentLogs(deploymentId: $id, limit: 120) { message severity } }`],
]) {
  try {
    const r = await gql(q, { id });
    const logs = r.buildLogs ?? r.deploymentLogs ?? [];
    console.log(`\n──────── ${label} (${logs.length}) ────────`);
    for (const l of logs) console.log(l.message);
  } catch (e) {
    console.log(`\n──────── ${label} ────────\n(${e.message})`);
  }
}
