# Implantação — CRM no WhatsApp, Meta e histórico de conversas

Tudo o que foi construído nesta rodada, na ordem em que precisa entrar.

## A ordem não é arbitrária

Três dependências mandam na sequência, e furar qualquer uma custa retrabalho:

1. **A política de privacidade vai ao ar antes do primeiro evento enviado
   à Meta.** Não é etapa de documentação: enviar dado de contato a um
   terceiro sem a página no ar é o problema, e a página é a correção.
2. **O SQL vem antes da API.** As rotas novas chamam funções do banco. Na
   ordem inversa, a API sobe e devolve erro em tudo.
3. **O `30` vem antes do `31` e do `32`.** Os dois usam a chave de
   telefone e a coluna de contexto que o `30` cria.

Se precisar parar no meio, os pontos seguros são: depois do passo 4 (o
CRM captura leads, e nada é enviado à Meta) e depois do passo 7 (tudo
funciona em modo de teste).

## O que exatamente vai junto

| Onde | O que mudou | Passo |
|---|---|---|
| `supabase/sql/30, 31, 32` | Lead pelo telefone, fila da Meta, histórico | 2 |
| `api/.../webhooks/whatsapp.routes.ts` | Contato vira lead, mensagem gravada, expurgo | 4 |
| `api/.../meta/capi.ts` e `meta.routes.ts` | Conversions API, com testes | 4 e 7 |
| `api/.../crm/crm.routes.ts` | A conversa entra no detalhe do lead | 4 |
| `api/.../config/env.ts` e `app.ts` | Variáveis da Meta e rotas novas | 4 |
| `src/pages/Privacidade.tsx` | Meta, hash, fronteira do que não sai | 3 |
| `src/lib/utm.ts` e `main.tsx` | Captura da origem na chegada | 3 |
| `src/lib/subdominio.ts`, `App.tsx`, `PaginaConsultor.tsx` | Uma fonte só para o slug | 3 |
| `src/components/DiagnosticoFinanceiroModal.tsx` | A origem viaja no formulário | 3 |
| `src/modules/.../PainelLead.tsx` | A conversa dentro do card | 3 |
| `n8n/workflow-07` | Instância em vez de id fixo; grava lead e conversa | 5 |
| `n8n/workflow-09` e `10` | Envio à Meta e expurgo | 7 e 6 |

Fora da implantação: `ENSAIO.md` e os três `LEIA-ME` são documentação e
não precisam de nenhuma ação no servidor.

**Um efeito colateral para saber:** a lista de subdomínios reservados
estava duplicada em dois arquivos e virou uma só, ganhando `painel`,
`login`, `suporte` e `blog`. Se alguma consultoria tiver um desses como
slug, a página dela para de abrir. Confira antes:

```sql
select slug from public.consultorias
where slug in ('painel','login','suporte','blog');
```

---

## 0. Enviar o código

Nada disso existe no servidor ainda. Os passos 3 e 4 dão `git pull` lá, e
sem isto o pull não traz nada — o servidor responde `Already up to date` e
você passa meia hora procurando defeito onde não há.

Nos **dois** repositórios, na sua máquina:

```powershell
cd C:\Projetos\saasfinanceiro
git add -A
git commit -m "CRM pelo WhatsApp, eventos para a Meta e historico de conversas"
git push

cd "C:\Projetos\business-triage"
git add -A
git commit -m "Privacidade, captura de UTM e conversa no card do lead"
git push
```

Confirme que o push saiu:

```powershell
git status -sb
```

A primeira linha deve dizer só `## main...origin/main`. Se aparecer
`[ahead 1]`, o commit está local e o push não foi.

---

## 1. Conferir duplicidade antes de tudo

No Supabase, **antes** de rodar qualquer arquivo:

```sql
select tenant_id, count(*), array_agg(nome)
from public.leads
where telefone is not null
group by tenant_id,
  substr(
    case when length(regexp_replace(telefone,'\D','','g')) in (12,13)
          and regexp_replace(telefone,'\D','','g') like '55%'
         then substr(regexp_replace(telefone,'\D','','g'),3)
         else regexp_replace(telefone,'\D','','g') end, 1, 2)
  || right(regexp_replace(telefone,'\D','','g'), 8)
having count(*) > 1;
```

**Se voltar vazio, siga.** Se voltar alguma linha, são leads repetidos —
junte-os à mão primeiro, senão o índice único do passo 2 falha. Vale o
trabalho: cada duplicata é um lead a mais no denominador do CAC.

---

## 2. SQL, um arquivo por vez

No editor do Supabase, **arquivo inteiro, um de cada vez**, conferindo o
resultado antes do seguinte.

