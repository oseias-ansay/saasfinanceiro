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
  ('vw_contratos_vencendo','?'), ('vw_despesas_por_categoria','?')
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


-- ---------------------------------------------------------------------
-- DEPOIS DE APLICAR QUALQUER ARQUIVO
-- ---------------------------------------------------------------------
-- O PostgREST guarda o desenho do banco em memória. Sem este aviso, ele
-- continua respondendo "não existe" para uma view recém-criada.
--
--   notify pgrst, 'reload schema';
