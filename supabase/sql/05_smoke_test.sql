-- =====================================================================
-- 05_smoke_test.sql — validação pós-deploy (opcional)
-- =====================================================================
-- Rode no SQL Editor do Supabase, SEÇÃO POR SEÇÃO (o editor só mostra o
-- resultado da última consulta se você rodar tudo de uma vez).
-- Blocos "do $$ ... end $$;" precisam ser selecionados INTEIROS.
--
-- ⚠️ Grava dados reais. Não rode numa base com dado de cliente.
-- A última linha (comentada) remove a massa de teste.
-- =====================================================================

-- --------------------------------------------------------------
-- 1. Massa de teste
-- --------------------------------------------------------------
do $$
declare
  v_t1 uuid; v_t2 uuid;
  v_cat_venda uuid; v_cat_merc uuid; v_cat_aluguel uuid;
  v_cli uuid; v_forn uuid; v_conta uuid;
begin
  insert into public.tenants (name, tax_id) values ('Padaria Teste LTDA', '11222333000181')
    returning id into v_t1;
  insert into public.tenants (name, tax_id) values ('Empresa Rival LTDA',  '11222333000262')
    returning id into v_t2;

  insert into public.bank_accounts (tenant_id, name, opening_balance, is_default)
    values (v_t1, 'Caixa', 10000.00, true) returning id into v_conta;

  insert into public.categories (tenant_id, name, type, dre_group) values
    (v_t1, 'Venda de Produtos', 'receita', 'receita_bruta')  returning id into v_cat_venda;
  insert into public.categories (tenant_id, name, type, dre_group) values
    (v_t1, 'Mercadoria',        'despesa', 'custo_variavel') returning id into v_cat_merc;
  insert into public.categories (tenant_id, name, type, dre_group) values
    (v_t1, 'Aluguel',           'despesa', 'despesa_fixa')   returning id into v_cat_aluguel;

  insert into public.entities (tenant_id, name, kind) values (v_t1, 'Cliente A', 'cliente')
    returning id into v_cli;
  insert into public.entities (tenant_id, name, kind) values (v_t1, 'Fornecedor B', 'fornecedor')
    returning id into v_forn;

  -- Receita à vista JÁ RECEBIDA (entra no caixa e no DRE)
  insert into public.transactions
    (tenant_id, type, description, amount, status, competence_date, due_date,
     paid_date, paid_amount, category_id, entity_id, bank_account_id)
  values (v_t1, 'receita', 'Venda balcão', 5000.00, 'liquidado',
          current_date - 5, current_date - 5, current_date - 5, 5000.00,
          v_cat_venda, v_cli, v_conta);

  -- Despesa parcelada em 3x: as 3 parcelas competem ao MÊS DA COMPRA
  insert into public.transactions
    (tenant_id, type, description, amount, status, competence_date, due_date,
     category_id, entity_id, schedule_type, installment_number, installment_total)
  select v_t1, 'despesa', format('Compra mercadoria (%s/3)', i), 1000.00, 'pendente',
         current_date, current_date + ((i-1) * 30), v_cat_merc, v_forn, 'parcelado', i, 3
  from generate_series(1,3) i;

  -- Aluguel vencendo HOJE
  insert into public.transactions
    (tenant_id, type, description, amount, status, competence_date, due_date, category_id)
  values (v_t1, 'despesa', 'Aluguel', 3000.00, 'pendente', current_date, current_date, v_cat_aluguel);

  -- Ruído no OUTRO tenant: NUNCA pode aparecer nas consultas do tenant 1
  insert into public.transactions (tenant_id, type, description, amount, competence_date, due_date)
  values (v_t2, 'receita', 'NAO DEVE VAZAR', 999999.00, current_date, current_date);
end $$;

-- --------------------------------------------------------------
-- 2. Conferências
-- --------------------------------------------------------------

-- 2.1 Contas a pagar — esperado: 4 títulos pendentes
--     vence_hoje = 2 (aluguel 3.000 + parcela 1/3 1.000) | a_vencer = 2
select situacao, count(*), sum(amount)
from public.vw_transactions
where tenant_id = (select id from public.tenants where tax_id = '11222333000181')
  and type = 'despesa' and status = 'pendente'
group by situacao order by 1;

-- 2.2 Fluxo de caixa realizado — esperado: saldo_acumulado = 15.000
select data, entradas, saidas, saldo_acumulado
from public.vw_cashflow_daily
where tenant_id = (select id from public.tenants where tax_id = '11222333000181')
order by data;

-- 2.3 Projeção — saldo parte de 15.000 e cai.
--     Observe se alerta_saldo_negativo vira true em algum dia.
select data, dias_a_frente, entradas_previstas, saidas_previstas,
       saldo_projetado, alerta_saldo_negativo
from public.vw_cashflow_projection
where tenant_id = (select id from public.tenants where tax_id = '11222333000181')
  and dias_a_frente <= 90
order by data;

-- 2.4 DRE do mês corrente — O TESTE MAIS IMPORTANTE. Esperado:
--     receita_bruta 5.000 | custos_variaveis 3.000 | margem_contribuicao 2.000 (40%)
--     despesas_fixas 3.000 | resultado_operacional -1.000 | ponto_equilibrio 7.500
--
--     Repare no contraste com o 2.2: caixa +15.000 e resultado -1.000 no mesmo
--     mês. É exatamente o que a EPP não enxerga sem separar as duas datas.
select competencia, receita_bruta, deducoes, custos_variaveis,
       margem_contribuicao, margem_contribuicao_pct,
       despesas_fixas, resultado_operacional, ponto_equilibrio
from public.vw_dre_monthly
where tenant_id = (select id from public.tenants where tax_id = '11222333000181')
order by competencia;

-- 2.5 Recorrência: cria aluguel mensal e materializa 60 dias à frente
do $$
declare v_t1 uuid; v_cat uuid;
begin
  select id into v_t1 from public.tenants where tax_id = '11222333000181';
  select id into v_cat from public.categories where tenant_id = v_t1 and name = 'Aluguel';

  insert into public.recurring_templates
    (tenant_id, type, description, amount, category_id, frequency,
     day_of_month, start_date, next_due_date, generate_ahead_days)
  values (v_t1, 'despesa', 'Aluguel mensal', 3000.00, v_cat, 'mensal',
          10, current_date, public.fn_apply_day_of_month(current_date, 10), 60);
end $$;

select * from public.fn_generate_recurring();   -- esperado: 2 a 3 ocorrências
select * from public.fn_generate_recurring();   -- esperado: 0 (idempotência)

select description, due_date, status
from public.transactions where schedule_type = 'recorrente' order by due_date;

-- 2.6 Baixa em lote
select public.fn_settle_transactions(
  array(select id from public.transactions
         where status = 'pendente' and due_date = current_date limit 5),
  current_date
) as titulos_baixados;

-- 2.7 TESTE DE ISOLAMENTO (RLS) — o mais importante de todos.
--     Selecione o bloco INTEIRO e rode de uma vez.
--     Simula um usuário autenticado que não é membro de nenhuma empresa.
--     Se retornar qualquer coisa diferente de 0, há vazamento entre empresas.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
select count(*) as deve_ser_zero_transactions from public.transactions;
select count(*) as deve_ser_zero_tenants      from public.tenants;
commit;

-- --------------------------------------------------------------
-- 3. LIMPEZA (descomente para remover a massa de teste)
-- --------------------------------------------------------------
-- delete from public.tenants where tax_id in ('11222333000181','11222333000262');
