create table if not exists public.fechamentos_mensais (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  competencia     date not null,

  passivo_curto_prazo     numeric(14,2) check (passivo_curto_prazo >= 0),
  passivo_longo_prazo     numeric(14,2) check (passivo_longo_prazo >= 0),
  parcela_dividas_mensal  numeric(14,2) check (parcela_dividas_mensal >= 0),
  custo_divida_pct_am     numeric(6,3)  check (custo_divida_pct_am between 0 and 100),

  pme_dias                int check (pme_dias between 0 and 3650),

  uso_antecipacao_recebiveis text
    check (uso_antecipacao_recebiveis in ('nunca','raramente','mensalmente','constantemente')),
  mistura_contas_pf_pj       text
    check (mistura_contas_pf_pj in ('nao','as_vezes','sim')),

  percentual_maior_cliente   numeric(5,2) check (percentual_maior_cliente between 0 and 100),

  confirmado_em   timestamptz,
  confirmado_por  uuid references auth.users(id) on delete set null,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (tenant_id, competencia),
  constraint fechamento_competencia_dia1 check (extract(day from competencia) = 1)
);

drop trigger if exists set_updated_at on public.fechamentos_mensais;
create trigger set_updated_at before update on public.fechamentos_mensais
  for each row execute function public.tg_set_updated_at();

comment on table public.fechamentos_mensais is
  'Os campos que o diagnóstico precisa e os lançamentos não revelam. '
  'Pré-preenchidos com o mês anterior — confirmar é mais barato que digitar.';

comment on column public.fechamentos_mensais.confirmado_em is
  'Nulo = rascunho herdado do mês anterior, ainda não olhado por ninguém. '
  'A completude só conta campo de fechamento confirmado.';

comment on column public.fechamentos_mensais.percentual_maior_cliente is
  'Sobrepõe o valor calculado pelas entidades. Existe porque quem não '
  'preenche entidade nos lançamentos ainda sabe a resposta.';

alter table public.fechamentos_mensais enable row level security;

drop policy if exists fechamentos_select on public.fechamentos_mensais;
create policy fechamentos_select on public.fechamentos_mensais
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists fechamentos_write on public.fechamentos_mensais;
create policy fechamentos_write on public.fechamentos_mensais
  for all using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

create or replace view public.vw_prazos_medios
with (security_invoker = on) as
select
  t.tenant_id,
  date_trunc('month', t.competence_date::timestamp)::date as competencia,

  round(
    sum(t.paid_amount * (t.paid_date - t.competence_date))
      filter (where t.type = 'receita')
    / nullif(sum(t.paid_amount) filter (where t.type = 'receita'), 0)
  )::int as pmr_dias,

  round(
    sum(t.paid_amount * (t.paid_date - t.competence_date))
      filter (where t.type = 'despesa')
    / nullif(sum(t.paid_amount) filter (where t.type = 'despesa'), 0)
  )::int as pmp_dias,

  count(*) filter (where t.type = 'receita') as titulos_recebidos,
  count(*) filter (where t.type = 'despesa') as titulos_pagos
from public.transactions t
where t.status = 'liquidado'
  and t.paid_date is not null
  and t.paid_amount is not null
group by t.tenant_id, date_trunc('month', t.competence_date::timestamp);

comment on view public.vw_prazos_medios is
  'PMR e PMP ponderados por valor, sobre lançamentos liquidados. Título em '
  'aberto não entra: ele tem vencimento, não prazo de recebimento.';

grant select on public.vw_prazos_medios to authenticated;

