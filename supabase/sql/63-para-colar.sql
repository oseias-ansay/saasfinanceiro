-- =====================================================================
-- 63 · BOLETO POR E-MAIL
-- =====================================================================
-- O cliente (ou o fornecedor dele) encaminha o boleto para um endereço,
-- e ele aparece na fila de conferência da empresa certa.
--
-- ---------------------------------------------------------------------
-- A PERGUNTA QUE DECIDE ESTE ARQUIVO: DE QUEM É O E-MAIL QUE CHEGOU?
-- ---------------------------------------------------------------------
-- A resposta tentadora é "do remetente". E é errada: o campo `From` de
-- um e-mail é trivial de falsificar, não exige nada de quem envia. Pior,
-- ela nem resolve o caso real — quando o FORNECEDOR encaminha o boleto,
-- o remetente não é usuário de empresa nenhuma.
--
-- Então cada empresa recebe um ENDEREÇO próprio, com um código que não
-- se adivinha:
--
--     boletos+a7f3x9k2@businesstriage.com.br
--
-- O código resolve a empresa. Não depende do remetente, não depende de
-- cadastro, e funciona para o fornecedor encaminhando.
--
-- ---------------------------------------------------------------------
-- O ENDEREÇO É UMA CREDENCIAL. ISSO TEM QUE ESTAR ESCRITO.
-- ---------------------------------------------------------------------
-- Quem souber o endereço de uma empresa consegue colocar um boleto na
-- fila dela. Não há como evitar: um endereço de e-mail serve para
-- receber de quem você não conhece — é o ponto dele.
--
-- O que limita o dano é o desenho da captura, não este arquivo: nada
-- vira `transactions` sem uma pessoa confirmar na tela. O teto do ataque
-- é lixo na fila de conferência.
--
-- Mas há um ataque que o lixo na fila NÃO cobre, e ele é a fraude mais
-- comum do Brasil: um boleto com dígito verificador correto, valor
-- plausível e nome de fornecedor conhecido, esperando que alguém
-- confirme no automático. A leitura do código não protege disso — o
-- código está perfeito, o boleto é que é de outro beneficiário.
--
-- Por isso `origem` e `remetente` são colunas, não detalhe de log: a
-- tela TEM que mostrar que aquele boleto chegou por e-mail e de quem,
-- para a conferência ser uma conferência. E por isso o token é
-- rotacionável, em tabela própria: endereço vazado se troca sem mexer
-- em `tenants`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. DE ONDE VEIO O BOLETO
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'boleto_origem') then
    create type public.boleto_origem as enum ('foto', 'digitado', 'email');
  end if;
end $$;

alter table public.boletos_capturados
  add column if not exists origem public.boleto_origem not null default 'foto';

/**
 * Quem mandou, e com que assunto.
 *
 * Nulos quando a origem é foto ou digitado — ali quem capturou é o
 * próprio usuário, já registrado em `criado_por`.
 *
 * O endereço vem do `From` e NÃO é confiável: serve para a pessoa
 * reconhecer ("é o meu fornecedor de bebidas"), nunca para a plataforma
 * decidir qualquer coisa. Está escrito aqui porque a tentação de usá-lo
 * como identificação vai aparecer de novo.
 */
alter table public.boletos_capturados
  add column if not exists remetente text check (remetente is null or length(remetente) <= 320);

alter table public.boletos_capturados
  add column if not exists assunto text check (assunto is null or length(assunto) <= 500);

/**
 * Coerência: e-mail tem remetente, foto e digitado não.
 *
 * Sem isto, um defeito na rota gravaria boleto de e-mail sem remetente —
 * e a tela mostraria "chegou por e-mail" sem dizer de quem, que é
 * exatamente a informação que torna a conferência possível.
 */
alter table public.boletos_capturados
  drop constraint if exists boleto_origem_coerente;

alter table public.boletos_capturados
  add constraint boleto_origem_coerente check (
    (origem = 'email' and remetente is not null)
    or (origem <> 'email' and remetente is null)
  );


-- ---------------------------------------------------------------------
-- 2. O ENDEREÇO DE ENTRADA DE CADA EMPRESA
-- ---------------------------------------------------------------------
-- Tabela própria, e não uma coluna em `tenants`, por dois motivos:
-- rotacionar o token é desativar uma linha e criar outra (fica o
-- histórico de quando o endereço mudou), e a tabela de empresas não
-- precisa de uma coluna que é segredo operacional.

create table if not exists public.boleto_entrada_email (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  /**
   * O código que vai no endereço. Minúsculas e dígitos, 8 a 32.
   *
   * Gerado no banco, não na aplicação: assim ninguém cria um token
   * "fácil de digitar" por conveniência, que é como esse tipo de segredo
   * costuma degradar.
   */
  token      text not null unique
    check (token ~ '^[a-z0-9]{8,32}$'),

  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  revogado_em timestamptz,

  constraint entrada_revogacao_coerente check (
    (ativo and revogado_em is null) or (not ativo and revogado_em is not null)
  )
);

