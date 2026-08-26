-- =====================================================================
-- 21 — DIAGNÓSTICO AUTOMÁTICO (módulo 1.2.0)
-- =====================================================================
-- Até aqui o score vinha de um formulário de trinta campos, preenchido
-- pelo consultor numa reunião. Isso funciona uma vez. Não funciona doze
-- vezes por ano — e é a repetição que sustenta a assinatura, porque o
-- produto que segura cliente não é a foto, é a curva.
--
-- A ideia deste arquivo: tirar dos LANÇAMENTOS tudo o que der, e reduzir
-- a pergunta mensal ao que o sistema não tem como saber.
--
-- ---------------------------------------------------------------------
-- O QUE SAI DE GRAÇA
-- ---------------------------------------------------------------------
-- O `dre_group` das categorias já classifica cada lançamento, então a
-- DRE inteira sai de `vw_dre_monthly`. As datas de competência, venci-
-- mento e pagamento dão os prazos médios. O saldo das contas dá a
-- reserva. As entidades dão a concentração de clientes.
--
--   faturamento, impostos, custos variáveis, despesas fixas,
--   pró-labore, saldo de caixa, PMR, PMP, inadimplência,
--   concentração do maior cliente
--
-- ---------------------------------------------------------------------
-- O QUE PRECISA SER PERGUNTADO
-- ---------------------------------------------------------------------
-- Sete campos, e cada um por um motivo diferente:
--
--   passivo curto/longo prazo  — é balanço, não fluxo. Não passa por
--                                lançamento nenhum.
--   parcela mensal de dívidas  — passa por lançamento, mas misturada em
--                                'despesa_fixa'. Separar exigiria um
--                                dre_group novo e recategorizar o
--                                histórico de todo mundo.
--   custo da dívida (% a.m.)   — é taxa de contrato, não valor pago.
--   PME (estoque)              — o sistema não controla estoque.
--   uso de antecipação         — comportamento, não transação.
--   mistura PF/PJ              — o sistema só vê a conta da empresa; se
--                                o sócio paga a conta de luz da casa
--                                pelo cartão pessoal, nada chega aqui.
--
-- Eles ficam em `fechamentos_mensais`, pré-preenchidos com o mês
-- anterior. Passivo e comportamento mudam devagar: confirmar leva
-- segundos, e só o que mudou pede atenção.
--
-- ---------------------------------------------------------------------
-- A DISCIPLINA: RECUSAR-SE A PONTUAR COM DADO INCOMPLETO
-- ---------------------------------------------------------------------
-- Se o cliente lançou as receitas e metade das despesas, o score sai
-- alto e falso — e pior, sai com aparência de precisão. A régua herdada
-- trata ausência como o pior caso (nota 0 em Endividamento e Governança),
-- o que transformaria silêncio em mau desempenho.
--
-- Por isso existe `fn_completude_mensal`. Abaixo do limiar, o relatório
-- simplesmente não é gerado: o cliente recebe o que falta, não um número
-- errado. É o mesmo princípio do silêncio no fluxo de WhatsApp — não
-- responder é melhor que responder errado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O FECHAMENTO MENSAL
-- ---------------------------------------------------------------------
-- Uma linha por empresa por mês. A competência é sempre o primeiro dia
-- do mês, para casar com `vw_dre_monthly`.

