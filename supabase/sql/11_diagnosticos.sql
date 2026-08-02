-- =====================================================================
-- 11 — DIAGNÓSTICOS (porta de entrada de clientes)
--
-- Guarda os diagnósticos financeiro e comercial gerados pelo formulário
-- público do site, e implementa a fila de envio no dia seguinte às 8h.
--
--   • public.diagnosticos            -> o registro do lead + o relatório
--   • fn_proxima_janela_envio()      -> próximo dia útil às 8h (America/Sao_Paulo)
--   • fn_diagnosticos_para_enviar()  -> fila liberada (usada pelo cron das 8h)
--   • fn_diagnostico_marcar()        -> enviado / falhou
--   • fn_diagnostico_segurar()       -> link do e-mail interno, por token
--
-- IMPORTANTE: estes registros NÃO são de um tenant. São prospects, gente
-- que ainda não é cliente. Por isso a tabela fica fora do modelo
-- multiempresa e nenhum usuário comum enxerga nada aqui — só o staff da
-- Business Triage.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TIPOS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.diagnostico_tipo as enum ('financeiro', 'comercial');
exception when duplicate_object then null; end $$;

do $$ begin
  -- pendente  -> calculado, aguardando a janela das 8h
  -- segurado  -> você clicou em "Segurar"; não sai sozinho
  -- enviado   -> relatório entregue ao lead
  -- falhou    -> o envio deu erro; fica visível em vez de sumir
  create type public.diagnostico_status as enum ('pendente', 'segurado', 'enviado', 'falhou');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. JANELA DE ENVIO
