-- =====================================================================
-- 34 — O registro das execuções, e o vigia
-- =====================================================================
--
-- ---------------------------------------------------------------------
-- POR QUE ISTO EXISTE
-- ---------------------------------------------------------------------
-- Todo defeito caro desta plataforma teve a mesma forma: alguma coisa
-- deixou de acontecer, e nada avisou.
--
--   - o relatório das 8h parou de sair, e o alarme que deveria avisar
--     usava a mesma credencial do Gmail que tinha quebrado;
--   - o formulário do site passou a falhar só para quem entrava com
--     `www`, e o log do servidor mostrava 200;
--   - o fluxo do WhatsApp abortava no primeiro nó e os dois seguintes
--     nunca rodavam;
--   - a suíte de testes rodava 7 de 91 e dizia "pass".
--
-- Nenhum gerou erro. Um sistema que só sabe reclamar do que aconteceu é
-- cego para o que deixou de acontecer — e é aí que mora o prejuízo,
-- porque o cliente percebe antes de você.
--
-- Esta tabela é a metade de baixo da correção: o registro de que algo
-- rodou. A metade de cima é o catálogo do que DEVERIA rodar, que vive em
-- `api/src/modules/monitor/monitor.ts`.
--
-- ---------------------------------------------------------------------
-- POR QUE O CATÁLOGO NÃO ESTÁ AQUI
-- ---------------------------------------------------------------------
-- Seria natural criar uma tabela `processos_esperados`. Não está, de
-- propósito: processo agendado nasce e morre junto com o código que o
-- implementa. Numa tabela, a lista envelheceria em silêncio — alguém
-- apagaria um fluxo e a linha ficaria cobrando para sempre, ou criaria
-- um fluxo novo e ninguém lembraria de cadastrar.
--
-- O mesmo defeito, um andar acima. Em código, o catálogo entra no
-- mesmo commit da mudança e é coberto por teste.
-- =====================================================================

create table if not exists public.execucoes (
  id           uuid primary key default gen_random_uuid(),

  -- A chave do catálogo. Mudar isto sem migrar faz o vigia achar que o
  -- processo nunca rodou — e gritar todo dia, para sempre.
  processo     text not null,

  iniciado_em  timestamptz not null default now(),
  terminado_em timestamptz,

  -- Nulo enquanto está rodando. É o que separa "está demorando" de
  -- "terminou mal" — dois problemas com respostas diferentes.
  ok           boolean,

  -- Quantos itens foram tratados. Zero é informação legítima e
  -- importante: "rodou e não tinha nada" é saudável, e é exatamente o
  -- que hoje se confunde com "não rodou".
  total        int,

  detalhe      jsonb,
  erro         text
);

-- O vigia só pergunta pela última execução boa de cada processo. Sem
-- este índice, a pergunta varre a tabela inteira a cada verificação.
create index if not exists execucoes_ultimo_idx
  on public.execucoes (processo, terminado_em desc)
  where ok;

create index if not exists execucoes_recentes_idx
  on public.execucoes (iniciado_em desc);

alter table public.execucoes enable row level security;