create table if not exists public.fechamentos_mensais (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  competencia     date not null,

  -- Balanço — não passa por lançamento
  passivo_curto_prazo     numeric(14,2) check (passivo_curto_prazo >= 0),
  passivo_longo_prazo     numeric(14,2) check (passivo_longo_prazo >= 0),
  parcela_dividas_mensal  numeric(14,2) check (parcela_dividas_mensal >= 0),
  custo_divida_pct_am     numeric(6,3)  check (custo_divida_pct_am between 0 and 100),

  -- Operação — o sistema não controla estoque
  pme_dias                int check (pme_dias between 0 and 3650),

  -- Comportamento — os dois campos que mais pesam no score e que
  -- nenhum lançamento revela
  uso_antecipacao_recebiveis text
    check (uso_antecipacao_recebiveis in ('nunca','raramente','mensalmente','constantemente')),
  mistura_contas_pf_pj       text
    check (mistura_contas_pf_pj in ('nao','as_vezes','sim')),

  -- Escape para quando a apuração automática erra: se o cliente sabe que
  -- o maior cliente dele é 45% e as entidades não estão preenchidas, o
  -- valor informado vence o calculado.
  percentual_maior_cliente   numeric(5,2) check (percentual_maior_cliente between 0 and 100),

  confirmado_em   timestamptz,
  confirmado_por  uuid references auth.users(id) on delete set null,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (tenant_id, competencia),
  constraint fechamento_competencia_dia1 check (extract(day from competencia) = 1)
);

drop trigger if exists set_updated_at on public.fechamentos_mensais;
create trigger set_updated_at before update on public.fechamentos_mensais
  for each row execute function public.tg_set_updated_at();

comment on table public.fechamentos_mensais is
  'Os campos que o diagnóstico precisa e os lançamentos não revelam. '
  'Pré-preenchidos com o mês anterior — confirmar é mais barato que digitar.';

comment on column public.fechamentos_mensais.confirmado_em is
  'Nulo = rascunho herdado do mês anterior, ainda não olhado por ninguém. '
  'A completude só conta campo de fechamento confirmado.';

comment on column public.fechamentos_mensais.percentual_maior_cliente is
  'Sobrepõe o valor calculado pelas entidades. Existe porque quem não '
  'preenche entidade nos lançamentos ainda sabe a resposta.';

alter table public.fechamentos_mensais enable row level security;

drop policy if exists fechamentos_select on public.fechamentos_mensais;
create policy fechamentos_select on public.fechamentos_mensais
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists fechamentos_write on public.fechamentos_mensais;
create policy fechamentos_write on public.fechamentos_mensais
  for all using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

-- ---------------------------------------------------------------------
-- 2. PRAZOS MÉDIOS A PARTIR DAS DATAS
-- ---------------------------------------------------------------------
-- PMR e PMP saem da distância entre competência e pagamento, ponderada
-- pelo valor: um título de R$ 50.000 pago com 60 dias pesa mais que dez
-- de R$ 500 pagos à vista, e a média simples esconderia isso.
--
-- Só entram lançamentos LIQUIDADOS. Título em aberto não tem prazo de
-- recebimento — tem prazo de vencimento, que é outra coisa; incluí-lo
-- faria a empresa que atrasa parecer a que negocia prazo longo.
--
-- Consequência a ter em mente: num mês com poucos títulos liquidados, o
-- prazo médio é volátil. `titulos_recebidos` e `titulos_pagos` viajam
-- junto para que a tela possa dizer "PMR de 45 dias, sobre 3 títulos" —
-- que é uma informação bem diferente de "sobre 80 títulos".

create or replace view public.vw_prazos_medios
with (security_invoker = on) as
select
  t.tenant_id,
  date_trunc('month', t.competence_date::timestamp)::date as competencia,

  round(
    sum(t.paid_amount * (t.paid_date - t.competence_date))
      filter (where t.type = 'receita')
    / nullif(sum(t.paid_amount) filter (where t.type = 'receita'), 0)
  )::int as pmr_dias,

  round(
    sum(t.paid_amount * (t.paid_date - t.competence_date))
      filter (where t.type = 'despesa')
    / nullif(sum(t.paid_amount) filter (where t.type = 'despesa'), 0)
  )::int as pmp_dias,

  count(*) filter (where t.type = 'receita') as titulos_recebidos,
  count(*) filter (where t.type = 'despesa') as titulos_pagos
from public.transactions t
where t.status = 'liquidado'
  and t.paid_date is not null
  and t.paid_amount is not null
group by t.tenant_id, date_trunc('month', t.competence_date::timestamp);

comment on view public.vw_prazos_medios is
  'PMR e PMP ponderados por valor, sobre lançamentos liquidados. Título em '
  'aberto não entra: ele tem vencimento, não prazo de recebimento.';

