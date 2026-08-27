-- =====================================================================
-- 29 — ANOTAÇÕES DO LEAD
-- =====================================================================
-- O que foi negociado, em anotações datadas.
--
-- ---------------------------------------------------------------------
-- POR QUE NÃO BASTA O CAMPO `observacao`
-- ---------------------------------------------------------------------
-- `leads.observacao` é um texto só. Serve para uma nota de cadastro —
-- "veio pelo Instagram, pediu para ligar à tarde" — e falha para o que
-- o cliente pediu: acompanhar uma negociação.
--
-- Negociação acontece em episódios. "Pediu desconto de 10%" em 3 de
-- agosto e "aceitou parcelar em 3x" em 12 de agosto são dois fatos, com
-- datas, e a distância entre eles é informação. Num campo único, o
-- segundo apaga o primeiro ou vira um parágrafo que ninguém relê.
--
-- ---------------------------------------------------------------------
-- A FRONTEIRA, DE NOVO
-- ---------------------------------------------------------------------
-- Isto é anotação, não tarefa. Não tem responsável, não tem prazo, não
-- tem lembrete, não tem status. Cada um desses campos é razoável
-- isolado, e juntos transformam o módulo no CRM genérico que já existe
-- maduro em dez concorrentes.
--
-- Se o cliente precisar de tarefa com prazo e cobrança, isso já existe
-- na plataforma: é o plano de ação do PDCA, que tem responsável, prazo
-- e acompanhamento do consultor.
-- =====================================================================

create table if not exists public.lead_notas (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id)   on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  texto      text not null check (length(btrim(texto)) between 2 and 4000),

  -- O nome de quem escreveu, resolvido na hora e guardado como texto.
  -- Não é desnormalização por descuido: a anotação é registro histórico,
  -- e precisa continuar legível depois de a pessoa sair da empresa e o
  -- perfil dela ser removido.
  autor_nome text,
  autor_id   uuid references auth.users(id) on delete set null,

  em         timestamptz not null default now()
);

create index if not exists lead_notas_lead_idx on public.lead_notas (lead_id, em desc);

comment on table public.lead_notas is
  'O que foi negociado, em episódios datados. Anotação, não tarefa: quem '
  'precisa de responsável e prazo tem o plano de ação do PDCA.';

alter table public.lead_notas enable row level security;

drop policy if exists lead_notas_select on public.lead_notas;
create policy lead_notas_select on public.lead_notas
  for select using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.is_tenant_member(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

drop policy if exists lead_notas_insert on public.lead_notas;
create policy lead_notas_insert on public.lead_notas
  for insert with check (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.can_write_tenant(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

-- Anotação não se edita nem se apaga pela aplicação.
--
-- É registro do que aconteceu numa negociação, e negociação vira
-- conversa difícil com alguma frequência — "eu nunca disse isso" é
-- exatamente o momento em que o histórico precisa ser confiável. Erro
-- de digitação se corrige com uma anotação nova.
--
-- Quem precisar apagar de verdade (pedido de exclusão de dados, LGPD)
-- usa service_role, que ignora RLS, e fica registrado no lugar próprio.

-- ---------------------------------------------------------------------
-- O RESUMO PARA O PAINEL
-- ---------------------------------------------------------------------
-- Quantas anotações e quando foi a última. Vai no card do quadro: um
-- lead sem anotação há três semanas, parado na proposta, é uma
-- negociação esfriando — e isso aparece antes de virar perda.

create or replace view public.vw_leads_notas_resumo
with (security_invoker = on) as
select
  l.id as lead_id,
  l.tenant_id,
  count(n.id)      as qtd_notas,
  max(n.em)        as ultima_nota_em
from public.leads l
left join public.lead_notas n on n.lead_id = l.id
group by l.id, l.tenant_id;

grant select on public.vw_leads_notas_resumo to authenticated;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select to_regclass('public.lead_notas') as tabela;
--
-- Depois:  notify pgrst, 'reload schema';
