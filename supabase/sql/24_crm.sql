-- =====================================================================
-- 24 — CRM (módulo 1.4.0, parte 1)
-- =====================================================================
-- CRM genérico é mercado saturado e produto enorme. Não é essa a
-- disputa. O que ninguém tem é o CRM **alimentando o diagnóstico**:
-- funil, contato, valor, etapa e origem, o suficiente para o score
-- comercial se calcular sozinho e a curva aparecer para o cliente.
--
-- Cada campo aqui existe porque a régua pergunta por ele. O que a régua
-- não pergunta ficou de fora — e vai continuar fora, porque a primeira
-- vez que este arquivo ganhar um campo "só por garantia" ele começa a
-- virar o CRM genérico que a gente não quer construir.
--
-- ---------------------------------------------------------------------
-- ETAPAS FIXAS: A MESMA DECISÃO DA RÉGUA
-- ---------------------------------------------------------------------
-- As cinco etapas são iguais em toda a rede. Cada empresa pode
-- renomeá-las na tela — "orçamento" em vez de "proposta" —, mas a etapa
-- por trás é a mesma.
--
-- Se cada cliente desenhasse o próprio funil, "taxa de conversão"
-- deixaria de significar a mesma coisa entre dois clientes, e o
-- benchmark morreria junto. É exatamente o argumento que sustenta a
-- régua financeira única, aplicado ao comercial.
--
-- ---------------------------------------------------------------------
-- TODO CONTATO ENTRA, NÃO SÓ O DE ANÚNCIO
-- ---------------------------------------------------------------------
-- Indicação, WhatsApp, feira, anúncio: tudo vira lead, com a origem
-- dizendo de onde veio. É o único jeito de o CAC ser honesto — sem o
-- denominador completo, anúncio sempre parece melhor do que é, porque
-- as vendas que vieram de graça ficam fora da conta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AS ETAPAS
-- ---------------------------------------------------------------------
-- `ordem` define o avanço. `terminal` marca as duas saídas do funil:
-- ganho e perda. Separar terminal de ordem permite perguntar "quantos
-- ainda estão no funil?" sem enumerar etapas.

do $$ begin
  create type public.etapa_lead as enum
    ('novo', 'contato', 'qualificado', 'proposta', 'ganho', 'perdido');
exception when duplicate_object then null; end $$;

create table if not exists public.etapas_funil (
  codigo    public.etapa_lead primary key,
  nome      text not null,
  ordem     int  not null,
  terminal  boolean not null default false,
  descricao text
);

insert into public.etapas_funil (codigo, nome, ordem, terminal, descricao) values
  ('novo',        'Novo',        10, false, 'Chegou e ainda não foi contatado.'),
  ('contato',     'Contato feito', 20, false, 'Alguém falou com ele.'),
  ('qualificado', 'Qualificado', 30, false, 'Tem o problema, o orçamento e a decisão.'),
  ('proposta',    'Proposta',    40, false, 'Recebeu preço e está decidindo.'),
  ('ganho',       'Ganho',       50, true,  'Fechou.'),
  ('perdido',     'Perdido',     60, true,  'Não fechou.')
on conflict (codigo) do update set
  nome = excluded.nome, ordem = excluded.ordem,
  terminal = excluded.terminal, descricao = excluded.descricao;

grant select on public.etapas_funil to authenticated;

-- Rótulos próprios da empresa. Ausente = usa o nome padrão.
create table if not exists public.rotulos_funil (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  etapa     public.etapa_lead not null references public.etapas_funil(codigo),
  rotulo    text not null check (length(btrim(rotulo)) between 2 and 40),
  primary key (tenant_id, etapa)
);

comment on table public.rotulos_funil is
  'Renomeia etapas na tela da empresa. A etapa por trás continua a mesma — '
  'é o que mantém a conversão comparável entre clientes da rede.';

alter table public.rotulos_funil enable row level security;

drop policy if exists rotulos_rw on public.rotulos_funil;
create policy rotulos_rw on public.rotulos_funil
  for all using (
    public.can_write_tenant(tenant_id) or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id) or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

-- ---------------------------------------------------------------------
-- 2. AS ORIGENS
-- ---------------------------------------------------------------------
-- Poucas e fixas, pelo mesmo motivo das etapas: comparar canais entre
-- clientes só funciona se "indicação" quiser dizer a mesma coisa em
-- todos. `detalhe` guarda o texto livre — o nome da feira, quem indicou.

