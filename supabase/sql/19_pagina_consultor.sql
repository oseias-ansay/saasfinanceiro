-- =====================================================================
-- 19 — PÁGINA PÚBLICA DO CONSULTOR
-- =====================================================================
-- Cada consultoria certificada ganha um endereço próprio:
--
--     businesstriage.com.br/c/consultoria-silva
--
-- e, quando o certificado curinga estiver no ar, o mesmo conteúdo em
-- consultoriasilva.businesstriage.com.br — sem mudar nada aqui, porque o
-- que resolve a página é o `slug`, não o formato do endereço.
--
-- O QUE FAZ ESTA PÁGINA VALER MAIS QUE UM CARTÃO DE VISITA
--
-- O botão de diagnóstico dela carrega o slug do consultor. O lead nasce
-- atribuído, a conversão por consultor entra no painel de validação, e a
-- página deixa de ser vaidade para virar canal medido. Sem essa
-- atribuição, um franqueado poderia divulgar a página por meses sem que
-- ninguém — nem ele — soubesse se ela trouxe alguém.
--
-- LEITURA PÚBLICA, E SÓ DO NECESSÁRIO
--
-- Esta é a primeira tabela do sistema com policy para visitante anônimo.
-- Por isso a exposição é por VIEW, não pela tabela: assim o CNPJ, o
-- e-mail de contato interno e as observações da franquia ficam de fora
-- por construção, e não por alguém ter lembrado de não selecioná-los.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CAMPOS DA PÁGINA
-- ---------------------------------------------------------------------
alter table public.consultorias
  add column if not exists slug          text,
  add column if not exists titulo        text,
  add column if not exists apresentacao  text,
  add column if not exists foto_url      text,
  add column if not exists regiao        text,
  add column if not exists whatsapp      text,
  add column if not exists linkedin      text,
  -- A página só aparece quando isto for verdadeiro. Nasce falso: cadastrar
  -- a consultoria e publicar a página são decisões diferentes, e a segunda
  -- costuma esperar a foto e o texto ficarem prontos.
  add column if not exists pagina_publica boolean not null default false;

-- Slug em minúsculas, sem acento, separado por hífen. A restrição existe
-- porque este texto vira endereço: espaço ou maiúscula ali gera URL que
-- funciona num navegador e quebra em outro.
alter table public.consultorias
  drop constraint if exists consultorias_slug_formato;
alter table public.consultorias
  add constraint consultorias_slug_formato
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create unique index if not exists consultorias_slug_uidx
  on public.consultorias (slug) where slug is not null;

comment on column public.consultorias.slug is
  'Identificador da página pública: /c/<slug> e, futuramente, <slug>.businesstriage.com.br.';

comment on column public.consultorias.pagina_publica is
  'Publica a página. Falso por padrão — cadastrar a consultoria e publicá-la '
  'são decisões diferentes.';

-- ---------------------------------------------------------------------
-- 2. A VITRINE
-- ---------------------------------------------------------------------
-- View sem `security_invoker`: roda com os privilégios de quem a criou,
-- e é assim que ela consegue ser lida por visitante anônimo sem que a
-- tabela `consultorias` precise abrir para o mundo.
--
-- A lista de colunas é a fronteira de privacidade. CNPJ, e-mail interno,
-- observações e datas de gestão não estão aqui — e não estarão por
-- descuido futuro, porque acrescentar coluna a uma view é ato explícito.

create or replace view public.vw_consultor_publico as
select
  k.slug,
  coalesce(k.titulo, k.nome)  as titulo,
  k.nome,
  k.responsavel,
  k.apresentacao,
  k.foto_url,
  k.regiao,
  k.whatsapp,
  k.linkedin,
  k.certificada_em
from public.consultorias k
where k.is_active and k.pagina_publica and k.slug is not null;

comment on view public.vw_consultor_publico is
  'Dados públicos da página do consultor. A lista de colunas é a fronteira de '
  'privacidade: o que não está aqui não é exposto.';

grant select on public.vw_consultor_publico to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. ATRIBUIÇÃO DO LEAD
-- ---------------------------------------------------------------------
-- De qual página o diagnóstico veio. Nulo = site principal, que é a
-- maioria hoje e continua sendo o caso normal.
--
-- Guardado como TEXTO, não como chave estrangeira, de propósito: é o
-- registro de por onde a pessoa entrou, um fato histórico. Se a
-- consultoria for encerrada e a linha apagada, a informação de origem
-- daquele lead não pode desaparecer junto — ela explica um número no
-- funil de três meses atrás.

alter table public.diagnosticos
  add column if not exists origem_slug text;

create index if not exists diagnosticos_origem_idx
  on public.diagnosticos (origem_slug) where origem_slug is not null;

comment on column public.diagnosticos.origem_slug is
  'Slug da página de consultor que originou o lead. Nulo = site principal. '
  'Texto e não FK: é fato histórico, sobrevive ao encerramento da consultoria.';

-- ---------------------------------------------------------------------
-- 4. CONVERSÃO POR CONSULTOR
-- ---------------------------------------------------------------------
-- A mesma leitura do painel de validação, agora quebrada por origem. É o
-- que responde "a página do fulano trouxe alguém?" — pergunta que vai
-- aparecer na primeira reunião com qualquer franqueado.

create or replace view public.vw_funil_por_consultor
with (security_invoker = on) as
select
  coalesce(d.origem_slug, '(site principal)')        as origem,
  k.nome                                             as consultoria,
  count(*)                                           as diagnosticos,
  count(*) filter (where d.tenant_id is not null)    as convertidos,
  round(
    100.0 * count(*) filter (where d.tenant_id is not null)
    / nullif(count(*), 0)
  , 1)                                               as taxa_conversao_pct,
  min(d.created_at)                                  as primeiro,
  max(d.created_at)                                  as ultimo
from public.diagnosticos d
left join public.consultorias k on k.slug = d.origem_slug
where public.is_platform_staff()
   or d.origem_slug in (
        select k2.slug from public.consultorias k2
         where k2.id in (select public.minhas_consultorias())
      )
group by 1, 2;

comment on view public.vw_funil_por_consultor is
  'Conversão de diagnóstico em contrato por página de origem. O franqueador vê '
  'todas; o consultor vê a própria.';

grant select on public.vw_funil_por_consultor to authenticated;

-- ---------------------------------------------------------------------
-- 5. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Nenhuma página publicada ainda — a view precisa voltar vazia:
--
--   select * from public.vw_consultor_publico;
--
-- Para publicar a primeira, depois de cadastrar a consultoria:
--
--   update public.consultorias set
--     slug = 'consultoria-silva',
--     titulo = 'Consultoria Silva · Business Triage',
--     apresentacao = 'Vinte anos em banco, agora ajudando pequenas empresas '
--                    'a enxergar o próprio caixa antes de decidir.',
--     regiao = 'Curitiba e região metropolitana',
--     whatsapp = '5541999999999',
--     pagina_publica = true
--   where nome = 'Consultoria Silva';
--
-- E o teste da fronteira de privacidade — deslogado, no navegador anônimo,
-- a página deve abrir e o CNPJ NÃO deve aparecer em lugar nenhum.
--
-- Depois de aplicar:  notify pgrst, 'reload schema';
