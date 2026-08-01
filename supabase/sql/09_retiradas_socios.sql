-- =====================================================================
-- 09_retiradas_socios.sql — Separar retirada de sócio do resultado
-- =====================================================================
-- ⚠️ RODE EM DUAS ETAPAS SEPARADAS. Não cole o arquivo inteiro de uma vez.
--
-- O Postgres não permite USAR um valor de enum na mesma transação em que ele
-- foi criado. Como o SQL Editor roda tudo numa transação só, a ETAPA 2
-- falharia com "unsafe use of new value of enum type".
--
-- Rode a ETAPA 1, aguarde o "Success", e só então rode a ETAPA 2.
-- =====================================================================
--
-- POR QUE ISTO EXISTE
--
-- Retirada de sócio não é despesa. São três coisas diferentes que hoje caem
-- no mesmo lugar e distorcem o diagnóstico:
--
--   • Pró-labore — remunera o TRABALHO do sócio. É despesa, entra no
--     resultado, e deveria ser um valor estável. Sócio cotista que não
--     trabalha na empresa não tem pró-labore.
--
--   • Distribuição de lucros — destinação do lucro já apurado. NÃO é
--     despesa: vem depois do resultado, não antes.
--
--   • Despesa pessoal paga pela empresa — retirada disfarçada. Tratá-la
--     como despesa operacional faz a empresa parecer menos lucrativa do
--     que é, e esconde que o problema é o consumo, não a operação.
--
-- Sem essa separação, o dono conclui que "a empresa não dá dinheiro" quando
-- na verdade ela dá — e ele está retirando mais do que ela gera. É o
-- diagnóstico invertido, e a causa da confusão patrimonial não ser percebida.
--
-- NOTA: pró-labore e distribuição têm tratamento tributário distinto (INSS,
-- IR, exigências de escrituração). Este script trata da separação GERENCIAL.
-- O enquadramento fiscal de cada retirada é conversa com o contador.
-- =====================================================================


-- =====================================================================
-- ETAPA 1 — rode SOZINHA e aguarde o "Success"
-- =====================================================================

alter type public.dre_group add value if not exists 'retirada_socios';


-- =====================================================================
-- ETAPA 2 — só depois que a ETAPA 1 terminar
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2.1 Liberar a nova classificação no CHECK de categorias
-- ---------------------------------------------------------------------
alter table public.categories drop constraint if exists categories_type_group_ck;

alter table public.categories add constraint categories_type_group_ck check (
  (type = 'receita' and dre_group in ('receita_bruta','outras_receitas'))
  or
  (type = 'despesa' and dre_group in (
     'deducao','custo_variavel','despesa_fixa','outras_despesas','retirada_socios'))
);

-- ---------------------------------------------------------------------
-- 2.2 DRE com a retirada ABAIXO do resultado
-- ---------------------------------------------------------------------
-- O DROP é obrigatório: `create or replace view` não permite alterar a ordem
-- nem os nomes das colunas, e estamos inserindo duas colunas novas no meio.
-- View não guarda dados — é só uma consulta salva.
drop view if exists public.vw_dre_monthly;

create or replace view public.vw_dre_monthly
with (security_invoker = on) as
select
  d.tenant_id,
  d.competencia,
  d.receita_bruta,
  d.deducoes,
  d.receita_bruta - d.deducoes                                        as receita_liquida,
  d.custos_variaveis,
  d.receita_bruta - d.deducoes - d.custos_variaveis                   as margem_contribuicao,
  case when (d.receita_bruta - d.deducoes) > 0
       then round(((d.receita_bruta - d.deducoes - d.custos_variaveis)
                   / (d.receita_bruta - d.deducoes)) * 100, 2)
  end                                                                 as margem_contribuicao_pct,
  d.despesas_fixas,
  d.receita_bruta - d.deducoes - d.custos_variaveis - d.despesas_fixas as resultado_operacional,
  d.outras_receitas,
  d.outras_despesas,

  -- Lucro do período: o que a empresa efetivamente gerou.
  d.receita_bruta - d.deducoes - d.custos_variaveis - d.despesas_fixas
    + d.outras_receitas - d.outras_despesas                           as resultado_liquido,

  -- Abaixo da linha: destinação do lucro, não custo de operar.
  d.retiradas                                                         as retiradas_socios,

  -- Quanto o patrimônio da empresa cresceu ou encolheu no mês.
  -- Negativo significa que a retirada consumiu capital de giro.
  d.receita_bruta - d.deducoes - d.custos_variaveis - d.despesas_fixas
    + d.outras_receitas - d.outras_despesas - d.retiradas             as variacao_patrimonio,

  case when d.despesas_fixas > 0
        and (d.receita_bruta - d.deducoes) > 0
        and (d.receita_bruta - d.deducoes - d.custos_variaveis) > 0
       then round(d.despesas_fixas
                  / ((d.receita_bruta - d.deducoes - d.custos_variaveis)
                     / (d.receita_bruta - d.deducoes)), 2)
  end                                                                 as ponto_equilibrio
