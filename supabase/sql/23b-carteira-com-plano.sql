-- Acrescenta plano e liberações extras à carteira do consultor.
--
-- As colunas novas entram no FIM da lista, o que permite `create or
-- replace` sem derrubar a view. Inserir no meio exigiria DROP, e o DROP
-- falharia se alguma outra view dependesse desta.
--
-- O score mensal entra junto: com o ciclo automático no ar, o "score
-- atual" de um assinante passa a vir de `diagnosticos_mensais`, e não do
-- último diagnóstico avulso. `coalesce` mantém a resposta certa para
-- quem só tem o avulso.

create or replace view public.vw_staff_tenants
with (security_invoker = on) as
select
  t.id,
  t.name,
  t.tax_id,
  t.is_active,
  t.created_at,
  t.consultoria_id,
  k.nome                                                 as consultoria,
  (select count(*) from public.memberships m
    where m.tenant_id = t.id and m.is_active)            as qtd_usuarios,
  (select count(*) from public.transactions x
    where x.tenant_id = t.id)                            as qtd_lancamentos,
  (select max(x.created_at) from public.transactions x
    where x.tenant_id = t.id)                            as ultimo_lancamento,
  mz.score_total                                         as marco_zero_score,
  mz.assinado_em                                         as marco_zero_em,
  coalesce(
    (select dm.score_total from public.diagnosticos_mensais dm
      where dm.tenant_id = t.id and dm.status = 'calculado'
      order by dm.competencia desc limit 1),
    (select d.score_total from public.diagnosticos d
      where d.tenant_id = t.id and d.score_total is not null
      order by d.created_at desc limit 1)
  )                                                      as score_atual,
  t.plano,
  pl.nome                                                as plano_nome,
  pl.ordem                                               as plano_ordem,
  t.plano_desde,
  t.recursos_extras
from public.tenants t
left join public.marcos_zero mz on mz.tenant_id = t.id
left join public.consultorias k on k.id = t.consultoria_id
left join public.planos pl on pl.codigo = t.plano;

grant select on public.vw_staff_tenants to authenticated;
