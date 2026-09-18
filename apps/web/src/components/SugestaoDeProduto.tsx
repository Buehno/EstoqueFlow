import { useEffect, useRef, useState } from "react";

/**
 * Campo de descrição do item da proposta, com sugestão de produto embutida.
 *
 * Substitui a exigência do comando `/peça`: o vendedor só digita o nome do
 * produto (em qualquer lugar do texto) e a lista aparece sozinha, filtrando
 * a cada letra — igual ao que já acontecia na Saída Balcão e na Entrada de
 * Estoque, só que agora dentro da proposta também, sem comando nenhum.
 *
 * `/peça` continua funcionando como atalho opcional (ainda é reconhecido),
 * mas nunca é obrigatório.
 */

export interface ProdutoSugerido {
  id: string;
  descricao: string;
  sku?: string | null;
  size?: string | null;
  unit?: string | null;
}

interface Props {
  value: string;
  onChange: (novoTexto: string) => void;
  /** Chamado quando o vendedor escolhe um produto da lista — vincula o item ao estoque. */
  onSelecionarProduto: (produto: ProdutoSugerido) => void;
  buscarSugestoes: (query: string) => Promise<ProdutoSugerido[]>;
  placeholder?: string;
}

/** Pega só a linha que está sendo editada agora (a última linha do texto). */
function linhaAtual(texto: string): string {
  const partes = texto.split("\n");
  return partes[partes.length - 1] ?? "";
}

/** Suporte ao atalho antigo: "/peça algo", "/peca algo", "/item algo", "/produto algo". */
function extrairComandoOuTexto(linha: string): string {
  const m = linha.match(/^\s*\/(pe[çc]a|item|produto)\s+(.*)$/i);
  return m ? m[2] : linha;
}

export function SugestaoDeProduto({
  value,
  onChange,
  onSelecionarProduto,
  buscarSugestoes,
  placeholder,
}: Props) {
  const [sugestoes, setSugestoes] = useState<ProdutoSugerido[]>([]);
  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requisicaoAtual = useRef(0);

  useEffect(() => {
    const query = extrairComandoOuTexto(linhaAtual(value));

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setSugestoes([]);
      setAberto(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const idDestaChamada = ++requisicaoAtual.current;
      setCarregando(true);
      try {
        const resultado = await buscarSugestoes(query);
        // Descarta respostas que chegaram fora de ordem (o usuário já digitou mais).
        if (idDestaChamada !== requisicaoAtual.current) return;
        setSugestoes(resultado);
        setAberto(resultado.length > 0);
        setIndiceAtivo(0);
      } finally {
        if (idDestaChamada === requisicaoAtual.current) setCarregando(false);
      }
    }, 180); // debounce curto — precisa parecer instantâneo enquanto digita

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function escolher(produto: ProdutoSugerido) {
    const linhas = value.split("\n");
    linhas[linhas.length - 1] = produto.descricao;
    onChange(linhas.join("\n"));
    onSelecionarProduto(produto);
    setAberto(false);
    setSugestoes([]);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!aberto || sugestoes.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndiceAtivo((i) => (i + 1) % sugestoes.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndiceAtivo((i) => (i - 1 + sugestoes.length) % sugestoes.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      escolher(sugestoes[indiceAtivo]);
    } else if (e.key === "Escape") {
      setAberto(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={aoTeclar}
        placeholder={placeholder ?? "Descreva o item — comece a digitar o nome do produto para ver sugestões do estoque"}
        rows={3}
        style={{ width: "100%" }}
      />
      {aberto && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            top: "100%",
            background: "#0F2740",
            border: "1px solid #1E3A5F",
            borderRadius: 12,
            marginTop: 4,
            maxHeight: 260,
            overflowY: "auto",
            listStyle: "none",
            padding: 6,
          }}
        >
          {sugestoes.map((produto, i) => (
            <li
              key={produto.id}
              role="option"
              aria-selected={i === indiceAtivo}
              onMouseDown={(e) => {
                e.preventDefault(); // não perde o foco do textarea antes do clique registrar
                escolher(produto);
              }}
              onMouseEnter={() => setIndiceAtivo(i)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                cursor: "pointer",
                background: i === indiceAtivo ? "#173352" : "transparent",
                color: "#E8ECEF",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>{produto.descricao}</span>
              {(produto.size || produto.unit) && (
                <span style={{ color: "#9FB3C8", fontSize: 13 }}>
                  {[produto.size, produto.unit].filter(Boolean).join(" · ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {carregando && (
        <span style={{ position: "absolute", right: 10, top: 10, fontSize: 12, color: "#9FB3C8" }}>
          buscando…
        </span>
      )}
    </div>
  );
}

/** Helper pronto para plugar no ItemEditor real: chama o endpoint do backend. */
export async function buscarSugestoesNoServidor(
  api: { get: (url: string) => Promise<{ produtos: ProdutoSugerido[] }> },
  query: string,
): Promise<ProdutoSugerido[]> {
  const resposta = await api.get(`/products/suggest?q=${encodeURIComponent(query)}`);
  return resposta.produtos;
}