--
-- Sempre o PRÓXIMO dia útil às 8h, no horário de Brasília. Formulário
-- preenchido na sexta à noite sai na segunda — relatório chegando no
-- sábado de manhã não é lido e queima a primeira impressão.
--
-- STABLE, não IMMUTABLE: depende de now(). Marcar como IMMUTABLE aqui
-- faria o Postgres cachear o resultado indevidamente.
-- ---------------------------------------------------------------------
create or replace function public.fn_proxima_janela_envio(p_agora timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_dia date;
begin
  -- Converte para o calendário local antes de somar o dia: às 22h de SP
  -- já é o dia seguinte em UTC, e sem isso o relatório pularia 24h.
  v_dia := ((p_agora at time zone 'America/Sao_Paulo')::date) + 1;

  while extract(isodow from v_dia) in (6, 7) loop   -- 6 = sábado, 7 = domingo
    v_dia := v_dia + 1;
  end loop;

  return (v_dia + time '08:00') at time zone 'America/Sao_Paulo';
end $$;

-- ---------------------------------------------------------------------
-- 3. TABELA
-- ---------------------------------------------------------------------
create table if not exists public.diagnosticos (
  id              uuid primary key default gen_random_uuid(),
  protocolo       text not null unique,
  tipo            public.diagnostico_tipo not null,

  -- Identificação do lead
  razao_social    text,
  cnpj            text,
  email           text not null,
  telefone        text,
  setor           text,
  mes_referencia  text,

  -- Resultado (números do código, textos da IA)
  score_total     int,
  nivel           text,
  entrada         jsonb not null default '{}'::jsonb,
  indicadores     jsonb not null default '{}'::jsonb,
  -- Semáforo indicador a indicador, com fórmula e faixa. Vai para o PDF:
  -- eram 15 contas explícitas que só a IA enxergava e o cliente nunca via.
  alertas         jsonb not null default '[]'::jsonb,
  analise         jsonb not null default '{}'::jsonb,

  -- O e-mail já renderizado. Guardar o HTML pronto significa que a IA
  -- roda UMA vez, no envio do formulário. O cron das 8h só entrega o que
  -- já existe — sem custo de token novo e sem risco de o segundo texto
  -- sair diferente do que você aprovou.
  assunto_cliente text,
  html_cliente    text,

  -- Caminho do PDF no Storage. Renderizado uma vez e reaproveitado: o
  -- arquivo que você revisa no Drive é byte a byte o que o cliente
  -- recebe às 8h. Renderizar de novo abriria espaço para divergência.
  pdf_path        text,

  -- Fila
  status          public.diagnostico_status not null default 'pendente',
  liberar_em      timestamptz not null default public.fn_proxima_janela_envio(),
  -- Token do link "Segurar" do e-mail interno. Dois UUIDs v4 concatenados
  -- (122 bits) evitam depender da pgcrypto, cujo schema varia entre
  -- instalações do Supabase.
  hold_token      text not null default replace(gen_random_uuid()::text, '-', '')
                                      || replace(gen_random_uuid()::text, '-', ''),
  tentativas      int not null default 0,
  enviado_em      timestamptz,
  erro            text,
  created_at      timestamptz not null default now()
);

-- Fila do cron: só as pendentes já liberadas.
create index if not exists diagnosticos_fila_idx
  on public.diagnosticos (liberar_em)
  where status = 'pendente';

create index if not exists diagnosticos_recentes_idx
  on public.diagnosticos (created_at desc);

-- Único: dois diagnósticos com o mesmo token fariam o link "Segurar"
-- agir sobre o registro errado.
create unique index if not exists diagnosticos_hold_uidx
  on public.diagnosticos (hold_token);

-- ---------------------------------------------------------------------
-- 4. RLS — ninguém, exceto o staff (leitura) e o service_role (escrita)
-- ---------------------------------------------------------------------
alter table public.diagnosticos enable row level security;

drop policy if exists diagnosticos_staff_select on public.diagnosticos;
create policy diagnosticos_staff_select on public.diagnosticos
  for select to authenticated
  using (public.is_platform_staff());

-- Sem policy de insert/update/delete para `authenticated`: gravação é
-- exclusiva do service_role, que ignora RLS. Um cliente logado no SaaS
-- não tem como enxergar nem tocar na base de prospects.

-- ---------------------------------------------------------------------
-- 4b. STORAGE — bucket dos PDFs
--
-- Privado. Ninguém acessa por URL: quem entrega o arquivo é a API, e
-- quem lê é o n8n com o segredo de webhook. Um relatório financeiro
-- completo com link público seria vazamento de dado de cliente.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diagnosticos', 'diagnosticos', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- Sem policies para `authenticated`: só o service_role escreve e lê,
-- e ele ignora a RLS do storage por natureza.

-- ---------------------------------------------------------------------
-- 5. FILA
-- ---------------------------------------------------------------------

-- O que o cron das 8h deve enviar agora.
-- LIMIT protege contra uma fila represada disparar centenas de e-mails
-- de uma vez depois de dias de instância parada.
create or replace function public.fn_diagnosticos_para_enviar(p_limite int default 50)
returns table (
  protocolo       text,
  tipo            public.diagnostico_tipo,
  razao_social    text,
  email           text,
  assunto_cliente text,
  html_cliente    text,
  liberar_em      timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select d.protocolo, d.tipo, d.razao_social, d.email,
         d.assunto_cliente, d.html_cliente, d.liberar_em
  from public.diagnosticos d
  where d.status = 'pendente'
    and d.liberar_em <= now()
    and d.email is not null
    and d.html_cliente is not null
    and d.tentativas < 3
  order by d.liberar_em
  limit greatest(1, least(p_limite, 200));
$$;

-- Resultado do envio. `tentativas` sobe sempre, para um erro permanente
-- (e-mail inválido, por exemplo) sair da fila em vez de ser retentado
-- todo dia para sempre.
create or replace function public.fn_diagnostico_marcar(
  p_protocolo text,
  p_status    public.diagnostico_status,
  p_erro      text default null
)
returns public.diagnostico_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.diagnostico_status;
begin
  update public.diagnosticos
     set status     = p_status,
         erro       = p_erro,
         tentativas = tentativas + 1,
         enviado_em = case when p_status = 'enviado' then now() else enviado_em end
   where protocolo = p_protocolo
  returning status into v_status;

  if v_status is null then
    raise exception 'Protocolo % não encontrado', p_protocolo
      using errcode = 'no_data_found';
  end if;

  return v_status;
end $$;

-- Link "Segurar" do e-mail interno.
--
-- Só age sobre quem ainda está `pendente`: clicar depois das 8h, com o
-- relatório já entregue, não pode fingir que segurou. O retorno diz
-- exatamente o que aconteceu, para a página mostrar a verdade.
create or replace function public.fn_diagnostico_segurar(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec record;
begin
  select protocolo, razao_social, status
    into v_rec
    from public.diagnosticos
   where hold_token = p_token;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  if v_rec.status <> 'pendente' then
    return jsonb_build_object(
      'ok', false, 'motivo', 'ja_processado',
      'status', v_rec.status, 'empresa', v_rec.razao_social
    );
  end if;

  update public.diagnosticos
     set status = 'segurado'
   where hold_token = p_token;

  return jsonb_build_object(
    'ok', true, 'protocolo', v_rec.protocolo, 'empresa', v_rec.razao_social
  );
end $$;

-- ---------------------------------------------------------------------
-- 6. PERMISSÕES
-- ---------------------------------------------------------------------
revoke all on function public.fn_diagnosticos_para_enviar(int) from public, authenticated;
revoke all on function public.fn_diagnostico_marcar(text, public.diagnostico_status, text) from public, authenticated;
revoke all on function public.fn_diagnostico_segurar(text) from public, authenticated;

grant execute on function public.fn_proxima_janela_envio(timestamptz) to service_role;
grant execute on function public.fn_diagnosticos_para_enviar(int) to service_role;
grant execute on function public.fn_diagnostico_marcar(text, public.diagnostico_status, text) to service_role;
grant execute on function public.fn_diagnostico_segurar(text) to service_role;

grant select on public.diagnosticos to authenticated;   -- filtrado pela RLS de staff

-- ---------------------------------------------------------------------
-- 7. CONFERÊNCIA RÁPIDA
-- ---------------------------------------------------------------------
-- Sexta 22h deve cair na segunda às 8h:
--   select public.fn_proxima_janela_envio('2026-08-07 22:00-03'::timestamptz);
--   -- esperado: 2026-08-10 08:00:00-03
--
-- Terça 09h deve cair na quarta às 8h:
--   select public.fn_proxima_janela_envio('2026-08-04 09:00-03'::timestamptz);
--   -- esperado: 2026-08-05 08:00:00-03
