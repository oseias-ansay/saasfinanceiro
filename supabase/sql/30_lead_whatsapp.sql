-- =====================================================================
-- 30 — O contato do WhatsApp vira lead
-- =====================================================================
--
-- Etapa 1 do desenho: quem manda mensagem pelo anúncio entra no CRM
-- sozinho, como card em "Novo". Etapa 2 é a qualificação no quadro, que
-- já existe. Etapa 3 é devolver o resultado à Meta — e depende destas
-- duas, porque não há o que devolver antes de o lead ser qualificado.
--
-- ---------------------------------------------------------------------
-- O PROBLEMA CENTRAL: A MESMA PESSOA MANDA DEZ MENSAGENS
-- ---------------------------------------------------------------------
-- Conversa de WhatsApp não é um evento, é uma sequência. "Oi", "tudo
-- bem?", "queria saber do diagnóstico" são três webhooks. Se cada um
-- criar um card, na primeira semana de campanha o quadro tem três vezes
-- mais cards que pessoas — e o CAC sai dividido pelo número errado,
-- fazendo o anúncio parecer três vezes mais barato do que é.
--
-- Por isso tudo aqui gira em torno de uma chave estável por pessoa.
--
-- ---------------------------------------------------------------------
-- POR QUE A CHAVE NÃO É O TELEFONE INTEIRO
-- ---------------------------------------------------------------------
-- No Brasil o mesmo celular aparece de duas formas: com e sem o nono
-- dígito. O WhatsApp entrega números antigos como 55 + DDD + 8 dígitos,
-- e o mesmo contato salvo na agenda tem 9 dígitos. Comparar o número
-- inteiro trata os dois como pessoas diferentes.
--
-- A chave é DDD + os últimos 8 dígitos. Duas pessoas do mesmo DDD com os
-- mesmos 8 dígitos finais existem em teoria; em uma carteira de dezenas
-- de leads, não. É a troca certa: o erro raro é juntar dois leads, e o
-- erro comum — duplicar todo mundo — é o que estraga a conta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A chave do telefone
-- ---------------------------------------------------------------------
-- `immutable` porque vai virar coluna gerada, e o Postgres só aceita
-- função imutável ali. É legítimo: a saída depende só da entrada.

create or replace function public.fn_tel_chave(p_tel text)
returns text
language sql
immutable
as $$
  select case
    when p_tel is null then null
    -- Menos de 10 dígitos não é telefone brasileiro completo. Devolve o
    -- que veio, para não fabricar uma chave falsa que junte leads
    -- diferentes por engano.
    when length(regexp_replace(p_tel, '\D', '', 'g')) < 10
      then nullif(regexp_replace(p_tel, '\D', '', 'g'), '')
    else
      -- O DDD são os dois primeiros dígitos DEPOIS do código do país.
      --
      -- Tirar o 55 por casamento de prefixo é armadilha: DDD 55 existe
      -- (Santa Maria e região, no Rio Grande do Sul). Em `55999998888`,
      -- que é um número local sem código de país, o "55" da frente é o
      -- DDD — e removê-lo produziria a chave de outra pessoa.
      --
      -- O comprimento desfaz a ambiguidade sem chutar:
      --   10 ou 11 dígitos → local, o DDD já está na frente
      --   12 ou 13 dígitos → tem o 55 do país na frente
      substr(
        case
          when length(regexp_replace(p_tel, '\D', '', 'g')) in (12, 13)
           and regexp_replace(p_tel, '\D', '', 'g') like '55%'
            then substr(regexp_replace(p_tel, '\D', '', 'g'), 3)
          else regexp_replace(p_tel, '\D', '', 'g')
        end,
        1, 2
      )
      || right(regexp_replace(p_tel, '\D', '', 'g'), 8)
  end
$$;

-- Confira depois de rodar. As três primeiras linhas têm de dar a MESMA
-- chave, e a quarta e a quinta também — são o mesmo celular escrito de
-- formas diferentes. A do DDD 55 é a que pega o erro clássico.
--
--   select tel, public.fn_tel_chave(tel) from (values
--     ('5541999998888'), ('554199998888'), ('(41) 99999-8888'),
--     ('5555999998888'), ('55999998888')
--   ) t(tel);
--
-- Esperado: 4199998888, 4199998888, 4199998888, 5599998888, 5599998888

comment on function public.fn_tel_chave(text) is
  'DDD + últimos 8 dígitos. Iguala o mesmo celular com e sem o nono dígito.';

-- ---------------------------------------------------------------------
-- Colunas novas em leads
-- ---------------------------------------------------------------------

