-- =====================================================================
-- 37 — Margem de contribuição e ponto de equilíbrio
-- =====================================================================
-- Duas tabelas pequenas. Elas guardam o que o usuário REVISOU, não o que
-- o sistema mediu: faturamento, despesa fixa e percentuais continuam
-- vindo dos lançamentos. Guardar cópia do que já está em `transactions`
-- criaria duas fontes de verdade, e duas fontes divergem.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Os produtos do mix
-- ---------------------------------------------------------------------
create table if not exists public.mix_produtos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,

  nome              text not null check (length(btrim(nome)) between 1 and 120),

  preco             numeric(14,2) not null check (preco > 0),
  custo_direto      numeric(14,2) not null default 0 check (custo_direto >= 0),

  -- Impostos, comissão, frete, taxa de cartão. Tudo o que varia com a
  -- venda, somado. Separar em colunas daria um cadastro mais bonito e um
  -- formulário mais longo, e o número que entra na conta é a soma.
  variaveis_pct     numeric(6,2) not null default 0
                      check (variaveis_pct >= 0 and variaveis_pct < 100),

  -- O peso no faturamento. Não há `check` de soma 100 aqui de propósito:
  -- a soma só fecha quando o último produto é salvo, e um check impediria
  -- o penúltimo de existir. A normalização e o aviso ficam no cálculo.
  participacao_pct  numeric(6,2) not null default 0
                      check (participacao_pct >= 0 and participacao_pct <= 100),

  ordem             int not null default 0,
  is_active         boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (tenant_id, nome)
);

create index if not exists mix_produtos_tenant_idx
  on public.mix_produtos (tenant_id, ordem) where is_active;

drop trigger if exists set_updated_at on public.mix_produtos;
create trigger set_updated_at before update on public.mix_produtos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 2. A revisão dos custos fixos
-- ---------------------------------------------------------------------
-- O usuário vê as categorias de despesa fixa com a média real dos meses
-- fechados. Esta tabela guarda só o que ele MUDOU: o que excluiu, o valor
-- que sobrescreveu, e os itens que ainda não estão lançados (pró-labore
-- que ele não registra, por exemplo).
--
-- Linha ausente significa "aceito a medição". É o que mantém a tela
-- correta sozinha quando os lançamentos mudam no mês seguinte.
create table if not exists public.mix_custos_fixos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  -- Preenchido quando o item veio de uma categoria de despesa fixa.
  category_id   uuid references public.categories(id) on delete cascade,

  -- Preenchido quando é item avulso, sem lançamento correspondente.
  descricao     text check (descricao is null or length(btrim(descricao)) between 1 and 120),

  -- Nulo com `category_id` preenchido = usar a média medida.
  valor_mensal  numeric(14,2) check (valor_mensal is null or valor_mensal >= 0),

  incluir       boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Ou é categoria, ou é avulso. Nunca os dois, nunca nenhum.
  constraint mix_cf_origem_ck check (
    (category_id is not null and descricao is null)
    or
    (category_id is null and descricao is not null and valor_mensal is not null)
  )
);

create unique index if not exists mix_custos_fixos_categoria_uidx
  on public.mix_custos_fixos (tenant_id, category_id) where category_id is not null;

create index if not exists mix_custos_fixos_tenant_idx
  on public.mix_custos_fixos (tenant_id);

drop trigger if exists set_updated_at on public.mix_custos_fixos;
create trigger set_updated_at before update on public.mix_custos_fixos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RLS — mesma regra do resto do módulo financeiro
-- ---------------------------------------------------------------------
alter table public.mix_produtos     enable row level security;
alter table public.mix_custos_fixos enable row level security;

-- Ler: qualquer membro, inclusive `viewer`. Escrever: só quem pode
-- escrever no tenant — mesma separação do resto do módulo financeiro.
drop policy if exists mix_produtos_select on public.mix_produtos;
create policy mix_produtos_select on public.mix_produtos
  for select using (public.is_tenant_member(tenant_id));

drop policy if exists mix_produtos_write on public.mix_produtos;
create policy mix_produtos_write on public.mix_produtos
  for all
  using (public.can_write_tenant(tenant_id))
  with check (public.can_write_tenant(tenant_id));

drop policy if exists mix_custos_fixos_select on public.mix_custos_fixos;
create policy mix_custos_fixos_select on public.mix_custos_fixos
  for select using (public.is_tenant_member(tenant_id));

drop policy if exists mix_custos_fixos_write on public.mix_custos_fixos;
create policy mix_custos_fixos_write on public.mix_custos_fixos
  for all
  using (public.can_write_tenant(tenant_id))
  with check (public.can_write_tenant(tenant_id));

-- ---------------------------------------------------------------------
-- 4. A base medida: despesa fixa por categoria
-- ---------------------------------------------------------------------
-- Média dos últimos 3 meses FECHADOS. O mês corrente fica de fora porque
-- tem despesa fixa cheia e faturamento parcial — incluí-lo inflaria o
-- rateio e derrubaria o ponto de equilíbrio para baixo, que é o erro
-- perigoso nesta conta.
create or replace function public.fn_custos_fixos_medidos(p_tenant uuid)
returns table (
  category_id   uuid,
  categoria     text,
  media_mensal  numeric,
  meses         int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with fechados as (
    select distinct date_trunc('month', t.competence_date)::date as mes
    from public.transactions t
    join public.categories c on c.id = t.category_id
    where t.tenant_id = p_tenant
      and c.dre_group = 'despesa_fixa'
      and t.competence_date < date_trunc('month', current_date)
    order by 1 desc
    limit 3
  )
  select
    c.id,
    c.name,
    round(sum(t.amount) / greatest(count(distinct date_trunc('month', t.competence_date)), 1), 2),
    count(distinct date_trunc('month', t.competence_date))::int
  from public.transactions t
  join public.categories c on c.id = t.category_id
  where t.tenant_id = p_tenant
    and c.dre_group = 'despesa_fixa'
    and date_trunc('month', t.competence_date)::date in (select mes from fechados)
  group by c.id, c.name
  order by 3 desc;
$$;

comment on function public.fn_custos_fixos_medidos(uuid) is
  'Despesa fixa por categoria, média dos até 3 últimos meses fechados. Base da tela de ponto de equilíbrio.';

notify pgrst, 'reload schema';
