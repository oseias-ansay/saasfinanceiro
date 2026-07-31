//
// ⚠️  O ponto mais importante de toda a API está neste arquivo.
//
// Existem DOIS clientes e usar o errado é uma falha de segurança:
//
//   supabaseAdmin      -> service_role. IGNORA TODO O RLS.
//                         Só para jobs, webhooks do n8n e convites.
//                         Se você usar num endpoint de usuário, qualquer
//                         cliente passa a enxergar dados de outra empresa.
//
//   userClient(token)  -> repassa o JWT do usuário. O RLS continua valendo,
//                         então o banco é a última linha de defesa mesmo
//                         que a API tenha um bug de autorização.
//
// Regra prática: todo endpoint autenticado usa req.supabase (userClient).
// Qualquer uso de supabaseAdmin precisa de um comentário justificando.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import type { Database } from '../types/database.types.js';

// Enquanto database.types.ts for o stub (`Database = any`), este alias
// resolve para um client sem inferência e tudo retorna `any`.
// Depois de gerar os tipos reais, ele passa a tipar as queries sozinho —
// não é preciso mexer aqui.
export type Db = SupabaseClient<Database>;

/** service_role — bypassa RLS. Use com parcimônia. */
export const supabaseAdmin: Db = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Cliente no contexto do usuário: o RLS do Postgres continua ativo. */
export function userClient(accessToken: string): Db {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
