-- =====================================================================
-- 44 · PRÓ-LABORE: O PAPEL DA CATEGORIA E O PISO DA VIDA
-- =====================================================================
-- Duas coisas, pela mesma razão: a calculadora da aula 1.4 precisa
-- separar o que hoje está misturado e guardar o que hoje não tem casa.
--
-- ---------------------------------------------------------------------
-- 1. A ARMADILHA DO NOME
-- ---------------------------------------------------------------------
-- `vw_agregados_mensais.pro_labore_socios` NÃO é o pró-labore: é a soma
-- do grupo `retirada_socios` (distribuição de lucros, despesas pessoais
-- do sócio, empréstimo ao sócio), que fica ABAIXO da linha do resultado.
--
-- O pró-labore de verdade é uma CATEGORIA dentro de `despesa_fixa` — ele
-- é subtraído do resultado, como manda a aula 2.8. São números
-- diferentes, em lugares diferentes da DRE, e a calculadora precisa dos
-- dois separados:
--
--   • "quanto você retira hoje"  = pró-labore + retiradas
--   • "resultado antes da sua retirada" = resultado líquido + pró-labore
--
-- Somar a retirada de volta ao resultado seria errado: ela já está
-- abaixo da linha, nunca foi subtraída.
--
-- Identificar a categoria pelo NOME seria frágil — o cliente renomeia, e
-- a conta silenciosamente passa a dar outro número. Por isso um papel
-- declarado na categoria.
--
-- `folha` já entra agora, ainda sem uso: a Calculadora de Provisão
-- (aula 4.5) pede a folha mensal, e `dre_group` só sabe dizer
-- "despesa_fixa". Marcar as duas de uma vez evita uma segunda migração
-- na mesma tabela daqui a uma semana.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'categoria_papel') then
    create type public.categoria_papel as enum ('pro_labore', 'folha');
  end if;
end $$;

alter table public.categories
  add column if not exists papel public.categoria_papel;

comment on column public.categories.papel is
  'Marca categorias que uma calculadora precisa isolar e que dre_group nao '
  'distingue. Nulo e o normal. pro_labore: a retirada do dono que passa pelo '
  'resultado. folha: salario, encargo e beneficio, para a provisao de 13o e ferias.';

create index if not exists categories_papel_idx
  on public.categories (tenant_id, papel) where papel is not null;


-- ---------------------------------------------------------------------
-- 2. MARCAÇÃO INICIAL, PELOS NOMES QUE O SISTEMA SEMEIA
-- ---------------------------------------------------------------------
-- Melhor esforço sobre os nomes padrão de `fn_seed_default_categories` e
-- do plano de contas da aula 1.6. Quem renomeou fica sem marca — e é
-- melhor assim: a tela avisa que não encontrou, em vez de marcar a
-- categoria errada e produzir um número convincente e falso.

update public.categories
   set papel = 'pro_labore'
 where papel is null
   and dre_group = 'despesa_fixa'
   and lower(translate(name, 'óÓ-', 'oo ')) in ('pro labore', 'prolabore');

update public.categories
   set papel = 'folha'
 where papel is null
   and dre_group = 'despesa_fixa'
   and (
     lower(name) like 'sal%rios%'
     or lower(name) like '%encargos%'
     or lower(name) like 'pessoal%'
     or lower(name) like '%benef%cios%'
   );


-- ---------------------------------------------------------------------
-- 3. A SÉRIE MENSAL QUE A CALCULADORA LÊ
-- ---------------------------------------------------------------------
-- Um mês por linha, com o resultado ANTES da retirada do dono — que é o
-- que o método 3 da aula pede, e não existe em nenhuma view de hoje.

drop view if exists public.vw_prolabore_mensal;

create view public.vw_prolabore_mensal
with (security_invoker = on) as
with por_papel as (
  select
    t.tenant_id,
    date_trunc('month', t.competence_date::timestamp)::date as competencia,
    coalesce(sum(t.amount) filter (where c.papel = 'pro_labore'), 0) as pro_labore,
    coalesce(sum(t.amount) filter (where c.papel = 'folha'), 0)      as folha
  from public.transactions t
  join public.categories c on c.id = t.category_id
  where t.status <> 'cancelado'
    and c.papel is not null
  group by t.tenant_id, date_trunc('month', t.competence_date::timestamp)
)
select
  d.tenant_id,
  d.competencia,
  d.receita_bruta,
  d.resultado_liquido,
  d.retiradas_socios,
  coalesce(p.pro_labore, 0) as pro_labore,
  coalesce(p.folha, 0)      as folha,

  -- O numerador do método 3. O pró-labore volta porque foi subtraído
  -- dentro das despesas fixas; a retirada NÃO volta, porque nunca foi.
  d.resultado_liquido + coalesce(p.pro_labore, 0) as resultado_antes_retirada,

  -- Tudo que sai para o dono. A aula é explícita: "somando tudo,
  -- inclusive o que sai pelo cartão da empresa" — que é exatamente a
  -- categoria Despesas Pessoais do Sócio.
  coalesce(p.pro_labore, 0) + d.retiradas_socios as retirada_total