drop policy if exists execucoes_staff on public.execucoes;
create policy execucoes_staff on public.execucoes
  for select using (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- Abrir e fechar uma execução
-- ---------------------------------------------------------------------
--
-- Em dois tempos de propósito. Registrar só no fim perderia justamente o
-- caso que mais interessa: o processo que começou e travou no meio. Com
-- a abertura gravada, uma linha sem `terminado_em` é visível e acusa
-- travamento — que, registrado só no fim, seria indistinguível de nunca
-- ter começado.

create or replace function public.fn_execucao_inicio(p_processo text)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.execucoes (processo) values (left(p_processo, 80))
  returning id;
$$;

create or replace function public.fn_execucao_fim(
  p_id      uuid,
  p_ok      boolean,
  p_total   int default null,
  p_detalhe jsonb default null,
  p_erro    text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.execucoes
     set terminado_em = now(),
         ok           = p_ok,
         total        = p_total,
         detalhe      = p_detalhe,
         erro         = left(p_erro, 4000)
   where id = p_id;
$$;

-- ---------------------------------------------------------------------
-- O que o vigia lê
-- ---------------------------------------------------------------------

create or replace function public.fn_execucoes_ultimo_sucesso()
returns table (processo text, ultimo_sucesso timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.processo, max(e.terminado_em)
  from public.execucoes e
  where e.ok
  group by e.processo;
$$;

-- ---------------------------------------------------------------------
-- Memória do alarme
-- ---------------------------------------------------------------------
--
-- Sem isto, o vigia rodando a cada dez minutos mandaria a mesma mensagem
-- seis vezes por hora até alguém consertar. Em meio dia você passaria a
-- ignorar o alarme — e alarme ignorado é igual a alarme inexistente,
-- com a desvantagem de parecer que existe proteção.

create table if not exists public.monitor_alarmes (
  processo     text primary key,
  ultimo_envio timestamptz not null default now(),
  vezes        int not null default 1
);

alter table public.monitor_alarmes enable row level security;

drop policy if exists monitor_alarmes_staff on public.monitor_alarmes;
create policy monitor_alarmes_staff on public.monitor_alarmes
  for select using (public.is_platform_staff());

/**
 * Diz se cabe alarmar, e já marca que alarmou.
 *
 * A decisão e o registro na mesma transação, de propósito: dois
 * processos da API subindo ao mesmo tempo chamariam isto em paralelo, e
 * separado em duas chamadas os dois passariam pela verificação antes de
 * qualquer um gravar. `on conflict` resolve no banco, que é o único
 * lugar onde a corrida não existe.
 */
create or replace function public.fn_alarme_cabe(
  p_processo   text,
  p_intervalo  interval default '6 hours'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_anterior timestamptz;
begin
  -- `for update` trava a linha: dois processos da API chamando ao mesmo
  -- tempo entram em fila aqui em vez de decidirem os dois que cabe.
  select a.ultimo_envio into v_anterior
  from public.monitor_alarmes a
  where a.processo = p_processo
  for update;

  if v_anterior is null then
    insert into public.monitor_alarmes (processo) values (left(p_processo, 80));
    return true;
  end if;

  if v_anterior < now() - p_intervalo then
    update public.monitor_alarmes
       set ultimo_envio = now(), vezes = vezes + 1
     where processo = p_processo;
    return true;
  end if;

  return false;
exception when unique_violation then
  -- Outro processo inseriu entre o select e o insert. Ele alarma; este
  -- não. Perder um alarme repetido é melhor que mandar dois.
  return false;
end;
$fn$;

/** Processo voltou ao normal: esquece o histórico de alarme. */
create or replace function public.fn_alarme_limpar(p_processo text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.monitor_alarmes where processo = p_processo;
$$;

-- ---------------------------------------------------------------------
-- O pulso diário
-- ---------------------------------------------------------------------
--
-- Um vigia morto e um sistema saudável produzem o mesmo silêncio. O
-- pulso quebra o empate: chegando todo dia, a AUSÊNCIA dele vira o
-- sinal — e quem percebe é uma pessoa, que não depende de credencial
-- nenhuma para continuar funcionando.

create table if not exists public.monitor_pulso (
  dia         date primary key,
  enviado_em  timestamptz not null default now()
);

alter table public.monitor_pulso enable row level security;

drop policy if exists monitor_pulso_staff on public.monitor_pulso;
create policy monitor_pulso_staff on public.monitor_pulso
  for select using (public.is_platform_staff());

/** Reserva o pulso do dia. Devolve falso se alguém já mandou. */
create or replace function public.fn_pulso_reservar(p_dia date)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.monitor_pulso (dia) values (p_dia);
  return true;
exception when unique_violation then
  return false;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Expurgo
-- ---------------------------------------------------------------------

create or replace function public.fn_purgar_execucoes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_n integer;
begin
  delete from public.execucoes where iniciado_em < now() - interval '90 days';
  get diagnostics v_n = row_count;

  delete from public.monitor_pulso where dia < current_date - 90;

  return v_n;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
--
-- A API fala pelo `service_role`. O grant explícito é necessário porque
-- o revoke em `public` levaria junto o que ele herdava.

revoke all on function public.fn_execucao_inicio(text) from anon, authenticated;
grant execute on function public.fn_execucao_inicio(text) to service_role;

revoke all on function public.fn_execucao_fim(uuid, boolean, int, jsonb, text) from anon, authenticated;
grant execute on function public.fn_execucao_fim(uuid, boolean, int, jsonb, text) to service_role;

revoke all on function public.fn_execucoes_ultimo_sucesso() from anon, authenticated;
grant execute on function public.fn_execucoes_ultimo_sucesso() to service_role;

revoke all on function public.fn_alarme_cabe(text, interval) from anon, authenticated;
grant execute on function public.fn_alarme_cabe(text, interval) to service_role;

revoke all on function public.fn_alarme_limpar(text) from anon, authenticated;
grant execute on function public.fn_alarme_limpar(text) to service_role;

revoke all on function public.fn_pulso_reservar(date) from anon, authenticated;
grant execute on function public.fn_pulso_reservar(date) to service_role;

revoke all on function public.fn_purgar_execucoes() from anon, authenticated;
grant execute on function public.fn_purgar_execucoes() to service_role;

-- ---------------------------------------------------------------------
-- Para você olhar
-- ---------------------------------------------------------------------

drop view if exists public.vw_execucoes;
create view public.vw_execucoes
with (security_invoker = on) as
select
  e.processo,
  e.iniciado_em,
  e.terminado_em,
  case
    when e.terminado_em is null and e.iniciado_em < now() - interval '1 hour'
      then 'travado'
    when e.terminado_em is null then 'rodando'
    when e.ok then 'ok'
    else 'falhou'
  end as situacao,
  round(extract(epoch from (e.terminado_em - e.iniciado_em)))::int as duracao_seg,
  e.total,
  e.erro
from public.execucoes e
order by e.iniciado_em desc;

comment on view public.vw_execucoes is
  'O que rodou. `travado` é a linha que começou e nunca terminou — invisível sem o registro em dois tempos.';

notify pgrst, 'reload schema';

-- =====================================================================
-- DEPOIS DE RODAR
-- =====================================================================
--
-- A tabela começa vazia, e isso significa que TODO processo do catálogo
-- aparece como atrasado na primeira verificação. É o comportamento
-- certo: até agora nenhum deles sabia dizer que rodou, e tratar
-- "nunca registrou" como "deve estar tudo bem" seria repetir o defeito
-- que este arquivo existe para corrigir.
--
-- O silêncio volta conforme cada processo passa a registrar.
-- =====================================================================