do $$ begin
  create type public.origem_lead as enum
    ('anuncio', 'indicacao', 'organico', 'prospeccao', 'recorrente', 'outro');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. O LEAD
-- ---------------------------------------------------------------------

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  nome        text not null check (length(btrim(nome)) between 2 and 160),
  telefone    text,
  email       text,

  etapa       public.etapa_lead not null default 'novo'
                references public.etapas_funil(codigo),

  -- Quanto o negócio vale, na estimativa de quem cadastrou. É o que
  -- permite "R$ 82 mil em proposta" — a leitura que faz o dono olhar o
  -- funil. Nulo é aceito: obrigar a estimar no primeiro contato faria
  -- gente inventar número, e número inventado é pior que ausência.
  valor_estimado numeric(14,2) check (valor_estimado >= 0),

  origem      public.origem_lead not null default 'outro',
  origem_detalhe text,

  -- Rastreio de campanha. Guardados como texto e sem FK: são o que veio
  -- na URL, e precisam sobreviver ao fim da campanha que os gerou.
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,

  -- O elo com o financeiro. Preenchido ao ganhar: daí em diante o
  -- faturamento real daquele cliente sai dos lançamentos, e o ticket
  -- médio deixa de ser estimativa.
  entity_id   uuid references public.entities(id) on delete set null,

  responsavel_nome text,
  observacao  text,

  -- Datas do ciclo. `fechado_em` vale para ganho e para perda: as duas
  -- encerram o lead, e o tempo até a perda é informação tão útil quanto
  -- o tempo até a venda.
  fechado_em  timestamptz,
  motivo_perda text,

  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint lead_tem_contato check (telefone is not null or email is not null),
  constraint lead_fechado_coerente check (
    (etapa in ('ganho','perdido') and fechado_em is not null)
    or (etapa not in ('ganho','perdido') and fechado_em is null)
  )
);

create index if not exists leads_tenant_etapa_idx
  on public.leads (tenant_id, etapa, created_at desc);

create index if not exists leads_tenant_origem_idx
  on public.leads (tenant_id, origem, created_at);

create index if not exists leads_entity_idx
  on public.leads (entity_id) where entity_id is not null;

drop trigger if exists set_updated_at on public.leads;
create trigger set_updated_at before update on public.leads
  for each row execute function public.tg_set_updated_at();

comment on table public.leads is
  'Contatos comerciais da empresa. Todo contato entra, não só o de anúncio — '
  'sem o denominador completo o CAC mente a favor da mídia paga.';

comment on column public.leads.entity_id is
  'Cliente correspondente no financeiro, preenchido ao ganhar. É o que faz o '
  'ticket médio sair dos lançamentos em vez da estimativa.';

alter table public.leads enable row level security;

