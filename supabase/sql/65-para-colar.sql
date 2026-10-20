-- =====================================================================
-- 65 · O STAFF TAMBÉM PRECISA DA COERÊNCIA DA CONCLUSÃO
-- =====================================================================
-- Defeito achado em 19/10/2026, marcando uma ação como feita logado
-- como franqueador. A tela respondia:
--
--     "Estado inconsistente da conclusão. Recarregue a página."
--
-- Recarregar não resolvia, porque o problema não era de estado.
--
-- ---------------------------------------------------------------------
-- O QUE ACONTECIA
-- ---------------------------------------------------------------------
-- `tg_acao_protege_campos` começa liberando o staff:
--
--     if public.is_platform_staff() then
--       return new;
--     end if;
--
-- A intenção era certa — o staff pode mudar qualquer campo, e o resto
-- da função só existe para limitar o cliente. Mas o bloco que preenche
-- `concluida_em` vive DEPOIS desse return, junto com as restrições.
--
-- Então o staff saía antes dele, o update gravava `status = 'concluida'`
-- com `concluida_em` nulo, e a trava recusava:
--
--     constraint acao_conclusao_ck check (
--       (status = 'concluida' and concluida_em is not null)
--       or (status <> 'concluida' and concluida_em is null)
--     )
--
-- A trava está certa. Quem estava errado era o gatilho, que tratou a
-- coerência da conclusão como se fosse uma restrição ao cliente. Não é:
-- é um INVARIANTE da tabela, e vale para todo mundo que escreve nela.
--
-- ---------------------------------------------------------------------
-- POR QUE NÃO MANDAR A DATA PELO FRONT
-- ---------------------------------------------------------------------
-- Seria uma linha no `usePdca.ts` e estaria errado. A data de conclusão
-- entra na medição de ritmo — é dela que sai "concluiu cinco na véspera
-- da reunião". Relógio de navegador é editável, e medição que o medido
-- pode ajustar não mede nada.
--
-- ---------------------------------------------------------------------
-- O STAFF CONTINUA PODENDO DATAR À MÃO
-- ---------------------------------------------------------------------
-- O preenchimento automático só age quando `new.concluida_em` vem nulo.
-- Um consultor registrando que a ação foi feita na semana passada manda
-- a data e ela é respeitada — o gatilho não sobrescreve.
--
-- Sem essa guarda, a correção consertaria um caso e quebraria outro:
-- toda conclusão retroativa viraria "agora".
--
-- ---------------------------------------------------------------------
-- NÃO HÁ LINHA PARA CORRIGIR
-- ---------------------------------------------------------------------
-- A trava impediu a gravação, então nenhuma ação ficou num estado ruim.
-- O defeito custou tentativas que não funcionaram, não dado sujo.
-- =====================================================================

create or replace function public.tg_acao_protege_campos()
returns trigger language plpgsql security definer
-- Delimitador `$fn$` e não `$$`, como no SQL 26: o editor do Supabase
-- quebra o corpo no `$$` e o erro chega como "syntax error at or near
-- if", apontando para o meio da função. Aconteceu em 19/10/2026.
set search_path = public, pg_temp as $fn$
declare
  v_origem public.plano_origem;
begin
  -- -------------------------------------------------------------------
  -- Coerência entre status e data da conclusão.
  --
  -- ANTES das bifurcações de papel, de propósito: é invariante da
  -- tabela, não permissão. Pôr isto depois do `return new` do staff foi
  -- o defeito de 19/10/2026 — e o sintoma ("estado inconsistente")
  -- apontava para a tela, não para aqui.
  -- -------------------------------------------------------------------
  if new.status = 'concluida' and old.status is distinct from 'concluida' then
    -- `is null` protege a conclusão retroativa que o consultor informa.
    if new.concluida_em is null then
      new.concluida_em  := now();
      new.concluida_por := auth.uid();
    end if;
  elsif new.status <> 'concluida' then
    new.concluida_em  := null;
    new.concluida_por := null;
  end if;

  -- Staff altera o resto livremente.
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

  return new;
end $fn$;

drop trigger if exists acao_protege_campos on public.acoes;
create trigger acao_protege_campos before update on public.acoes
  for each row execute function public.tg_acao_protege_campos();

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- A função tem a coerência ANTES do atalho do staff. As duas colunas
-- precisam vir `true`:
--
-- select
--   position('is_platform_staff' in prosrc)
--     > position('new.concluida_em  := now()' in prosrc)  as ordem_certa,
--   prosrc like '%new.concluida_em is null%'              as respeita_data_informada
-- from pg_proc
-- where proname = 'tg_acao_protege_campos';
--
-- E nenhuma ação em estado incoerente (a trava já garante, mas custa
-- nada confirmar — tem de vir zero):
--
-- select count(*) from public.acoes
--  where (status = 'concluida') <> (concluida_em is not null);