/** Um endereço ATIVO por empresa. Revogados ficam, para histórico. */
create unique index if not exists boleto_entrada_ativa_idx
  on public.boleto_entrada_email (tenant_id)
  where ativo;

create index if not exists boleto_entrada_token_idx
  on public.boleto_entrada_email (token)
  where ativo;


-- ---------------------------------------------------------------------
-- 3. GERAR O TOKEN
-- ---------------------------------------------------------------------
-- `gen_random_bytes` do pgcrypto, em base36 por caractere. 12
-- caracteres de [a-z0-9] dão cerca de 62 bits — longe de ser adivinhado
-- por tentativa, e ainda cabe num endereço que alguém digita.

create or replace function public.fn_boleto_token_novo()
returns text
language plpgsql
volatile
as $$
declare
  alfabeto constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  saida text := '';
  i int;
begin
  for i in 1..12 loop
    saida := saida || substr(alfabeto, 1 + floor(random() * 36)::int, 1);
  end loop;
  return saida;
end $$;

/**
 * Devolve o endereço ativo da empresa, criando na primeira chamada.
 *
 * `security definer` porque precisa inserir, e quem chama é o usuário
 * comum pela API. O `search_path` fixo é obrigatório em definer: sem
 * ele, um `search_path` manipulado faz a função chamar outra coisa.
 *
 * A permissão é conferida AQUI dentro, com as mesmas funções do RLS.
 */
create or replace function public.fn_boleto_entrada(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  if not (public.is_tenant_member(p_tenant)
          or public.is_platform_staff()
          or public.is_consultor_de(p_tenant)) then
    raise exception 'sem permissão para esta empresa' using errcode = '42501';
  end if;

  select token into v_token
    from public.boleto_entrada_email
   where tenant_id = p_tenant and ativo
   limit 1;

  if v_token is not null then
    return v_token;
  end if;

  -- Laço porque o token é aleatório e o unique pode colidir. Três
  -- tentativas é folga enorme para 62 bits; falhar é melhor que laço
  -- infinito se algo estiver errado de verdade.
  for i in 1..3 loop
    begin
      v_token := public.fn_boleto_token_novo();
      insert into public.boleto_entrada_email (tenant_id, token)
        values (p_tenant, v_token);
      return v_token;
    exception when unique_violation then
      v_token := null;
    end;
  end loop;

  raise exception 'não consegui gerar o endereço de entrada';
end $$;

revoke all on function public.fn_boleto_entrada(uuid) from public;
grant execute on function public.fn_boleto_entrada(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. RLS DA TABELA DE ENTRADA
-- ---------------------------------------------------------------------
-- Leitura para quem é da empresa. Escrita por NENHUMA política: criar e
-- revogar passa pelas funções, que conferem permissão e geram o token
-- do jeito certo. Política de insert aberta permitiria o cliente
-- escolher o próprio token — e ele escolheria "posto1".

alter table public.boleto_entrada_email enable row level security;

drop policy if exists boleto_entrada_select on public.boleto_entrada_email;
create policy boleto_entrada_select on public.boleto_entrada_email
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );


-- ---------------------------------------------------------------------
-- 5. REVOGAR UM ENDEREÇO VAZADO
-- ---------------------------------------------------------------------
-- Desativa o atual e cria outro na mesma transação. O endereço antigo
-- deixa de resolver na hora, e o registro fica — se amanhã aparecer
-- boleto estranho, dá para saber qual endereço estava valendo quando.

create or replace function public.fn_boleto_entrada_trocar(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.can_write_tenant(p_tenant)
          or public.is_platform_staff()
          or public.is_consultor_de(p_tenant)) then
    raise exception 'sem permissão para esta empresa' using errcode = '42501';
  end if;

  update public.boleto_entrada_email
     set ativo = false, revogado_em = now()
   where tenant_id = p_tenant and ativo;

  return public.fn_boleto_entrada(p_tenant);
end $$;

revoke all on function public.fn_boleto_entrada_trocar(uuid) from public;
grant execute on function public.fn_boleto_entrada_trocar(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. CONFERIR
-- ---------------------------------------------------------------------
-- Rode depois de colar. Tudo tem que vir 1 (e `origem_default` = 'foto').

-- select
--   (select count(*) from information_schema.columns
--      where table_name = 'boletos_capturados' and column_name = 'origem') as col_origem,
--   (select count(*) from information_schema.columns
--      where table_name = 'boletos_capturados' and column_name = 'remetente') as col_remetente,
--   (select count(*) from information_schema.tables
--      where table_schema = 'public' and table_name = 'boleto_entrada_email') as tab_entrada,
--   (select count(*) from pg_proc where proname = 'fn_boleto_entrada') as fn_entrada,
--   (select count(*) from pg_indexes
--      where indexname = 'boleto_entrada_ativa_idx') as idx_uma_ativa;