create or replace view public.vw_agregados_mensais
with (security_invoker = on) as
with base as (
  select
    d.tenant_id,
    d.competencia,
    d.receita_bruta,
    d.deducoes,
    d.custos_variaveis,
    d.despesas_fixas,
    d.retiradas_socios,
    d.resultado_liquido
  from public.vw_dre_monthly d
),
saldo_fim as (
  select
    b.tenant_id,
    b.competencia,
    coalesce((
      select sum(ba.opening_balance)
        from public.bank_accounts ba
       where ba.tenant_id = b.tenant_id
         and ba.is_active
         and ba.opening_balance_date <= (b.competencia + interval '1 month - 1 day')::date
    ), 0)
    + coalesce((
      select sum(case when t.type = 'receita' then t.paid_amount else -t.paid_amount end)
        from public.transactions t
       where t.tenant_id = b.tenant_id
         and t.status = 'liquidado'
         and t.paid_date <= (b.competencia + interval '1 month - 1 day')::date
    ), 0) as saldo_caixa
  from base b
),
inadimplencia as (
  select
    b.tenant_id,
    b.competencia,
    coalesce((
      select sum(t.amount)
        from public.transactions t
       where t.tenant_id = b.tenant_id
         and t.type = 'receita'
         and t.status <> 'cancelado'
         and t.status <> 'liquidado'
         and t.due_date < current_date
         and date_trunc('month', t.competence_date::timestamp)::date = b.competencia
    ), 0) as receita_vencida_em_aberto
  from base b
),
concentracao as (
  select
    b.tenant_id,
    b.competencia,
    (
      select round(max(por_cliente.total) / nullif(sum(por_cliente.total), 0) * 100, 2)
        from (
          select sum(t.amount) as total
            from public.transactions t
           where t.tenant_id = b.tenant_id
             and t.type = 'receita'
             and t.status <> 'cancelado'
             and t.entity_id is not null
             and date_trunc('month', t.competence_date::timestamp)::date = b.competencia
           group by t.entity_id
        ) por_cliente
    ) as maior_cliente_pct,
    (
      select count(*) filter (where t.entity_id is null)::numeric
             / nullif(count(*), 0) * 100
        from public.transactions t
       where t.tenant_id = b.tenant_id
         and t.type = 'receita'
         and t.status <> 'cancelado'
         and date_trunc('month', t.competence_date::timestamp)::date = b.competencia
    ) as receitas_sem_entidade_pct
  from base b
)
select
  b.tenant_id,
  b.competencia,
  b.receita_bruta        as faturamento_bruto,
  b.deducoes             as impostos_sobre_vendas,
  b.custos_variaveis,
  b.despesas_fixas,
  b.retiradas_socios     as pro_labore_socios,
  b.resultado_liquido    as lucro_liquido,
  s.saldo_caixa,
  p.pmr_dias,
  p.pmp_dias,
  p.titulos_recebidos,
  p.titulos_pagos,
  i.receita_vencida_em_aberto,
  case when b.receita_bruta > 0
       then round(i.receita_vencida_em_aberto / b.receita_bruta * 100, 2)
       else null end     as inadimplencia_pct,
  c.maior_cliente_pct,
  round(c.receitas_sem_entidade_pct, 1) as receitas_sem_entidade_pct
from base b
join saldo_fim      s on s.tenant_id = b.tenant_id and s.competencia = b.competencia
join inadimplencia  i on i.tenant_id = b.tenant_id and i.competencia = b.competencia
join concentracao   c on c.tenant_id = b.tenant_id and c.competencia = b.competencia
left join public.vw_prazos_medios p
       on p.tenant_id = b.tenant_id and p.competencia = b.competencia;

comment on view public.vw_agregados_mensais is
  'Tudo o que a régua consome e sai dos lançamentos. O saldo é o do fim da '
  'competência, não o de hoje: o passado não pode mudar quando alguém abre a tela.';

grant select on public.vw_agregados_mensais to authenticated;

