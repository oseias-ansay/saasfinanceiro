-- =====================================================================
-- 32 — O histórico das conversas de WhatsApp
-- =====================================================================
--
-- Guarda o que foi dito com cada lead, para a negociação sobreviver à
-- troca de quem atende.
--
-- ---------------------------------------------------------------------
-- ISTO NÃO PROTEGE CONTRA O BANIMENTO DO NÚMERO
-- ---------------------------------------------------------------------
-- Vale registrar, porque foi o motivo que originou o pedido. Se a
-- instância não oficial for derrubada, este histórico continua aqui —
-- mas o canal morreu, e os leads em negociação ficam sem resposta.
-- Histórico salvo é consolo, não mitigação. A mitigação do banimento é
-- outra: número dedicado, volume controlado e, quando o cliente escala,
-- a API oficial.
--
-- O que este arquivo resolve de verdade é a continuidade: o consultor
-- que assume a carteira lê o que foi combinado sem depender do celular
-- de quem atendeu antes.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA NO PRODUTO AO GUARDAR ISTO
-- ---------------------------------------------------------------------
-- Até aqui o sistema guardava números de empresa: dado do próprio
-- cliente, sobre o próprio cliente. A partir daqui ele guarda conversas
-- dos CLIENTES DOS CLIENTES — onde aparece CPF, endereço, reclamação e,
-- de vez em quando, assunto que ninguém pediu para receber.
--
-- Três decisões nascem disso, e estão implementadas abaixo:
--
--   1. Prazo. Cento e oitenta dias, apagando sozinho. Política que
--      depende de alguém lembrar de limpar não é política.
--   2. Sem mídia. Guarda que houve um áudio, não o áudio. É onde mora o
--      pior risco — foto de documento, comprovante bancário — e o que
--      menos ajuda a negociação.
--   3. Só quem está no funil. Fornecedor, conhecido e engano não entram.
--
-- Nenhuma das três é implementação: são a diferença entre um recurso
-- vendável e um passivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roteamento: de qual empresa é esta instância
-- ---------------------------------------------------------------------
--
-- Hoje existe uma instância só, a da Business Triage, e o id da empresa
-- está fixo no nó do n8n. Isso não sobrevive ao segundo cliente.
--
-- Esta tabela é o que permite um fluxo só atender a rede inteira: a
-- Evolution manda o nome da instância em todo evento, e ele diz de quem
-- é a conversa. Sem isto, cada cliente novo exigiria duplicar o fluxo —
-- e dez cópias do mesmo fluxo divergem em semanas.

create table if not exists public.whatsapp_instancias (
  instancia   text primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  -- Só para você saber qual número é qual ao olhar a lista.
  rotulo      text,
  numero      text,

  -- Desligar sem apagar: cliente que sai, ou instância trocada.
  ativa       boolean not null default true,

  -- Quanto tempo guardar as mensagens desta empresa. Fica por instância
  -- para um cliente com exigência diferente ser atendido sem mudar
  -- código — mas com padrão, porque quase ninguém vai querer escolher.
  retencao_dias int not null default 180
    check (retencao_dias between 7 and 1825),

  created_at  timestamptz not null default now()
);

create index if not exists whatsapp_instancias_tenant_idx
  on public.whatsapp_instancias (tenant_id);

alter table public.whatsapp_instancias enable row level security;

drop policy if exists whatsapp_instancias_leitura on public.whatsapp_instancias;
create policy whatsapp_instancias_leitura on public.whatsapp_instancias
  for select using (
    public.is_tenant_member(tenant_id) or public.is_platform_staff()
  );

