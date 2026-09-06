-- =====================================================================
-- 33 — O registro dos eventos do WhatsApp
-- =====================================================================
--
-- Substitui a lista de execuções do n8n.
--
-- ---------------------------------------------------------------------
-- POR QUE ISTO PRECISA EXISTIR ANTES DE TIRAR O n8n DO CAMINHO
-- ---------------------------------------------------------------------
-- A lista de execuções do n8n era ruim de várias formas — fotografia
-- imutável, uma execução por vez, sem consulta — mas era o único lugar
-- onde dava para ver que um evento CHEGOU e não virou nada.
--
-- Tirar o n8n sem pôr nada no lugar trocaria um diagnóstico ruim por
-- nenhum. E o modo de falha desta integração é justamente o silencioso:
-- instância não cadastrada, telefone que é LID, empresa sem o recurso do
-- CRM. Nenhum deles gera erro. Todos terminam com "não aconteceu nada" —
-- que, sem este registro, é indistinguível de "não chegou nada".
--
-- ---------------------------------------------------------------------
-- O QUE NÃO ENTRA AQUI
-- ---------------------------------------------------------------------
-- O texto das mensagens. O arquivo 32 promete que só se guarda conversa
-- de quem está no funil; guardar o payload cru aqui anularia a promessa
-- por uma porta lateral.
--
-- O que a API grava é o resumo montado por `resumoDoEvento` — uma lista
-- do que ENTRA (remetente, tipo, instância, contexto de anúncio), nunca
-- uma lista do que sai. A diferença importa: com lista do que sai, um
-- campo novo da Evolution passaria a ser guardado sozinho, e um dia esse
-- campo seria o conteúdo de uma conversa.
--
-- É por isso que o prazo aqui é curto: trinta dias. Registro de
-- diagnóstico serve para achar o defeito da semana passada, não para
-- virar um segundo banco de dados de conversas.
-- =====================================================================

create table if not exists public.eventos_whatsapp (
  id          uuid primary key default gen_random_uuid(),

  -- O nome da instância como veio no evento, antes de qualquer
  -- resolução. É o campo que você vai olhar quando o roteamento falhar:
  -- instância digitada diferente da cadastrada é o erro mais provável.
  instancia   text,

  -- Nulo quando a instância não foi reconhecida — que é exatamente o
  -- caso mais interessante de investigar.
  tenant_id   uuid references public.tenants(id) on delete cascade,

  wa_id       text,

  -- O que a API decidiu, e por quê.
  motivo      text,
  responder   boolean,
  registrar   boolean,
  guardar     boolean,

  -- O que de fato aconteceu depois da decisão: lead criado ou
  -- encontrado, mensagem gravada ou não, resposta enviada ou não.
  --
  -- Separado da decisão de propósito. "Decidi registrar" e "consegui
  -- registrar" são coisas diferentes, e todo defeito desta integração
  -- vive na distância entre as duas.
  resultado   jsonb,

  -- Preenchido quando algum passo falhou. O evento continua gravado:
  -- falha que não deixa rastro é a que volta.
  erro        text,

  -- O resumo do evento, sem conteúdo de conversa. Ver o cabeçalho.
  resumo      jsonb,

  recebido_em timestamptz not null default now()
);

create index if not exists eventos_whatsapp_recente_idx
  on public.eventos_whatsapp (recebido_em desc);

-- Para achar "os que não viraram nada" sem varrer a tabela — a consulta
-- que você vai fazer toda vez que alguém disser "mandei e não apareceu".
create index if not exists eventos_whatsapp_sem_lead_idx
  on public.eventos_whatsapp (recebido_em desc)
  where tenant_id is null or erro is not null;

alter table public.eventos_whatsapp enable row level security;

