-- =====================================================================
-- 43 · OS CINCO NÚMEROS QUE NENHUMA OUTRA FONTE TEM
-- =====================================================================
-- As planilhas do curso pedem, entre todas, uns vinte números. Quase
-- todos a plataforma já mede: faturamento e custos saem do DRE, a
-- receber e a pagar saem dos títulos, saldo em caixa sai das contas
-- bancárias com os lançamentos liquidados, pró-labore sai da categoria.
--
-- Sobram CINCO. Nenhum deles passa por lançamento, e nenhum pode ser
-- inferido sem chutar:
--
--   • estoque         — a plataforma não controla estoque por item
--   • imobilizado     — imóvel, veículo e equipamento, já depreciados
--   • atendimentos    — quantas pessoas entraram, ligaram ou pediram
--   • vendas          — quantos cupons, notas ou pedidos
--   • clientes novos  — quantos compraram pela primeira vez
--
-- Os três últimos são contagem, e é por isso que eles existem: sem
-- atendimentos não há taxa de conversão, e sem conversão o orçamento da
-- aula 4.6 vira chute travestido de planilha.
--
-- ---------------------------------------------------------------------
-- POR QUE AQUI E NÃO NUMA TABELA NOVA
-- ---------------------------------------------------------------------
-- `fechamentos_mensais` já é exatamente isto: uma linha por empresa por
-- mês, com os campos que os lançamentos não revelam, herdada do mês
-- anterior e confirmada por uma pessoa. Criar uma segunda tabela com a
-- mesma chave daria dois lugares para responder "quanto esta empresa
-- tinha em estoque em agosto" — e um dia eles discordariam.
--
-- ---------------------------------------------------------------------
-- SALDO E CONTAGEM SE COMPORTAM DIFERENTE, E A HERANÇA RESPEITA ISSO
-- ---------------------------------------------------------------------
-- Estoque e imobilizado são SALDOS: atravessam o mês. Herdar o valor
-- anterior e pedir confirmação é honesto — na maioria dos meses a
-- resposta é "continua parecido".
--
-- Atendimentos, vendas e clientes novos são CONTAGENS DO MÊS. Herdar
-- 1.850 atendimentos de agosto para setembro e deixar alguém confirmar
-- por inércia produziria uma taxa de conversão estável que é só cópia.
-- E a 4.7 existe justamente para mostrar a variação. Por isso a função
-- de abertura copia os dois primeiros e deixa os três últimos em branco.
-- =====================================================================

alter table public.fechamentos_mensais
  add column if not exists estoque_valor numeric(14,2)
    check (estoque_valor >= 0),
  add column if not exists imobilizado_liquido numeric(14,2)
    check (imobilizado_liquido >= 0),
  add column if not exists atendimentos int
    check (atendimentos >= 0),
  add column if not exists vendas_numero int
    check (vendas_numero >= 0),
  add column if not exists clientes_novos int
    check (clientes_novos >= 0);

comment on column public.fechamentos_mensais.estoque_valor is
  'Mercadoria parada a preço de CUSTO no último dia do mês. Alimenta o '
  'ciclo financeiro (aula 4.1), a NCG e os tres indices (aula 4.8). '
  'Ausente nao vale zero: zero encurta o ciclo e faz a empresa parecer '
  'mais saudavel do que e.';

comment on column public.fechamentos_mensais.imobilizado_liquido is
  'Imovel, veiculo e equipamento pelo valor de compra menos a depreciacao '
  'ja acumulada. So a aula 4.8 usa — entra no capital investido, que e o '
  'denominador da rentabilidade.';

comment on column public.fechamentos_mensais.atendimentos is
  'Pessoas atendidas no mes, nao clientes distintos. E o denominador da '
  'taxa de conversao. Uma folha no balcao e um traco por pessoa ja basta '
  'para comecar.';

comment on column public.fechamentos_mensais.vendas_numero is
  'Cupons, notas ou pedidos emitidos no mes. Faturamento dividido por '
  'este numero e o ticket medio.';

comment on column public.fechamentos_mensais.clientes_novos is
  'Quem comprou pela primeira vez no mes. Verba de marketing dividida '
  'por este numero e o CAC.';


-- ---------------------------------------------------------------------
-- A ABERTURA DO MÊS, com a distinção entre saldo e contagem
-- ---------------------------------------------------------------------
-- Idêntica à original em tudo, menos nas duas linhas novas da herança.
-- Repetida inteira porque `create or replace function` substitui o corpo
-- todo — não existe "alterar só um trecho".

