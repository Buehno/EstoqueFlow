-- Alerta diário por e-mail (27/10/2026): destinatários, horário e SMTP por empresa.
ALTER TABLE "companies"
  ADD COLUMN "alert_email_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "alert_email_to" TEXT,
  ADD COLUMN "alert_email_hour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "alert_email_last_at" TIMESTAMP(3),
  ADD COLUMN "smtp_host" TEXT,
  ADD COLUMN "smtp_port" INTEGER,
  ADD COLUMN "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smtp_user" TEXT,
  ADD COLUMN "smtp_pass" TEXT,
  ADD COLUMN "smtp_from" TEXT;
