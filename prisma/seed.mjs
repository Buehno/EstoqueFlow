/**
 * Seed idempotente — cria a empresa demo, os dois depósitos, catálogo inicial
 * e um estoque de partida. Roda em todo deploy (release command); se a empresa
 * já existir, não duplica nada.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@estoqueflow.app';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'estoque2026';

const PRODUTOS = [
  ['SKU-1001', '7891000100103', 'Caixa Papelão 40x30x30', 'Embalagens', 'UN', 3.2, 6.9, 100],
  ['SKU-1002', '7891000100110', 'Fita Adesiva Transparente 48mm', 'Embalagens', 'UN', 4.5, 9.9, 60],
  ['SKU-1003', '7891000100127', 'Plástico Bolha 1m x 100m', 'Embalagens', 'RL', 89.0, 149.9, 10],
  ['SKU-2001', '7891000200105', 'Pallet PBR 1,20x1,00', 'Movimentação', 'UN', 65.0, 119.0, 20],
  ['SKU-2002', '7891000200112', 'Filme Stretch 500mm', 'Movimentação', 'RL', 42.0, 79.9, 25],
  ['SKU-2003', '7891000200129', 'Carrinho Plataforma 300kg', 'Movimentação', 'UN', 480.0, 890.0, 3],
  ['SKU-3001', '7891000300102', 'Luva Pigmentada CA 41.234', 'EPI', 'PR', 4.9, 11.9, 80],
  ['SKU-3002', '7891000300119', 'Óculos de Proteção Incolor', 'EPI', 'UN', 9.9, 22.5, 40],
  ['SKU-3003', '7891000300126', 'Bota de Segurança Bico PVC', 'EPI', 'PR', 89.9, 169.9, 15],
  ['SKU-4001', '7891000400109', 'Etiqueta Térmica 100x50 (rolo)', 'Identificação', 'RL', 28.0, 54.9, 30],
  ['SKU-4002', '7891000400116', 'Ribbon Cera 110x450', 'Identificação', 'UN', 22.0, 44.9, 20],
  ['SKU-5001', '7891000500106', 'Coletor de Dados Wi-Fi', 'Equipamentos', 'UN', 1890.0, 3290.0, 2],
];

async function main() {
  const existing = await prisma.company.findUnique({ where: { slug: 'demo-logistica' } });
  if (existing) {
    console.log('✔ Seed já aplicado anteriormente. Nada a fazer.');
    return;
  }

  const company = await prisma.company.create({
    data: {
      name: 'Logística Demo Ltda',
      legalName: 'Logística Demo Comércio e Distribuição Ltda',
      slug: 'demo-logistica',
      email: DEMO_EMAIL,
      sheetId: process.env.GOOGLE_SHEET_ID || null,
    },
  });

  const [superior, inferior] = await Promise.all([
    prisma.warehouse.create({
      data: {
        companyId: company.id,
        code: 'DEP-1',
        name: 'Depósito 1 · Superior',
        address: 'Pavimento superior',
        city: 'Jundiaí',
        state: 'SP',
        isDefault: true,
      },
    }),
    prisma.warehouse.create({
      data: {
        companyId: company.id,
        code: 'DEP-2',
        name: 'Depósito 2 · Inferior',
        address: 'Pavimento inferior / térreo',
        city: 'Jundiaí',
        state: 'SP',
      },
    }),
  ]);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        companyId: company.id,
        name: 'Ronaldo Bueno',
        email: DEMO_EMAIL,
        role: 'OWNER',
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      },
    }),
    prisma.user.create({
      data: {
        companyId: company.id,
        name: 'Operador de Estoque',
        email: 'estoquista@estoqueflow.app',
        role: 'ESTOQUISTA',
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      },
    }),
    prisma.user.create({
      data: {
        companyId: company.id,
        name: 'Vendedor Balcão',
        email: 'vendedor@estoqueflow.app',
        role: 'VENDEDOR',
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      },
    }),
  ]);
  const owner = users[0];

  const catNames = [...new Set(PRODUTOS.map((p) => p[3]))];
  const cats = {};
  for (const name of catNames) {
    const c = await prisma.category.create({ data: { companyId: company.id, name } });
    cats[name] = c.id;
  }

  const fornecedor = await prisma.supplier.create({
    data: { companyId: company.id, name: 'Distribuidora Alfa', cnpj: '12.345.678/0001-90' },
  });

  let movNumber = 0;
  for (const [sku, barcode, name, cat, unit, cost, price, min] of PRODUTOS) {
    const product = await prisma.product.create({
      data: {
        companyId: company.id,
        sku,
        barcode,
        name,
        unit,
        costPrice: cost,
        salePrice: price,
        minStock: min,
        categoryId: cats[cat],
        supplierId: fornecedor.id,
      },
    });

    // estoque inicial: superior guarda o grosso, inferior fica com o giro rápido
    for (const [wh, factor] of [[superior, 3], [inferior, 1.2]]) {
      const qty = Math.round(min * factor);
      if (qty <= 0) continue;
      await prisma.stockItem.create({
        data: { productId: product.id, warehouseId: wh.id, quantity: qty, avgCost: cost },
      });
      movNumber += 1;
      await prisma.movement.create({
        data: {
          companyId: company.id,
          number: movNumber,
          type: 'ENTRADA',
          productId: product.id,
          quantity: qty,
          unitCost: cost,
          toWarehouseId: wh.id,
          balanceTo: qty,
          reason: 'Carga inicial de implantação',
          document: 'IMPLANTACAO',
          userId: owner.id,
        },
      });
    }
  }

  await prisma.counter.createMany({
    data: [
      { companyId: company.id, name: 'movement', value: movNumber },
      { companyId: company.id, name: 'sale', value: 0 },
      { companyId: company.id, name: 'count', value: 0 },
    ],
    skipDuplicates: true,
  });

  console.log('═'.repeat(64));
  console.log(' EstoqueFlow — banco populado com sucesso');
  console.log('═'.repeat(64));
  console.log(` Empresa .......: ${company.name}`);
  console.log(` Depósitos .....: ${superior.name} / ${inferior.name}`);
  console.log(` Produtos ......: ${PRODUTOS.length}`);
  console.log(` Movimentos ....: ${movNumber}`);
  console.log('');
  console.log(` Login .........: ${DEMO_EMAIL}`);
  console.log(` Senha .........: ${DEMO_PASSWORD}`);
  console.log('═'.repeat(64));
}

main()
  .catch((e) => {
    console.error('Falha no seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
