# WhatsApp → CRM

O que muda no fluxo 07: além de responder, cada contato vindo de um botão
identificado passa a entrar no funil como card em "Novo".

## O ajuste que vale mais que todo o resto

**No anúncio da Meta, a mensagem pré-preenchida precisa terminar com um
código de origem.** Algo assim:

> Quero fazer o diagnóstico gratuito da minha empresa. (ref: anuncio)

Esse parêntese é o que faz a corrente inteira funcionar: dispara a resposta
automática certa, cria o lead com origem `anuncio` e permite separar quem
veio do anúncio de quem veio do site. Sem ele, o contato do anúncio é
indistinguível de um conhecido mandando mensagem — e o fluxo fica em
silêncio de propósito, sem registrar nada.

É um campo de texto no Gerenciador de Anúncios, e leva dez segundos. Mas
só dá para fazer **antes** de a campanha subir: os cliques que chegarem
sem o código não voltam.

Se rodar mais de um criativo, use um código por criativo — `(ref: anuncio-a)`,
`(ref: anuncio-b)`. Qualquer código começado por `anuncio` recebe a mesma
resposta, e o texto exato fica gravado em `leads.wa_ref`, o que permite
comparar criativos depois.

## Antes de ativar

1. No nó **Ler Mensagem e Escolher Resposta**, troque
   `COLE_AQUI_O_ID_DA_EMPRESA` pelo id da empresa Business Triage.
2. No nó **API — Registrar Lead**, troque `COLE_AQUI_O_SEGREDO` pelo
   valor de `N8N_WEBHOOK_SECRET`.
3. Confirme que a empresa tem o recurso `crm` liberado. Sem ele a API
   responde `sem_crm` e não registra — de propósito, para não acumular
   lead invisível numa tela que ninguém abre.

## O que testar antes da campanha

Mande para o número da Business Triage, do seu celular pessoal:

- `oi (ref: anuncio)` → resposta automática do anúncio, card novo no funil.
- a mesma mensagem de novo → resposta não repete, e **nenhum card novo**.
  Este é o teste que importa: conversa de WhatsApp tem dez mensagens, e
  dez cards por pessoa quebrariam a conta do CAC.
- `oi` sem código → silêncio, nenhum card. É o comportamento certo para
  quem já tem o número salvo.

## O que ainda não acontece

Nada é enviado de volta para a Meta. A view `vw_eventos_meta` já monta os
eventos, mas o envio depende de duas coisas que não estão prontas: a
aprovação do app na Meta e um ajuste na política de privacidade do site —
que hoje promete não ceder dados a terceiros. Ver o fim do arquivo
`supabase/sql/30_lead_whatsapp.sql`.

---

# Histórico das conversas (arquivo 32)

## O que mudou para permitir replicar

O `tenant_id` saiu do nó do n8n. A empresa passou a ser resolvida pela
API a partir do **nome da instância**, na tabela `whatsapp_instancias`.

Com isso um fluxo só atende a rede inteira: ligar um cliente novo é uma
linha no banco, não uma cópia do fluxo. Dez cópias do mesmo fluxo divergem
em semanas — alguém corrige uma e esquece as outras — e essa é a falha
mais provável de uma solução replicada.

Efeito colateral bom: o n8n deixou de poder escrever em qualquer empresa.
Ele só alcança a que estiver ligada à instância que lhe entregou a
mensagem.

```sql
insert into public.whatsapp_instancias (instancia, tenant_id, rotulo)
values ('wa_ultimo', 'ID_DA_BUSINESS_TRIAGE', 'Business Triage');
```

O nome da instância é o campo `instance` que a Evolution manda em todo
evento. **Confira num log antes de cadastrar** — errar aqui faz o
roteamento devolver nulo e nada ser gravado, sem erro nenhum.

## O que é guardado, e o que não é

| Guarda | Não guarda |
|---|---|
| Texto das mensagens, dos dois lados | Fotos, áudios e documentos |
| Que houve um áudio, uma foto, um documento | Conversa de quem não é lead |
| Data e hora | Nada além de 180 dias |

Os anexos ficam só no WhatsApp de propósito: é onde mora o pior risco —
foto de documento, comprovante bancário — e o que menos ajuda a
negociação.

## O expurgo é parte do produto

O fluxo 10 roda todo dia às 4h e apaga o que passou do prazo. Ele é o que
torna verdadeira a promessa de retenção. Política que depende de alguém
lembrar de limpar não é política, e a diferença aparece numa fiscalização.

## Antes de vender isto a um cliente

Guardar conversa do cliente do seu cliente faz de você **operador** de
dado pessoal de terceiros. O contrato precisa dizer que a plataforma
armazena o histórico, por quanto tempo, que o cliente é o controlador e
responde pelo aviso aos titulares dele, e o que acontece com o histórico
quando o contrato acaba.

Não é formalidade: é o que separa um recurso que se vende de um passivo
que se herda.

## O que isto NÃO resolve

Não protege contra o banimento do número. Se a instância não oficial for
derrubada, o histórico continua aqui — mas o canal morreu e os leads em
negociação ficam sem resposta. A mitigação do banimento é outra: número
dedicado, volume controlado, e a Cloud API oficial quando o cliente
escalar.