drop policy if exists whatsapp_instancias_escrita on public.whatsapp_instancias;
create policy whatsapp_instancias_escrita on public.whatsapp_instancias
  for all using (public.is_platform_staff())
  with check (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- As mensagens
-- ---------------------------------------------------------------------

create table if not exists public.lead_mensagens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  -- Pendurada no lead, não no telefone. É o que garante que a conversa
  -- some junto quando o lead é apagado a pedido do titular — se ficasse
  -- solta pelo número, o direito de exclusão da LGPD não seria
  -- cumprido de fato, só na tabela que a gente lembrou de limpar.
  lead_id     uuid not null references public.leads(id) on delete cascade,

  -- Quem falou.
  de_mim      boolean not null,

  -- O texto. Nulo quando a mensagem não era texto.
  texto       text,

  -- O que veio quando não era texto: 'audio', 'imagem', 'documento',
  -- 'video', 'figurinha', 'localizacao', 'contato'.
  --
  -- O ARQUIVO NÃO É GUARDADO, de propósito. Guardar comprovante
  -- bancário e foto de documento que ninguém pediu é assumir o pior
  -- risco desta tabela em troca do que menos ajuda a negociação. O
  -- registro de que houve basta para o histórico fazer sentido.
  tipo_midia  text,
  midia_nome  text,

  -- Id da mensagem no WhatsApp. Serve para não gravar duas vezes quando
  -- a Evolution reentrega o mesmo evento — o que ela faz.
  wa_id       text,

  enviada_em  timestamptz not null,
  created_at  timestamptz not null default now(),

  constraint mensagem_tem_conteudo check (texto is not null or tipo_midia is not null)
);

-- Reentrega da Evolution não pode virar linha repetida.
create unique index if not exists lead_mensagens_wa_uidx
  on public.lead_mensagens (tenant_id, wa_id)
  where wa_id is not null;

create index if not exists lead_mensagens_lead_idx
  on public.lead_mensagens (lead_id, enviada_em desc);

-- Para o expurgo varrer por data sem ler a tabela inteira.
create index if not exists lead_mensagens_purga_idx
  on public.lead_mensagens (enviada_em);

alter table public.lead_mensagens enable row level security;