from public.vw_dre_monthly d
left join por_papel p
  on p.tenant_id = d.tenant_id and p.competencia = d.competencia;

comment on view public.vw_prolabore_mensal is
  'Serie mensal para a calculadora de pro-labore (aula 1.4). Separa o '
  'pro-labore, que passa pelo resultado, da retirada, que fica abaixo dele.';


-- ---------------------------------------------------------------------
-- 4. O PISO DA VIDA
-- ---------------------------------------------------------------------
-- Os cinco custos da família do dono e os dois parâmetros do cálculo.
--
-- Fica FORA de `fechamentos_mensais` de propósito. O fechamento é
-- mensal e sobre a empresa; isto é anual e sobre uma pessoa. Misturar
-- obrigaria a redigitar o aluguel da casa doze vezes por ano, e a tela
-- do fechamento já é longa.
--
-- Uma linha por empresa, não por sócio. A aula trata de UM dono que
-- retira — sociedade com dois pró-labores diferentes é outro problema,
-- e resolver por antecipação aqui só adicionaria uma chave que ninguém
-- usaria.
--
-- ATENÇÃO AO QUE ISTO GUARDA: custo de moradia, alimentação, saúde e
-- educação da família são dados pessoais, não financeiros da empresa. A
-- RLS abaixo segue o padrão das outras tabelas, o que inclui o
-- consultor da carteira. É deliberado — é ele quem conduz a conversa da
-- aula 1.4 — mas o cliente precisa saber disso, e a tela diz.

create table if not exists public.prolabore_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Método 1
  salario_mercado numeric(14,2) check (salario_mercado >= 0),

  -- Método 2 — o piso da vida
  moradia            numeric(14,2) check (moradia >= 0),
  alimentacao        numeric(14,2) check (alimentacao >= 0),
  transporte         numeric(14,2) check (transporte >= 0),
  saude_educacao     numeric(14,2) check (saude_educacao >= 0),
  outros_essenciais  numeric(14,2) check (outros_essenciais >= 0),

  -- Método 3
  percentual_resultado numeric(5,2) not null default 60
    check (percentual_resultado > 0 and percentual_resultado <= 100),

  -- Sobrepõe o medido quando o cliente sabe que os lançamentos não
  -- contam tudo que sai para ele.
  retirada_informada numeric(14,2) check (retirada_informada >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prolabore_config is
  'Piso da vida do dono e parametros da aula 1.4. Anual, nao mensal: '
  'aluguel de casa nao muda todo mes. Contem dado pessoal da familia.';

comment on column public.prolabore_config.percentual_resultado is
  'Quanto do resultado pode ir para o pro-labore. Padrao 60% da aula. '
  'Veiculo, estoque e venda a prazo puxam este numero para baixo.';

comment on column public.prolabore_config.retirada_informada is
  'Sobrepoe o calculado por vw_prolabore_mensal. Existe porque quem paga '
  'a conta do mercado pelo cartao da empresa sabe disso, e o lancamento '
  'pode nao revelar.';

drop trigger if exists set_updated_at on public.prolabore_config;
create trigger set_updated_at before update on public.prolabore_config
  for each row execute function public.tg_set_updated_at();

alter table public.prolabore_config enable row level security;

drop policy if exists prolabore_config_select on public.prolabore_config;
create policy prolabore_config_select on public.prolabore_config
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists prolabore_config_write on public.prolabore_config;
create policy prolabore_config_write on public.prolabore_config
  for all using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- 1. Quantas categorias ganharam papel, por empresa:
--
-- select tenant_id, papel, count(*), string_agg(name, ', ')
--   from public.categories
--  where papel is not null
--  group by tenant_id, papel
--  order by tenant_id, papel;
--
-- Cada empresa deveria ter UMA de `pro_labore`. Zero significa que o
-- cliente renomeou a categoria — marque à mão:
--
--   update public.categories set papel = 'pro_labore' where id = '...';
--
-- Mais de uma não é erro: quem tem dois sócios pode ter duas linhas.
--
-- 2. A série do método 3, para um tenant:
--
-- select competencia, receita_bruta, resultado_liquido,
--        pro_labore, retiradas_socios,
--        resultado_antes_retirada, retirada_total
--   from public.vw_prolabore_mensal
--  where tenant_id = 'SEU-TENANT'
--  order by competencia desc limit 6;
--
-- Confira uma linha à mão:
--   resultado_antes_retirada = resultado_liquido + pro_labore
--   retirada_total           = pro_labore + retiradas_socios
