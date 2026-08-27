-- =====================================================================
-- 26 — ADD-ONS COM VIGÊNCIA
-- =====================================================================
-- O CRM sai da composição dos planos e vira contrato à parte, de doze
-- meses, que pode ser somado a qualquer plano.
--
-- ---------------------------------------------------------------------
-- POR QUE O ARRAY NÃO SERVE MAIS
-- ---------------------------------------------------------------------
-- `tenants.recursos_extras` era um `text[]`: uma lista de códigos, sem
-- mais nada. Serviu enquanto liberação era cortesia informal.
--
-- Vender com prazo exige três coisas que um array não guarda: quando
-- começou, quando termina, e a que título — contrato, cortesia ou
-- piloto. Sem a data de fim não há corte automático, e serviço vendido
-- por doze meses que continua ligado no décimo terceiro é receita que
-- ninguém cobra.
--
-- ---------------------------------------------------------------------
-- CORTAR É AUTOMÁTICO, AVISAR É ANTES
-- ---------------------------------------------------------------------
-- No dia seguinte ao vencimento o recurso deixa de ser concedido — a
-- função de acesso passa a responder não, sem ninguém precisar lembrar.
--
-- O aviso sai com trinta dias de antecedência, e essa ordem é o desenho:
-- a conversa de renovação precisa acontecer ANTES de o cliente perder a
-- tela. Descobrir o vencimento pelo cliente reclamando é a pior forma
-- possível de abrir uma negociação.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A TABELA
-- ---------------------------------------------------------------------

create table if not exists public.tenant_recursos (
  tenant_id  uuid not null references public.tenants(id)  on delete cascade,
  recurso    text not null references public.recursos(codigo) on delete cascade,

  inicio     date not null default current_date,
  -- Nulo = sem prazo. Continua existindo porque nem toda liberação é
  -- venda: cortesia por tempo indeterminado é decisão legítima, e
  -- forçar uma data faria alguém inventar uma.
  fim        date,

  tipo       text not null default 'contratado'
             check (tipo in ('contratado', 'cortesia', 'piloto')),

  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (tenant_id, recurso),
  constraint tr_periodo_coerente check (fim is null or fim >= inicio)
);

drop trigger if exists set_updated_at on public.tenant_recursos;
create trigger set_updated_at before update on public.tenant_recursos
  for each row execute function public.tg_set_updated_at();

comment on table public.tenant_recursos is
  'Recursos contratados fora do plano, com vigência. `fim` nulo = sem prazo. '
  'O acesso cai sozinho no dia seguinte ao vencimento.';

comment on column public.tenant_recursos.tipo is
  'contratado = venda. cortesia = liberado sem cobrar. piloto = teste com '
  'cliente escolhido. Separar os três mantém honesta a leitura de receita.';

create index if not exists tenant_recursos_vencimento_idx
  on public.tenant_recursos (fim) where fim is not null;

alter table public.tenant_recursos enable row level security;

-- O cliente lê o que tem; só a plataforma concede. Deixar o cliente
-- escrever aqui seria deixá-lo assinar o próprio contrato.
drop policy if exists tr_select on public.tenant_recursos;
create policy tr_select on public.tenant_recursos
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists tr_write on public.tenant_recursos;
create policy tr_write on public.tenant_recursos
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- 2. MIGRAÇÃO DO ARRAY
-- ---------------------------------------------------------------------
-- O que já estava liberado vira cortesia sem prazo. É a leitura
-- conservadora: aquelas liberações foram feitas sem combinar data, e
-- inventar um vencimento retroativo cortaria acesso que ninguém
-- prometeu cortar.

insert into public.tenant_recursos (tenant_id, recurso, inicio, fim, tipo, observacao)
select t.id, r, current_date, null, 'cortesia', 'Migrado de recursos_extras'
  from public.tenants t
  cross join lateral unnest(t.recursos_extras) as r
 where t.recursos_extras is not null and array_length(t.recursos_extras, 1) > 0
on conflict (tenant_id, recurso) do nothing;

