/**
 * Seed mínimo pra teste de integração manual/smoke test — NÃO é o
 * importador real de dados (isso é pendência separada, seção 3 do plano).
 * Cria 1 empresa + 1 usuário OWNER com senha conhecida, só pra dar pra
 * logar e testar o servidor rodando de verdade.
 */
import { PrismaClient } from "@prisma/client";
import { hashSenha } from "./lib/senha.js";

const prisma = new PrismaClient();

async function main() {
  const empresa = await prisma.company.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: { id: "00000000-0000-0000-0000-000000000001", name: "Jundiaquece (teste)" },
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@teste.local" },
    update: {},
    create: {
      companyId: empresa.id,
      name: "Owner Teste",
      email: "owner@teste.local",
      passwordHash: hashSenha("senha-inicial-123"),
      role: "OWNER",
      mustChangePassword: true,
    },
  });

  console.log(JSON.stringify({ empresaId: empresa.id, ownerId: owner.id }));
}

main().finally(() => prisma.$disconnect());