create or replace function public.fn_abrir_fechamento(
  p_tenant_id   uuid,
  p_competencia date
)
returns public.fechamentos_mensais
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_linha public.fechamentos_mensais;
begin
  if not (public.can_write_tenant(p_tenant_id)
          or public.is_platform_staff()
          or public.is_consultor_de(p_tenant_id)) then
    raise exception 'Sem permissão para esta empresa' using errcode = '42501';
  end if;

  select * into v_linha
    from public.fechamentos_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia;

  if found then
    return v_linha;
  end if;

  insert into public.fechamentos_mensais (
    tenant_id, competencia,
    passivo_curto_prazo, passivo_longo_prazo, parcela_dividas_mensal,
    custo_divida_pct_am, pme_dias,
    uso_antecipacao_recebiveis, mistura_contas_pf_pj, percentual_maior_cliente,
    -- Saldos: atravessam o mês, então herdam.
    estoque_valor, imobilizado_liquido
    -- Contagens (atendimentos, vendas, clientes novos) NÃO herdam.
    -- Copiar a contagem do mês passado e deixar confirmar por inércia
    -- daria uma taxa de conversão que nunca muda.
  )
  select
    p_tenant_id, p_competencia,
    a.passivo_curto_prazo, a.passivo_longo_prazo, a.parcela_dividas_mensal,
    a.custo_divida_pct_am, a.pme_dias,
    a.uso_antecipacao_recebiveis, a.mistura_contas_pf_pj, a.percentual_maior_cliente,
    a.estoque_valor, a.imobilizado_liquido
  from public.fechamentos_mensais a
  where a.tenant_id = p_tenant_id
    and a.competencia < p_competencia
  order by a.competencia desc
  limit 1;

  -- Nenhum mês anterior: cria a linha vazia mesmo assim, para a tela ter
  -- onde gravar e o `update` do rascunho encontrar alvo.
  if not found then
    insert into public.fechamentos_mensais (tenant_id, competencia)
    values (p_tenant_id, p_competencia)
    on conflict (tenant_id, competencia) do nothing;
  end if;

  select * into v_linha
    from public.fechamentos_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia;

  return v_linha;
end;
$$;

comment on function public.fn_abrir_fechamento(uuid, date) is
  'Abre o fechamento do mês herdando o anterior, sem confirmar. Idempotente: '
  'nunca sobrescreve o que já foi digitado. Saldos herdam; contagens do mês '
  'nascem em branco de propósito.';

revoke all on function public.fn_abrir_fechamento(uuid, date) from public;
grant execute on function public.fn_abrir_fechamento(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- O ÚLTIMO VALOR INFORMADO, com a competência junto
-- ---------------------------------------------------------------------
-- As calculadoras (ciclo, capital de giro, três índices) precisam do
-- estoque mesmo quando o mês corrente ainda não foi preenchido. Elas
-- caem para o último mês que tem o número.
--
-- A competência viaja junto, e não é detalhe: uma tela que mostra
-- "estoque: R$ 144.000" sem dizer de quando ele é convida o usuário a
-- tratar um número de três meses atrás como se fosse de hoje.

drop view if exists public.vw_fechamento_ultimo;

create view public.vw_fechamento_ultimo
with (security_invoker = on) as
select distinct on (tenant_id)
  tenant_id,
  competencia,
  estoque_valor,
  imobilizado_liquido,
  atendimentos,
  vendas_numero,
  clientes_novos,
  confirmado_em
from public.fechamentos_mensais
where estoque_valor is not null
   or imobilizado_liquido is not null
   or atendimentos is not null
   or vendas_numero is not null
   or clientes_novos is not null
order by tenant_id, competencia desc;

comment on view public.vw_fechamento_ultimo is
  'O fechamento mais recente que tem ao menos um dos cinco numeros '
  'operacionais, com a competencia. As calculadoras leem daqui quando o '
  'mes corrente ainda esta vazio.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- 1. As cinco colunas existem:
--
-- select column_name, data_type
--   from information_schema.columns
--  where table_name = 'fechamentos_mensais'
--    and column_name in ('estoque_valor','imobilizado_liquido',
--                        'atendimentos','vendas_numero','clientes_novos')
--  order by column_name;
--
-- Tem de vir CINCO linhas.
--
-- 2. A view responde (pode vir vazia — ninguém preencheu ainda):
--
-- select * from public.vw_fechamento_ultimo;
