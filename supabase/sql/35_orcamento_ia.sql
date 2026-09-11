-- =====================================================================
-- 35 — O teto de gasto com a IA
-- =====================================================================
--
-- ---------------------------------------------------------------------
-- POR QUE ISTO EXISTE
-- ---------------------------------------------------------------------
-- O formulário de diagnóstico é público e cada envio custa uma chamada
-- paga ao modelo. O limite por endereço já fecha a porta do abuso banal,
-- mas não cobre os dois casos que realmente doem:
--
--   1. Muitos endereços diferentes — um script distribuído, ou um dia de
--      campanha que deu muito mais certo do que o previsto.
--   2. Defeito nosso. Um laço que reprocessa, uma varredura que chama o
--      modelo de novo a cada passada, uma retentativa que não para.
--
-- Nos dois casos o sintoma é o mesmo: nada quebra, nada avisa, e a conta
-- chega no fim do mês. É falha silenciosa com outro nome.
--
-- ---------------------------------------------------------------------
-- POR QUE O CONTADOR VIVE NO BANCO
-- ---------------------------------------------------------------------
-- Um contador na memória da API zera a cada reinício — e reinício é
-- justamente o que acontece quando algo está errado. O banco é o único
-- lugar onde a contagem sobrevive ao processo que ela deveria conter.
--
-- A reserva também precisa ser atômica: duas requisições simultâneas
-- lendo "49 de 50" e as duas passando é exatamente o tipo de corrida que
-- torna um teto decorativo.
-- =====================================================================

create table if not exists public.ia_uso (
  dia             date primary key,
  chamadas        int    not null default 0,

  -- Preenchidos DEPOIS da resposta, porque só então se sabe quanto foi
  -- consumido. Servem para você calcular o custo por diagnóstico com
  -- número, em vez de estimar pela fatura.
  tokens_entrada  bigint not null default 0,
  tokens_saida    bigint not null default 0,

  -- Quantas vezes o teto recusou uma chamada. Diferente de zero significa
  -- que alguém ficou sem diagnóstico — e isso precisa ser investigado,
  -- não comemorado.
  recusadas       int    not null default 0,

  atualizado_em   timestamptz not null default now()
);

alter table public.ia_uso enable row level security;

drop policy if exists ia_uso_staff on public.ia_uso;
create policy ia_uso_staff on public.ia_uso
  for select using (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- Reservar uma chamada
-- ---------------------------------------------------------------------
--
-- Incrementa e devolve se pode prosseguir, numa transação só. Chamado
-- ANTES de falar com o modelo: reservar depois seria contar o que já foi
-- gasto, que é o oposto de um teto.
--
-- Devolve também `usadas` e `limite` para o alarme dizer onde está, em
-- vez de só "bateu o teto".

create or replace function public.fn_ia_reservar(p_limite int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_atual int;
begin
  insert into public.ia_uso (dia, chamadas)
  values (current_date, 0)
  on conflict (dia) do nothing;

  -- `for update` serializa as concorrentes aqui. Sem isso, duas
  -- requisições simultâneas leem o mesmo valor e as duas passam.
  select u.chamadas into v_atual
  from public.ia_uso u
  where u.dia = current_date
  for update;

  if v_atual >= p_limite then
    update public.ia_uso
       set recusadas = recusadas + 1, atualizado_em = now()
     where dia = current_date;

    return jsonb_build_object('permitido', false, 'usadas', v_atual, 'limite', p_limite);
  end if;

  update public.ia_uso
     set chamadas = chamadas + 1, atualizado_em = now()
   where dia = current_date;

  return jsonb_build_object('permitido', true, 'usadas', v_atual + 1, 'limite', p_limite);
end;
$fn$;

-- ---------------------------------------------------------------------
-- Registrar o que foi consumido
-- ---------------------------------------------------------------------
--
-- Separado da reserva porque só se sabe depois da resposta. Nunca lança:
-- perder a contabilidade de uma chamada é aceitável; derrubar um
-- diagnóstico por causa dela, não.

create or replace function public.fn_ia_consumo(
  p_entrada bigint,
  p_saida   bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.ia_uso
     set tokens_entrada = tokens_entrada + coalesce(p_entrada, 0),
         tokens_saida   = tokens_saida   + coalesce(p_saida, 0),
         atualizado_em  = now()
   where dia = current_date;
exception when others then
  null;
end;
$fn$;

revoke all on function public.fn_ia_reservar(int) from anon, authenticated;
grant execute on function public.fn_ia_reservar(int) to service_role;

revoke all on function public.fn_ia_consumo(bigint, bigint) from anon, authenticated;
grant execute on function public.fn_ia_consumo(bigint, bigint) to service_role;

-- ---------------------------------------------------------------------
-- Para você olhar
-- ---------------------------------------------------------------------

drop view if exists public.vw_ia_uso;
create view public.vw_ia_uso
with (security_invoker = on) as
select
  u.dia,
  u.chamadas,
  u.recusadas,
  u.tokens_entrada,
  u.tokens_saida,
  case when u.chamadas > 0
       then round((u.tokens_entrada + u.tokens_saida)::numeric / u.chamadas)
  end as tokens_por_chamada,
  u.atualizado_em
from public.ia_uso u
order by u.dia desc;

comment on view public.vw_ia_uso is
  'Consumo diário da IA. `recusadas` diferente de zero significa que alguém ficou sem diagnóstico.';

notify pgrst, 'reload schema';

-- =====================================================================
-- COMO ESCOLHER O LIMITE
-- =====================================================================
--
-- Olhe o movimento real depois de uma semana:
--
--   select dia, chamadas, tokens_por_chamada from public.vw_ia_uso;
--
-- O teto deve ficar bem acima do maior dia normal — ele não é uma cota,
-- é um disjuntor. Um teto apertado transforma um dia bom de campanha em
-- prospect recusado, que é um prejuízo maior que a conta que ele evita.
--
-- O valor fica em `IA_LIMITE_DIARIO` no `.env`, para mudar sem deploy.
-- =====================================================================
