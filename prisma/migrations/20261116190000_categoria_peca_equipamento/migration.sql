-- Categoria: peça ou equipamento (16/11/2026) — filtro do relatório de compras.
ALTER TABLE "categories" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PECA';

-- Classificação inicial pelo nome (mesma lista de palavras de
-- services/compras.service.ts → classificarPorNome). Pode ser corrigida em
-- Produtos → Categorias. translate() tira os acentos sem depender de extensão.
UPDATE "categories"
   SET "kind" = 'EQUIPAMENTO'
 WHERE translate(lower("name"), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc')
       ~ '(boiler|reservat|bomba|pressuriz|coletor|placa|painel|trocador|gerador|aquecedor|cilindro|inversor|motobomba|tanque|caixa d.?agua|equipamento|filtro.*piscina|rinnai)'
   AND translate(lower("name"), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') !~ '^\s*(acess|conex|pec|kit|suporte|fixa)';