### `supabase/sql/30_lead_whatsapp.sql`

Cria a chave de telefone, as colunas novas em `leads` e a função que acha
ou cria o lead.

Confira depois de rodar:

```sql
select tel, public.fn_tel_chave(tel) from (values
  ('5541999998888'), ('554199998888'), ('(41) 99999-8888'),
  ('5555999998888'), ('55999998888')
) t(tel);
```

Esperado: `4199998888`, `4199998888`, `4199998888`, `5599998888`,
`5599998888`. As três primeiras iguais entre si e as duas últimas iguais
entre si — o mesmo celular escrito de formas diferentes. A do DDD 55 é a
que pega o erro clássico.

### `supabase/sql/31_meta_capi.sql`

Cria a fila de eventos para a Meta e o gatilho que a alimenta.

### `supabase/sql/32_conversas_whatsapp.sql`

Cria `whatsapp_instancias` — o roteamento que diz de qual empresa é cada
número — e `lead_mensagens`, o histórico das conversas.

### 2.4. Confira que os três entraram

**Não pule para o cadastro sem rodar isto.** Sem o `32`, a tabela
`whatsapp_instancias` não existe e o insert abaixo falha.

```sql
select
  to_regclass('public.eventos_meta')        as tab_eventos_meta,
  to_regclass('public.whatsapp_instancias') as tab_instancias,
  to_regclass('public.lead_mensagens')      as tab_mensagens,
  to_regproc('public.fn_tel_chave')         as fn_tel_chave,
  to_regproc('public.fn_lead_do_whatsapp')  as fn_lead,
  to_regproc('public.fn_gravar_mensagem')   as fn_mensagem,
  to_regproc('public.fn_purgar_mensagens')  as fn_purgar;
```

As sete colunas precisam vir preenchidas. Qualquer `null` aponta o
arquivo que faltou: as três primeiras e `fn_purgar` vêm do `31` e do
`32`; `fn_tel_chave` e `fn_lead`, do `30`.

### 2.5. Cadastre a instância e libere o CRM

```sql
-- 1. Qual é o id da empresa Business Triage.
--    A coluna é `name`, em inglês, como o resto do schema original.
select id, name from public.tenants order by created_at;

-- 2. Ligue a instância do WhatsApp a ela.
--    Confira o nome da instância num log da Evolution antes: errar aqui
--    faz o roteamento devolver nulo e nada ser gravado, sem erro nenhum.
insert into public.whatsapp_instancias (instancia, tenant_id, rotulo)
values ('wa_ultimo', 'COLE_O_ID', 'Business Triage');

-- 3. Libere o CRM para ela, como piloto
insert into public.tenant_recursos (tenant_id, recurso, inicio, tipo)
values ('COLE_O_ID', 'crm', current_date, 'piloto')
on conflict do nothing;

-- 4. Confirme
select public.fn_tenant_tem_recurso('COLE_O_ID', 'crm');  -- tem de dar true
```

---

## 3. Publicar a política de privacidade

**Antes da API**, porque é o passo que não pode ficar para depois.

```bash
cd /var/www/bt
git pull
npm ci
npm run build
```

Abra `businesstriage.com.br/privacidade` e confirme que aparecem:

- a linha da Meta na tabela de fornecedores;
- o parágrafo que diz que o hash **não** é anonimização;
- a frase sobre poder recusar por e-mail;
- na seção Confidencialidade, a fronteira do que nunca sai — faturamento,
  dívida, margem, saldo e diagnóstico.

Isso também publica a captura de UTM e a conversa dentro do card.

---

## 4. Subir a API

```bash
cd /opt/finance-src
git pull
cd api
docker compose up -d --build
docker compose logs --tail 40
```

Confirme que subiu:

```bash
curl -s https://api-financeiro.businesstriage.com.br/health
```

Neste ponto **a integração com a Meta ainda está desligada** — sem as
variáveis, a rota responde que não está configurada e não envia nada. É o
estado certo por enquanto.

---

## 5. Atualizar o fluxo 07 no n8n

Importe `n8n/workflow-07-whatsapp-inbound.json` por cima do existente.

Troque `COLE_AQUI_O_SEGREDO` em **dois** nós: *API — Registrar Lead* e
*API — Guardar Mensagem*. O valor é o `N8N_WEBHOOK_SECRET` do `.env`.

Não há mais id de empresa para colar: ele sai da instância agora.

### Teste, do seu celular pessoal

| O que mandar | O que tem de acontecer |
|---|---|
| `oi (ref: anuncio)` | Resposta automática do anúncio, card novo no funil |
| a mesma mensagem de novo | Sem resposta, e **nenhum card novo** |
| `bom dia, tudo bem?` | Sem resposta automática, mas a mensagem aparece na conversa do card |
| `oi` de um número que não é lead | Silêncio, nenhum card, nada gravado |

