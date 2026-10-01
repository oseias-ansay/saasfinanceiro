-- =====================================================================
-- 56 · CONVERSA SOBRE O PLANO DE AÇÃO
-- =====================================================================
-- O cliente pergunta sobre o próprio PDCA e recebe resposta com os
-- números dele. Duas tabelas e um teto.
--
-- ---------------------------------------------------------------------
-- O CHAT NÃO ALTERA O PLANO. DECISÃO, NÃO LIMITAÇÃO.
-- ---------------------------------------------------------------------
-- Nada aqui concede escrita em `planos_acao` ou `acoes`. O plano é o que
-- foi ACORDADO na reunião — é a razão de o `17` ter um gatilho que
-- reverte qualquer campo que o cliente tente mudar fora do status.
--
-- Um chat que interpreta linguagem natural e escreve no plano erra de um
-- jeito específico e caro: "pode concluir a primeira" sobre uma lista
-- que o modelo ordenou de um jeito e a tela de outro. O cliente marca o
-- check na tela, onde vê exatamente o que está marcando.
--
-- Se um dia o chat escrever, não é com permissão nova para estas
-- tabelas: é com uma rota própria que confirma a ação antes, por id.
--
-- ---------------------------------------------------------------------
-- POR QUE GUARDAR A CONVERSA
-- ---------------------------------------------------------------------
-- Três razões, em ordem de peso:
--
--   1. O cliente fecha a aba e volta no dia seguinte. Sem histórico, o
--      chat esquece e ele reexplica.
--   2. A pergunta do cliente é diagnóstico. "Por que isso é
--      prioridade?" repetido por seis clientes diz que o plano está
--      sendo entregue sem o porquê — e isso se corrige na reunião, não
--      no chat.
--   3. Sem registro, não há como auditar o que o modelo respondeu sobre
--      o dinheiro de alguém.
--
-- ---------------------------------------------------------------------
-- O TETO É POR EMPRESA, E É DIFERENTE DO TETO DOS DIAGNÓSTICOS
-- ---------------------------------------------------------------------
-- `IA_LIMITE_DIARIO` é um disjuntor global: protege a fatura contra um
-- defeito nosso. Ele não serve aqui sozinho, porque um único cliente
-- conversando sem parar consumiria o teto do dia e o próximo prospect
-- que preenchesse o formulário seria recusado.
--
-- Então o chat tem dois limites em série: o global (que ele respeita
-- junto com todo o resto) e este, por empresa, que impede uma conversa
-- de comer o orçamento das outras.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A CONVERSA
-- ---------------------------------------------------------------------
-- Uma por empresa POR PLANO. Amarrar ao plano, e não só ao tenant, tem
-- uma consequência boa: quando o ciclo encerra e um plano novo começa, a
-- conversa começa limpa. Histórico de PDCA antigo no contexto de um
-- plano novo é a receita de resposta confiante sobre ação que já não
-- existe.

