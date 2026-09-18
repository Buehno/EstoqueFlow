-- Corrige a falha de senha inicial nunca trocada: toda conta criada por um
-- administrador (que escolhe a senha) passa a exigir troca no primeiro
-- acesso. Quem já está cadastrado continua com o valor padrão (false) —
-- não trava ninguém que já está usando o sistema normalmente.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
