-- =====================================================================
-- 58 · PLANO DE AÇÃO AUTOMÁTICO
-- =====================================================================
-- Uma coluna de origem e um ajuste no gatilho de proteção. Com isso o
-- Básico passa a entregar plano de ação e chat sem reunião, e o
-- Intermediário continua sendo o plano conduzido por gente.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA NO PRODUTO
-- ---------------------------------------------------------------------
-- O diagnóstico mensal já produz um plano — `planoDeAcao`, com prioridade,
-- pilar e ação recomendada. Hoje ele vira PDF e morre ali. Daqui em
-- diante vira `acoes`, e o cliente ganha quadro, card de pendências e
-- chat sem ninguém conduzir.
--
-- O que ele NÃO ganha é a reunião: o cruzamento entre áreas, a Matriz GUT
-- feita por quem conhece o negócio, e o compromisso assumido na frente de
-- outra pessoa. Isso continua sendo o Intermediário — e é exatamente
-- isso que se vende no upgrade.
--
-- ---------------------------------------------------------------------
-- POR QUE A COLUNA `origem` É NECESSÁRIA
-- ---------------------------------------------------------------------
-- Porque as duas espécies de plano precisam de regras diferentes de
-- edição, e sem um marcador no banco a regra teria que ser inferida — por
-- `criado_por` nulo, por exemplo. Inferência é o tipo de coisa que
-- funciona até o dia em que alguém cria um plano por script.
--
-- ---------------------------------------------------------------------
-- A REGRA DE EDIÇÃO, E POR QUE ELA MUDA
-- ---------------------------------------------------------------------
-- O gatilho do SQL 17 reverte qualquer alteração do cliente que não seja
-- o status. A razão era boa: o plano é um compromisso acordado, e deixar
-- o cliente reescrever prazo transformaria acordo em lista de desejos.
--
-- Num plano automático não houve acordo. Prazo e responsável foram
-- derivados de uma prioridade por uma máquina. Mantê-los fixos produziria
-- um quadro cheio de ações atrasadas em datas que ninguém combinou — e
-- quadro sempre vermelho é quadro que se aprende a ignorar.
--
-- Então: no plano automático, o cliente ajusta PRAZO e RESPONSÁVEL.
-- O título, o detalhe, o pilar e a causa-raiz continuam fixos, porque
-- são a rastreabilidade até o gargalo que originou a ação. Sem eles, o
-- chat responderia sobre uma ação que já não é a que o diagnóstico
-- recomendou.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DE ONDE VEIO O PLANO
-- ---------------------------------------------------------------------
do $$ begin
  create type public.plano_origem as enum ('consultor', 'automatico');
exception when duplicate_object then null; end $$;

alter table public.planos_acao
  add column if not exists origem public.plano_origem not null default 'consultor';

comment on column public.planos_acao.origem is
  'consultor = prescrito em reunião, campos fixos para o cliente. '
  'automatico = derivado do diagnóstico mensal; o cliente ajusta prazo e '
  'responsável, porque não houve acordo sobre eles.';

-- A competência que originou o plano automático. Permite reabrir o
-- diagnóstico de onde a ação saiu, e evita gerar duas vezes o mesmo mês.
--
-- É a COMPETÊNCIA, e não um id: `diagnosticos_mensais` tem chave
-- composta `(tenant_id, competencia)` e nenhuma coluna `id`. A chave
-- estrangeira abaixo é composta pela mesma razão — e, como `tenant_id`
-- já existe nas duas tabelas, ela também garante de graça que o plano e
-- o diagnóstico são da mesma empresa.
alter table public.planos_acao
  add column if not exists diagnostico_competencia date;

alter table public.planos_acao
  drop constraint if exists planos_acao_diagnostico_mensal_fkey;

alter table public.planos_acao
  add constraint planos_acao_diagnostico_mensal_fkey
  foreign key (tenant_id, diagnostico_competencia)
  references public.diagnosticos_mensais (tenant_id, competencia)
  on delete set null;

create index if not exists planos_acao_diag_mensal_idx
  on public.planos_acao (tenant_id, diagnostico_competencia)
  where diagnostico_competencia is not null;

-- ---------------------------------------------------------------------
-- 2. O GATILHO PASSA A OLHAR A ORIGEM
-- ---------------------------------------------------------------------
-- Substitui a função do SQL 17. O corpo é o mesmo, com uma bifurcação.