create or replace function public.fn_completude_mensal(
  p_tenant_id   uuid,
  p_competencia date
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_ag        record;
  v_fe        record;
  v_faltas    text[] := '{}';
  v_pontos    int := 0;
  v_max       int := 10;
begin
  select * into v_ag
    from public.vw_agregados_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia;

  select * into v_fe
    from public.fechamentos_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia
     and confirmado_em is not null;

  if v_ag is null or coalesce(v_ag.faturamento_bruto, 0) = 0 then
    v_faltas := v_faltas || 'as receitas do mês';
  else
    v_pontos := v_pontos + 3;
  end if;

  if v_ag is null or coalesce(v_ag.despesas_fixas, 0) = 0 then
    v_faltas := v_faltas || 'as despesas fixas do mês';
  else
    v_pontos := v_pontos + 2;
  end if;

  if v_ag is not null
     and coalesce(v_ag.faturamento_bruto, 0) > 0
     and (coalesce(v_ag.custos_variaveis, 0) + coalesce(v_ag.despesas_fixas, 0)
          + coalesce(v_ag.impostos_sobre_vendas, 0))
         < v_ag.faturamento_bruto * 0.33
  then
    v_faltas := v_faltas || 'parte das despesas — o total lançado é pequeno demais para o faturamento do mês';
  else
    if v_ag is not null then v_pontos := v_pontos + 1; end if;
  end if;

  if v_fe is null then
    v_faltas := v_faltas || 'a confirmação do fechamento do mês';
  else
    if v_fe.passivo_curto_prazo is null or v_fe.passivo_longo_prazo is null then
      v_faltas := v_faltas || 'o passivo de curto e longo prazo';
    else
      v_pontos := v_pontos + 1;
    end if;

    if v_fe.parcela_dividas_mensal is null then
      v_faltas := v_faltas || 'a parcela mensal de dívidas';
    else
      v_pontos := v_pontos + 1;
    end if;

    if v_fe.uso_antecipacao_recebiveis is null then
      v_faltas := v_faltas || 'a pergunta sobre antecipação de recebíveis';
    else
      v_pontos := v_pontos + 1;
    end if;

    if v_fe.mistura_contas_pf_pj is null then
      v_faltas := v_faltas || 'a pergunta sobre separação entre conta pessoal e da empresa';
    else
      v_pontos := v_pontos + 1;
    end if;
  end if;

  return jsonb_build_object(
    'tenant_id',    p_tenant_id,
    'competencia',  p_competencia,
    'pontos',       v_pontos,
    'maximo',       v_max,
    'percentual',   round(v_pontos::numeric / v_max * 100),
    'suficiente',   v_pontos = v_max,
    'faltas',       to_jsonb(v_faltas)
  );
end;
$$;

comment on function public.fn_completude_mensal(uuid, date) is
  'Dá para confiar no score deste mês? Devolve veredito e a lista do que '
  'falta, em texto que pode ir direto ao cliente.';

revoke all on function public.fn_completude_mensal(uuid, date) from public;
grant execute on function public.fn_completude_mensal(uuid, date) to authenticated;

create or replace function public.fn_entrada_regua(
  p_tenant_id   uuid,
  p_competencia date
)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'dre', jsonb_build_object(
      'faturamento_bruto',       coalesce(a.faturamento_bruto, 0),
      'impostos_sobre_vendas',   coalesce(a.impostos_sobre_vendas, 0),
      'custos_variaveis',        coalesce(a.custos_variaveis, 0),
      'despesas_fixas',          coalesce(a.despesas_fixas, 0),
      'pro_labore_socios',       coalesce(a.pro_labore_socios, 0),
      'lucro_liquido_informado', coalesce(a.lucro_liquido, 0)
    ),
    'caixa', jsonb_build_object(
      'saldo_caixa_reservas', coalesce(a.saldo_caixa, 0),
      'pmr_dias',             coalesce(a.pmr_dias, 0),
      'pmp_dias',             coalesce(a.pmp_dias, 0),
      'pme_dias',             coalesce(f.pme_dias, 0),
      'inadimplencia_pct',    coalesce(a.inadimplencia_pct, 0)
    ),
    'endividamento', jsonb_build_object(
      'passivo_curto_prazo',        f.passivo_curto_prazo,
      'passivo_longo_prazo',        f.passivo_longo_prazo,
      'parcela_dividas_mensal',     f.parcela_dividas_mensal,
      'custo_divida_pct_am',        f.custo_divida_pct_am,
      'uso_antecipacao_recebiveis', f.uso_antecipacao_recebiveis
    ),
    'qualitativo', jsonb_build_object(
      'mistura_contas_pf_pj', f.mistura_contas_pf_pj,
      'percentual_maior_cliente',
        coalesce(f.percentual_maior_cliente, a.maior_cliente_pct, 0)
    ),
    'origem', jsonb_build_object(
      'automatico',                true,
      'receitas_sem_entidade_pct', a.receitas_sem_entidade_pct,
      'titulos_recebidos',         a.titulos_recebidos,
      'titulos_pagos',             a.titulos_pagos
    )
  )
  from public.vw_agregados_mensais a
  left join public.fechamentos_mensais f
         on f.tenant_id = a.tenant_id
        and f.competencia = a.competencia
        and f.confirmado_em is not null
  where a.tenant_id = p_tenant_id and a.competencia = p_competencia;
$$;

comment on function public.fn_entrada_regua(uuid, date) is
  'Monta a entrada da régua a partir dos lançamentos e do fechamento. Mesmo '
  'formato do formulário manual — um formato só, dois produtores.';

revoke all on function public.fn_entrada_regua(uuid, date) from public;
grant execute on function public.fn_entrada_regua(uuid, date) to authenticated;

create or replace function public.fn_abrir_fechamento(
  p_tenant_id   uuid,
  p_competencia date
)
returns public.fechamentos_mensais
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_linha public.fechamentos_mensais;
begin
  if not (public.can_write_tenant(p_tenant_id)
          or public.is_platform_staff()
          or public.is_consultor_de(p_tenant_id)) then
    raise exception 'Sem permissão para esta empresa' using errcode = '42501';
  end if;

  select * into v_linha
    from public.fechamentos_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia;

  if found then
    return v_linha;
  end if;

  insert into public.fechamentos_mensais (
    tenant_id, competencia,
    passivo_curto_prazo, passivo_longo_prazo, parcela_dividas_mensal,
    custo_divida_pct_am, pme_dias,
    uso_antecipacao_recebiveis, mistura_contas_pf_pj, percentual_maior_cliente
  )
  select
    p_tenant_id, p_competencia,
    a.passivo_curto_prazo, a.passivo_longo_prazo, a.parcela_dividas_mensal,
    a.custo_divida_pct_am, a.pme_dias,
    a.uso_antecipacao_recebiveis, a.mistura_contas_pf_pj, a.percentual_maior_cliente
  from public.fechamentos_mensais a
  where a.tenant_id = p_tenant_id
    and a.competencia < p_competencia
  order by a.competencia desc
  limit 1;

  if not found then
    insert into public.fechamentos_mensais (tenant_id, competencia)
    values (p_tenant_id, p_competencia);
  end if;

  select * into v_linha
    from public.fechamentos_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia;

  return v_linha;
end;
$$;

comment on function public.fn_abrir_fechamento(uuid, date) is
  'Abre o fechamento do mês herdando o anterior, sem confirmar. Idempotente: '
  'nunca sobrescreve o que já foi digitado.';

revoke all on function public.fn_abrir_fechamento(uuid, date) from public;
grant execute on function public.fn_abrir_fechamento(uuid, date) to authenticated;
