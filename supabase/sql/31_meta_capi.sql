-- =====================================================================
-- 31 — A fila de eventos para a Meta
-- =====================================================================
--
-- Etapa 3: quando o lead é qualificado no quadro, a Meta precisa saber.
--
-- ---------------------------------------------------------------------
-- POR QUE UMA FILA, E NÃO UMA CHAMADA DIRETA
-- ---------------------------------------------------------------------
-- A especificação original dizia "webhook do CRM dispara o evento". Num
-- CRM de terceiro isso é obrigatório — não há outro jeito de saber o que
-- aconteceu lá dentro. Aqui o CRM é nosso, e sair pela rede e voltar
-- seria uma volta desnecessária.
--
-- Mas o motivo principal de não chamar a Meta na hora é outro: mover um
-- card é a ação mais repetida da tela, e ela não pode depender de um
-- servidor de terceiro estar de pé. Se a Meta estiver fora do ar, ou
-- lenta, o consultor veria o card travar ou voltar para a coluna
-- anterior. O trabalho dele perderia por causa de um sistema de
-- publicidade — troca inaceitável.
--
-- Então o movimento grava uma linha nesta fila, na mesma transação, e
-- termina. Quem conversa com a Meta é um processo separado, que pode
-- falhar, esperar e tentar de novo sem ninguém perceber.
--
-- ---------------------------------------------------------------------
-- O event_id É O QUE IMPEDE CONTAR DUAS VEZES
-- ---------------------------------------------------------------------
-- A especificação não mencionava isso, e é o defeito mais caro possível
-- nesta integração. Toda tentativa de reenvio — timeout que na verdade
-- funcionou, processo reiniciado no meio, alguém rodando a fila à mão —
-- mandaria o mesmo evento outra vez. A Meta contaria dois leads, o
-- algoritmo aprenderia com um número inflado, e a campanha seria
-- otimizada para uma realidade que não existe.
--
-- O `event_id` é gerado uma vez, aqui, e viaja em toda tentativa. A Meta
-- descarta repetidos por até 48 horas. É o que torna a fila segura para
-- tentar de novo sem medo.
-- =====================================================================

create table if not exists public.eventos_meta (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,

  -- 'Lead' na qualificação, 'Purchase' no fechamento.
  event_name  text not null check (event_name in ('Lead', 'Purchase')),

  -- Quando o fato aconteceu no mundo, não quando o envio ocorreu. A Meta
  -- usa isto para casar com o clique, e mandar a hora do envio jogaria o
  -- evento para depois da janela de atribuição em qualquer reprocessamento.
  event_time  timestamptz not null default now(),

  -- Gerado na criação e imutável. Ver o comentário no topo.
  event_id    text not null unique default gen_random_uuid()::text,

  -- Cópia dos dados no instante do evento. Deliberadamente uma cópia, e
  -- não um join com `leads`: se o telefone for corrigido depois, o
  -- reenvio precisa mandar o que foi enviado antes, senão a
  -- deduplicação da Meta não reconhece o par.
  telefone    text,
  email       text,
  ctwa_clid   text,
  valor       numeric(14,2),

  -- Controle de envio.
  enviado_em    timestamptz,
  tentativas    int not null default 0,
  ultimo_erro   text,
  resposta      jsonb,

  created_at  timestamptz not null default now()
);

create index if not exists eventos_meta_pendentes_idx
  on public.eventos_meta (created_at)
  where enviado_em is null;

create index if not exists eventos_meta_lead_idx
  on public.eventos_meta (lead_id, event_name);

-- Um evento de cada tipo por lead.
--
-- Sem isto, arrastar o card para "Proposta" e voltar para "Reunião" e
-- avançar de novo geraria três eventos de qualificação para a mesma
-- pessoa. Movimento de card é exploratório: gente arrasta para ver, e
-- desfaz. A Meta não pode aprender com hesitação de interface.
create unique index if not exists eventos_meta_unico_idx
  on public.eventos_meta (lead_id, event_name);

alter table public.eventos_meta enable row level security;

