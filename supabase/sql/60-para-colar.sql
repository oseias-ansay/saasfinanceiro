-- =====================================================================
-- 60 · INDICADORES ECONÔMICOS
-- =====================================================================
-- IPCA, IGP-M, Selic, dólar e euro, para o assistente responder.
--
-- ---------------------------------------------------------------------
-- O CACHE NÃO É OTIMIZAÇÃO. É O DESENHO.
-- ---------------------------------------------------------------------
-- IPCA e IGP-M mudam uma vez por mês. A Selic muda quando o Copom se
-- reúne. Buscar na fonte a cada pergunta do cliente adicionaria latência
-- e um ponto de falha sem trazer nenhuma informação nova.
--
-- E há a parte que decide: a fonte pode estar fora do ar. Com a leitura
-- guardada, o assistente responde com o último valor conhecido e a data
-- dele. Sem ela, responderia "não consegui consultar" — numa pergunta
-- cuja resposta não mudou em três semanas.
--
-- ---------------------------------------------------------------------
-- A DATA DE REFERÊNCIA É PARTE DO DADO, NÃO METADADO
-- ---------------------------------------------------------------------
-- "O IPCA é 0,44%" sem dizer de qual mês é enganoso: o índice sai com
-- defasagem, e o cliente pode entender que é o do mês corrente.
--
-- Por isso `referencia` é obrigatória e aparece na resposta junto com o
-- valor. Mesma regra dos números das telas: declarar de onde veio.
--
-- ---------------------------------------------------------------------
-- NÃO TEM tenant_id, E ISSO É PROPOSITAL
-- ---------------------------------------------------------------------
-- É dado público, igual para todo mundo. Única tabela do projeto sem
-- recorte por empresa — então a policy libera leitura a qualquer usuário
-- autenticado, e a escrita fica só com a API.
-- =====================================================================

create table if not exists public.indicadores_economicos (
  -- 'ipca', 'igpm', 'selic', 'dolar', 'euro'. Texto, e não enum: a lista
  -- vai crescer conforme as perguntas pedirem, e acrescentar valor a enum
  -- em produção é caro.
  codigo       text primary key,

  nome         text not null,
  /** O mês ou dia a que o número se refere. Nunca a data da coleta. */
  referencia   date not null,
  valor        numeric(14,4) not null,
  unidade      text not null default '%',

  fonte        text not null,
  coletado_em  timestamptz not null default now(),

  /** Falhas seguidas na coleta. O assistente avisa quando o dado envelhece. */
  falhas       int not null default 0,
  ultimo_erro  text
);

comment on table public.indicadores_economicos is
  'Último valor conhecido de cada indicador público. Uma linha por '
  'indicador — o histórico não é guardado aqui porque ninguém pergunta '
  'pelo IPCA de março pelo chat; para série histórica, a fonte é o BCB.';

comment on column public.indicadores_economicos.referencia is
  'Mês ou dia do INDICADOR, não da coleta. O IPCA sai com defasagem, e '
  'responder sem a referência faz o cliente entender que é do mês corrente.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- Leitura para qualquer autenticado: é dado público e igual para todos.
-- Escrita para ninguém — quem grava é a API, com a chave de serviço.

alter table public.indicadores_economicos enable row level security;

drop policy if exists indicadores_select on public.indicadores_economicos;
create policy indicadores_select on public.indicadores_economicos
  for select to authenticated
  using (true);

grant select on public.indicadores_economicos to authenticated;

-- ---------------------------------------------------------------------
-- MARCAR FALHA SEM PERDER O VALOR
-- ---------------------------------------------------------------------
-- A coleta falha e o número anterior continua valendo: a Selic de ontem
-- é a Selic de hoje em quase todos os dias. Apagar a leitura por causa de
-- uma coleta falha trocaria um dado levemente velho por nenhum dado.
--
-- Função em vez de update direto porque ela incrementa — e incremento
-- feito pela aplicação precisaria ler antes, o que abre corrida entre
-- duas passadas do relógio.

create or replace function public.fn_indicador_falhou(
  p_codigo text,
  p_erro   text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  update public.indicadores_economicos
     set falhas = falhas + 1,
         ultimo_erro = p_erro
   where codigo = p_codigo
$fn$;

revoke all on function public.fn_indicador_falhou(text, text) from public;
grant execute on function public.fn_indicador_falhou(text, text) to service_role;

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
--   select codigo, nome, referencia, valor, unidade, coletado_em, falhas
--     from public.indicadores_economicos
--    order by codigo;
--
-- Vazia logo após aplicar. A primeira coleta preenche.
--
-- Se `falhas` passar de 3 em algum indicador, a fonte está recusando e
-- vale olhar o `ultimo_erro`.