alter table public.leads
  add column if not exists telefone_chave text
    generated always as (public.fn_tel_chave(telefone)) stored;

-- O código `(ref: …)` que viaja na mensagem pré-escrita dos botões do
-- site. Diz por qual porta a pessoa entrou.
alter table public.leads
  add column if not exists wa_ref text;

-- O que o WhatsApp entregou junto com a primeira mensagem, cru.
--
-- Quando alguém chega por um anúncio de clique-para-WhatsApp, a primeira
-- mensagem costuma vir com o contexto do anúncio anexado. O formato
-- exato depende da versão da Evolution e não está documentado de forma
-- confiável — então guardamos o objeto inteiro, sem interpretar.
--
-- Isto é seguro de fazer e caro de não fazer: quando a integração com a
-- Meta for construída, ou já teremos os payloads reais da campanha, ou
-- teremos de rodar outra campanha só para descobrir o formato. Dado de
-- campanha não se coleta retroativamente.
alter table public.leads
  add column if not exists contato_payload jsonb;

alter table public.leads
  add column if not exists primeiro_contato_em timestamptz;

-- ---------------------------------------------------------------------
-- A trava contra duplicidade
-- ---------------------------------------------------------------------
-- A função abaixo procura antes de inserir, mas duas mensagens que
-- chegam no mesmo instante passariam pela busca antes de qualquer uma
-- inserir. Só o índice único resolve isso de verdade.
--
-- SE ESTE COMANDO FALHAR com "could not create unique index", já existem
-- leads repetidos. Rode para ver quais:
--
--   select tenant_id, public.fn_tel_chave(telefone) as chave,
--          count(*), array_agg(nome)
--   from public.leads where telefone is not null
--   group by 1,2 having count(*) > 1;
--
-- e junte-os à mão antes de repetir. Deixar duplicado é pior do que o
-- trabalho de juntar: cada duplicata vira um lead a mais no denominador
-- do CAC.

create unique index if not exists leads_tenant_telefone_uidx
  on public.leads (tenant_id, telefone_chave)
  where telefone_chave is not null;

-- ---------------------------------------------------------------------
-- Achar ou criar
-- ---------------------------------------------------------------------
--
-- Devolve o lead e diz se ele nasceu agora. O `criado` importa: é o que
-- permite responder "quantas pessoas o anúncio trouxe" sem contar de
-- novo quem já estava no quadro.
--
-- REGRA DE OURO: em lead que já existe, esta função não sobrescreve
-- NADA que uma pessoa tenha digitado. Nome, valor estimado e etapa
-- ficam como estão. Se o consultor moveu o card para "Proposta" e a
-- pessoa manda outra mensagem, o card não volta para "Novo" — voltar
-- seria apagar trabalho, e o sistema perderia a confiança de quem usa.
--
-- O único campo que ele completa é o que estava vazio: e-mail, ref e
-- payload do primeiro contato.

