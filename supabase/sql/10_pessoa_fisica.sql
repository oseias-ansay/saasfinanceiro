-- =====================================================================
-- 10_pessoa_fisica.sql — Controle financeiro pessoal do sócio
-- Rode DEPOIS do 09.
-- =====================================================================
-- IDEIA CENTRAL: a pessoa física é um TENANT, como a empresa.
--
-- Nada no modelo exige que um tenant seja empresa. Categorias, contas,
-- lançamentos, fluxo de caixa e projeção funcionam igual para uma pessoa.
-- Em vez de um módulo paralelo, marcamos o tipo e reaproveitamos tudo —
-- inclusive o RLS, o seletor de contexto e o alerta de caixa negativo.
--
-- CONSEQUÊNCIA DE PRIVACIDADE (deliberada): o controle pessoal é um tenant
-- separado, então a consultoria só enxerga se o sócio a adicionar como
-- membro. Ele decide se compartilha a vida pessoal. Não é automático, e é
-- assim que deve ser.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TIPO DE TENANT
-- ---------------------------------------------------------------------
do $$ begin
  create type public.tenant_kind as enum ('empresa', 'pessoa_fisica');
exception when duplicate_object then null; end $$;

alter table public.tenants
  add column if not exists kind public.tenant_kind not null default 'empresa';

comment on column public.tenants.kind is
  'empresa = CNPJ do cliente. pessoa_fisica = controle pessoal do sócio, com categorias e telas próprias.';

create index if not exists tenants_kind_idx on public.tenants (kind);

-- ---------------------------------------------------------------------
-- 2. CATEGORIAS DE VIDA PESSOAL
-- ---------------------------------------------------------------------
-- Estrutura diferente da empresa de propósito. Pessoa física não tem
-- margem de contribuição nem ponto de equilíbrio; tem renda, custo fixo de
-- viver, gasto variável e o que sobra.
--
-- O mapeamento para dre_group é reaproveitamento técnico, não conceito
-- contábil: 'despesa_fixa' para o que se paga todo mês independentemente,
-- 'custo_variavel' para o que oscila com o consumo.
create or replace function public.fn_seed_categorias_pessoais(p_tenant_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  if not (
    public.is_tenant_admin(p_tenant_id)
    or public.is_platform_staff()
    or current_user = 'service_role'
  ) then
    raise exception 'Permissão negada para o tenant %', p_tenant_id;
  end if;

  insert into public.categories (tenant_id, name, type, dre_group) values
    -- Rendas
    (p_tenant_id, 'Pró-labore',                'receita', 'receita_bruta'),
    (p_tenant_id, 'Distribuição de Lucros',    'receita', 'receita_bruta'),
    (p_tenant_id, 'Salário',                   'receita', 'receita_bruta'),
    (p_tenant_id, 'Aluguéis Recebidos',        'receita', 'receita_bruta'),
    (p_tenant_id, 'Rendimentos de Investimentos','receita','outras_receitas'),
    (p_tenant_id, 'Outras Rendas',             'receita', 'outras_receitas'),

    -- Custo de viver — fixo
    (p_tenant_id, 'Moradia (aluguel/financiamento)','despesa','despesa_fixa'),
    (p_tenant_id, 'Condomínio e IPTU',         'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Energia, Água, Gás',        'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Internet e Telefone',       'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Escola e Faculdade',        'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Plano de Saúde',            'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Seguros',                   'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Financiamento de Veículo',  'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Assinaturas e Streaming',   'despesa', 'despesa_fixa'),

    -- Custo de viver — variável
    (p_tenant_id, 'Supermercado',              'despesa', 'custo_variavel'),
    (p_tenant_id, 'Alimentação Fora',          'despesa', 'custo_variavel'),
    (p_tenant_id, 'Combustível e Transporte',  'despesa', 'custo_variavel'),
    (p_tenant_id, 'Saúde e Farmácia',          'despesa', 'custo_variavel'),
    (p_tenant_id, 'Vestuário',                 'despesa', 'custo_variavel'),
    (p_tenant_id, 'Lazer e Viagens',           'despesa', 'custo_variavel'),
    (p_tenant_id, 'Cuidados Pessoais',         'despesa', 'custo_variavel'),
    (p_tenant_id, 'Presentes e Doações',       'despesa', 'custo_variavel'),

    -- Outros
    (p_tenant_id, 'Impostos e Taxas',          'despesa', 'outras_despesas'),
    (p_tenant_id, 'Juros e Tarifas Bancárias', 'despesa', 'outras_despesas'),
    (p_tenant_id, 'Investimentos / Poupança',  'despesa', 'outras_despesas')
  on conflict (tenant_id, name, type) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.fn_seed_categorias_pessoais(uuid) from public;
grant execute on function public.fn_seed_categorias_pessoais(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. RESUMO MENSAL DA PESSOA FÍSICA
-- ---------------------------------------------------------------------
-- Sem margem de contribuição nem ponto de equilíbrio: para pessoa física
-- esses conceitos não significam nada. O que importa é renda, custo de
-- viver e o quanto sobra.
create or replace view public.vw_pf_monthly
with (security_invoker = on) as
select
  d.tenant_id,
  d.competencia,
  d.rendas,
  d.gastos_fixos,
  d.gastos_variaveis,
  d.outros_gastos,
  d.gastos_fixos + d.gastos_variaveis + d.outros_gastos as custo_total,
  d.rendas - (d.gastos_fixos + d.gastos_variaveis + d.outros_gastos) as sobra,
  case when d.rendas > 0
       then round(((d.rendas - (d.gastos_fixos + d.gastos_variaveis + d.outros_gastos))
                   / d.rendas) * 100, 2)
  end as taxa_poupanca_pct,
  -- Comprometimento fixo: quanto da renda já está preso antes de qualquer
  -- escolha. Acima de 60% costuma indicar pouca margem de manobra.
  case when d.rendas > 0
       then round((d.gastos_fixos / d.rendas) * 100, 2)
  end as comprometimento_fixo_pct
from (
  select
    t.tenant_id,
    date_trunc('month', t.competence_date::timestamp)::date as competencia,
    coalesce(sum(t.amount) filter (where t.type = 'receita'), 0) as rendas,
    coalesce(sum(t.amount) filter (
      where t.type = 'despesa' and c.dre_group = 'despesa_fixa'), 0) as gastos_fixos,
    coalesce(sum(t.amount) filter (
      where t.type = 'despesa' and c.dre_group = 'custo_variavel'), 0) as gastos_variaveis,
    coalesce(sum(t.amount) filter (
      where t.type = 'despesa'
        and (c.dre_group is null or c.dre_group not in ('despesa_fixa','custo_variavel'))
    ), 0) as outros_gastos
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.status <> 'cancelado'
  group by t.tenant_id, date_trunc('month', t.competence_date::timestamp)
) d;

comment on view public.vw_pf_monthly is
  'Resumo mensal para tenants do tipo pessoa_fisica: renda, custo de viver e sobra.';

grant select on public.vw_pf_monthly to authenticated;

-- ---------------------------------------------------------------------
-- 4. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- select id, name, kind from public.tenants;
