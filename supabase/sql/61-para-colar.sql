-- =====================================================================
-- 61 · MOVIMENTO DIÁRIO
-- =====================================================================
-- Um formulário por dia, em vez de lançamento a lançamento.
--
-- ---------------------------------------------------------------------
-- O PROBLEMA QUE ISTO RESOLVE
-- ---------------------------------------------------------------------
-- Lançar um a um é o atrito que faz o cliente parar de usar o Controle
-- Financeiro na terceira semana. Ele vende o dia inteiro, fecha o caixa,
-- e aí teria que cadastrar quinze lançamentos. Não cadastra.
--
-- E quando ele para de lançar, tudo o que a plataforma faz em cima disso
-- — diagnóstico, plano automático, assistente — passa a falar sobre um
-- mês vazio.
--
-- ---------------------------------------------------------------------
-- O FORMULÁRIO NÃO CRIA UM MODELO NOVO
-- ---------------------------------------------------------------------
-- Ele produz `transactions`, as mesmas de sempre. Nada a jusante muda:
-- extrato, DRE, contas a receber, prazos médios, diagnóstico e o
-- assistente continuam lendo o que já liam.
--
-- Uma tabela paralela de "movimento" seria mais simples de escrever e
-- criaria dois lugares com a verdade sobre o faturamento — que é
-- exatamente o defeito que este projeto evita em todas as telas.
--
-- ---------------------------------------------------------------------
-- CARTÃO NÃO É DINHEIRO HOJE. ESTA É A DECISÃO CENTRAL DO ARQUIVO.
-- ---------------------------------------------------------------------
-- Num posto, o crédito cai em trinta dias. Se a venda no cartão entrar
-- como recebida no dia, duas coisas que a plataforma vende passam a
-- mentir: a cobertura de caixa fica inflada e o prazo médio de
-- recebimento fica curto demais.
--
-- São os números do diagnóstico. Um formulário que facilita o lançamento
-- e corrompe o indicador troca adoção por confiança — o pior negócio
-- possível aqui.
--
-- Por isso cada forma de recebimento tem PRAZO. A venda é competência no
-- dia em que aconteceu; o vencimento é o dia em que o dinheiro entra.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AS FORMAS DE RECEBIMENTO
-- ---------------------------------------------------------------------
-- Por empresa, porque o prazo é negociado: a taxa e o prazo da
-- adquirente variam de contrato para contrato, e um posto que recebe em
-- 2 dias não pode ser tratado como um que recebe em 30.

create table if not exists public.formas_recebimento (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  nome        text not null check (length(btrim(nome)) between 2 and 40),
  /** Dias até o dinheiro entrar. Zero = à vista. */
  prazo_dias  int  not null default 0 check (prazo_dias between 0 and 180),

  ordem       int  not null default 0,
  ativa       boolean not null default true,

  created_at  timestamptz not null default now(),

  unique (tenant_id, nome)
);

comment on column public.formas_recebimento.prazo_dias is
  'Dias até o dinheiro entrar na conta. É o que separa venda de '
  'recebimento — cartão de crédito a 30 dias não é caixa hoje, e tratá-lo '
  'como se fosse infla a cobertura de caixa e encurta o PMR.';

alter table public.formas_recebimento enable row level security;

drop policy if exists formas_select on public.formas_recebimento;
create policy formas_select on public.formas_recebimento
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

drop policy if exists formas_write on public.formas_recebimento;
create policy formas_write on public.formas_recebimento
  for all to authenticated
  using (public.can_write_tenant(tenant_id) or public.is_platform_staff())
  with check (public.can_write_tenant(tenant_id) or public.is_platform_staff());

grant select, insert, update, delete on public.formas_recebimento to authenticated;

-- ---------------------------------------------------------------------
-- 2. O DIA
-- ---------------------------------------------------------------------
-- Um registro por empresa por data. É o que permite REENVIAR o mesmo dia
-- sem duplicar: o salvamento apaga os lançamentos daquele movimento e
-- recria.
--
-- Sem esta tabela, o cliente que corrigisse o movimento de ontem criaria
-- um segundo conjunto de lançamentos, e o faturamento do dia dobraria em
-- silêncio.

create table if not exists public.movimentos_diarios (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  data        date not null,

  observacao  text,
  lancado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (tenant_id, data)
);

create index if not exists movimentos_tenant_idx
  on public.movimentos_diarios (tenant_id, data desc);

drop trigger if exists set_updated_at on public.movimentos_diarios;
create trigger set_updated_at before update on public.movimentos_diarios
  for each row execute function public.tg_set_updated_at();

alter table public.movimentos_diarios enable row level security;

drop policy if exists movimentos_select on public.movimentos_diarios;
create policy movimentos_select on public.movimentos_diarios
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

drop policy if exists movimentos_write on public.movimentos_diarios;
create policy movimentos_write on public.movimentos_diarios
  for all to authenticated
  using (public.can_write_tenant(tenant_id) or public.is_platform_staff())
  with check (public.can_write_tenant(tenant_id) or public.is_platform_staff());

grant select, insert, update, delete on public.movimentos_diarios to authenticated;

-- ---------------------------------------------------------------------
-- 3. O LAÇO ENTRE O LANÇAMENTO E O DIA
-- ---------------------------------------------------------------------
-- `on delete cascade` de propósito: apagar o movimento apaga os
-- lançamentos que ele gerou. É o que torna o reenvio seguro.
--
-- Lançamento feito à mão continua com a coluna nula, e some do alcance
-- do formulário — quem lançou manualmente não quer ver aquilo apagado
-- porque alguém reenviou o dia.

alter table public.transactions
  add column if not exists movimento_id uuid
    references public.movimentos_diarios(id) on delete cascade;

create index if not exists transactions_movimento_idx
  on public.transactions (movimento_id) where movimento_id is not null;

comment on column public.transactions.movimento_id is
  'Preenchido quando o lançamento veio do formulário de movimento diário. '
  'Nulo em lançamento manual — e é por isso que reenviar o dia não apaga '
  'o que foi cadastrado à mão.';

-- ---------------------------------------------------------------------
-- 4. FORMAS PADRÃO PARA QUEM AINDA NÃO TEM
-- ---------------------------------------------------------------------
-- Os prazos abaixo são os usuais do varejo brasileiro, e são SUGESTÃO:
-- a tela deixa o consultor ajustar para o contrato de cada cliente.
--
-- Débito em 1 dia e crédito em 30 são o padrão de mercado. Zero nos dois
-- seria mais simples e produziria o erro que este arquivo existe para
-- evitar.

insert into public.formas_recebimento (tenant_id, nome, prazo_dias, ordem)
select t.id, f.nome, f.prazo, f.ordem
  from public.tenants t
 cross join (values
   ('Dinheiro',          0, 10),
   ('Pix',               0, 20),
   ('Cartão de débito',  1, 30),
   ('Cartão de crédito', 30, 40),
   ('A prazo',           30, 50)
 ) as f(nome, prazo, ordem)
 where t.is_active
   and not exists (
     select 1 from public.formas_recebimento x
      where x.tenant_id = t.id and x.nome = f.nome
   );

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- Cada empresa ativa recebeu as cinco formas:
--
--   select t.name, count(f.id) as formas
--     from public.tenants t
--     left join public.formas_recebimento f on f.tenant_id = t.id
--    where t.is_active
--    group by t.name order by t.name;
--
-- A coluna do laço existe:
--
--   select column_name from information_schema.columns
--    where table_name = 'transactions' and column_name = 'movimento_id';
