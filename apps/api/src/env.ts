import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  /**
   * '::' abre o socket em dual-stack (IPv4 + IPv6). É o que faz o healthcheck
   * de plataformas com rede privada IPv6 (Railway, Fly) alcançar o container.
   */
  HOST: z.string().default('::'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET precisa ter ao menos 16 caracteres'),
  JWT_EXPIRES: z.string().default('12h'),

  // ── Google Sheets (redundância opcional) ────────────────────────────────
  /** ID da planilha: .../spreadsheets/d/<SHEET_ID>/edit */
  GOOGLE_SHEET_ID: z.string().optional(),
  /** JSON completo da Service Account (cole o conteúdo do arquivo) */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  /** Alternativa: e-mail + chave separados */
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  /** Intervalo do worker de replicação (ms) */
  SHEET_SYNC_INTERVAL_MS: z.coerce.number().default(30_000),
  /** Intervalo do guardião que reverte edições manuais (ms) */
  SHEET_GUARD_INTERVAL_MS: z.coerce.number().default(300_000),
  SHEET_SYNC_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),

  /** Origens liberadas no CORS, separadas por vírgula. '*' libera todas. */
  CORS_ORIGIN: z.string().default('*'),

  /** Cria empresa demo + usuário demo no primeiro boot */
  SEED_DEMO: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n❌ Variáveis de ambiente inválidas:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
