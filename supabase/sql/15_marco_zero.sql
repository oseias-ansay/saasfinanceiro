-- =====================================================================
-- 15 — MARCO ZERO E VERSÃO DA RÉGUA
-- =====================================================================
-- Duas providências pequenas que só funcionam se existirem ANTES do
-- primeiro cliente pagante. Retroativamente nenhuma das duas se
-- reconstrói, e as duas sustentam a mesma frase: "a empresa saiu de 48 e
-- chegou a 86".
--
--   1. VERSÃO DA RÉGUA — a pontuação vai mudar. No dia em que mudar, os
--      scores antigos deixam de ser comparáveis, e a curva vira ficção
--      sem ninguém perceber. Gravar a versão junto com cada score é o que
--      permite dizer depois "estes 40 foram medidos por outra régua".
--
--   2. MARCO ZERO — o retrato do cliente no dia em que ele assinou. Sem
--      ele o "de 48 para 86" não tem o 48: o primeiro diagnóstico é de
--      quando ele ainda era prospect, e entre aquele dia e a assinatura
--      pode ter passado um mês.
--
-- Junto vem a peça que faltava para ligar as duas: hoje `diagnosticos`
-- guarda prospects e não sabe nada de empresas. Sem um vínculo, não há
-- como montar série nenhuma.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. VERSÕES DA RÉGUA
-- ---------------------------------------------------------------------
-- Tabela em vez de constante no código porque a pergunta "o que mudou
-- entre a v1 e a v2?" vai ser feita na frente do cliente, e a resposta
-- precisa estar onde os dados estão — não num commit de seis meses atrás.

create table if not exists public.regua_versoes (
  versao         text not null,
  tipo           public.diagnostico_tipo not null,
  vigente_desde  date not null default current_date,
  resumo         text not null,
  primary key (versao, tipo)
);

comment on table public.regua_versoes is
  'Histórico das réguas de pontuação. Cada diagnóstico grava a versão que o '
  'produziu, e é isso que mantém scores de épocas diferentes comparáveis.';

insert into public.regua_versoes (versao, tipo, vigente_desde, resumo) values
  ('v1', 'financeiro', date '2026-07-01',
   'Quatro pilares: Lucratividade e Eficiência (35), Liquidez e Capital de Giro (30), '
   'Endividamento e Risco (20), Governança e Mercado (15). Faixas: 85+ Excelente, '
   '70-84 Boa, 41-69 Atenção, 0-40 Crítica.'),
  ('v1', 'comercial', date '2026-07-01',
   'Quatro pilares: Estrutura, Processo e Funil (30), Atração e Geração de Demanda (30), '
   'Equipe, Metas e Gestão (20), Ticket Médio e Pós-Venda (20). Faixas: 85+ Operação '
   'Escalável, 66-84 Em Estruturação, 41-65 Informal, 0-40 Não Estruturado.')
on conflict (versao, tipo) do nothing;

alter table public.regua_versoes enable row level security;

drop policy if exists regua_versoes_select on public.regua_versoes;
create policy regua_versoes_select on public.regua_versoes
  for select to authenticated using (true);

grant select on public.regua_versoes to authenticated;

-- ---------------------------------------------------------------------
-- 2. O DIAGNÓSTICO PASSA A SABER DE QUAL RÉGUA VEIO — E DE QUEM É
-- ---------------------------------------------------------------------
alter table public.diagnosticos
  add column if not exists regua_versao text not null default 'v1';

-- O vínculo com a empresa. Fica nulo enquanto é prospect e é preenchido
-- quando ele vira cliente. `on delete set null` de propósito: excluir a
-- empresa não pode apagar o diagnóstico, que é registro de um lead e tem
-- vida própria — mas também não pode deixar referência pendurada.
alter table public.diagnosticos
  add column if not exists tenant_id uuid references public.tenants(id) on delete set null;

create index if not exists diagnosticos_tenant_idx
  on public.diagnosticos (tenant_id, created_at)
  where tenant_id is not null;

comment on column public.diagnosticos.regua_versao is
  'Versão da régua que produziu este score. Nunca alterar em registro antigo: '
  'recalcular em silêncio é o que transforma a curva em ficção.';

comment on column public.diagnosticos.tenant_id is
  'Preenchido quando o prospect vira cliente. É o que liga o diagnóstico de '
  'entrada à série histórica da empresa.';

-- ---------------------------------------------------------------------
-- 3. MARCO ZERO
-- ---------------------------------------------------------------------
-- Um por empresa. A restrição de unicidade é o ponto: marco zero que pode
-- ser refeito não é marco zero — é o número de hoje com outro nome.
-- Corrigir exige apagar e recriar, que é uma decisão consciente e fica
-- registrada em `registrado_por`.

