# Tirar o n8n do caminho dos diagnósticos

O formulário do site passa a falar direto com a API. Um salto em vez de
três, tudo versionado e testado, e a volta atrás é uma linha no `.env`.

**Pré-requisito:** o vigia (`VIGIA.md`) já implantado. Sem ele, uma falha
depois da resposta ao site continua invisível.

---

## O que mudou de comportamento

| | Antes (n8n) | Agora (API) |
|---|---|---|
| Régua comercial | Nó de código sem teste | `regua-comercial.ts`, 25 testes, paridade de 20 mil casos |
| Prompt da IA | Só dentro do banco do n8n | Versionado, com teste de privacidade |
| Resposta do modelo | Aceita como veio | Validada por schema estrito, uma retentativa |
| Falha no meio | Mata tudo que vem depois | Isolada por passo |
| Protocolo mostrado ao cliente | **Inventado no navegador** | O que o servidor gravou |
| Dado identificável no prompt | Pedido ao modelo que ignorasse | Removido pelo código, com teste |
| Execução perdida | Invisível | `vw_execucoes` marca como `travado` |

**A política de envio ficou explícita.** Comercial sai na hora;
financeiro espera a janela das 8h. Antes isso era efeito colateral da
ordem dos nós — ninguém tinha decidido, só acontecia. Agora é
`POLITICA_ENVIO`, em código, com teste.

---

## Passo 0 — Enviar o código

```powershell
cd C:\Projetos\saasfinanceiro
git add -A
git commit -m "Diagnosticos na API: regua comercial, prompt versionado, orquestracao isolada e rota publica"
git push

cd "C:\Projetos\business-triage"
git add -A
git commit -m "Formulario posta na API; protocolo vem do servidor"
git push
```

---

## Passo 0.5 — O SQL do disjuntor

Junto com o `34-para-colar.sql` do vigia, cole também
**`supabase/sql/35-para-colar.sql`**.

```sql
select to_regclass('public.ia_uso')          as tabela,
       to_regproc('public.fn_ia_reservar')   as reserva;
```

Ele é o teto diário de chamadas ao modelo. Sem ele, a API sobe e roda —
só sem proteção contra um defeito que consuma sem parar.

## Passo 1 — As variáveis novas na API

> **Este passo roda UMA vez.** O `>>` acrescenta ao fim do arquivo, e o
> dotenv usa a última ocorrência de cada chave. Rodar de novo sobrescreve
> valores já preenchidos com as linhas vazias do modelo — sem erro
> nenhum, e o sintoma aparece só quando o e-mail deixa de sair.
>
> Antes de colar, confira se já não está lá:
>
> ```bash
> grep -c ^SMTP_HOST= /opt/finance-src/api/.env
> ```
>
> Se der 1 ou mais, pule este passo e edite só o que faltar.

```bash
cat >> /opt/finance-src/api/.env <<'EOF'
ANTHROPIC_API_KEY=sk-ant-COLE_A_CHAVE
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS=16000
IA_LIMITE_DIARIO=60

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_REMETENTE=Business Triage <contato@businesstriage.com.br>
EMAIL_INTERNO=contato@businesstriage.com.br
EOF
```

**As credenciais de SMTP são as mesmas que o n8n já usa.** Pegue-as na
credencial `SMTP` do n8n — mesmo servidor, mesmo remetente, então SPF,
DKIM e reputação não mudam. Quem usa Gmail é só o fluxo das 8h, que é
justamente o que quebrou.

Preencha as quatro linhas do SMTP antes de subir: vazias, a API grava o
diagnóstico e não manda e-mail nenhum.

---

## Passo 2 — Subir e conferir

```bash
cd /opt/finance-src && git pull
cd api && docker compose up -d --build finance-api
docker compose logs --tail 30 finance-api
```

---

## Passo 3 — Testar sem envolver o site