-- O acesso exige o recurso. Diferente das demais tabelas do sistema:
-- aqui não basta ser membro da empresa, o plano precisa incluir CRM.
-- Sem isso, um cliente que perdesse o Premium continuaria lendo os
-- leads por chamada direta ao PostgREST.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.is_tenant_member(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

drop policy if exists leads_write on public.leads;
create policy leads_write on public.leads
  for all using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.can_write_tenant(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  ) with check (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.can_write_tenant(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

-- ---------------------------------------------------------------------
-- 4. O HISTÓRICO DE MOVIMENTAÇÃO
-- ---------------------------------------------------------------------
-- Sem isto não existe "tempo médio em cada etapa" — e esse é o
-- indicador que mostra ONDE o funil trava. Saber que a conversão é 8%
-- não diz o que consertar; saber que o lead fica onze dias parado em
-- "proposta" diz.
--
-- Gravado por trigger, não pela aplicação: histórico que depende de
-- alguém lembrar de registrar é histórico com buraco.

create table if not exists public.lead_movimentos (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  de         public.etapa_lead,
  para       public.etapa_lead not null,
  em         timestamptz not null default now(),
  por        uuid references auth.users(id) on delete set null
);

create index if not exists lead_mov_lead_idx on public.lead_movimentos (lead_id, em);
create index if not exists lead_mov_tenant_idx on public.lead_movimentos (tenant_id, em);

alter table public.lead_movimentos enable row level security;

drop policy if exists lead_mov_select on public.lead_movimentos;
create policy lead_mov_select on public.lead_movimentos
  for select using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.is_tenant_member(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

-- Ninguém escreve à mão: quem escreve é o trigger, que roda como dono
-- da função. Histórico editável não é histórico.
drop policy if exists lead_mov_write on public.lead_movimentos;
create policy lead_mov_write on public.lead_movimentos
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

create or replace function public.tg_lead_movimento()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_movimentos (lead_id, tenant_id, de, para, por)
    values (new.id, new.tenant_id, null, new.etapa, auth.uid());
    return new;
  end if;

  if new.etapa is distinct from old.etapa then
    insert into public.lead_movimentos (lead_id, tenant_id, de, para, por)
    values (new.id, new.tenant_id, old.etapa, new.etapa, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists tg_lead_movimento on public.leads;
create trigger tg_lead_movimento
  after insert or update of etapa on public.leads
  for each row execute function public.tg_lead_movimento();

-- ---------------------------------------------------------------------
-- 5. FECHAR É AUTOMÁTICO
-- ---------------------------------------------------------------------
-- A restrição `lead_fechado_coerente` exige `fechado_em` nas etapas
-- terminais. Deixar isso a cargo da aplicação significaria que todo
-- caminho novo — importação, automação, correção manual — teria que
-- lembrar da regra. O trigger carimba e pronto.
--
-- Reabrir um lead limpa a data: o negócio voltou a estar em aberto, e
-- manter a data antiga faria o tempo de ciclo contar um fechamento que
-- foi desfeito.

create or replace function public.tg_lead_fechamento()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  if new.etapa in ('ganho', 'perdido') then
    new.fechado_em := coalesce(new.fechado_em, now());
  else
    new.fechado_em := null;
    new.motivo_perda := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_lead_fechamento on public.leads;
create trigger tg_lead_fechamento
  before insert or update on public.leads
  for each row execute function public.tg_lead_fechamento();

-- ---------------------------------------------------------------------
-- 6. O QUADRO
-- ---------------------------------------------------------------------
-- O que a tela do funil consome: o lead, o rótulo que a empresa deu à
-- etapa, e há quantos dias ele está parado ali.
--
-- "Dias parado" é o campo que faz a tela ser usada. Um funil que só
-- mostra nomes em colunas é uma lista bonita; um que destaca quem não
-- se move há duas semanas é uma ferramenta de trabalho.

create or replace view public.vw_funil_leads
with (security_invoker = on) as
select
  l.id,
  l.tenant_id,
  l.nome,
  l.telefone,
  l.email,
  l.etapa,
  coalesce(rf.rotulo, ef.nome) as etapa_rotulo,
  ef.ordem                     as etapa_ordem,
  ef.terminal                  as etapa_terminal,
  l.valor_estimado,
  l.origem,
  l.origem_detalhe,
  l.utm_source,
  l.utm_campaign,
  l.entity_id,
  l.responsavel_nome,
  l.observacao,
  l.motivo_perda,
  l.created_at,
  l.fechado_em,
  (select max(m.em) from public.lead_movimentos m where m.lead_id = l.id) as ultimo_movimento,
  extract(day from now() - coalesce(
    (select max(m.em) from public.lead_movimentos m where m.lead_id = l.id),
    l.created_at))::int as dias_na_etapa,
  extract(day from coalesce(l.fechado_em, now()) - l.created_at)::int as dias_no_funil
from public.leads l
join public.etapas_funil ef on ef.codigo = l.etapa
left join public.rotulos_funil rf
       on rf.tenant_id = l.tenant_id and rf.etapa = l.etapa;

comment on view public.vw_funil_leads is
  'O quadro do funil. `dias_na_etapa` é o campo que faz a tela ser usada: '
  'mostra quem parou, não só quem existe.';

grant select on public.vw_funil_leads to authenticated;

-- ---------------------------------------------------------------------
-- 7. CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select * from public.etapas_funil order by ordem;
--
-- Para testar com a empresa que recebeu o recurso do CRM:
--
--   insert into public.leads (tenant_id, nome, telefone, origem, valor_estimado)
--   values ('<tenant>', 'Cliente de teste', '41999999999', 'indicacao', 5000);
--
--   select nome, etapa, dias_na_etapa from public.vw_funil_leads;
--
-- Uma empresa SEM o recurso `crm` não consegue inserir nem ler — a
-- policy exige o recurso antes de qualquer outra condição.
--
-- Depois:  notify pgrst, 'reload schema';
