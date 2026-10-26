# Rodar a API e as suítes de teste localmente

As suítes em `scripts/teste-*.mjs` batem numa API local (`http://localhost:8080/api`)
ligada a um Postgres de teste. Cada suíte registra a própria empresa, então o
banco precisa estar **limpo** a cada rodada (elas não são idempotentes).

## Caminho normal (com os binários do Prisma)

```bash
npm ci
export DATABASE_URL='postgresql://postgres@localhost:5432/estoqueflow_test'
export JWT_SECRET='qualquer-coisa-com-16-ou-mais' SEED_DEMO=false SHEET_SYNC_ENABLED=false
npx prisma migrate deploy
npm run build:api && node apps/api/dist/server.js &
node scripts/teste-regressao.mjs
```

## Sem acesso a `binaries.prisma.sh` (ambientes com rede restrita)

Quando o download dos engines nativos do Prisma é bloqueado, a API ainda roda
com o engine **WASM** do próprio pacote `@prisma/client` + driver `pg`:

1. `prisma generate` precisa passar: aponte os engines para arquivos vazios e
   ignore o checksum —
   `PRISMA_QUERY_ENGINE_LIBRARY=/tmp/x PRISMA_SCHEMA_ENGINE_BINARY=/tmp/y PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npx prisma generate`
2. O loader WASM gerado (`node_modules/.prisma/client/wasm-worker-loader.mjs`)
   importa `.wasm` como módulo ES, o que o Node não faz sem flag; troque o
   conteúdo por:
   ```js
   import { readFileSync } from 'node:fs';
   export default Promise.resolve({ default: new WebAssembly.Module(readFileSync(new URL('./query_engine_bg.wasm', import.meta.url))) });
   ```
   (é só no `node_modules`, refaça depois de cada `prisma generate`).
3. Aplique as migrações por SQL: `for f in prisma/migrations/*/; do psql -f "$f/migration.sql"; done`
   (o `migrate deploy` também precisa do engine nativo).
4. Suba a API com `PRISMA_ADAPTER=pg` — `apps/api/src/lib/prisma.ts` então usa
   `@prisma/client/wasm` + `@prisma/adapter-pg`. Em produção a variável não
   existe e nada disso é carregado.

As suítes que consultam o banco direto (`teste-melhorias-2409`,
`teste-dados-quebrados`) usam o comando em `PSQL`
(padrão `sudo -u postgres psql -d estoqueflow_full`); ajuste conforme o
ambiente, por exemplo `PSQL='psql -h /tmp -p 5433 -U postgres -d estoqueflow_test'`.
