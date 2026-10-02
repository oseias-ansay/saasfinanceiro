-- =====================================================================
-- 52 · O QUE O CÓDIGO ESPERA E O BANCO NÃO TEM
-- =====================================================================
-- Três vezes seguidas a mesma falha: o código foi publicado, a migração
-- não foi aplicada, e a tela quebrou com uma mensagem genérica.
--
--   · Extrato        → faltava a coluna tx_id      (arquivo 14)
--   · Fluxo de caixa → faltam as views de fluxo    (arquivo 50)
--
-- A causa não é esquecimento: é que a aplicação das migrações é manual,
-- e nada compara o que o código pede com o que o banco tem. Esta consulta
-- faz essa comparação. Rode depois de CADA publicação.
--
-- A lista abaixo foi extraída dos `.from('...')` da API e do front-end.
-- Ao criar uma tabela ou view nova, acrescente o nome aqui.
-- =====================================================================

with esperado(objeto, arquivo) as (values
  -- Base
  ('tenants','01'), ('profiles','01'), ('memberships','02'),
  ('bank_accounts','01'), ('categories','01'), ('cost_centers','01'),
  ('entities','01'), ('transactions','01'), ('attachments','01'),
  ('vw_transactions','04'), ('vw_dre_monthly','04'),
  ('vw_expenses_by_category','04'), ('vw_dashboard_kpis','04'),
  ('vw_cashflow_projection','04'), ('vw_contas_resumo','04'),

  -- Extrato detalhado
  ('vw_extrato_caixa','14'),

  -- Diagnósticos, staff e consultorias
  ('diagnosticos','11'), ('exclusoes_empresas','13'),
  ('vw_staff_tenants','07'), ('consultorias','18'), ('consultores','18'),
  ('vw_consultorias','18'), ('vw_consultor_publico','19'),
  ('vw_evolucao_score','21'), ('diagnosticos_mensais','21'),
  ('marcos_zero','15'), ('planos_acao','17'), ('acoes','17'),
  ('vw_pdca_consultor','17'), ('vw_quadro_acoes','17'),

  -- Planos, recursos e add-ons
  ('planos','23'), ('recursos','23'), ('plano_recursos','23'),
  ('tenant_recursos','26'), ('vw_meus_recursos','26'),

  -- CRM e funil
  ('leads','24'), ('lead_notas','29'), ('lead_movimentos','24'),
  ('funil_etapas','27'), ('vw_funil_etapas','27'), ('vw_funil_leads','25'),
  ('vw_funil_canais','25'), ('vw_funil_mensal','25'),
  ('vw_funil_diagnosticos','25'), ('vw_lead_conversa','32'),
  ('whatsapp_instancias','30'),

  -- Fechamento mensal e agregados
  ('fechamentos_mensais','22'), ('vw_fechamento_ultimo','22'),
  ('vw_agregados_mensais','22'), ('vw_prazos_medios','22'),
  ('vw_pf_monthly','10'), ('vw_contas_por_pessoa','36'),

  -- Precificação e ferramentas
  ('mix_produtos','35'), ('mix_custos_fixos','35'),
  ('prolabore_config','41'), ('vw_prolabore_mensal','41'),
  ('comercial_config','44'), ('investimentos_midia','44'),
  ('vw_verba_midia_ultima','44'),
  ('orcamento_cenarios','46'), ('orcamento_tetos','46'),
  ('hora_produtiva_config','48'), ('vw_centros_resultado','49'),

  -- Fluxo de caixa projetado — 12 semanas
  ('fluxo_ajustes','50'), ('vw_fluxo_semanal','50'),
  ('vw_fluxo_media_semanal','50'),

  -- Treinamento
  ('curso_modulos','?'), ('curso_aulas','?'), ('curso_atividades','?'),
  ('curso_progresso','?'), ('curso_respostas','?'),

  -- Relatórios de carteira
  ('vw_engajamento_clientes','?'), ('vw_retencao_coortes','?'),
  ('vw_contratos_vencendo','?'), ('vw_despesas_por_categoria','?'),

  -- Dossiê de crédito
  -- Ficaram de fora quando o 55 foi escrito, e o arquivo que existe para
  -- pegar migração esquecida não pegaria a própria. Acrescentado em
  -- 01/10/2026.
  ('credito_dossies','55'), ('credito_documentos','55'),
  ('vw_credito_carteira','55'),

  -- Conversa sobre o plano de ação
  ('pdca_conversas','56'), ('pdca_mensagens','56'),
  ('vw_pdca_chat_uso','56')
)
select
  x.objeto                             as faltando,
  'rode o arquivo ' || x.arquivo       as solucao
from esperado x
where not exists (
  select 1 from information_schema.tables t
   where t.table_schema = 'public' and t.table_name = x.objeto
)
order by x.arquivo, x.objeto;

-- Vazio = o banco tem tudo o que o código pede.
--
-- Com linhas = cada uma aponta o arquivo SQL que precisa ser aplicado.
-- Aplique na ordem do número e rode esta consulta de novo.


-- =====================================================================
-- SEGUNDA PARTE · COLUNAS QUE O CÓDIGO PEDE
-- =====================================================================
-- Rode SEPARADO da consulta acima.
--
-- A primeira parte confere tabelas e views. Não pega coluna faltando —
-- e a quebra que originou este arquivo foi exatamente uma coluna: o
-- `tx_id` do extrato. A tabela existia, a consulta falhava.
--
-- Aqui só entram as colunas acrescentadas DEPOIS da criação da tabela,
-- por um arquivo numerado próprio. Coluna que nasceu junto com a tabela
-- já está coberta pela primeira parte: se a tabela existe, ela existe.
--
-- Acrescentado em 02/10/2026, junto do contexto do plano.
-- =====================================================================

with esperado(tabela, coluna, arquivo) as (values
  ('hora_produtiva_config', 'folha_mensal', '53'),
  ('acoes',                 'ganho_dias',   '47'),
  ('planos_acao',           'tipo',         '23'),
  -- Sem esta, a rota do chat do PDCA falha inteira: o `select` pede a
  -- coluna, o Postgres recusa a consulta, e a tela do plano quebra junto.
  ('planos_acao',           'contexto',     '57'),
  ('transactions',          'paid_date',    '01'),
  ('tenants',               'recursos_extras', '23'),
  ('credito_documentos',    'drive_file_id', '55'),
  ('credito_documentos',    'sync_tentativas', '55'),
  ('pdca_mensagens',        'tokens_cache', '56'),
  ('planos_acao',           'origem',       '58'),
  ('planos_acao',           'diagnostico_competencia', '58'),
  ('pdca_mensagens',        'ferramentas',  '59')
)
select
  x.tabela || '.' || x.coluna     as faltando,
  'rode o arquivo ' || x.arquivo  as solucao
from esperado x
where exists (
  -- Só reclama de coluna cuja TABELA existe. Tabela ausente é problema da
  -- primeira parte, e repetir aqui daria duas linhas para um erro só.
  select 1 from information_schema.tables t
   where t.table_schema = 'public' and t.table_name = x.tabela
)
and not exists (
  select 1 from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = x.tabela
     and c.column_name = x.coluna
)
order by x.arquivo, x.tabela, x.coluna;

-- Vazio aqui também = banco em dia.


-- ---------------------------------------------------------------------
-- DEPOIS DE APLICAR QUALQUER ARQUIVO
-- ---------------------------------------------------------------------
-- O PostgREST guarda o desenho do banco em memória. Sem este aviso, ele
-- continua respondendo "não existe" para uma view recém-criada.
--
--   notify pgrst, 'reload schema';