```bash
docker exec finance-api wget -qO- \
  --header='Content-Type: application/json' \
  --post-data='{"identificacao":{"email":"SEU@EMAIL.com","cnpj":"12345678000199","razao_social":"Teste BT","setor":"Comercio","mes_referencia":"08/2026"},"comercial":{"uso_crm":"PARCIAL","processo_funil_definido":"SIM","nivel_metricas_funil":"BASICO","previsibilidade_leads":"MEDIA","origem_leads":"MISTA","calcula_cac":"NAO","gestao_metas":"MENSAL","perfil_vendedores":"HIBRIDA","modelo_remuneracao":"FIXO_MAIS_COMISSAO","estrategia_upsell":"REATIVA","pos_venda_estruturado":"REATIVO","ticket_medio":1500,"observacoes":"teste"}}' \
  http://localhost:3333/api/v1/diagnostico/comercial
```

A resposta é **imediata**, com o score:

```json
{"ok":true,"protocolo":"12345678-C...","scoreTotal":44,"nivelSaude":"Comercial Informal"}
```

O relatório chega no e-mail informado **um minuto depois** — é o tempo da
análise. Acompanhe:

```bash
docker compose logs -f finance-api | grep -i -E 'diagn|claude|e-mail'
```

E no Supabase:

```sql
select processo, situacao, duracao_seg, erro
from public.vw_execucoes
where processo like 'diagnostico%'
order by iniciado_em desc limit 5;

select protocolo, status, tentativas, enviado_em, erro
from public.diagnosticos order by created_at desc limit 5;
```

`situacao = 'ok'` e `status = 'enviado'` fecham o teste. **Não siga sem
receber o PDF no e-mail.**

---

## Passo 4 — O financeiro

Mesmo comando, trocando o fim do endereço para `/financeiro` e o corpo
para os quatro blocos (`dre`, `caixa`, `endividamento`, `qualitativo`).

Aqui o esperado é diferente: chega uma **confirmação** ao lead e o
**aviso interno com o link de segurar**. O relatório fica `pendente` para
a janela das 8h.

---

## Passo 5 — Virar a chave no site

Só depois dos passos 3 e 4 passarem.

```powershell
cd "C:\Projetos\business-triage"
npm run build
```

E publique como você já publica. As variáveis novas já estão no
`.env.production`.

Em seguida, **desative os dois fluxos de diagnóstico no n8n**. Com os
dois ligados, cada formulário geraria dois diagnósticos e duas chamadas
pagas ao Claude.

---

## Passo 6 — O teste de verdade

Pelo site, com `www` e sem `www`:

| Formulário | Esperado |
|---|---|
| Comercial | Tela de sucesso com protocolo; relatório em PDF no e-mail em ~1 min |
| Financeiro | Tela de sucesso; confirmação no e-mail; aviso interno com link de segurar |

Confira que **o protocolo da tela é o mesmo do banco** — antes não era.

```sql
select protocolo, tipo, status, score_total from public.diagnosticos
order by created_at desc limit 5;
```

---

## Voltar atrás

Apague estas duas linhas do `.env.production` do site e reconstrua:

```
VITE_API_DIAGNOSTICO_FINANCEIRO=...
VITE_API_DIAGNOSTICO_COMERCIAL=...
```

O código volta a usar `VITE_N8N_WEBHOOK_*` sozinho. Reative os dois
fluxos no n8n. Nada foi apagado.

---

## O que ficou pendente, de propósito

**Se o contêiner morrer entre a resposta ao site e o fim da análise, o
diagnóstico se perde.** A linha em `execucoes` fica sem `terminado_em` e
`vw_execucoes` a marca como `travado` — é visível, que é a diferença que
importa, mas não é automático.

A correção é gravar o registro como `processando` antes da análise e ter
uma varredura que retoma os travados. Vale fazer, e vale fazer depois de
a migração estar de pé: misturar as duas coisas esconde uma na outra.

**O corte de 66 contra o de 70** na classificação comercial continua
divergindo do `corDoScore` do PDF. Um score de 67 sai com etiqueta de um
patamar e cor de outro. Corrigir exige subir a versão da régua, e a
versão precisa ser carimbada nos diagnósticos antigos — está descrito em
`regua-comercial.ts`.

**Os fluxos exportados do n8n ainda não estão no repositório.** Eles têm
segredo em texto puro e precisam de limpeza antes de entrar no git. As
cópias estão em `/root/fluxos-n8n` e `/root/fluxos.tgz` no servidor.
