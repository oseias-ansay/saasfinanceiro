-- =====================================================================
-- 50 · FLUXO DE CAIXA PROJETADO — 12 SEMANAS
-- =====================================================================
-- Uma tabela de ajustes e duas views. A projeção em si não é guardada:
-- ela é recalculada a cada abertura, porque títulos são lançados e
-- baixados todo dia e uma projeção congelada envelheceria em horas.
--
-- O que PRECISA ser guardado é só o que o usuário sabe e o sistema não:
-- "nesta semana entra o 13º", "aqui vem a parcela do IPVA". É isso que
-- `fluxo_ajustes` guarda.
--
-- ---------------------------------------------------------------------
-- A CHAVE É A DATA DE INÍCIO DA SEMANA, NÃO O NÚMERO DELA
-- ---------------------------------------------------------------------
-- "Semana 3" hoje é "semana 2" na semana que vem e some daqui a três.
-- Guardar pelo número faria o ajuste do 13º deslizar para cima das
-- semanas erradas sozinho, toda segunda-feira — um bug que ninguém
-- notaria até dezembro.
--
-- Guardando pela data de início, o ajuste fica colado na semana real e
-- simplesmente sai da janela quando ela passa.
-- =====================================================================

create table if not exists public.fluxo_ajustes (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  semana_inicio date not null,

  entradas numeric(14,2) check (entradas >= 0),
  saidas   numeric(14,2) check (saidas >= 0),

  -- "O que foge do padrão nesta semana", na linguagem da planilha.
  observacao text check (length(observacao) <= 300),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (tenant_id, semana_inicio),
  -- Segunda-feira. ISO: 1 = segunda. Sem isso, dois ajustes da mesma
  -- semana poderiam existir com datas diferentes e um deles sumiria.
  constraint fluxo_ajuste_segunda check (extract(isodow from semana_inicio) = 1)
);

comment on table public.fluxo_ajustes is
  'O que o usuario sabe da semana e o sistema nao: 13o, IPVA, uma compra '
  'grande combinada. Chaveado pela data de inicio da semana, nunca pelo '
  'numero dela -- numero de semana desliza toda segunda.';

comment on column public.fluxo_ajustes.entradas is
  'Sobrepoe titulo e media. Nulo e diferente de zero: nulo significa "use o '
  'que voce calculou", zero significa "nao entra nada nesta semana".';

drop trigger if exists set_updated_at on public.fluxo_ajustes;
create trigger set_updated_at before update on public.fluxo_ajustes
  for each row execute function public.tg_set_updated_at();

alter table public.fluxo_ajustes enable row level security;

drop policy if exists fluxo_ajustes_select on public.fluxo_ajustes;
create policy fluxo_ajustes_select on public.fluxo_ajustes
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists fluxo_ajustes_write on public.fluxo_ajustes;
create policy fluxo_ajustes_write on public.fluxo_ajustes
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
-- OS TÍTULOS A VENCER, AGRUPADOS POR SEMANA
-- ---------------------------------------------------------------------
-- Só `pendente`: o que já foi liquidado saiu do futuro e entrou no
-- saldo de hoje. Contá-lo de novo somaria o mesmo dinheiro duas vezes.
--
-- O vencido entra na PRIMEIRA semana, não na semana em que venceu.
-- Deixá-lo no passado o tiraria da projeção — e ele é dinheiro que
-- ainda vai entrar ou sair, só que atrasado. Jogá-lo para "agora" é
-- otimista quanto ao recebimento e realista quanto ao pagamento; a tela
-- separa o vencido para o usuário decidir.

drop view if exists public.vw_fluxo_semanal;

create view public.vw_fluxo_semanal
with (security_invoker = on) as
select
  t.tenant_id,
  -- Segunda-feira da semana do vencimento; vencido cai na semana atual.
  greatest(
    date_trunc('week', t.due_date::timestamp)::date,
    date_trunc('week', current_date::timestamp)::date
  ) as semana_inicio,
  coalesce(sum(t.amount) filter (where t.type = 'receita'), 0) as entradas,
  coalesce(sum(t.amount) filter (where t.type = 'despesa'), 0) as saidas,
  coalesce(sum(t.amount) filter (
    where t.type = 'receita' and t.due_date < current_date), 0) as entradas_vencidas,
  coalesce(sum(t.amount) filter (
    where t.type = 'despesa' and t.due_date < current_date), 0) as saidas_vencidas
from public.transactions t
where t.status = 'pendente'
group by t.tenant_id, greatest(
  date_trunc('week', t.due_date::timestamp)::date,
  date_trunc('week', current_date::timestamp)::date
);

comment on view public.vw_fluxo_semanal is
  'Titulos pendentes por semana de vencimento. O vencido cai na semana atual '
  'em vez de ficar no passado: ele ainda vai entrar ou sair, so que atrasado.';


-- ---------------------------------------------------------------------
-- A MÉDIA SEMANAL DO QUE REALMENTE ENTROU E SAIU
-- ---------------------------------------------------------------------
-- Base das semanas estimadas. Sai dos LIQUIDADOS das últimas 13 semanas
-- completas — um trimestre, que é o menor período em que um padrão
-- semanal aparece sem virar ruído.
--
-- A semana corrente fica de fora: ela está pela metade, e incluí-la
-- puxaria a média para baixo toda vez que alguém abrisse a tela numa
-- terça-feira.

drop view if exists public.vw_fluxo_media_semanal;

create view public.vw_fluxo_media_semanal
with (security_invoker = on) as
with por_semana as (
  select
    t.tenant_id,
    date_trunc('week', t.paid_date::timestamp)::date as semana,
    coalesce(sum(t.paid_amount) filter (where t.type = 'receita'), 0) as entradas,
    coalesce(sum(t.paid_amount) filter (where t.type = 'despesa'), 0) as saidas
  from public.transactions t
  where t.status = 'liquidado'
    and t.paid_date is not null
    and t.paid_date >= current_date - interval '13 weeks'
    and t.paid_date < date_trunc('week', current_date::timestamp)::date
  group by t.tenant_id, date_trunc('week', t.paid_date::timestamp)
)
select
  tenant_id,
  round(avg(entradas), 2) as entrada_media,
  round(avg(saidas), 2)   as saida_media,
  count(*)::int           as semanas
from por_semana
group by tenant_id;

comment on view public.vw_fluxo_media_semanal is
  'Media semanal de entradas e saidas liquidadas nas ultimas 13 semanas '
  'completas. A semana corrente fica de fora: esta pela metade.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- 1. As médias, e quantas semanas as sustentam:
--
-- select * from public.vw_fluxo_media_semanal where tenant_id = 'SEU-TENANT';
--
-- `semanas` abaixo de 4 significa histórico curto — a tela avisa.
--
-- 2. Os títulos das próximas semanas:
--
-- select semana_inicio, entradas, saidas, entradas_vencidas, saidas_vencidas
--   from public.vw_fluxo_semanal
--  where tenant_id = 'SEU-TENANT'
--  order by semana_inicio
--  limit 12;
--
-- A primeira linha costuma ser a maior: é ela que recebe todo o vencido.
--
-- 3. O total pendente tem de bater com a tela de contas:
--
-- select
--   (select sum(entradas) from public.vw_fluxo_semanal where tenant_id = 'SEU-TENANT')
--   -
--   (select total_aberto from public.vw_contas_resumo
--     where tenant_id = 'SEU-TENANT' and natureza = 'a_receber') as diferenca;
--
-- Tem de vir ZERO.