-- Ninguém lê pelo PostgREST. É fila de infraestrutura: quem escreve é o
-- gatilho, quem lê é a API com a chave de serviço. Sem política de
-- leitura, um token de cliente vazado não expõe a base de telefones.
drop policy if exists eventos_meta_staff on public.eventos_meta;
create policy eventos_meta_staff on public.eventos_meta
  for select using (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- O gatilho
-- ---------------------------------------------------------------------
--
-- Enfileira quando o lead ENTRA numa etapa que conta como qualificação
-- ou como fechamento. Só para leads de anúncio: mandar à Meta um lead
-- que veio de indicação ensinaria o algoritmo a procurar pessoas
-- parecidas com quem nunca viu o anúncio.

create or replace function public.tg_enfileirar_evento_meta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_nome text;
begin
  if new.origem <> 'anuncio' then
    return new;
  end if;

  -- Só na mudança de etapa. `update` de anotação ou de nome não é evento.
  if tg_op = 'UPDATE' and new.etapa is not distinct from old.etapa then
    return new;
  end if;

  v_nome := case
    when new.etapa = 'ganho' then 'Purchase'
    when new.etapa in ('reuniao', 'qualificado', 'proposta') then 'Lead'
  end;

  if v_nome is null then
    return new;
  end if;

  insert into public.eventos_meta (
    tenant_id, lead_id, event_name, event_time, telefone, email, ctwa_clid, valor
  )
  values (
    new.tenant_id, new.id, v_nome, now(), new.telefone, new.email,
    -- O identificador do clique, se ele existir no que o WhatsApp
    -- entregou. Procura em dois lugares porque o formato depende da
    -- versão — ver o comentário de `contato_payload` no arquivo 30.
    coalesce(
      new.contato_payload #>> '{ctwa_clid}',
      new.contato_payload #>> '{externalAdReply,ctwaClid}',
      new.contato_payload #>> '{conversionSource}'
    ),
    new.valor_estimado
  )
  on conflict (lead_id, event_name) do nothing;

  return new;
end;
$fn$;

drop trigger if exists tg_z_evento_meta on public.leads;

-- Nome começando com 'z' de propósito: gatilhos disparam em ordem
-- alfabética, e este precisa rodar DEPOIS do que resolve a etapa
-- canônica a partir da coluna (`tg_a_lead_canonica`). Antes dele,
-- `new.etapa` ainda teria o valor velho e o evento sairia errado.
create trigger tg_z_evento_meta
  after insert or update of etapa on public.leads
  for each row execute function public.tg_enfileirar_evento_meta();

-- ---------------------------------------------------------------------
-- Leitura e baixa da fila
-- ---------------------------------------------------------------------

create or replace function public.fn_eventos_meta_pendentes(p_limite int default 50)
returns setof public.eventos_meta
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
  from public.eventos_meta
  where enviado_em is null
    -- Desiste depois de cinco tentativas. Continuar para sempre esconde
    -- um defeito real atrás de uma fila que nunca esvazia — e o sintoma
    -- vira "a fila está grande", que ninguém investiga.
    and tentativas < 5
  order by created_at
  limit greatest(1, least(p_limite, 200))
$$;

create or replace function public.fn_evento_meta_baixa(
  p_id       uuid,
  p_sucesso  boolean,
  p_erro     text default null,
  p_resposta jsonb default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.eventos_meta
     set enviado_em  = case when p_sucesso then now() else null end,
         tentativas  = tentativas + 1,
         ultimo_erro = case when p_sucesso then null else p_erro end,
         resposta    = coalesce(p_resposta, resposta)
   where id = p_id
$$;

revoke all on function public.fn_eventos_meta_pendentes(int) from anon, authenticated;

-- A API fala pelo `service_role`. Sem o grant explícito ele ficaria de
-- fora junto com o cliente, porque dependia da permissão do `public`.
grant execute on function public.fn_eventos_meta_pendentes(int) to service_role;
revoke all on function public.fn_evento_meta_baixa(uuid, boolean, text, jsonb) from anon, authenticated;

-- A API fala pelo `service_role`. Sem o grant explícito ele ficaria de
-- fora junto com o cliente, porque dependia da permissão do `public`.
grant execute on function public.fn_evento_meta_baixa(uuid, boolean, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Para você olhar
-- ---------------------------------------------------------------------

drop view if exists public.vw_eventos_meta;
create view public.vw_eventos_meta
with (security_invoker = on) as
select
  e.tenant_id,
  e.event_name,
  count(*)                                            as total,
  count(*) filter (where e.enviado_em is not null)     as enviados,
  count(*) filter (where e.enviado_em is null and e.tentativas >= 5) as desistidos,
  count(*) filter (where e.enviado_em is null and e.tentativas < 5)  as na_fila,
  count(*) filter (where e.ctwa_clid is not null)      as com_clique,
  max(e.enviado_em)                                   as ultimo_envio
from public.eventos_meta e
group by e.tenant_id, e.event_name;

comment on view public.vw_eventos_meta is
  'Saúde da fila. `com_clique` é o número que decide se a atribuição funciona.';

notify pgrst, 'reload schema';

-- =====================================================================
-- DEPOIS DE RODAR, OLHE ISTO
-- =====================================================================
--
--   select * from public.vw_eventos_meta;
--
-- A coluna que importa é `com_clique`. Ela conta quantos eventos têm o
-- identificador do clique do anúncio.
--
-- Se ela ficar em zero depois da campanha rodar, a atribuição vai
-- depender só do telefone com hash, cuja taxa de casamento é bem menor.
-- Não é o fim — funciona — mas é a diferença entre a Meta saber
-- exatamente qual anúncio trouxe o cliente e ela ter de adivinhar.
-- =====================================================================
