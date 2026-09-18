import assert from "node:assert";
import {
  resolverPermissoes,
  podeGerenciar,
  podeAbrirPainelEquipe,
  papeisAtribuiveis,
  PERMISSAO_CHAVES,
} from "./permissoes.js";

// --- resolverPermissoes: papel define o padrão -----------------------------
{
  const p = resolverPermissoes("OPERADOR");
  assert.equal(p.estoqueMovimentar, true);
  assert.equal(p.relatoriosVerResumido, false);
  assert.equal(p.equipeGerenciar, false);
}

{
  const p = resolverPermissoes("GESTOR");
  assert.equal(p.relatoriosVerCompleto, true);
  assert.equal(p.equipeGerenciar, true);
  assert.equal(p.configuracoesEmpresa, false); // só OWNER mexe em config da empresa
}

{
  const p = resolverPermissoes("OWNER");
  for (const chave of PERMISSAO_CHAVES) assert.equal(p[chave], true, `OWNER deveria ter ${chave} = true`);
}

// --- resolverPermissoes: sobrescrita por pessoa vence o padrão do papel ----
{
  // Operadora comum não vê relatório resumido — mas essa pessoa específica pode ver.
  const p = resolverPermissoes("OPERADOR", { relatoriosVerResumido: true });
  assert.equal(p.relatoriosVerResumido, true);
  assert.equal(p.relatoriosVerCompleto, false); // o resto continua no padrão do papel
}

{
  // Gestor por padrão gerencia estoque — mas essa pessoa foi explicitamente proibida.
  const p = resolverPermissoes("GESTOR", { estoqueMovimentar: false });
  assert.equal(p.estoqueMovimentar, false);
  assert.equal(p.equipeGerenciar, true); // não afetado
}

{
  // overrides com null explícito = "não sobrescreve", cai no padrão do papel.
  const p = resolverPermissoes("ADMINISTRADOR", { relatoriosVerCompleto: null });
  assert.equal(p.relatoriosVerCompleto, false);
}

// --- podeGerenciar: hierarquia -----------------------------------------
assert.equal(podeGerenciar("OWNER", "GESTOR"), true);
assert.equal(podeGerenciar("OWNER", "OWNER"), false, "ninguém gerencia OWNER, nem outro OWNER");
assert.equal(podeGerenciar("GESTOR", "ADMINISTRADOR"), true);
assert.equal(podeGerenciar("GESTOR", "OPERADOR"), true);
assert.equal(podeGerenciar("GESTOR", "GESTOR"), false, "Gestor não gerencia outro Gestor");
assert.equal(podeGerenciar("GESTOR", "OWNER"), false);
assert.equal(podeGerenciar("ADMINISTRADOR", "OPERADOR"), true);
assert.equal(podeGerenciar("ADMINISTRADOR", "ADMINISTRADOR"), false, "Administrador não gerencia outro Administrador");
assert.equal(podeGerenciar("ADMINISTRADOR", "GESTOR"), false);
assert.equal(podeGerenciar("OPERADOR", "OPERADOR"), false, "Operador nunca gerencia ninguém");

// --- podeAbrirPainelEquipe ------------------------------------------------
assert.equal(podeAbrirPainelEquipe("OWNER"), true);
assert.equal(podeAbrirPainelEquipe("GESTOR"), true);
assert.equal(podeAbrirPainelEquipe("ADMINISTRADOR"), true);
assert.equal(podeAbrirPainelEquipe("OPERADOR"), false);
assert.equal(podeAbrirPainelEquipe("OPERADOR", { equipeGerenciar: true }), true, "override individual também abre o painel");

// --- papeisAtribuiveis -----------------------------------------------------
assert.deepEqual(new Set(papeisAtribuiveis("OWNER")), new Set(["GESTOR", "ADMINISTRADOR", "OPERADOR"]));
assert.deepEqual(new Set(papeisAtribuiveis("GESTOR")), new Set(["ADMINISTRADOR", "OPERADOR"]));
assert.deepEqual(new Set(papeisAtribuiveis("ADMINISTRADOR")), new Set(["OPERADOR"]));
assert.deepEqual(new Set(papeisAtribuiveis("OPERADOR")), new Set([]));

console.log("permissoes.test.ts: todos os testes passaram");
