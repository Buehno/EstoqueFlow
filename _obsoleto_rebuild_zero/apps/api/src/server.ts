import { buildApp } from "./app.js";

async function main() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = "0.0.0.0"; // obrigatório no Railway — não escutar só em localhost

  try {
    await app.listen({ port, host });
  } catch (erro) {
    app.log.error(erro);
    process.exit(1);
  }
}

main();
