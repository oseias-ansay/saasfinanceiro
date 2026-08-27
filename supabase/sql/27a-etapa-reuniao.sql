-- =====================================================================
-- 27a — A ETAPA "REUNIÃO"
-- =====================================================================
-- Precisa rodar SOZINHO, antes do 27b.
--
-- `alter type ... add value` não permite usar o valor novo na mesma
-- transação em que ele foi criado. Como o 27b insere linhas com
-- 'reuniao', juntar os dois faria o Postgres recusar com "unsafe use of
-- new value of enum type".
--
-- Rode este, confirme o sucesso, e só então rode o 27b.
-- =====================================================================

alter type public.etapa_lead add value if not exists 'reuniao' after 'contato';
