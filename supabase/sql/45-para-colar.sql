-- =====================================================================
-- 45 · AS DUAS ESTIMATIVAS DO VALOR DO CLIENTE
-- =====================================================================
-- A aula 4.7 pede dois números que nenhum lançamento revela e que a
-- própria planilha declara serem ESTIMATIVA:
--
--   • quantas vezes o mesmo cliente compra por ano
--   • quantos anos ele fica
--
-- Tudo o mais da tela já é medido: faturamento vem do DRE, vendas,
-- atendimentos e clientes novos vêm do fechamento mensal (SQL 43), a
-- verba vem de `investimentos_midia` e a margem vem do mix de produtos.
--
-- ---------------------------------------------------------------------
-- POR QUE UMA TABELA E NÃO MAIS DUAS COLUNAS NO FECHAMENTO
-- ---------------------------------------------------------------------
-- O fechamento é mensal. Estes dois são anuais e quase estáticos —
-- "meu cliente compra umas três vezes por ano" não muda de janeiro para
-- fevereiro. Colocá-los lá obrigaria a redigitar doze vezes por ano uma
-- resposta que é sempre a mesma, e a tela do fechamento já é longa.
--
-- Mesmo desenho de `prolabore_config`: uma linha por empresa, sem
-- competência.
-- =====================================================================

create table if not exists public.comercial_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  compras_por_ano     numeric(6,2) check (compras_por_ano >= 0),
  anos_relacionamento numeric(6,2) check (anos_relacionamento >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.comercial_config is
  'Estimativas de recompra da aula 4.7. Anuais e quase estaticas, por isso '
  'fora do fechamento mensal.';

comment on column public.comercial_config.compras_por_ano is
  'Quantas vezes o MESMO cliente compra por ano. E estimativa e serve assim '
  'mesmo: a ordem de grandeza decide. Nao entra no teto de verba, que usa o '
  'criterio conservador de pagar o CAC no primeiro pedido.';

drop trigger if exists set_updated_at on public.comercial_config;
create trigger set_updated_at before update on public.comercial_config
  for each row execute function public.tg_set_updated_at();

alter table public.comercial_config enable row level security;

drop policy if exists comercial_config_select on public.comercial_config;
create policy comercial_config_select on public.comercial_config
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists comercial_config_write on public.comercial_config;
create policy comercial_config_write on public.comercial_config
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
-- A VERBA DE MÍDIA DO ÚLTIMO MÊS COM LANÇAMENTO
-- ---------------------------------------------------------------------
-- `investimentos_midia` guarda uma linha por canal. A tela precisa do
-- total, e do mês a que ele se refere — o mesmo cuidado do estoque: uma
-- verba de três meses atrás apresentada sem data vira verba de hoje na
-- cabeça de quem lê.

drop view if exists public.vw_verba_midia_ultima;

create view public.vw_verba_midia_ultima
with (security_invoker = on) as
select distinct on (tenant_id)
  tenant_id,
  competencia,
  sum(valor) over (partition by tenant_id, competencia) as verba_total
from public.investimentos_midia
order by tenant_id, competencia desc;

comment on view public.vw_verba_midia_ultima is
  'Verba de midia somada de todos os canais, do mes mais recente lancado, '
  'com a competencia junto.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- select * from public.vw_verba_midia_ultima;
--
-- Uma linha por empresa que tenha verba lançada, com a competência mais
-- recente. Pode vir vazia — quem não usa mídia paga não aparece, e a
-- tela trata isso como CAC indisponível, não como zero.
