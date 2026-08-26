create or replace function public.fn_completude_mensal(
  p_tenant_id   uuid,
  p_competencia date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with ag as (
    select *
      from public.vw_agregados_mensais
     where tenant_id = p_tenant_id
       and competencia = p_competencia
  ),
  fe as (
    select *
      from public.fechamentos_mensais
     where tenant_id = p_tenant_id
       and competencia = p_competencia
       and confirmado_em is not null
  ),
  c as (
    select
      exists (select 1 from ag) as tem_lancamentos,
      exists (select 1 from fe) as tem_fechamento,
      coalesce((select faturamento_bruto from ag), 0) > 0 as tem_receita,
      coalesce((select despesas_fixas   from ag), 0) > 0 as tem_despesa_fixa,
      coalesce((
        select faturamento_bruto = 0
            or (coalesce(custos_variaveis, 0)
                + coalesce(despesas_fixas, 0)
                + coalesce(impostos_sobre_vendas, 0)) >= faturamento_bruto * 0.33
          from ag
      ), false) as despesas_proporcionais,
      coalesce((select passivo_curto_prazo is not null
                   and passivo_longo_prazo is not null from fe), false) as tem_passivo,
      coalesce((select parcela_dividas_mensal     is not null from fe), false) as tem_parcela,
      coalesce((select uso_antecipacao_recebiveis is not null from fe), false) as tem_antecipacao,
      coalesce((select mistura_contas_pf_pj       is not null from fe), false) as tem_mistura
  ),
  p as (
    select
      c.*,
      (case when c.tem_receita            then 3 else 0 end)
    + (case when c.tem_despesa_fixa       then 2 else 0 end)
    + (case when c.despesas_proporcionais then 1 else 0 end)
    + (case when c.tem_passivo            then 1 else 0 end)
    + (case when c.tem_parcela            then 1 else 0 end)
    + (case when c.tem_antecipacao        then 1 else 0 end)
    + (case when c.tem_mistura            then 1 else 0 end) as pontos,
      array_remove(array[
        case when c.tem_receita      then null else 'as receitas do mês' end,
        case when c.tem_despesa_fixa then null else 'as despesas fixas do mês' end,
        case when c.despesas_proporcionais or not c.tem_lancamentos then null
             else 'parte das despesas — o total lançado é pequeno demais para o faturamento do mês' end,
        case when c.tem_fechamento then null else 'a confirmação do fechamento do mês' end,
        case when not c.tem_fechamento or c.tem_passivo then null
             else 'o passivo de curto e longo prazo' end,
        case when not c.tem_fechamento or c.tem_parcela then null
             else 'a parcela mensal de dívidas' end,
        case when not c.tem_fechamento or c.tem_antecipacao then null
             else 'a pergunta sobre antecipação de recebíveis' end,
        case when not c.tem_fechamento or c.tem_mistura then null
             else 'a pergunta sobre separação entre conta pessoal e da empresa' end
      ], null) as faltas
    from c
  )
  select jsonb_build_object(
    'tenant_id',   p_tenant_id,
    'competencia', p_competencia,
    'pontos',      p.pontos,
    'maximo',      10,
    'percentual',  round(p.pontos::numeric / 10 * 100),
    'suficiente',  p.pontos = 10,
    'faltas',      to_jsonb(p.faltas)
  )
  from p
$fn$
