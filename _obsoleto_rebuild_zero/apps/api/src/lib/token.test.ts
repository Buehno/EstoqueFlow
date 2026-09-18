import assert from "node:assert";
import { gerarToken, verificarToken, expiracaoEmHoras } from "./token.js";

const SEGREDO = "segredo-de-teste-nao-usar-em-producao";

// --- gerar + verificar --------------------------------------------------
{
  const payload = { sub: "user-1", companyId: "empresa-1", role: "GESTOR", exp: expiracaoEmHoras(8) };
  const token = gerarToken(payload, SEGREDO);
  const verificado = verificarToken(token, SEGREDO);
  assert.ok(verificado);
  assert.equal(verificado?.sub, "user-1");
  assert.equal(verificado?.role, "GESTOR");
}

// --- assinatura errada / segredo errado ----------------------------------
{
  const token = gerarToken({ sub: "u", companyId: "c", role: "OPERADOR", exp: expiracaoEmHoras(1) }, SEGREDO);
  assert.equal(verificarToken(token, "segredo-diferente"), null);
}

// --- token adulterado -----------------------------------------------------
{
  const token = gerarToken({ sub: "u", companyId: "c", role: "OPERADOR", exp: expiracaoEmHoras(1) }, SEGREDO);
  const [corpo] = token.split(".");
  const payloadAdulterado = Buffer.from(JSON.stringify({ sub: "outro-user", companyId: "c", role: "OWNER", exp: expiracaoEmHoras(1) })).toString("base64url");
  const tokenAdulterado = `${payloadAdulterado}.${token.split(".")[1]}`;
  assert.notEqual(corpo, payloadAdulterado);
  assert.equal(verificarToken(tokenAdulterado, SEGREDO), null, "trocar o payload sem reassinar deve invalidar");
}

// --- expirado --------------------------------------------------------------
{
  const jaExpirado = Math.floor(Date.now() / 1000) - 10;
  const token = gerarToken({ sub: "u", companyId: "c", role: "OPERADOR", exp: jaExpirado }, SEGREDO);
  assert.equal(verificarToken(token, SEGREDO), null);
}

// --- formato inválido -------------------------------------------------------
assert.equal(verificarToken("token-invalido-sem-ponto", SEGREDO), null);
assert.equal(verificarToken("a.b.c", SEGREDO), null);
assert.equal(verificarToken("", SEGREDO), null);

console.log("token.test.ts: todos os testes passaram");