from (
  select
    t.tenant_id,
    date_trunc('month', t.competence_date::timestamp)::date as competencia,
    coalesce(sum(t.amount) filter (where g.grp = 'receita_bruta'),   0) as receita_bruta,
    coalesce(sum(t.amount) filter (where g.grp = 'deducao'),         0) as deducoes,
    coalesce(sum(t.amount) filter (where g.grp = 'custo_variavel'),  0) as custos_variaveis,
    coalesce(sum(t.amount) filter (where g.grp = 'despesa_fixa'),    0) as despesas_fixas,
    coalesce(sum(t.amount) filter (where g.grp = 'outras_receitas'), 0) as outras_receitas,
    coalesce(sum(t.amount) filter (where g.grp = 'outras_despesas'), 0) as outras_despesas,
    coalesce(sum(t.amount) filter (where g.grp = 'retirada_socios'), 0) as retiradas
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  cross join lateral (
    select coalesce(c.dre_group,
             case when t.type = 'receita' then 'receita_bruta'::public.dre_group
                  else 'despesa_fixa'::public.dre_group end) as grp
  ) g
  where t.status <> 'cancelado'
  group by t.tenant_id, date_trunc('month', t.competence_date::timestamp)
) d;

comment on view public.vw_dre_monthly is
  'DRE por competência. Retiradas de sócios ficam ABAIXO do resultado: são destinação do lucro, não despesa.';

-- ---------------------------------------------------------------------
-- 2.3 Categorias padrão para novas empresas
-- ---------------------------------------------------------------------
create or replace function public.fn_seed_default_categories(p_tenant_id uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
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
    (p_tenant_id, 'Venda de Produtos',          'receita', 'receita_bruta'),
    (p_tenant_id, 'Prestação de Serviços',      'receita', 'receita_bruta'),
    (p_tenant_id, 'Outras Receitas',            'receita', 'outras_receitas'),
    (p_tenant_id, 'Impostos sobre Vendas',      'despesa', 'deducao'),
    (p_tenant_id, 'Devoluções e Descontos',     'despesa', 'deducao'),
    (p_tenant_id, 'Mercadoria / Matéria-Prima', 'despesa', 'custo_variavel'),
    (p_tenant_id, 'Comissões de Vendas',        'despesa', 'custo_variavel'),
    (p_tenant_id, 'Frete sobre Vendas',         'despesa', 'custo_variavel'),
    (p_tenant_id, 'Taxas de Cartão / Gateway',  'despesa', 'custo_variavel'),
    (p_tenant_id, 'Embalagens',                 'despesa', 'custo_variavel'),
    (p_tenant_id, 'Pró-labore',                 'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Folha de Pagamento',         'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Encargos Sociais',           'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Aluguel e Condomínio',       'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Energia, Água e Internet',   'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Contabilidade',              'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Software e Assinaturas',     'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Marketing e Publicidade',    'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Manutenção e Limpeza',       'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Despesas Financeiras',       'despesa', 'outras_despesas'),
    (p_tenant_id, 'Investimentos / Imobilizado','despesa', 'outras_despesas'),
    -- Retiradas: abaixo da linha do resultado
    (p_tenant_id, 'Distribuição de Lucros',     'despesa', 'retirada_socios'),
    (p_tenant_id, 'Despesas Pessoais do Sócio', 'despesa', 'retirada_socios'),
    (p_tenant_id, 'Empréstimo ao Sócio',        'despesa', 'retirada_socios')
  on conflict (tenant_id, name, type) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 2.4 Acrescentar as categorias às empresas JÁ existentes
-- ---------------------------------------------------------------------
insert into public.categories (tenant_id, name, type, dre_group)
select t.id, v.nome, 'despesa', 'retirada_socios'
from public.tenants t
cross join (values
  ('Distribuição de Lucros'),
  ('Despesas Pessoais do Sócio'),
  ('Empréstimo ao Sócio')
) as v(nome)
on conflict (tenant_id, name, type) do nothing;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 2.5 CONFERÊNCIA
-- ---------------------------------------------------------------------
-- select competencia, resultado_liquido, retiradas_socios, variacao_patrimonio
--   from public.vw_dre_monthly order by competencia desc limit 6;