-- Leitura exige o recurso do CRM antes de qualquer coisa. É a mesma
-- disciplina de `leads`: sem o recurso, nem a política de participação
-- é avaliada.
drop policy if exists lead_mensagens_leitura on public.lead_mensagens;
create policy lead_mensagens_leitura on public.lead_mensagens
  for select using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.is_tenant_member(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

-- Ninguém escreve pela aplicação. Quem grava é a API, com a chave de
-- serviço, a partir do que o WhatsApp entregou.
--
-- E ninguém edita: o valor de um histórico de negociação é ser fiel ao
-- que foi dito. Um histórico editável não serve para resolver
-- divergência sobre o que foi combinado — que é justamente para o que
-- ele será usado.

-- ---------------------------------------------------------------------
-- Gravar
-- ---------------------------------------------------------------------
--
-- Devolve nulo quando não há lead para aquele telefone. Isso é a regra
-- de escopo: conversa de quem não está no funil não é guardada.

create or replace function public.fn_gravar_mensagem(
  p_instancia   text,
  p_telefone    text,
  p_de_mim      boolean,
  p_texto       text default null,
  p_tipo_midia  text default null,
  p_midia_nome  text default null,
  p_wa_id       text default null,
  p_enviada_em  timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tenant uuid;
  v_lead   uuid;
  v_id     uuid;
begin
  select i.tenant_id into v_tenant
  from public.whatsapp_instancias i
  where i.instancia = p_instancia and i.ativa;

  if v_tenant is null then
    return null;
  end if;

  if not public.fn_tenant_tem_recurso(v_tenant, 'crm') then
    return null;
  end if;

  select l.id into v_lead
  from public.leads l
  where l.tenant_id = v_tenant
    and l.telefone_chave = public.fn_tel_chave(p_telefone)
  limit 1;

  -- Sem lead, não guarda. Fornecedor, conhecido e engano ficam de fora.
  if v_lead is null then
    return null;
  end if;

  insert into public.lead_mensagens (
    tenant_id, lead_id, de_mim, texto, tipo_midia, midia_nome, wa_id, enviada_em
  )
  values (
    v_tenant, v_lead, p_de_mim,
    -- Corta mensagem gigante. Ninguém precisa de trinta mil caracteres
    -- para saber o que foi combinado, e texto sem limite é o caminho
    -- mais curto para uma tabela que cresce sem controle.
    left(nullif(btrim(coalesce(p_texto, '')), ''), 4000),
    p_tipo_midia, left(p_midia_nome, 200), p_wa_id, p_enviada_em
  )
  on conflict (tenant_id, wa_id) where wa_id is not null do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.fn_gravar_mensagem(text, text, boolean, text, text, text, text, timestamptz)
  from anon, authenticated;

-- A API fala pelo `service_role`. Sem o grant explícito ele ficaria de
-- fora junto com o cliente, porque dependia da permissão do `public`.
grant execute on function public.fn_gravar_mensagem(text, text, boolean, text, text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- O expurgo
-- ---------------------------------------------------------------------
--
-- Apaga o que passou do prazo de cada empresa. Chamado uma vez por dia.
--
-- Devolve quantas linhas apagou para o log ter o número — apagamento
-- silencioso é indistinguível de apagamento que não aconteceu, e este
-- é o mecanismo que sustenta a promessa feita no contrato.

create or replace function public.fn_purgar_mensagens()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_total integer := 0;
  v_n     integer;
  r       record;
begin
  for r in
    select i.tenant_id, max(i.retencao_dias) as dias
    from public.whatsapp_instancias i
    group by i.tenant_id
  loop
    delete from public.lead_mensagens m
     where m.tenant_id = r.tenant_id
       and m.enviada_em < now() - make_interval(days => r.dias);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  -- Mensagem de empresa cuja instância foi removida da tabela de
  -- roteamento. Sem esta varredura, ela ficaria para sempre — o cliente
  -- sai, a instância é apagada, e a conversa dele fica órfã e eterna.
  delete from public.lead_mensagens m
   where not exists (
     select 1 from public.whatsapp_instancias i where i.tenant_id = m.tenant_id
   )
   and m.enviada_em < now() - interval '180 days';
  get diagnostics v_n = row_count;

  return v_total + v_n;
end;
$fn$;

revoke all on function public.fn_purgar_mensagens() from anon, authenticated;

-- A API fala pelo `service_role`. Sem o grant explícito ele ficaria de
-- fora junto com o cliente, porque dependia da permissão do `public`.
grant execute on function public.fn_purgar_mensagens() to service_role;

-- ---------------------------------------------------------------------
-- A conversa, pronta para a tela
-- ---------------------------------------------------------------------

drop view if exists public.vw_lead_conversa;
create view public.vw_lead_conversa
with (security_invoker = on) as
select
  m.tenant_id,
  m.lead_id,
  m.id,
  m.de_mim,
  m.texto,
  m.tipo_midia,
  m.midia_nome,
  m.enviada_em
from public.lead_mensagens m
order by m.enviada_em;

notify pgrst, 'reload schema';

-- =====================================================================
-- DEPOIS DE RODAR — cadastre a instância
-- =====================================================================
--
--   insert into public.whatsapp_instancias (instancia, tenant_id, rotulo)
--   values ('wa_ultimo', 'ID_DA_BUSINESS_TRIAGE', 'Business Triage');
--
-- O nome da instância é o que a Evolution manda no campo `instance` de
-- todo evento. Confira num log antes de cadastrar: errar aqui faz o
-- roteamento devolver nulo e nada ser gravado, sem erro nenhum.
--
-- =====================================================================
-- ANTES DE OFERECER ISTO A UM CLIENTE
-- =====================================================================
--
-- Guardar conversa do cliente do seu cliente faz de você OPERADOR de
-- dado pessoal de terceiros, na linguagem da LGPD. O contrato de
-- prestação precisa dizer, no mínimo:
--
--   - que a plataforma armazena o histórico das conversas comerciais;
--   - por quanto tempo, e que o apagamento é automático;
--   - que o cliente é o controlador desses dados e responde pelo aviso
--     aos titulares dele;
--   - o que acontece com o histórico quando o contrato termina.
--
-- Isto não é formalidade jurídica: é o que separa um recurso que se
-- vende de um passivo que se herda.
-- =====================================================================
