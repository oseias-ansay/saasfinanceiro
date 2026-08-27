-- =====================================================================
-- 28 — RLS NAS TABELAS DE CATÁLOGO
-- =====================================================================
-- O Advisor do Supabase apontou quatro tabelas em `public` sem RLS:
-- `planos`, `recursos`, `plano_recursos` e `etapas_funil`.
--
-- Nenhuma delas guarda dado de cliente — são o catálogo do produto e o
-- conjunto canônico de etapas do método. E a escrita já estava
-- bloqueada: concedi apenas `select` a `anon` e `authenticated`.
--
-- Ainda assim o alerta procede, e por um motivo que vale registrar: sem
-- RLS, a única coisa impedindo escrita é o grant. No dia em que alguém
-- rodar um `grant all` de conveniência — coisa que acontece durante
-- depuração —, a tabela abre e nada avisa. Com RLS ligada e política de
-- leitura apenas, o grant extra não basta.
--
-- Leitura livre é intencional aqui: a tela de planos precisa aparecer
-- para visitante que ainda não tem conta.
-- =====================================================================

alter table public.planos          enable row level security;
alter table public.recursos        enable row level security;
alter table public.plano_recursos  enable row level security;
alter table public.etapas_funil    enable row level security;

drop policy if exists planos_leitura on public.planos;
create policy planos_leitura on public.planos
  for select using (true);

drop policy if exists recursos_leitura on public.recursos;
create policy recursos_leitura on public.recursos
  for select using (true);

drop policy if exists plano_recursos_leitura on public.plano_recursos;
create policy plano_recursos_leitura on public.plano_recursos
  for select using (true);

drop policy if exists etapas_funil_leitura on public.etapas_funil;
create policy etapas_funil_leitura on public.etapas_funil
  for select using (true);

-- Nenhuma política de escrita, de propósito. Quem altera o catálogo é a
-- plataforma, por SQL ou service_role — que ignora RLS. Não existe
-- caminho de aplicação para mudar preço de plano, e é assim que deve ser.

comment on table public.planos is
  'Catálogo comercial. Leitura pública; escrita só por service_role.';

comment on table public.etapas_funil is
  'Conjunto canônico de etapas do método. Cada etapa que uma empresa cria '
  'aponta para uma destas — é o que mantém o diagnóstico comparável.';

-- ---------------------------------------------------------------------
-- CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Lista tudo em `public` que ainda está sem RLS. O Advisor mostrou
-- quatro e mencionou mais uma; esta consulta mostra todas de uma vez,
-- inclusive as que apareceram depois.
--
--   select c.relname as tabela, c.relrowsecurity as rls_ligada
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relkind = 'r'
--      and not c.relrowsecurity
--    order by 1;
--
-- O esperado depois deste arquivo é nenhuma linha. Se sobrar alguma, me
-- mande o nome — pode ser tabela de catálogo (mesmo tratamento) ou algo
-- com dado de cliente, que aí é outra conversa.
