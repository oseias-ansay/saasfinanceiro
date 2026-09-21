-- =====================================================================
-- 46 · O ORÇAMENTO: TRÊS CENÁRIOS E OS TETOS POR GRUPO
-- =====================================================================
-- O orçamento é a primeira ferramenta que guarda um PLANO, não uma
-- medição. Atendimentos, conversão e ticket dos três cenários são
-- escolha de gestão para o ano que vem — nenhum lançamento os revela,
-- e eles não mudam mês a mês.
--
-- Por isso duas tabelas, ambas sem competência:
--
--   • `orcamento_cenarios` — três linhas por empresa, uma por cenário
--   • `orcamento_tetos`    — uma linha por categoria com limite definido
--
-- ---------------------------------------------------------------------
-- TRÊS LINHAS EM VEZ DE NOVE COLUNAS
-- ---------------------------------------------------------------------
-- A alternativa era `pess_atendimentos`, `real_atendimentos`,
-- `otim_atendimentos` e mais seis. Funciona, e envelhece mal: um quarto
-- cenário viraria três colunas novas, e toda consulta precisaria saber
-- os nomes de cor.
--
-- ---------------------------------------------------------------------
-- O TETO É PERCENTUAL, NÃO VALOR
-- ---------------------------------------------------------------------
-- Guardar "R$ 9.400 de aluguel" congelaria o limite: a empresa cresce,
-- o teto não acompanha, e em seis meses ninguém respeita mais. Guardar
-- "5% da receita" faz o limite crescer junto — e é assim que a aula
-- ensina, com o teto calculado sobre o faturamento do cenário realista.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'cenario_orcamento') then
    create type public.cenario_orcamento as enum ('pessimista', 'realista', 'otimista');
  end if;
end $$;

create table if not exists public.orcamento_cenarios (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cenario   public.cenario_orcamento not null,

  atendimentos  int           check (atendimentos >= 0),
  conversao_pct numeric(5,2)  check (conversao_pct between 0 and 100),
  ticket        numeric(14,2) check (ticket >= 0),

  -- Margem por cenário, e não uma só para os três: crescer por TICKET
  -- muda a margem percentual; crescer por VOLUME não. Forçar uma única
  -- margem esconderia essa diferença, que é justamente o que distingue
  -- um plano de preço de um plano de vendas.
  margem_pct numeric(5,2) check (margem_pct between 0 and 100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (tenant_id, cenario)
);

comment on table public.orcamento_cenarios is
  'Os tres cenarios da aula 4.6. Plano, nao medicao: escolha de gestao para '
  'o ano, sem competencia mensal.';

drop trigger if exists set_updated_at on public.orcamento_cenarios;
create trigger set_updated_at before update on public.orcamento_cenarios
  for each row execute function public.tg_set_updated_at();

alter table public.orcamento_cenarios enable row level security;

drop policy if exists orcamento_cenarios_select on public.orcamento_cenarios;
create policy orcamento_cenarios_select on public.orcamento_cenarios
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists orcamento_cenarios_write on public.orcamento_cenarios;
create policy orcamento_cenarios_write on public.orcamento_cenarios
  for all using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );


-- ---------------------------------------------------------------------
-- OS TETOS POR GRUPO DE DESPESA
-- ---------------------------------------------------------------------

create table if not exists public.orcamento_tetos (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,

  teto_pct numeric(5,2) not null check (teto_pct >= 0 and teto_pct <= 100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (tenant_id, category_id)
);

comment on table public.orcamento_tetos is
  'Limite de cada grupo de despesa como percentual da receita do cenario '
  'realista. Percentual e nao valor para o teto crescer junto com a empresa.';

drop trigger if exists set_updated_at on public.orcamento_tetos;
create trigger set_updated_at before update on public.orcamento_tetos
  for each row execute function public.tg_set_updated_at();

alter table public.orcamento_tetos enable row level security;

drop policy if exists orcamento_tetos_select on public.orcamento_tetos;
create policy orcamento_tetos_select on public.orcamento_tetos
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists orcamento_tetos_write on public.orcamento_tetos;
create policy orcamento_tetos_write on public.orcamento_tetos
  for all using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );


-- ---------------------------------------------------------------------
-- O GASTO ATUAL POR CATEGORIA DE DESPESA FIXA
-- ---------------------------------------------------------------------
-- Média dos últimos três meses fechados, por categoria. É o "gasto hoje"
-- da coluna B da planilha.
--
-- Média e não o último mês: uma despesa que cai trimestralmente — IPTU,
-- seguro, software anual — apareceria como zero em dois meses de cada
-- três, e o teto seria definido contra um gasto que não existe.

drop view if exists public.vw_despesas_por_categoria;

create view public.vw_despesas_por_categoria
with (security_invoker = on) as
with meses as (
  select distinct date_trunc('month', t.competence_date::timestamp)::date as competencia,
         t.tenant_id
  from public.transactions t
  where t.status <> 'cancelado'
    and date_trunc('month', t.competence_date::timestamp)::date
        < date_trunc('month', current_date)::date
),
ultimos as (
  select tenant_id, competencia,
         row_number() over (partition by tenant_id order by competencia desc) as pos
  from meses
)
select
  c.tenant_id,
  c.id   as category_id,
  c.name as categoria,
  round(coalesce(sum(t.amount), 0) / greatest(count(distinct u.competencia), 1), 2) as media_mensal,
  count(distinct u.competencia)::int as meses
from public.categories c
left join public.transactions t
  on t.category_id = c.id
 and t.status <> 'cancelado'
left join ultimos u
  on u.tenant_id = c.tenant_id
 and u.competencia = date_trunc('month', t.competence_date::timestamp)::date
 and u.pos <= 3
where c.dre_group = 'despesa_fixa'
  and c.is_active
group by c.tenant_id, c.id, c.name;

comment on view public.vw_despesas_por_categoria is
  'Media mensal de cada categoria de despesa fixa nos ultimos 3 meses '
  'fechados. Media e nao ultimo mes: despesa trimestral apareceria como zero.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- select categoria, media_mensal, meses
--   from public.vw_despesas_por_categoria
--  where tenant_id = 'SEU-TENANT'
--  order by media_mensal desc;
--
-- A soma de `media_mensal` deve ficar próxima das despesas fixas do
-- DRE na média dos mesmos 3 meses. Diferença grande costuma significar
-- lançamento sem categoria — que o DRE joga em despesa_fixa por padrão
-- e esta view não enxerga, porque ela parte das categorias.
