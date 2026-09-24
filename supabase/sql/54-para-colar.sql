-- =====================================================================
-- 54 · O CICLO FINANCEIRO, MÊS A MÊS
-- =====================================================================
-- As faixas de 30 e 40 dias da tela de Ciclo são referência gerencial do
-- curso, calibradas para comércio. Um supermercado opera com ciclo
-- NEGATIVO e uma construtora com 120 dias — e a tela chamava os dois de
-- "Crítico" ou "Confortável" pela mesma régua, como se fosse veredito.
--
-- A plataforma não sabe o setor da empresa: `tenants` guarda nome, CNPJ,
-- regime fiscal e fuso, e o `setor` existe apenas dentro de cada
-- diagnóstico, não como atributo da empresa.
--
-- O que ela sabe é o histórico da própria empresa. "Seu ciclo era 28
-- dias em julho e está em 34" é diagnóstico defensável em qualquer
-- setor, sem depender de tabela de referência que alguém teria de
-- manter atualizada.
--
-- ---------------------------------------------------------------------
-- A RECONSTRUÇÃO DO SALDO EM ABERTO, MÊS A MÊS
-- ---------------------------------------------------------------------
-- `vw_contas_resumo` responde "quanto está em aberto HOJE". Para o
-- histórico é preciso perguntar "quanto estava em aberto no último dia
-- de julho", que é outra coisa: um título de junho pago em agosto estava
-- aberto em julho e não aparece em nenhum saldo atual.
--
-- A regra é: existia (competência até o fim do mês), não foi cancelado,
-- e ou não foi liquidado, ou foi liquidado DEPOIS do fim do mês.
--
-- ---------------------------------------------------------------------
-- MÊS SEM ESTOQUE INFORMADO FICA MARCADO, NÃO ESCONDIDO
-- ---------------------------------------------------------------------
-- O estoque vem do fechamento mensal e nem toda empresa preenche todo
-- mês. Tratar ausência como zero produziria uma queda de ciclo que não
-- aconteceu — e uma comemoração falsa. A coluna `estoque_informado` diz
-- em quais meses a comparação é honesta.
-- =====================================================================

drop view if exists public.vw_ciclo_mensal;

create view public.vw_ciclo_mensal
with (security_invoker = on) as
with meses as (
  select
    d.tenant_id,
    d.competencia,
    d.receita_bruta,
    (d.competencia + interval '1 month - 1 day')::date as fim_mes
  from public.vw_dre_monthly d
  where d.receita_bruta > 0
),
saldos as (
  select
    m.tenant_id,
    m.competencia,
    m.receita_bruta,
    f.estoque_valor,
    coalesce(f.estoque_valor, 0) as estoque,

    coalesce((
      select sum(t.amount)
        from public.transactions t
       where t.tenant_id = m.tenant_id
         and t.type = 'receita'
         and t.status <> 'cancelado'
         and t.competence_date <= m.fim_mes
         and (t.status <> 'liquidado' or t.paid_date > m.fim_mes)
    ), 0) as a_receber,

    coalesce((
      select sum(t.amount)
        from public.transactions t
       where t.tenant_id = m.tenant_id
         and t.type = 'despesa'
         and t.status <> 'cancelado'
         and t.competence_date <= m.fim_mes
         and (t.status <> 'liquidado' or t.paid_date > m.fim_mes)
    ), 0) as a_pagar
  from meses m
  left join public.fechamentos_mensais f
    on f.tenant_id = m.tenant_id
   and f.competencia = m.competencia
)
select
  tenant_id,
  competencia,
  receita_bruta,
  estoque,
  a_receber,
  a_pagar,
  (estoque_valor is not null) as estoque_informado,
  round(receita_bruta / 30, 2) as venda_diaria,
  round(estoque + a_receber - a_pagar, 2) as dinheiro_preso,
  -- Mesma régua de `ciclo.ts`: dias de venda. Trocar a base aqui faria a
  -- linha do histórico discordar do número grande da própria tela.
  round((estoque + a_receber - a_pagar) / (receita_bruta / 30), 1) as ciclo_financeiro
from saldos;

comment on view public.vw_ciclo_mensal is
  'Ciclo financeiro por competencia, na regua de dias de venda. Saldos em '
  'aberto reconstruidos para o ultimo dia de cada mes. estoque_informado '
  'diz se o mes tem estoque no fechamento -- sem ele o ciclo sai subestimado.';

grant select on public.vw_ciclo_mensal to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- O ciclo do último mês fechado tem de bater com o da tela de Ciclo
-- Operacional e Financeiro, quando o estoque daquele mês foi informado:
--
-- select competencia, receita_bruta, estoque, a_receber, a_pagar,
--        estoque_informado, ciclo_financeiro
--   from public.vw_ciclo_mensal
--  where tenant_id = 'COLE-O-TENANT-ID'
--  order by competencia desc
--  limit 6;
