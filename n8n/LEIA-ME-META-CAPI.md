# Devolver os resultados à Meta

Quando um lead de anúncio avança para Reunião, Qualificado ou Proposta, a
Meta recebe um evento `Lead`. Quando ele fecha, recebe um `Purchase` com o
valor. É isso que faz o algoritmo procurar mais gente parecida com quem
fecha, em vez de mais gente parecida com quem só clica.

## O que mudou em relação à especificação original

Três pontos, e vale saber por quê.

**A versão do Graph API.** A especificação pedia `v19.0`, que foi
aposentada. Evento enviado para versão aposentada para de ser aceito — e o
sintoma é a integração simplesmente emudecer. Ficou em variável de
ambiente (`META_API_VERSION`, hoje `v23.0`) para a atualização ser uma
linha no `.env`.

**O tipo de conversão.** A especificação usava o padrão de site. Para
anúncio de clique-para-WhatsApp é preciso `action_source:
"business_messaging"` e `messaging_channel: "whatsapp"` — sem os dois, a
Meta não entende que a conversão veio de um anúncio de WhatsApp e o
identificador do clique é ignorado. Com o padrão de site, a campanha
casaria zero eventos.

**A fila, no lugar do webhook.** A especificação previa um webhook do CRM
disparando o envio. Num CRM de terceiro é obrigatório; aqui o CRM é nosso.
E o motivo principal é outro: mover um card é a ação mais repetida da tela
e não pode depender de a Meta estar de pé. Se estivesse lenta, o consultor
veria o card travar. O movimento grava na fila e termina; quem conversa
com a Meta é um processo separado, que pode falhar e tentar de novo.

A especificação também não mencionava **deduplicação**, que é o defeito
mais caro possível aqui: sem um `event_id` estável, cada reenvio contaria
o mesmo lead outra vez e a campanha seria otimizada para um número
inflado. Está resolvido — cada evento nasce com o seu, e ele viaja em toda
tentativa.

## Variáveis de ambiente

No `/opt/finance-src/api/.env`:

```
META_DATASET_ID=            # Gerenciador de Eventos → sua fonte de dados → ID
META_ACCESS_TOKEN=          # Configurações → Conversions API → Gerar token
META_API_VERSION=v23.0
META_TEST_EVENT_CODE=       # deixe preenchido durante o teste, apague depois
```

Enquanto `META_DATASET_ID` ou `META_ACCESS_TOKEN` estiverem vazios, a rota
responde que a integração está desligada e não envia nada. É o estado
certo até a política de privacidade estar no ar.

O token da CAPI é permanente e dá acesso de escrita à sua fonte de dados.
Trate como senha: só no `.env` do servidor, nunca no n8n, nunca em
mensagem.

## Como testar no Gerenciador de Eventos

1. No Gerenciador de Eventos, abra sua fonte de dados → aba **Eventos de
   Teste**. Copie o código que aparece (formato `TEST12345`).
2. Ponha em `META_TEST_EVENT_CODE` no `.env` e reinicie a API.
3. No CRM, arraste um lead de origem "anúncio" para Reunião.
4. Dispare o fluxo 09 à mão no n8n, ou espere quinze minutos.
5. O evento deve aparecer na aba Eventos de Teste em segundos.

**O que conferir na tela da Meta**, e não só se apareceu:

- **Qualidade da correspondência.** É o número que diz se a Meta
  conseguiu reconhecer a pessoa. Evento aceito com correspondência zero é
  evento inútil — e a Meta responde 200 do mesmo jeito.
- **Parâmetros recebidos.** `ph` deve estar lá. `ctwa_clid` também, se o
  lead veio de clique-para-WhatsApp.

Quando estiver certo, **apague `META_TEST_EVENT_CODE`** e reinicie. Evento
de teste não conta para otimização — esquecer essa linha preenchida
significa a campanha rodando sem sinal nenhum, sem nenhum aviso.

## O risco que você deve acompanhar

```sql
select * from public.vw_eventos_meta;
```

A coluna **`com_clique`** conta quantos eventos levaram o `ctwa_clid`, o
identificador do clique do anúncio. Ele é a chave de correspondência boa.

O problema: esse identificador é entregue de forma confiável pela **API
oficial do WhatsApp Business (Cloud API)**. Nós usamos a **Evolution**, que
é um cliente não oficial, e não há garantia de que ele chegue.

Por isso o fluxo 07 já guarda o contexto cru da primeira mensagem. Depois
dos primeiros cliques da campanha, rode:

```sql
select contato_payload from public.leads
where origem = 'anuncio' and contato_payload is not null
order by created_at desc limit 5;
```

- **Se aparecer algo com `ctwa_clid` ou `externalAdReply`**, ótimo. Me
  mostre o formato e eu ajusto o gatilho para ler do lugar certo.
- **Se vier tudo vazio**, a atribuição vai depender só do telefone com
  hash. Funciona, com taxa de correspondência menor. A alternativa é
  migrar para a Cloud API oficial — decisão de infraestrutura, não de
  código, e que só vale a pena decidir com o dado da primeira campanha na
  mão.

Esse é o motivo de a captura ter sido feita antes de a campanha subir:
não dá para coletar depois.

## O que ainda não está ligado

O `Purchase` de fechamento manda `valor_estimado` do lead. Se o card for
fechado sem valor preenchido, o evento vai sem valor e a Meta não consegue
otimizar por retorno — só por volume de fechamento. Preencher o valor ao
mover para "Fechou" é hábito, não código.