create table if not exists public.marcos_zero (
  tenant_id       uuid primary key references public.tenants(id) on delete cascade,
  diagnostico_id  uuid references public.diagnosticos(id) on delete set null,

  assinado_em     date not null default current_date,
  score_total     int  not null check (score_total between 0 and 100),
  nivel           text not null,
  tipo            public.diagnostico_tipo not null default 'financeiro',
  regua_versao    text not null default 'v1',

  -- O estado completo no dia zero. Guardado como veio: se a régua mudar,
  -- dá para reprocessar os mesmos números pela régua nova e comparar
  -- maçã com maçã.
  indicadores     jsonb not null default '{}'::jsonb,
  alertas         jsonb not null default '[]'::jsonb,

  observacao      text,
  registrado_por  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.marcos_zero is
  'Retrato do cliente no dia da assinatura. Base do "de 48 para 86". '
  'Um por empresa — refazer descaracteriza a medição.';

alter table public.marcos_zero enable row level security;

-- O cliente vê o próprio marco zero: é dele que sai a curva na tela dele.
-- O staff vê todos.
drop policy if exists marcos_zero_select on public.marcos_zero;
create policy marcos_zero_select on public.marcos_zero
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

-- Escrita só pela API, com service_role. Ninguém grava o próprio marco zero.
grant select on public.marcos_zero to authenticated;

-- ---------------------------------------------------------------------
-- 4. A SÉRIE
-- ---------------------------------------------------------------------
-- Marco zero + diagnósticos posteriores da mesma empresa, em ordem, com a
-- variação desde o início. É o que a tela do cliente e o painel do
-- consultor consomem.
--
-- `security_invoker` faz o RLS de `diagnosticos` e `marcos_zero` valer
-- aqui: o cliente enxerga a própria série, o staff enxerga todas.

create or replace view public.vw_evolucao_score
with (security_invoker = on) as
with serie as (
  select
    m.tenant_id,
    m.tipo,
    m.assinado_em::timestamptz as em,
    m.score_total,
    m.nivel,
    m.regua_versao,
    true  as marco_zero,
    null::text as protocolo
  from public.marcos_zero m

  union all

  select
    d.tenant_id,
    d.tipo,
    d.created_at,
    d.score_total,
    d.nivel,
    d.regua_versao,
    false,
    d.protocolo
  from public.diagnosticos d
  where d.tenant_id is not null and d.score_total is not null
)
select
  s.tenant_id,
  s.tipo,
  s.em,
  s.score_total,
  s.nivel,
  s.regua_versao,
  s.marco_zero,
  s.protocolo,
  -- Variação desde o marco zero do mesmo tipo. Nulo quando não há marco
  -- zero — e nulo é a resposta certa aí, porque "0" sugeriria que a
  -- empresa não evoluiu, quando na verdade não se sabe de onde ela saiu.
  s.score_total - first_value(s.score_total) over (
    partition by s.tenant_id, s.tipo order by s.marco_zero desc, s.em
  ) as variacao,
  -- Sinaliza a série que mistura réguas. A tela precisa avisar em vez de
  -- desenhar uma linha bonita e mentirosa.
  --
  -- Comparar menor com maior em vez de contar distintos: o Postgres não
  -- implementa `count(distinct ...)` como função de janela. Para saber
  -- apenas SE há mais de um valor, min <> max responde a mesma pergunta.
  min(s.regua_versao) over (partition by s.tenant_id, s.tipo)
    <> max(s.regua_versao) over (partition by s.tenant_id, s.tipo)
    as reguas_misturadas
from serie s;

comment on view public.vw_evolucao_score is
  'Curva do score por empresa: marco zero e diagnósticos posteriores, com a '
  'variação acumulada. Ordene por (tipo, em).';

grant select on public.vw_evolucao_score to authenticated;

-- ---------------------------------------------------------------------
-- 5. A CARTEIRA PASSA A MOSTRAR O MARCO ZERO
-- ---------------------------------------------------------------------
-- Sem isto, saber quais clientes ainda estão sem marco zero exigiria abrir
-- um por um. E cliente que passa da assinatura sem marco zero perde o
-- retrato para sempre — é justamente o caso que precisa saltar aos olhos.

create or replace view public.vw_staff_tenants
with (security_invoker = on) as
select
  t.id,
  t.name,
  t.tax_id,
  t.is_active,
  t.created_at,
  (select count(*) from public.memberships m
    where m.tenant_id = t.id and m.is_active)            as qtd_usuarios,
  (select count(*) from public.transactions x
    where x.tenant_id = t.id)                            as qtd_lancamentos,
  (select max(x.created_at) from public.transactions x
    where x.tenant_id = t.id)                            as ultimo_lancamento,
  mz.score_total                                         as marco_zero_score,
  mz.assinado_em                                         as marco_zero_em,
  (select d.score_total from public.diagnosticos d
    where d.tenant_id = t.id and d.score_total is not null
    order by d.created_at desc limit 1)                  as score_atual
from public.tenants t
left join public.marcos_zero mz on mz.tenant_id = t.id;

comment on view public.vw_staff_tenants is
  'Carteira de clientes para o painel de staff. Sem valores financeiros. '
  'Traz o marco zero e o score mais recente para a leitura da evolução.';

grant select on public.vw_staff_tenants to authenticated;

-- ---------------------------------------------------------------------
-- 6. CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select * from public.regua_versoes;
--
--   select column_name from information_schema.columns
--    where table_name = 'diagnosticos' and column_name in ('regua_versao','tenant_id');
--
-- Depois de aplicar, recarregue o cache do PostgREST:
--   notify pgrst, 'reload schema';
