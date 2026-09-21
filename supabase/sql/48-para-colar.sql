-- =====================================================================
-- 48 · OS PARÂMETROS DA HORA PRODUTIVA
-- =====================================================================
-- A aula 3.4 pede seis números que descrevem como a equipe trabalha:
-- quantas pessoas, horas contratadas, férias, feriados, faltas e
-- ocupação produtiva. A folha vem das categorias marcadas com
-- `papel = 'folha'` no SQL 44 — essa já é medida.
--
-- Nenhum dos seis muda de um mês para o outro. A jornada é a mesma o ano
-- inteiro, o número de feriados é uma média, e a ocupação produtiva é
-- uma característica da operação, não do mês. Por isso ficam fora do
-- fechamento mensal, no mesmo desenho de `prolabore_config` e
-- `comercial_config`: uma linha por empresa.
--
-- ---------------------------------------------------------------------
-- OS PADRÕES SÃO OS DA AULA, E ELES IMPORTAM
-- ---------------------------------------------------------------------
-- 220 horas é a jornada de 44 horas semanais. 70% de ocupação é o que a
-- aula chama de "equipe bem organizada" — e é deliberadamente
-- conservador, porque o erro comum é chutar a ocupação para cima, o que
-- faz a hora parecer barata e o orçamento, competitivo no papel.
-- =====================================================================

create table if not exists public.hora_produtiva_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  pessoas           int          check (pessoas > 0),
  horas_contratadas numeric(6,1) not null default 220
                    check (horas_contratadas > 0 and horas_contratadas <= 744),

  horas_ferias   numeric(6,1) not null default 0 check (horas_ferias >= 0),
  horas_feriados numeric(6,1) not null default 0 check (horas_feriados >= 0),
  horas_faltas   numeric(6,1) not null default 0 check (horas_faltas >= 0),

  ocupacao_pct numeric(5,2) not null default 70
               check (ocupacao_pct > 0 and ocupacao_pct <= 100),

  -- O serviço que se faz de graça. Um por empresa: quase toda MPE de
  -- serviço tem exatamente um, e uma lista aqui viraria um cadastro que
  -- ninguém mantém.
  servico_nome    text check (length(btrim(servico_nome)) between 2 and 120),
  servico_horas   numeric(6,1) check (servico_horas >= 0),
  servico_por_mes numeric(6,1) check (servico_por_mes >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hora_produtiva_config is
  'Como a equipe trabalha, para a aula 3.4. Anual, nao mensal: jornada, '
  'feriados medios e ocupacao produtiva nao mudam de um mes para o outro.';

comment on column public.hora_produtiva_config.ocupacao_pct is
  'Quanto da hora disponivel vira trabalho que o cliente paga. 70% ja e uma '
  'equipe bem organizada. Chutar para cima e a forma mais comum de fazer a '
  'hora parecer barata.';

comment on column public.hora_produtiva_config.horas_ferias is
  'Ferias provisionadas no mes: 1/12 do periodo. Sai da folha e nao gera '
  'servico -- e por isso encarece a hora que sobra.';

drop trigger if exists set_updated_at on public.hora_produtiva_config;
create trigger set_updated_at before update on public.hora_produtiva_config
  for each row execute function public.tg_set_updated_at();

alter table public.hora_produtiva_config enable row level security;

drop policy if exists hora_produtiva_config_select on public.hora_produtiva_config;
create policy hora_produtiva_config_select on public.hora_produtiva_config
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists hora_produtiva_config_write on public.hora_produtiva_config;
create policy hora_produtiva_config_write on public.hora_produtiva_config
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
-- select * from public.hora_produtiva_config;
--
-- Vem vazia até alguém preencher pela tela. Os padrões de 220 horas e
-- 70% de ocupação só aparecem quando a primeira linha é criada.
