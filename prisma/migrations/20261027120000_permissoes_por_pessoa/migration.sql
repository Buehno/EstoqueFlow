-- Permissões por pessoa (27/10/2026): papéis novos (GESTOR, ADMINISTRADOR,
-- OPERADOR) e liga/desliga de capacidades por usuário. Os papéis antigos
-- continuam válidos.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'GESTOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMINISTRADOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERADOR';

ALTER TABLE "users" ADD COLUMN "permission_overrides" JSONB;