create or replace function public.tg_acao_protege_campos()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_origem public.plano_origem;
begin
  if public.is_platform_staff() then
    return new;
  end if;

  select p.origem into v_origem
    from public.planos_acao p
   where p.id = old.plano_id;

  -- Rastreabilidade até o gargalo: fixa nas duas origens. É o que liga a
  -- ação ao diagnóstico, e é o que o chat usa para explicar o porquê.
  new.titulo     := old.titulo;
  new.detalhe    := old.detalhe;
  new.causa_raiz := old.causa_raiz;
  new.pilar      := old.pilar;
  new.plano_id   := old.plano_id;
  new.tenant_id  := old.tenant_id;
  new.verificacao := old.verificacao;
  new.ganho_dias := old.ganho_dias;

  -- Prazo e responsável: fixos no plano do consultor, livres no
  -- automático. No automático eles foram derivados por máquina, e manter
  -- fixo um prazo que ninguém combinou enche o quadro de atraso falso.
  if v_origem is distinct from 'automatico' then
    new.responsavel_nome := old.responsavel_nome;
    new.prazo            := old.prazo;
    new.ordem            := old.ordem;
  end if;

  if new.status = 'concluida' and old.status <> 'concluida' then
    new.concluida_em  := now();
    new.concluida_por := auth.uid();
  elsif new.status <> 'concluida' then
    new.concluida_em  := null;
    new.concluida_por := null;
  end if;

  return new;
end $$;

-- O gatilho já existe desde o 17 e aponta para a função pelo nome; o
-- `create or replace` acima basta. Recriado mesmo assim, para o caso de
-- alguém ter removido o gatilho sem remover a função.
drop trigger if exists acao_protege_campos on public.acoes;
create trigger acao_protege_campos before update on public.acoes
  for each row execute function public.tg_acao_protege_campos();

-- ---------------------------------------------------------------------
-- 3. A VIEW DO CLIENTE DECLARA A ORIGEM
-- ---------------------------------------------------------------------
-- A tela precisa saber se mostra campos editáveis, e precisa poder dizer
-- ao cliente que o prazo é sugerido. Número que não declara de onde veio
-- é o defeito que esta plataforma combate em todas as outras telas.

-- A coluna nova vai no FIM da lista, de propósito.
--
-- `create or replace view` só acrescenta coluna no final: pôr
-- `plano_origem` depois de `plano` deslocaria `titulo` para a posição
-- seguinte, e o Postgres recusa com "cannot change name of view column".
--
-- A alternativa seria `drop view` antes, mas dropar uma view que o front
-- consulta deixa a tela quebrada no intervalo entre as duas instruções —
-- e, se a segunda falhar por qualquer motivo, deixa quebrada de vez.
-- Acrescentar no fim não tem janela de risco. A ordem das colunas não
-- importa para quem faz `select *`.

create or replace view public.vw_quadro_acoes
with (security_invoker = on) as
select
  a.id,
  a.tenant_id,
  a.plano_id,
  p.titulo                                   as plano,
  a.titulo,
  a.detalhe,
  a.pilar,
  a.causa_raiz,
  a.responsavel_nome,
  a.prazo,
  a.status,
  a.concluida_em,
  a.ordem,
  (a.prazo - current_date)                   as dias_para_o_prazo,
  a.status = 'aberta' and a.prazo < current_date  as atrasada,
  (select max(e.em) from public.acao_eventos e where e.acao_id = a.id)
                                             as ultimo_movimento,
  p.origem                                   as plano_origem
from public.acoes a
join public.planos_acao p on p.id = a.plano_id
where p.status = 'ativo';

grant select on public.vw_quadro_acoes to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- A coluna existe e todo plano atual é de consultor:
--
--   select origem, count(*) from public.planos_acao group by origem;
--
-- O gatilho continua protegendo o plano do consultor — logado como
-- CLIENTE, numa ação de plano com origem 'consultor':
--
--   update public.acoes set prazo = '2030-01-01' where id = '<uuid>';
--   -- deve gravar sem erro E o prazo deve continuar o original
--
-- E deve permitir no automático:
--
--   update public.acoes set prazo = '2030-01-01' where id = '<uuid de plano automatico>';
--   -- aqui o prazo DEVE mudar