create or replace function public.fn_lead_do_whatsapp(
  p_tenant_id uuid,
  p_telefone  text,
  p_nome      text default null,
  p_wa_ref    text default null,
  p_origem    public.origem_lead default 'anuncio',
  p_payload   jsonb default null
)
returns table (lead_id uuid, criado boolean, etapa_atual text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_chave text := public.fn_tel_chave(p_telefone);
  v_id    uuid;
  v_etapa text;
  v_nome  text;
  v_etapa_id uuid;
begin
  if v_chave is null then
    raise exception 'Telefone inválido: %', p_telefone using errcode = '22023';
  end if;

  select l.id, l.etapa::text into v_id, v_etapa
  from public.leads l
  where l.tenant_id = p_tenant_id and l.telefone_chave = v_chave
  limit 1;

  if found then
    -- Completa buracos, preserva o que já foi decidido.
    update public.leads
       set wa_ref          = coalesce(wa_ref, p_wa_ref),
           contato_payload = coalesce(contato_payload, p_payload),
           primeiro_contato_em = coalesce(primeiro_contato_em, now())
     where id = v_id;

    lead_id := v_id; criado := false; etapa_atual := v_etapa;
    return next;
    return;
  end if;

  -- O WhatsApp nem sempre manda o nome do perfil, e a tabela exige pelo
  -- menos dois caracteres. Sem apelido, o próprio número serve: é
  -- identificação suficiente para o consultor abrir a conversa, e é
  -- honesto — não inventa "Cliente WhatsApp" como se fosse um nome.
  v_nome := nullif(btrim(coalesce(p_nome, '')), '');
  if v_nome is null or length(v_nome) < 2 then
    v_nome := 'WhatsApp ' || right(regexp_replace(p_telefone, '\D', '', 'g'), 8);
  end if;

  -- Garante que o funil da empresa existe antes de pendurar o lead nele.
  perform public.fn_semear_funil(p_tenant_id);

  select fe.id into v_etapa_id
  from public.funil_etapas fe
  where fe.tenant_id = p_tenant_id and fe.canonica = 'novo' and fe.ativa
  order by fe.ordem
  limit 1;

  insert into public.leads (
    tenant_id, nome, telefone, origem, origem_detalhe,
    wa_ref, contato_payload, primeiro_contato_em, etapa_id
  )
  values (
    p_tenant_id, left(v_nome, 160), p_telefone, p_origem,
    case when p_wa_ref is null then 'WhatsApp' else 'WhatsApp · ' || p_wa_ref end,
    p_wa_ref, p_payload, now(), v_etapa_id
  )
  returning id into v_id;

  lead_id := v_id; criado := true; etapa_atual := 'novo';
  return next;
end;
$fn$;

revoke all on function public.fn_lead_do_whatsapp(uuid, text, text, text, public.origem_lead, jsonb) from anon, authenticated;

-- A API fala pelo `service_role`. Sem o grant explícito ele ficaria de
-- fora junto com o cliente, porque dependia da permissão do `public`.
grant execute on function public.fn_lead_do_whatsapp(uuid, text, text, text, public.origem_lead, jsonb) to service_role;

comment on function public.fn_lead_do_whatsapp is
  'Acha ou cria o lead pelo telefone. Nunca sobrescreve etapa nem nome já existentes.';

-- ---------------------------------------------------------------------
-- O que a Meta vai precisar receber de volta
-- ---------------------------------------------------------------------
--
-- Ainda não envia nada — a integração depende da aprovação do app na
-- Meta. Esta view prepara o conteúdo para que, no dia em que o canal
-- abrir, não seja preciso decidir nada às pressas.
--
-- Um evento por lead, no momento em que ele foi qualificado ou fechado.
-- O telefone sai daqui em texto puro, e a API é quem aplica o SHA-256
-- antes de qualquer envio: hash é irreversível, e guardar a versão
-- hasheada no banco impediria corrigir um número digitado errado.
--
-- LEIA A OBSERVAÇÃO DE PRIVACIDADE NO FIM DESTE ARQUIVO ANTES DE USAR.

drop view if exists public.vw_eventos_meta;
create view public.vw_eventos_meta
with (security_invoker = on) as
select
  l.tenant_id,
  l.id                as lead_id,
  case
    when l.etapa = 'ganho' then 'Purchase'
    when l.etapa in ('proposta', 'qualificado', 'reuniao') then 'Lead'
  end                 as event_name,
  coalesce(l.fechado_em, l.updated_at) as event_time,
  l.telefone,
  l.email,
  l.valor_estimado    as value,
  'BRL'               as currency,
  l.wa_ref,
  l.utm_campaign,
  l.contato_payload
from public.leads l
where l.origem = 'anuncio'
  and l.etapa in ('reuniao', 'qualificado', 'proposta', 'ganho');

comment on view public.vw_eventos_meta is
  'Eventos de conversão prontos para a Meta. Nada é enviado ainda.';

notify pgrst, 'reload schema';

-- =====================================================================
-- PRIVACIDADE — LEIA ANTES DE LIGAR A ETAPA 3
-- =====================================================================
--
-- A página de privacidade do site diz hoje, em letras claras:
--
--   "As informações que você compartilhar são usadas apenas para gerar
--    o seu diagnóstico. Não são vendidas, cedidas nem comentadas com
--    terceiros."
--
-- Mandar telefone — mesmo hasheado — para a Meta é ceder dado pessoal a
-- um terceiro, para uma finalidade diferente daquela. Hash não resolve:
-- a LGPD trata dado hasheado como pessoal justamente porque ele serve
-- para reencontrar a pessoa, que é exatamente o uso pretendido aqui.
--
-- Então a etapa 3 exige, ANTES de enviar o primeiro evento:
--   1. a política de privacidade dizendo que dados de contato podem ser
--      compartilhados com plataformas de publicidade para medição;
--   2. o aviso no ponto da coleta, não só na página de privacidade.
--
-- Não é burocracia. É a mesma promessa que faz a empresa entregar o
-- faturamento dela no formulário. Quebrá-la em silêncio custa mais do
-- que qualquer campanha rende.
-- =====================================================================
