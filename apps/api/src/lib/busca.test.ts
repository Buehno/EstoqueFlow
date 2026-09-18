import assert from "node:assert/strict";
import { sugerirProdutos, produtoCasaComQuery, separarTermos } from "./busca.js";

const catalogo = [
  { id: "1", descricao: "Aquecedor de Piscina Solar 4m² polipropileno" },
  { id: "2", descricao: "Aquecedor Elétrico de Passagem 5500W" },
  { id: "3", descricao: "Capa Térmica para Piscina 4x2m" },
  { id: "4", descricao: "Tubo Tigre 25mm soldável" },
  { id: "5", descricao: "Tubo marrom Aquatherm 25mm" },
  { id: "6", descricao: "Joelho Tigre 90° 25mm" },
  { id: "7", descricao: "Papelão ondulado reforçado" },
  { id: "8", descricao: "Tubo cobre 22mm barra 5m" },
  { id: "9", descricao: "Caixa d'água Tigre 500L" },
];

function idsDe(resultados: { id: string }[]): string[] {
  return resultados.map((r) => r.id).sort();
}

// --- Exemplos exatos do pedido do Ronaldo ---

// "Piscina aque" -> mostra os aquecedores de piscina
assert.deepEqual(
  idsDe(sugerirProdutos(catalogo, "Piscina aque")),
  ["1"],
  '"Piscina aque" deveria achar só o Aquecedor de Piscina (não o Elétrico de Passagem, não a Capa Térmica)',
);

// "Tigre tubo de" -> mostra os tubos da marca Tigre
assert.deepEqual(
  idsDe(sugerirProdutos(catalogo, "Tigre tubo de")),
  ["4"],
  '"Tigre tubo de" deveria achar o Tubo Tigre (não o Joelho Tigre, não a Caixa d\'água Tigre)',
);

// --- Regras antigas do catálogo continuam valendo ---

// busca sem acento
assert.deepEqual(idsDe(sugerirProdutos(catalogo, "papelao")), ["7"], "sem acento deveria achar Papelão");

// ordem das palavras não importa (quando ambas estão fechadas, com espaço no fim)
assert.deepEqual(
  idsDe(sugerirProdutos(catalogo, "marrom tubo ")),
  idsDe(sugerirProdutos(catalogo, "tubo marrom ")),
  "ordem das palavras não deveria importar",
);

// prefixo de 1 letra não dispara (ruído demais)
assert.deepEqual(sugerirProdutos(catalogo, "t").length, 0, "1 letra não deveria sugerir nada ainda");

// digitando progressivamente "aquecedor de piscina" deveria ir refinando
const passos = ["a", "aq", "aqu", "aque", "aquecedor", "aquecedor ", "aquecedor de p", "aquecedor de piscina"];
for (const passo of passos.slice(1)) {
  const r = sugerirProdutos(catalogo, passo);
  console.log(`  "${passo}" ->`, r.map((x) => x.descricao));
}
assert.deepEqual(idsDe(sugerirProdutos(catalogo, "aquecedor de piscina")), ["1"]);

// separarTermos: espaço no final fecha a palavra
assert.deepEqual(separarTermos("tigre tubo de").prefixoAberto, null);
assert.deepEqual(separarTermos("tigre tubo").prefixoAberto, "tubo");

console.log("\nTodos os testes passaram.");
