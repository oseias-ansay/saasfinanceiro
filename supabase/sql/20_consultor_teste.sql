-- =====================================================================
-- 20 — CONSULTOR DE TESTE
-- =====================================================================
-- Cria uma consultoria de teste, publica a página dela e vincula uma
-- conta de consultor. Serve para exercitar o terceiro nível com um
-- usuário real antes de qualquer franqueado de verdade entrar.
--
-- Rode com "Run without RLS": as policies exigem staff para criar
-- consultoria, e o editor do Supabase não tem sessão de usuário.
--
-- ANTES DE RODAR: crie a conta do consultor de teste pelo painel de
-- Administração do site (Nova empresa não serve — é conta de usuário).
-- O jeito mais simples é o próprio Supabase:
--
--   Authentication → Users → Add user
--     e-mail: consultor.teste@businesstriage.com.br
--     senha:  a que você escolher
--     "Auto Confirm User" marcado
--
-- Depois volte aqui e rode. O bloco final confere se deu certo.
-- =====================================================================

-- ATENÇÃO: se você usou outro e-mail ao criar a conta, troque nos DOIS
-- lugares marcados com «E-MAIL DO CONSULTOR» abaixo. Não dá para usar
-- variável aqui: `\set` é comando do psql, e o editor SQL do Supabase
-- não é psql — ele mandaria erro de sintaxe.

-- ---------------------------------------------------------------------
-- 1. A CONSULTORIA
-- ---------------------------------------------------------------------
insert into public.consultorias (
  nome, responsavel, email_contato, certificada_em, is_active,
  slug, titulo, apresentacao, regiao, whatsapp, pagina_publica, observacao
) values (
  'Consultoria Teste',
  'Consultor de Teste',
  'consultor.teste@businesstriage.com.br',
  current_date,
  true,
  'teste',
  'Consultoria Teste · Business Triage',
  'Conta criada para validar o funcionamento da rede de consultores. '
  'Se você chegou aqui por engano, procure a Business Triage pelo site principal.',
  'Curitiba, PR',
  '5541992922623',
  true,
  'CONTA DE TESTE — remover antes de operar com franqueados reais.'
)
-- O `where slug is not null` repete o predicado do índice parcial criado
-- no 19. Sem ele o Postgres não reconhece qual índice usar e devolve
-- "no unique or exclusion constraint matching the ON CONFLICT".
on conflict (slug) where slug is not null do update set
  pagina_publica = true,
  is_active      = true;

-- ---------------------------------------------------------------------
-- 2. O VÍNCULO DA PESSOA
-- ---------------------------------------------------------------------
-- Titular: pode gerir a própria equipe. É o papel do franqueado.
insert into public.consultores (consultoria_id, user_id, papel, is_active)
select k.id, u.id, 'titular', true
  from public.consultorias k, auth.users u
 where k.slug = 'teste'
   -- «E-MAIL DO CONSULTOR» (1 de 2)
   and u.email = 'consultor.teste@businesstriage.com.br'
on conflict (consultoria_id, user_id) do update set
  is_active = true,
  papel     = 'titular';

-- O perfil precisa existir para o front resolver o nome. O trigger de
-- novos usuários normalmente cria, mas contas feitas direto no painel do
-- Supabase às vezes escapam — daí o upsert.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
 -- «E-MAIL DO CONSULTOR» (2 de 2)
 where u.email = 'consultor.teste@businesstriage.com.br'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. UMA EMPRESA NA CARTEIRA DELE
-- ---------------------------------------------------------------------
-- Sem isto o teste fica pela metade: a carteira abriria vazia e não daria
-- para ver o recorte funcionando. Escolhe a empresa de demonstração, que
-- é a única que não é cliente real.
--
-- ATENÇÃO: a partir deste update, essa empresa passa a ser da carteira do
-- consultor de teste. Para devolvê-la à Business Triage:
--   update public.tenants set consultoria_id = null where name like 'Business Triage%';

update public.tenants
   set consultoria_id = (select id from public.consultorias where slug = 'teste')
 where name like 'Business Triage%';

-- ---------------------------------------------------------------------
-- 4. CONFERÊNCIA
-- ---------------------------------------------------------------------
select
  (select count(*) from public.consultorias where slug = 'teste')            as consultoria,
  (select count(*) from public.consultores c
     join public.consultorias k on k.id = c.consultoria_id
    where k.slug = 'teste' and c.is_active)                                  as consultores_vinculados,
  (select count(*) from public.tenants t
     join public.consultorias k on k.id = t.consultoria_id
    where k.slug = 'teste')                                                  as empresas_na_carteira,
  (select count(*) from public.vw_consultor_publico where slug = 'teste')    as pagina_publicada;

-- O esperado é 1, 1, 1, 1.
--
-- Se `consultores_vinculados` vier 0, a conta não existe no GoTrue com esse
-- e-mail — crie no Authentication → Users e rode a seção 2 de novo.
--
-- Depois:  notify pgrst, 'reload schema';
--
-- ---------------------------------------------------------------------
-- PARA DESFAZER TUDO
-- ---------------------------------------------------------------------
--   update public.tenants set consultoria_id = null
--    where consultoria_id = (select id from public.consultorias where slug = 'teste');
--   delete from public.consultorias where slug = 'teste';  -- leva os vínculos junto