-- ---------------------------------------------------------------------
-- 3. O CRM SAI DOS PLANOS
-- ---------------------------------------------------------------------
-- Passa a ser vendido à parte. Consequência a registrar: sem o CRM, o
-- Premium fica com a mesma composição do Intermediário — ou seja, sem
-- diferencial próprio. Ele fica fora de oferta até ganhar conteúdo ou
-- ser removido.

delete from public.plano_recursos where recurso = 'crm';

update public.planos
   set ofertavel = false,
       descricao = 'Reservado. Sem diferencial próprio desde que o CRM '
                || 'passou a ser contratado à parte.'
 where codigo = 'premium';

update public.recursos
   set nome = 'CRM (contrato anual)',
       descricao = 'Funil rastreável integrado ao financeiro. Contratado à '
                || 'parte, por doze meses, sobre qualquer plano.'
 where codigo = 'crm';

-- ---------------------------------------------------------------------
-- 4. A PERGUNTA DE ACESSO, AGORA COM PRAZO
-- ---------------------------------------------------------------------
-- Mesma assinatura de antes: quem chama não muda. O que muda é que a
-- resposta passa a expirar.

create or replace function public.fn_tenant_tem_recurso(
  p_tenant_id uuid,
  p_recurso   text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce((
    select exists (
             select 1 from public.plano_recursos pr
              where pr.plano = t.plano and pr.recurso = p_recurso
           )
        or exists (
             select 1 from public.tenant_recursos tr
              where tr.tenant_id = t.id
                and tr.recurso = p_recurso
                and tr.inicio <= current_date
                and (tr.fim is null or tr.fim >= current_date)
           )
      from public.tenants t
     where t.id = p_tenant_id and t.is_active
  ), false)
$fn$;

comment on function public.fn_tenant_tem_recurso(uuid, text) is
  'A empresa tem acesso a este recurso hoje? Soma o plano com os add-ons '
  'dentro da vigência. Empresa arquivada não tem recurso nenhum.';

revoke all on function public.fn_tenant_tem_recurso(uuid, text) from public;
grant execute on function public.fn_tenant_tem_recurso(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. O QUE A EMPRESA TEM
-- ---------------------------------------------------------------------
-- `dias_para_vencer` viaja junto para a tela do cliente poder avisar sem
-- fazer conta — e para o aviso aparecer antes de o recurso sumir.

-- DROP obrigatório: a última coluna deixa de ser `recursos_extras` e
-- passa a ser `contratos`. `create or replace` não renomeia coluna de
-- view — recusa com 42P16 e desfaz o arquivo inteiro.
drop view if exists public.vw_meus_recursos;

create view public.vw_meus_recursos
with (security_invoker = on) as
select
  t.id     as tenant_id,
  t.plano,
  pl.nome  as plano_nome,
  pl.ordem as plano_ordem,
  t.plano_desde,
  array(
    select r.codigo
      from public.recursos r
     where exists (select 1 from public.plano_recursos pr
                    where pr.plano = t.plano and pr.recurso = r.codigo)
        or exists (select 1 from public.tenant_recursos tr
                    where tr.tenant_id = t.id and tr.recurso = r.codigo
                      and tr.inicio <= current_date
                      and (tr.fim is null or tr.fim >= current_date))
     order by r.ordem
  ) as recursos,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'recurso', tr.recurso,
             'nome',    r.nome,
             'tipo',    tr.tipo,
             'inicio',  tr.inicio,
             'fim',     tr.fim,
             'dias_para_vencer',
               case when tr.fim is null then null else tr.fim - current_date end,
             'vigente', tr.inicio <= current_date
                        and (tr.fim is null or tr.fim >= current_date)
           ) order by r.ordem)
      from public.tenant_recursos tr
      join public.recursos r on r.codigo = tr.recurso
     where tr.tenant_id = t.id
  ), '[]'::jsonb) as contratos
from public.tenants t
join public.planos pl on pl.codigo = t.plano
where t.is_active;

comment on view public.vw_meus_recursos is
  'Plano, lista efetiva de recursos e os contratos à parte com sua vigência.';

grant select on public.vw_meus_recursos to authenticated;

-- ---------------------------------------------------------------------
-- 6. O QUE VENCE
-- ---------------------------------------------------------------------
-- A leitura do franqueador. Trinta dias é a antecedência do aviso: menos
-- que isso não dá tempo de conversar, e mais que isso vira ruído que a
-- pessoa aprende a ignorar.