O segundo é o que mais importa. Conversa de WhatsApp tem dez mensagens, e
dez cards por pessoa dividiriam o CAC pelo número errado.

Abra o card no CRM e confirme que a conversa aparece acima das anotações.

---

## 6. Ativar o expurgo

Importe `n8n/workflow-10-purgar-mensagens.json`, troque o segredo, ative.

Dispare uma vez à mão. Deve responder `{"apagadas": 0}` — não há nada
velho ainda, e o que se está testando é que a rota responde.

Este fluxo é o que torna verdadeira a promessa de 180 dias. Ativá-lo não
é opcional.

---

## 7. Configurar a Meta, em modo de teste

No Gerenciador de Eventos: sua fonte de dados → **ID do conjunto de
dados**, e em Configurações → Conversions API → **gerar token**. Na aba
**Eventos de Teste**, copie o código no formato `TEST12345`.

No `/opt/finance-src/api/.env`:

```
META_DATASET_ID=...
META_ACCESS_TOKEN=...
META_API_VERSION=v23.0
META_TEST_EVENT_CODE=TEST12345
```

```bash
cd /opt/finance-src/api && docker compose up -d
```

Importe `n8n/workflow-09-eventos-meta.json`, troque o segredo, ative.

### O teste

1. No CRM, arraste um lead de origem "anúncio" para **Reunião**.
2. Dispare o fluxo 09 à mão.
3. O evento aparece na aba Eventos de Teste em segundos.

**Confira a qualidade da correspondência, não só se apareceu.** Evento
aceito com correspondência zero é evento inútil, e a Meta responde 200 do
mesmo jeito. Veja se `ph` chegou, e se `ctwa_clid` chegou quando o lead
veio de clique.

---

## 8. Ligar de verdade

Só depois de ver os eventos certos na aba de teste:

```bash
# apague a linha META_TEST_EVENT_CODE do .env
cd /opt/finance-src/api && docker compose up -d
```

**Esquecer essa linha preenchida significa a campanha rodando sem sinal
nenhum**, porque evento de teste não conta para otimização — e sem nenhum
aviso de que isso está acontecendo.

---

## 9. No Gerenciador de Anúncios, antes de subir a campanha

A mensagem pré-preenchida do anúncio precisa terminar com o código:

> Quero fazer o diagnóstico gratuito da minha empresa. (ref: anuncio)

É o que dispara a resposta certa, cria o lead com origem `anuncio` e
separa quem veio do anúncio de um conhecido mandando mensagem. Sem ele o
fluxo fica em silêncio de propósito e não registra nada.

Leva dez segundos e **só funciona antes**: clique que chegou sem o código
não volta. Com mais de um criativo, use `(ref: anuncio-a)`,
`(ref: anuncio-b)` — qualquer código começado por `anuncio` recebe a mesma
resposta, e o texto exato fica em `leads.wa_ref` para comparar depois.

---

## Depois dos primeiros cliques

```sql
select contato_payload from public.leads
where origem = 'anuncio' and contato_payload is not null
order by created_at desc limit 5;
```

Se aparecer `ctwa_clid` ou `externalAdReply`, me mostre o formato e eu
ajusto o gatilho para ler do lugar certo. Se vier tudo vazio, a Evolution
não entrega o identificador do clique e a atribuição fica só por telefone
— funciona, com acerto menor, e a alternativa é migrar para a Cloud API
oficial. Só dá para decidir com esse dado na mão, e por isso a captura
entrou antes da campanha.

```sql
select * from public.vw_eventos_meta;
```

`com_clique` é a coluna que responde isso.

---

## O que ficou pendente

- **O formulário do site ainda não cria lead no CRM.** A UTM já é
  capturada e viaja no envio, em `atribuicao`, mas o n8n ainda não faz
  nada com ela. Quem chega pelo site e preenche o diagnóstico continua
  aparecendo só no painel de Validação. Falta um nó no fluxo do
  diagnóstico.
- **O segredo do n8n nunca foi trocado.** Ele apareceu em texto claro em
  conversa. `openssl rand -hex 32`, atualizar o `.env`, reiniciar a API e
  trocar em todos os nós. Com os fluxos 09 e 10 novos, são mais dois
  lugares.
- **A tela de canais e CAC.** `vw_funil_canais` e a rota já existem; falta
  a tela. É o que deixaria você acompanhar a campanha sem abrir o banco.
- **O ensaio da jornada** (`ENSAIO.md`), nunca percorrido.