grant select on public.vw_prazos_medios to authenticated;

-- ---------------------------------------------------------------------
-- 3. AGREGADOS DO MÊS
-- ---------------------------------------------------------------------
-- Tudo o que a régua consome e sai dos lançamentos, num lugar só.
--
-- Três decisões que valem explicação:
--
-- • O saldo de caixa é o do FIM DO MÊS, não o de hoje. Um diagnóstico de
--   março lido em agosto precisa mostrar o caixa de março; usar o saldo
--   atual faria o passado mudar toda vez que alguém abrisse a tela.
--
-- • A inadimplência olha o que venceu no mês e não foi pago ATÉ HOJE.
--   Difere do saldo: aqui o presente é a informação certa — "o que ficou
--   pendente daquele mês" é um fato que só se conhece depois.
--
-- • A concentração usa o maior cliente do mês. Doze meses seria mais
--   estável, mas a régua pontua o risco corrente, e empresa que fechou
--   um contrato grande em março ficou concentrada em março.

create or replace view public.vw_agregados_mensais
with (security_invoker = on) as
with base as (
  select
    d.tenant_id,
    d.competencia,
    d.receita_bruta,
    d.deducoes,
    d.custos_variaveis,
    d.despesas_fixas,
    d.retiradas_socios,
    d.resultado_liquido
  from public.vw_dre_monthly d
),
saldo_fim as (
  -- Saldo acumulado até o último dia da competência: abertura das contas
  -- mais tudo o que foi efetivamente pago ou recebido até lá.
  select
    b.tenant_id,
    b.competencia,
    coalesce((
      select sum(ba.opening_balance)
        from public.bank_accounts ba
       where ba.tenant_id = b.tenant_id
         and ba.is_active
         and ba.opening_balance_date <= (b.competencia + interval '1 month - 1 day')::date
    ), 0)
    + coalesce((
      select sum(case when t.type = 'receita' then t.paid_amount else -t.paid_amount end)
        from public.transactions t
       where t.tenant_id = b.tenant_id
         and t.status = 'liquidado'
         and t.paid_date <= (b.competencia + interval '1 month - 1 day')::date
    ), 0) as saldo_caixa
  from base b
),
inadimplencia as (
  select
    b.tenant_id,
    b.competencia,
    coalesce((
      select sum(t.amount)
        from public.transactions t
       where t.tenant_id = b.tenant_id
         and t.type = 'receita'
         and t.status <> 'cancelado'
         and t.status <> 'liquidado'
         and t.due_date < current_date
         and date_trunc('month', t.competence_date::timestamp)::date = b.competencia
    ), 0) as receita_vencida_em_aberto
  from base b
),
concentracao as (
  select
    b.tenant_id,
    b.competencia,
    (
      -- Maior fatia sobre o total do mês. `max` e `sum` operam sobre as
      -- linhas já agrupadas por entidade, na subconsulta interna.
      select round(max(por_cliente.total) / nullif(sum(por_cliente.total), 0) * 100, 2)
        from (
          select sum(t.amount) as total
            from public.transactions t
           where t.tenant_id = b.tenant_id
             and t.type = 'receita'
             and t.status <> 'cancelado'
             and t.entity_id is not null
             and date_trunc('month', t.competence_date::timestamp)::date = b.competencia
           group by t.entity_id
        ) por_cliente
    ) as maior_cliente_pct,
    (
      select count(*) filter (where t.entity_id is null)::numeric
             / nullif(count(*), 0) * 100
        from public.transactions t
       where t.tenant_id = b.tenant_id
         and t.type = 'receita'
         and t.status <> 'cancelado'
         and date_trunc('month', t.competence_date::timestamp)::date = b.competencia
    ) as receitas_sem_entidade_pct
  from base b
)
select
  b.tenant_id,
  b.competencia,
  b.receita_bruta        as faturamento_bruto,
  b.deducoes             as impostos_sobre_vendas,
  b.custos_variaveis,
  b.despesas_fixas,
  b.retiradas_socios     as pro_labore_socios,
  b.resultado_liquido    as lucro_liquido,
  s.saldo_caixa,
  p.pmr_dias,
  p.pmp_dias,
  p.titulos_recebidos,
  p.titulos_pagos,
  i.receita_vencida_em_aberto,
  case when b.receita_bruta > 0
       then round(i.receita_vencida_em_aberto / b.receita_bruta * 100, 2)
       else null end     as inadimplencia_pct,
  c.maior_cliente_pct,
  round(c.receitas_sem_entidade_pct, 1) as receitas_sem_entidade_pct
