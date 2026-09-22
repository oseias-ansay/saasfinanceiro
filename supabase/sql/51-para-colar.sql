-- =====================================================================
-- 51 · POR QUE O DRE E O EXTRATO AINDA MOSTRAM O QUE FOI "APAGADO"
-- =====================================================================
-- O DRE (vw_dre_monthly) e o extrato (vw_extrato_caixa) não guardam nada:
-- são views, calculadas na hora a partir de public.transactions. Se eles
-- mostram um valor, existe uma linha em transactions que o produz. Não há
-- cache no banco, nem cópia, nem snapshot.
--
-- Então "apaguei e continua aparecendo" só tem três causas possíveis:
--
--   1. Sobraram linhas que a tela não listou (a lista tem filtro de tipo,
--      de situação e teto de 200 por página).
--   2. O DELETE foi barrado pelo RLS e devolveu zero sem erro — acontece
--      quando o papel do usuário na empresa não é owner, admin ou member.
--   3. O navegador está com a tela antiga em cache (Ctrl+F5 resolve).
--
-- Os passos abaixo distinguem as três e resolvem a primeira. Rode um de
-- cada vez, lendo o resultado antes de passar ao próximo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PASSO 1 — O que ainda existe, por empresa e por situação
-- ---------------------------------------------------------------------
-- Se vier vazio, transactions está limpa e o que você vê na tela é cache
-- do navegador: Ctrl+F5 e pronto. Se vier com linhas, siga em frente e
-- anote o tenant_id da empresa que você está testando.

select
  t.name                as empresa,
  x.tenant_id,
  x.status,
  x.type,
  count(*)              as qtd,
  sum(x.amount)         as total,
  min(x.competence_date) as primeira,
  max(x.competence_date) as ultima
from public.transactions x
join public.tenants t on t.id = x.tenant_id
group by t.name, x.tenant_id, x.status, x.type
order by t.name, x.status, x.type;


-- ---------------------------------------------------------------------
-- PASSO 2 — Conferir que é isso mesmo que alimenta as duas telas
-- ---------------------------------------------------------------------
-- Troque o tenant_id pelo da empresa do passo 1. A contagem do DRE e a do
-- extrato têm de bater com o que você viu lá.

-- select competencia, receita_bruta, despesas_fixas, resultado_liquido
--   from public.vw_dre_monthly
--  where tenant_id = 'COLE-O-TENANT-ID'
--  order by competencia;

-- select data, descricao, entradas, saidas, saldo
--   from public.vw_extrato_caixa
--  where tenant_id = 'COLE-O-TENANT-ID'
--  order by data, abertura desc, ordem, tx_id;

-- A linha "Saldo inicial das contas" do extrato NÃO é lançamento: ela vem
-- de bank_accounts.opening_balance e continua aparecendo mesmo com zero
-- lançamentos, porque o saldo inicial informado continua sendo verdade.
-- Para zerá-la, edite a conta em Cadastros — não adianta apagar títulos.


-- ---------------------------------------------------------------------
-- PASSO 3 — O seu usuário pode apagar?
-- ---------------------------------------------------------------------
-- Esta é a causa 2, e é silenciosa: o RLS permite LER com qualquer papel
-- ativo, mas só deixa APAGAR quem é owner, admin ou member. Um usuário
-- com outro papel apaga "com sucesso" e nada sai — o PostgREST devolve
-- zero linhas afetadas, sem erro nenhum.
--
-- Troque pelo seu e-mail de login.

-- select p.email, t.name as empresa, m.role, m.is_active
--   from public.memberships m
--   join public.tenants  t on t.id = m.tenant_id
--   join public.profiles p on p.id = m.user_id
--  where p.email = 'seu-email@exemplo.com';
--
-- Se `role` não for owner, admin ou member, achamos a causa. Corrija o
-- papel em Usuários, no painel, e a lixeira passa a funcionar.


-- ---------------------------------------------------------------------
-- PASSO 4 — Apagar de verdade, pelo banco
-- ---------------------------------------------------------------------
-- Roda como postgres, portanto ignora o RLS: apaga mesmo que o papel do
-- usuário não deixasse. É irreversível — confira o PASSO 1 antes.
--
-- O tenant_id no WHERE não é opcional. Sem ele, este comando limpa TODAS
-- as empresas da base, inclusive as dos clientes.

-- begin;
--
-- delete from public.transactions
--  where tenant_id = 'COLE-O-TENANT-ID';
--
-- -- Confira o número devolvido. Se fizer sentido, confirme:
-- commit;
-- -- Se não fizer, desfaça com:  rollback;


-- ---------------------------------------------------------------------
-- PASSO 5 — Conferir que sumiu
-- ---------------------------------------------------------------------
-- As três têm de voltar vazias ou zeradas.

-- select count(*) from public.transactions where tenant_id = 'COLE-O-TENANT-ID';
-- select count(*) from public.vw_dre_monthly where tenant_id = 'COLE-O-TENANT-ID';
-- select count(*) from public.vw_extrato_caixa
--   where tenant_id = 'COLE-O-TENANT-ID' and not abertura;
--
-- Depois, Ctrl+F5 no site. Se a tela ainda mostrar valores com as três
-- consultas zeradas, aí é o build do front-end que não subiu.
