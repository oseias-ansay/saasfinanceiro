-- =====================================================================
-- 64 · VÍNCULO COM O CRM E O CONTÁBIL
-- =====================================================================
-- O Portal, o CRM e o Contábil são três sistemas com três bancos. Até
-- aqui, uma empresa era três linhas sem nada que as ligasse: o Portal
-- conhece `tenant_id` (uuid), os outros dois conhecem `slug` — porque
-- neles o tenant vem do subdomínio, `<slug>.crm.businesstriage.com.br`.
--
-- Sem uma chave comum, qualquer integração é adivinhação. Esta é a
-- chave.
--
-- ---------------------------------------------------------------------
-- UM SLUG SÓ PARA OS DOIS SISTEMAS
-- ---------------------------------------------------------------------
-- CRM e Contábil são irmãos — mesmo stack, mesmo desenho de tenant. A
-- mesma empresa usa o mesmo slug nos dois, e por isso basta uma coluna.
--
-- Se um dia divergirem, vira `slug_crm` e `slug_contabil`. Começar com
-- duas colunas hoje seria pagar por um problema que não existe.
--
-- ---------------------------------------------------------------------
-- NULO É O ESTADO NORMAL, NÃO UM ERRO
-- ---------------------------------------------------------------------
-- A maioria das empresas não tem nenhum dos dois módulos. Nulo significa
-- "não há sistema externo para esta empresa", e a rota que monta o
-- endereço recusa com uma mensagem clara em vez de montar uma URL
-- quebrada.
--
-- ---------------------------------------------------------------------
-- O FORMATO É O DE SUBDOMÍNIO, E O CHECK EXISTE POR SEGURANÇA
-- ---------------------------------------------------------------------
-- O slug entra numa URL. Sem restrição, um valor com ponto ou barra
-- construiria um endereço para outro domínio — o Portal mandaria o
-- cliente, com um token de sessão, para um host que não é nosso.
--
-- Daí o `check`: só minúsculas, dígitos e hífen, de 2 a 48 caracteres,
-- sem começar nem terminar com hífen. É a mesma regra que um subdomínio
-- aceita.
--
-- O grupo opcional da primeira versão (`([a-z0-9-]{1,46}[a-z0-9])?`)
-- aceitava slug de UM caractere e recusava de dois. O teste pegou.
-- =====================================================================

alter table public.tenants
  add column if not exists slug_externo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_slug_externo_formato'
  ) then
    alter table public.tenants
      add constraint tenants_slug_externo_formato check (
        slug_externo is null
        or slug_externo ~ '^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$'
      );
  end if;
end $$;

create unique index if not exists tenants_slug_externo_uidx
  on public.tenants (slug_externo)
  where slug_externo is not null;

comment on column public.tenants.slug_externo is
  'Slug desta empresa no CRM e no Contabil, usado no subdominio '
  '<slug>.crm|contabil.businesstriage.com.br. Nulo quando a empresa nao '
  'tem nenhum dos dois modulos. O check impede ponto e barra: o valor '
  'entra numa URL e um slug livre apontaria para outro dominio.';


-- ---------------------------------------------------------------------
-- OS DOIS RECURSOS NOVOS
-- ---------------------------------------------------------------------
-- O portão já existe: `fn_tenant_tem_recurso`, `requireRecurso` na API e
-- `tem()` no front. Acrescentar módulo é cadastro, não engenharia.
--
-- `crm_externo` é um código novo, e não um reaproveitamento do `crm`,
-- de propósito. O `crm` liberava o Funil interno, que está sendo
-- aposentado; manter o mesmo código faria quem tinha o Funil de cortesia
-- herdar o CRM pago sem ninguém decidir isso.

insert into public.recursos (codigo, nome, descricao, ordem) values
  ('contabil', 'Contabilidade gerencial',
   'Balancete, DRE e balanço informativos, com importação de extratos e '
   'plano de contas próprio.', 70),
  ('crm_externo', 'CRM',
   'Funil com múltiplos pipelines, inbox de WhatsApp e Instagram, '
   'automações e bot de triagem.', 80)
on conflict (codigo) do update
  set nome      = excluded.nome,
      descricao = excluded.descricao,
      ordem     = excluded.ordem;


-- ---------------------------------------------------------------------
-- CONFERIR
-- ---------------------------------------------------------------------
-- Rode depois de colar. As três colunas têm de vir 1, 1 e 2.

-- select
--   (select count(*) from information_schema.columns
--      where table_name = 'tenants' and column_name = 'slug_externo') as col_slug,
--   (select count(*) from pg_indexes
--      where indexname = 'tenants_slug_externo_uidx')                 as idx_unico,
--   (select count(*) from public.recursos
--      where codigo in ('contabil', 'crm_externo'))                   as recursos;

-- E para preencher o slug de uma empresa (o nome vem de como ela está
-- cadastrada no CRM/Contábil, não de um palpite):
--
--   update public.tenants set slug_externo = 'auto-posto-esperanca'
--    where id = 'UUID-DA-EMPRESA';