-- Só a equipe da plataforma lê. É registro de infraestrutura, não dado
-- do cliente, e um token vazado não deve expor a lista de quem escreveu
-- para quem.
drop policy if exists eventos_whatsapp_staff on public.eventos_whatsapp;
create policy eventos_whatsapp_staff on public.eventos_whatsapp
  for select using (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- Gravar
-- ---------------------------------------------------------------------
--
-- Nunca lança. Esta função está no caminho do atendimento, e um registro
-- de diagnóstico que derruba o atendimento é pior do que não existir —
-- foi exatamente esse erro, com outro nome, que fez a resposta da
-- Evolution abortar a execução inteira no n8n.

create or replace function public.fn_registrar_evento_whatsapp(
  p_instancia text,
  p_tenant_id uuid default null,
  p_wa_id     text default null,
  p_motivo    text default null,
  p_responder boolean default null,
  p_registrar boolean default null,
  p_guardar   boolean default null,
  p_resultado jsonb default null,
  p_erro      text default null,
  p_resumo    jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
begin
  insert into public.eventos_whatsapp (
    instancia, tenant_id, wa_id, motivo,
    responder, registrar, guardar, resultado, erro, resumo
  )
  values (
    left(p_instancia, 80), p_tenant_id, left(p_wa_id, 120), left(p_motivo, 200),
    p_responder, p_registrar, p_guardar, p_resultado, left(p_erro, 2000), p_resumo
  )
  returning id into v_id;

  return v_id;
exception when others then
  -- Engole de propósito. Ver o comentário acima.
  return null;
end;
$fn$;

revoke all on function public.fn_registrar_evento_whatsapp(
  text, uuid, text, text, boolean, boolean, boolean, jsonb, text, jsonb
) from anon, authenticated;

-- A API fala pelo `service_role`. Sem o grant explícito ele ficaria de
-- fora junto com o cliente, porque dependia da permissão do `public`.
grant execute on function public.fn_registrar_evento_whatsapp(
  text, uuid, text, text, boolean, boolean, boolean, jsonb, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------
-- O expurgo
-- ---------------------------------------------------------------------
--
-- Trinta dias, apagando sozinho. Política que depende de alguém lembrar
-- de limpar não é política.

create or replace function public.fn_purgar_eventos_whatsapp()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
begin
  delete from public.eventos_whatsapp
   where recebido_em < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.fn_purgar_eventos_whatsapp() from anon, authenticated;
grant execute on function public.fn_purgar_eventos_whatsapp() to service_role;

-- ---------------------------------------------------------------------
-- Para você olhar
-- ---------------------------------------------------------------------

drop view if exists public.vw_eventos_whatsapp;
create view public.vw_eventos_whatsapp
with (security_invoker = on) as
select
  e.recebido_em,
  e.instancia,
  e.tenant_id,
  case
    when e.tenant_id is null then 'instância não reconhecida'
    when e.erro is not null   then 'falhou'
    when e.registrar and (e.resultado #>> '{lead_id}') is null then 'devia registrar e não registrou'
    when e.guardar   and (e.resultado #>> '{mensagem_id}') is null then 'devia guardar e não guardou'
    when e.responder and (e.resultado #>> '{respondido}') <> 'true' then 'devia responder e não respondeu'
    else 'ok'
  end as veredito,
  e.motivo,
  e.responder,
  e.registrar,
  e.guardar,
  e.resultado,
  e.erro,
  e.wa_id
from public.eventos_whatsapp e
order by e.recebido_em desc;

comment on view public.vw_eventos_whatsapp is
  'O que chegou pelo WhatsApp e o que virou. A coluna `veredito` compara a decisão com o resultado — é onde a falha silenciosa aparece.';

notify pgrst, 'reload schema';

-- =====================================================================
-- DEPOIS DE RODAR, OLHE ISTO
-- =====================================================================
--
--   select veredito, count(*)
--   from public.vw_eventos_whatsapp
--   where recebido_em > now() - interval '1 day'
--   group by veredito;
--
-- Tudo em 'ok' é o esperado. Qualquer outra linha é um evento que chegou
-- e não virou o que devia — e agora dá para ver qual, em vez de abrir
-- execução por execução.
-- =====================================================================
