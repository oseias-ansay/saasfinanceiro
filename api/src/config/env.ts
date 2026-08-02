import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  N8N_WEBHOOK_SECRET: z.string().min(32, 'Use pelo menos 32 caracteres'),

  // Endereço público desta API. Usado para montar o link "Segurar" que vai
  // no e-mail interno de diagnóstico — o link precisa abrir no celular,
  // então não serve o hostname interno do Docker.
  API_PUBLIC_URL: z
    .string()
    .url()
    .default('https://api-financeiro.businesstriage.com.br')
    .transform((v) => v.replace(/\/+$/, '')),

  // Caminho do Chromium usado para gerar os PDFs dos diagnósticos.
  // No Alpine da imagem é /usr/bin/chromium-browser; em desenvolvimento
  // no Windows/macOS, aponte para o Chrome instalado.
  CHROMIUM_PATH: z.string().default('/usr/bin/chromium-browser'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Falha rápido e alto: subir sem env correta é pior do que não subir.
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