create or replace view public.vw_contratos_vencendo
with (security_invoker = on) as
select
  tr.tenant_id,
  t.name        as empresa,
  t.consultoria_id,
  tr.recurso,
  r.nome        as recurso_nome,
  tr.tipo,
  tr.inicio,
  tr.fim,
  tr.fim - current_date as dias_para_vencer,
  tr.fim < current_date as vencido,
  tr.observacao
from public.tenant_recursos tr
join public.tenants  t on t.id = tr.tenant_id
join public.recursos r on r.codigo = tr.recurso
where tr.fim is not null
  and t.is_active
  and tr.fim <= current_date + 30;

comment on view public.vw_contratos_vencendo is
  'Add-ons vencidos ou a vencer em 30 dias. A conversa de renovação precisa '
  'acontecer antes de o cliente perder a tela.';

grant select on public.vw_contratos_vencendo to authenticated;

-- ---------------------------------------------------------------------
-- 7. A CARTEIRA SEM O ARRAY
-- ---------------------------------------------------------------------
-- DROP obrigatório: a coluna `recursos_extras` sai e uma nova entra no
-- lugar, e `create or replace` não permite trocar coluna.

drop view if exists public.vw_staff_tenants;

create view public.vw_staff_tenants
with (security_invoker = on) as
select
  t.id,
  t.name,
  t.tax_id,
  t.is_active,
  t.created_at,
  t.consultoria_id,
  k.nome                                                 as consultoria,
  (select count(*) from public.memberships m
    where m.tenant_id = t.id and m.is_active)            as qtd_usuarios,
  (select count(*) from public.transactions x
    where x.tenant_id = t.id)                            as qtd_lancamentos,
  (select max(x.created_at) from public.transactions x
    where x.tenant_id = t.id)                            as ultimo_lancamento,
  mz.score_total                                         as marco_zero_score,
  mz.assinado_em                                         as marco_zero_em,
  coalesce(
    (select dm.score_total from public.diagnosticos_mensais dm
      where dm.tenant_id = t.id and dm.status = 'calculado'
      order by dm.competencia desc limit 1),
    (select d.score_total from public.diagnosticos d
      where d.tenant_id = t.id and d.score_total is not null
      order by d.created_at desc limit 1)
  )                                                      as score_atual,
  t.plano,
  pl.nome                                                as plano_nome,
  pl.ordem                                               as plano_ordem,
  t.plano_desde,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'recurso', tr.recurso,
             'tipo',    tr.tipo,
             'inicio',  tr.inicio,
             'fim',     tr.fim,
             'dias_para_vencer',
               case when tr.fim is null then null else tr.fim - current_date end
           ) order by tr.recurso)
      from public.tenant_recursos tr
     where tr.tenant_id = t.id
  ), '[]'::jsonb)                                        as contratos
from public.tenants t
left join public.marcos_zero mz on mz.tenant_id = t.id
left join public.consultorias k on k.id = t.consultoria_id
left join public.planos pl on pl.codigo = t.plano;

grant select on public.vw_staff_tenants to authenticated;

-- O array sai por último, depois de tudo que dependia dele.
alter table public.tenants drop column if exists recursos_extras;

-- ---------------------------------------------------------------------
-- 8. CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select p.nome, array_agg(r.codigo order by r.ordem)
--     from public.planos p
--     join public.plano_recursos pr on pr.plano = p.codigo
--     join public.recursos r on r.codigo = pr.recurso
--    group by p.nome, p.ordem order by p.ordem;
--
-- Nenhum plano deve mais listar `crm`.
--
-- Para vender o CRM a um cliente, por doze meses:
--
--   insert into public.tenant_recursos (tenant_id, recurso, inicio, fim, tipo, observacao)
--   values ('<tenant>', 'crm', current_date, current_date + interval '12 months',
--           'contratado', 'Contrato anual — piloto do CRM');
--
-- Para o piloto sem cobrar, com prazo:
--
--   ... tipo = 'piloto', fim = current_date + interval '3 months'
--
-- Depois:  notify pgrst, 'reload schema';
