-- =====================================================================
-- 41a — Os dois destinos que faltavam
-- =====================================================================
-- Precisa rodar SOZINHO, antes do 41.
--
-- O Postgres não deixa usar um valor de enum na mesma transação em que
-- ele foi criado — e o editor do Supabase roda cada script como uma
-- transação só. Com o `alter type` junto do `insert` que usa o valor
-- novo, o erro é:
--
--   55P04: unsafe use of new value "diagnostico" of enum type
--
-- Separar os dois num arquivo próprio resolve. Rode este, espere
-- terminar, e só então rode o 41.
-- =====================================================================

alter type public.atividade_destino add value if not exists 'categorias';
alter type public.atividade_destino add value if not exists 'diagnostico';

-- Confira antes de seguir — os seis valores têm de aparecer:
--
--   select unnest(enum_range(null::public.atividade_destino));