from base b
join saldo_fim      s on s.tenant_id = b.tenant_id and s.competencia = b.competencia
join inadimplencia  i on i.tenant_id = b.tenant_id and i.competencia = b.competencia
join concentracao   c on c.tenant_id = b.tenant_id and c.competencia = b.competencia
left join public.vw_prazos_medios p
       on p.tenant_id = b.tenant_id and p.competencia = b.competencia;

comment on view public.vw_agregados_mensais is
  'Tudo o que a régua consome e sai dos lançamentos. O saldo é o do fim da '
  'competência, não o de hoje: o passado não pode mudar quando alguém abre a tela.';

grant select on public.vw_agregados_mensais to authenticated;

-- ---------------------------------------------------------------------
-- 4. COMPLETUDE
-- ---------------------------------------------------------------------
-- Este é o coração do módulo. Ele responde uma pergunta só: **dá para
-- confiar no score deste mês?**
--
-- A resposta é composta de duas partes, e as duas precisam passar.
--
-- LANÇAMENTOS. Não basta contar linhas: uma empresa que lançou trinta
-- receitas e nenhuma despesa tem trinta lançamentos e um retrato
-- fantasioso. Os sinais que importam:
--
--   • existe receita no mês?
--   • existe despesa fixa? (empresa nenhuma opera sem)
--   • as despesas somam pelo menos um terço das receitas?
--
-- O último é o que pega o caso perigoso: receitas em dia, despesas
-- esquecidas. Um terço é deliberadamente frouxo — o objetivo não é
-- julgar a margem, é detectar ausência. Empresa com margem de 60% passa;
-- empresa que lançou R$ 80.000 de receita e R$ 4.000 de despesa, não.
--
-- FECHAMENTO. Os sete campos precisam estar confirmados PARA AQUELE MÊS.
-- Rascunho herdado não conta: se contasse, o passivo de janeiro seguiria
-- valendo em dezembro sem ninguém ter olhado, e a curva mostraria uma
-- estabilidade que é só inércia de formulário.
--
-- O retorno é um jsonb com o veredito e a lista do que falta, em texto
-- que pode ir direto para o cliente. "Faltam as despesas de julho" gera
-- ação; "completude 62%" não gera nada.

