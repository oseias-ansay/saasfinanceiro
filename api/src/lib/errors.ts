import type { PostgrestError } from '@supabase/supabase-js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'app_error',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, m, 'bad_request', d);
export const unauthorized = (m = 'Não autenticado') => new AppError(401, m, 'unauthorized');
export const forbidden = (m = 'Sem permissão para esta empresa') => new AppError(403, m, 'forbidden');
export const notFound = (m = 'Recurso não encontrado') => new AppError(404, m, 'not_found');
export const conflict = (m: string) => new AppError(409, m, 'conflict');

/**
 * Traduz erro do Postgres/PostgREST para HTTP + mensagem em português.
 * Evita vazar detalhes internos do banco para o cliente.
 */
export function fromPostgrest(e: PostgrestError): AppError {
  switch (e.code) {
    case '23505': // unique_violation
      return conflict('Já existe um registro com esses dados.');
    case '23503': // foreign_key_violation
      return badRequest('Referência inválida: categoria, cliente ou conta não existe.');
    case '23514': // check_violation
      return badRequest('Dados inconsistentes com as regras do sistema.');
    case '42501': // insufficient_privilege — normalmente RLS barrando
      return forbidden('Você não tem acesso a este recurso.');
    case 'PGRST116': // .single() sem linhas
      return notFound();
    default:
      return new AppError(500, 'Erro ao acessar o banco de dados.', e.code ?? 'db_error', e.message);
  }
}
