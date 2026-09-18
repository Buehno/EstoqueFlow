import assert from "node:assert";
import { hashSenha, verificarSenha, gerarSenhaProvisoria, senhaValida } from "./senha.js";

// --- hash/verificação -------------------------------------------------
{
  const hash = hashSenha("Buh@1202");
  assert.ok(hash.includes(":"), "hash deve ter o formato salt:hash");
  assert.equal(verificarSenha("Buh@1202", hash), true);
  assert.equal(verificarSenha("senha-errada", hash), false);
}

{
  // Dois hashes da mesma senha devem ser diferentes (salt aleatório).
  const a = hashSenha("123456789");
  const b = hashSenha("123456789");
  assert.notEqual(a, b);
  assert.equal(verificarSenha("123456789", a), true);
  assert.equal(verificarSenha("123456789", b), true);
}

{
  // Entradas malformadas não derrubam a verificação, só retornam false.
  assert.equal(verificarSenha("qualquer", ""), false);
  assert.equal(verificarSenha("qualquer", "sem-separador"), false);
}

// --- gerarSenhaProvisoria ----------------------------------------------
{
  const senha1 = gerarSenhaProvisoria();
  const senha2 = gerarSenhaProvisoria();
  assert.equal(senha1.length, 8);
  assert.notEqual(senha1, senha2, "duas gerações não devem coincidir");
}

// --- senhaValida ---------------------------------------------------------
assert.equal(senhaValida("1234567"), false, "7 caracteres não é suficiente");
assert.equal(senhaValida("12345678"), true);
assert.equal(senhaValida(""), false);

console.log("senha.test.ts: todos os testes passaram");