create table if not exists public.pdca_conversas (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  plano_id   uuid not null references public.planos_acao(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Última mensagem, de qualquer lado. Ordena a lista do consultor por
  -- quem está conversando, que é informação de adoção.
  ultima_em  timestamptz not null default now(),

  unique (tenant_id, plano_id)
);

create index if not exists pdca_conversas_tenant_idx
  on public.pdca_conversas (tenant_id, ultima_em desc);

-- ---------------------------------------------------------------------
-- 2. AS MENSAGENS
-- ---------------------------------------------------------------------
-- `tenant_id` repetido aqui, embora derive da conversa. É redundância
-- deliberada: a policy de RLS fica sobre a coluna da própria linha, sem
-- subconsulta à conversa. Uma policy que precisa de join é uma policy
-- que um dia alguém reescreve errado.

create table if not exists public.pdca_mensagens (
  id         bigserial primary key,
  conversa_id uuid not null references public.pdca_conversas(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  papel      text not null check (papel in ('cliente', 'assistente')),
  texto      text not null check (length(btrim(texto)) between 1 and 20000),

  -- Consumo da chamada que produziu esta resposta. Nulo nas mensagens do
  -- cliente. Serve para responder "quanto custou o chat este mês?" sem
  -- depender da fatura.
  tokens_entrada int,
  tokens_saida   int,
  -- Quantos tokens vieram do cache. Se esta coluna ficar sempre em zero,
  -- o cache de prompt não está funcionando e o chat custa 10x mais.
  tokens_cache   int,

  em         timestamptz not null default now()
);

create index if not exists pdca_mensagens_conversa_idx
  on public.pdca_mensagens (conversa_id, em);

create index if not exists pdca_mensagens_tenant_dia_idx
  on public.pdca_mensagens (tenant_id, em desc) where papel = 'cliente';

-- Mantém `ultima_em` sem a aplicação precisar lembrar.
create or replace function public.tg_pdca_toca_conversa()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update public.pdca_conversas set ultima_em = new.em where id = new.conversa_id;
  return new;
end $$;

drop trigger if exists pdca_toca_conversa on public.pdca_mensagens;
create trigger pdca_toca_conversa after insert on public.pdca_mensagens
  for each row execute function public.tg_pdca_toca_conversa();

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
-- Leitura: quem é da empresa, mais o staff. Escrita: ninguém pelo
-- cliente do usuário.
--
-- Essa última parte é o ponto. A mensagem do cliente só é gravada DEPOIS
-- de a rota ter aceito a pergunta, e a resposta do assistente só depois
-- de o modelo ter respondido. Se o front pudesse inserir direto, daria
-- para fabricar uma mensagem de "assistente" dizendo qualquer coisa —
-- e o histórico fabricado voltaria como contexto na pergunta seguinte.
--
-- Quem grava é a API, com `supabaseAdmin`, depois de resolver o tenant
-- pelo JWT. É o mesmo motivo de `acao_eventos` só aceitar escrita do
-- gatilho.

alter table public.pdca_conversas  enable row level security;
alter table public.pdca_mensagens  enable row level security;

drop policy if exists pdca_conversas_select on public.pdca_conversas;
create policy pdca_conversas_select on public.pdca_conversas
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

drop policy if exists pdca_mensagens_select on public.pdca_mensagens;
create policy pdca_mensagens_select on public.pdca_mensagens
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

grant select on public.pdca_conversas to authenticated;
grant select on public.pdca_mensagens to authenticated;

-- Sem insert, update ou delete para `authenticated`. De propósito.

-- ---------------------------------------------------------------------
-- 4. O TETO POR EMPRESA
-- ---------------------------------------------------------------------
-- Conta as perguntas do cliente nas últimas 24 horas, não no dia
-- civil. Janela móvel porque o teto diário civil tem um defeito
-- conhecido: quem bate o limite às 23h recupera tudo uma hora depois, e
-- quem bate às 9h espera quinze.
--
-- Devolve objeto, e não booleano, para a tela poder dizer quantas restam
-- em vez de só "não". Recusa sem número vira reclamação.

create or replace function public.fn_pdca_cabe(
  p_tenant_id uuid,
  p_limite    int
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'usadas', c.n,
    'limite', p_limite,
    'permitido', c.n < p_limite
  )
  from (
    select count(*)::int as n
      from public.pdca_mensagens m
     where m.tenant_id = p_tenant_id
       and m.papel = 'cliente'
       and m.em > now() - interval '24 hours'
  ) c
$fn$;

comment on function public.fn_pdca_cabe(uuid, int) is
  'Quantas perguntas esta empresa fez ao chat do PDCA nas últimas 24 horas '
  'e se cabe mais uma. Janela móvel, não dia civil.';

revoke all on function public.fn_pdca_cabe(uuid, int) from public;
grant execute on function public.fn_pdca_cabe(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. O QUE O CONSULTOR VÊ
-- ---------------------------------------------------------------------
-- A pergunta que o cliente faz ao chat é diagnóstico da entrega. Esta
-- view existe para essa leitura, e só mostra contagem e data — o texto
-- das mensagens está nas tabelas, com o mesmo RLS.

create or replace view public.vw_pdca_chat_uso
with (security_invoker = on) as
select
  c.tenant_id,
  t.name                                                    as empresa,
  c.plano_id,
  p.titulo                                                  as plano,
  c.created_at                                              as iniciada_em,
  c.ultima_em,
  count(m.id) filter (where m.papel = 'cliente')            as perguntas,
  coalesce(sum(m.tokens_entrada), 0)::bigint                as tokens_entrada,
  coalesce(sum(m.tokens_saida), 0)::bigint                  as tokens_saida,
  coalesce(sum(m.tokens_cache), 0)::bigint                  as tokens_cache
from public.pdca_conversas c
join public.tenants t      on t.id = c.tenant_id
join public.planos_acao p  on p.id = c.plano_id
left join public.pdca_mensagens m on m.conversa_id = c.id
group by c.tenant_id, t.name, c.plano_id, p.titulo, c.created_at, c.ultima_em;

comment on view public.vw_pdca_chat_uso is
  'Uso do chat do PDCA por empresa. A coluna tokens_cache em zero significa '
  'que o cache de prompt parou de funcionar — o custo sobe cerca de 10x.';

grant select on public.vw_pdca_chat_uso to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- As duas tabelas e a view existem:
--
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('pdca_conversas','pdca_mensagens','vw_pdca_chat_uso');
--   -- esperado: 3 linhas
--
-- O teto responde (troque o uuid por uma empresa real):
--
--   select public.fn_pdca_cabe('<uuid do tenant>', 30);
--   -- esperado: {"usadas": 0, "limite": 30, "permitido": true}
--
-- E o cliente NÃO consegue inserir mensagem direto — logado como
-- cliente, não como service_role:
--
--   insert into public.pdca_mensagens (conversa_id, tenant_id, papel, texto)
--   values (gen_random_uuid(), '<uuid do tenant>', 'assistente', 'fabricada');
--   -- esperado: erro de permissão. Se gravar, a policy está errada.