create or replace function public.fn_completude_mensal(
  p_tenant_id   uuid,
  p_competencia date
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_ag        record;
  v_fe        record;
  v_faltas    text[] := '{}';
  v_pontos    int := 0;
  v_max       int := 10;
begin
  select * into v_ag
    from public.vw_agregados_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia;

  select * into v_fe
    from public.fechamentos_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia
     and confirmado_em is not null;

  -- ---- Lançamentos (6 pontos) ----
  if v_ag is null or coalesce(v_ag.faturamento_bruto, 0) = 0 then
    v_faltas := array_append(v_faltas, 'as receitas do mês');
  else
    v_pontos := v_pontos + 3;
  end if;

  if v_ag is null or coalesce(v_ag.despesas_fixas, 0) = 0 then
    v_faltas := array_append(v_faltas, 'as despesas fixas do mês');
  else
    v_pontos := v_pontos + 2;
  end if;

  if v_ag is not null
     and coalesce(v_ag.faturamento_bruto, 0) > 0
     and (coalesce(v_ag.custos_variaveis, 0) + coalesce(v_ag.despesas_fixas, 0)
          + coalesce(v_ag.impostos_sobre_vendas, 0))
         < v_ag.faturamento_bruto * 0.33
  then
    v_faltas := array_append(v_faltas, 'parte das despesas — o total lançado é pequeno demais para o faturamento do mês');
  else
    if v_ag is not null then v_pontos := v_pontos + 1; end if;
  end if;

  -- ---- Fechamento (4 pontos) ----
  -- Endividamento e comportamento pesam junto porque, sem eles, dois
  -- pilares inteiros da régua caem para zero por ausência.
  if v_fe is null then
    v_faltas := array_append(v_faltas, 'a confirmação do fechamento do mês');
  else
    if v_fe.passivo_curto_prazo is null or v_fe.passivo_longo_prazo is null then
      v_faltas := array_append(v_faltas, 'o passivo de curto e longo prazo');
    else
      v_pontos := v_pontos + 1;
    end if;

    if v_fe.parcela_dividas_mensal is null then
      v_faltas := array_append(v_faltas, 'a parcela mensal de dívidas');
    else
      v_pontos := v_pontos + 1;
    end if;

    if v_fe.uso_antecipacao_recebiveis is null then
      v_faltas := array_append(v_faltas, 'a pergunta sobre antecipação de recebíveis');
    else
      v_pontos := v_pontos + 1;
    end if;

    if v_fe.mistura_contas_pf_pj is null then
      v_faltas := array_append(v_faltas, 'a pergunta sobre separação entre conta pessoal e da empresa');
    else
      v_pontos := v_pontos + 1;
    end if;
  end if;

  return jsonb_build_object(
    'tenant_id',    p_tenant_id,
    'competencia',  p_competencia,
    'pontos',       v_pontos,
    'maximo',       v_max,
    'percentual',   round(v_pontos::numeric / v_max * 100),
    -- O limiar é 10 de 10: exigir tudo. Qualquer corte abaixo disso
    -- significaria emitir score com pilar zerado por ausência, que é
    -- exatamente o que este módulo existe para impedir.
    'suficiente',   v_pontos = v_max,
    'faltas',       to_jsonb(v_faltas)
  );
end;
$$;

comment on function public.fn_completude_mensal(uuid, date) is
  'Dá para confiar no score deste mês? Devolve veredito e a lista do que '
  'falta, em texto que pode ir direto ao cliente.';

revoke all on function public.fn_completude_mensal(uuid, date) from public;
grant execute on function public.fn_completude_mensal(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. A ENTRADA DA RÉGUA
-- ---------------------------------------------------------------------
-- Monta exatamente o objeto que `calcularRegua` espera — os mesmos quatro
-- blocos do formulário manual. Um formato só, dois produtores: é isso que
-- impede o cálculo automático de virar uma segunda régua.
--
-- Sobre `lucro_liquido_informado`: no automático, informado e calculado
-- são o mesmo número, e a "Divergência da DRE" nasce sempre zerada. O
-- indicador não some do relatório — ele deixa de ser informativo, e quem
-- ocupa o lugar dele é a completude.

create or replace function public.fn_entrada_regua(
  p_tenant_id   uuid,
  p_competencia date
)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'dre', jsonb_build_object(
      'faturamento_bruto',       coalesce(a.faturamento_bruto, 0),
      'impostos_sobre_vendas',   coalesce(a.impostos_sobre_vendas, 0),
      'custos_variaveis',        coalesce(a.custos_variaveis, 0),
      'despesas_fixas',          coalesce(a.despesas_fixas, 0),
      'pro_labore_socios',       coalesce(a.pro_labore_socios, 0),
      'lucro_liquido_informado', coalesce(a.lucro_liquido, 0)
    ),
    'caixa', jsonb_build_object(
      'saldo_caixa_reservas', coalesce(a.saldo_caixa, 0),
      'pmr_dias',             coalesce(a.pmr_dias, 0),
      'pmp_dias',             coalesce(a.pmp_dias, 0),
      'pme_dias',             coalesce(f.pme_dias, 0),
      'inadimplencia_pct',    coalesce(a.inadimplencia_pct, 0)
    ),
    'endividamento', jsonb_build_object(
      'passivo_curto_prazo',        f.passivo_curto_prazo,
      'passivo_longo_prazo',        f.passivo_longo_prazo,
      'parcela_dividas_mensal',     f.parcela_dividas_mensal,
      'custo_divida_pct_am',        f.custo_divida_pct_am,
      'uso_antecipacao_recebiveis', f.uso_antecipacao_recebiveis
    ),
    'qualitativo', jsonb_build_object(
      'mistura_contas_pf_pj', f.mistura_contas_pf_pj,
      -- O informado vence o calculado: quem não preenche entidade nos
      -- lançamentos ainda sabe qual é o maior cliente dele.
      'percentual_maior_cliente',
        coalesce(f.percentual_maior_cliente, a.maior_cliente_pct, 0)
    ),
    'origem', jsonb_build_object(
      'automatico',                true,
      'receitas_sem_entidade_pct', a.receitas_sem_entidade_pct,
      'titulos_recebidos',         a.titulos_recebidos,
      'titulos_pagos',             a.titulos_pagos
    )
  )
  from public.vw_agregados_mensais a
  left join public.fechamentos_mensais f
         on f.tenant_id = a.tenant_id
        and f.competencia = a.competencia
        and f.confirmado_em is not null
  where a.tenant_id = p_tenant_id and a.competencia = p_competencia;
$$;

comment on function public.fn_entrada_regua(uuid, date) is
  'Monta a entrada da régua a partir dos lançamentos e do fechamento. Mesmo '
  'formato do formulário manual — um formato só, dois produtores.';

revoke all on function public.fn_entrada_regua(uuid, date) from public;
grant execute on function public.fn_entrada_regua(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. RASCUNHO DO FECHAMENTO
-- ---------------------------------------------------------------------
-- Cria a linha do mês copiando o mês anterior, sem marcar como
-- confirmada. É o pré-preenchimento: o cliente abre a tela e encontra os
-- valores que ele já informou, em vez de sete campos vazios.
--
-- Idempotente de propósito — pode ser chamada todo dia pelo agendador
-- sem risco de sobrescrever o que o cliente digitou.

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
    uso_antecipacao_recebiveis, mistura_contas_pf_pj, percentual_maior_cliente
  )
  select
    p_tenant_id, p_competencia,
    a.passivo_curto_prazo, a.passivo_longo_prazo, a.parcela_dividas_mensal,
    a.custo_divida_pct_am, a.pme_dias,
    a.uso_antecipacao_recebiveis, a.mistura_contas_pf_pj, a.percentual_maior_cliente
  from public.fechamentos_mensais a
  where a.tenant_id = p_tenant_id
    and a.competencia < p_competencia
  order by a.competencia desc
  limit 1;

  if not found then
    -- Primeiro mês da empresa: linha vazia, para a tela ter onde gravar.
    insert into public.fechamentos_mensais (tenant_id, competencia)
    values (p_tenant_id, p_competencia);
  end if;

  select * into v_linha
    from public.fechamentos_mensais
   where tenant_id = p_tenant_id and competencia = p_competencia;

  return v_linha;
end;
$$;

comment on function public.fn_abrir_fechamento(uuid, date) is
  'Abre o fechamento do mês herdando o anterior, sem confirmar. Idempotente: '
  'nunca sobrescreve o que já foi digitado.';

revoke all on function public.fn_abrir_fechamento(uuid, date) from public;
grant execute on function public.fn_abrir_fechamento(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Depois de aplicar, rode com uma empresa que tenha lançamentos:
--
--   select * from public.vw_agregados_mensais
--    where tenant_id = '<id>' order by competencia desc limit 6;
--
--   select public.fn_completude_mensal('<id>', date_trunc('month', current_date)::date);
--
-- O esperado no primeiro mês é `suficiente: false` com a falta do
-- fechamento — nenhuma empresa tem fechamento confirmado ainda, e é
-- assim que deve ser.
--
-- Depois:  notify pgrst, 'reload schema';
