# O vigia — acabar com as falhas silenciosas

Todo defeito caro desta plataforma teve a mesma forma: **alguma coisa
deixou de acontecer, e nada avisou.**

- o relatório das 8h parou de sair, e o alarme que deveria avisar usava a
  mesma credencial do Gmail que tinha quebrado;
- o formulário do site passou a falhar só para quem entrava com `www`, e
  o log do servidor mostrava 200;
- o fluxo do WhatsApp abortava no primeiro nó e os dois seguintes nunca
  rodavam;
- a suíte de testes rodava 7 de 91 e dizia "pass".

Nenhum gerou erro. Um sistema que só sabe reclamar do que aconteceu é
cego para o que deixou de acontecer — e é aí que mora o prejuízo, porque
o cliente percebe antes de você.

## A inversão

Em vez de esperar um erro, o vigia parte de uma lista do que **deveria**
ter acontecido e cobra cada item. Silêncio deixa de ser ausência de
notícia e passa a ser a notícia.

Três peças:

| Peça | Onde | O que faz |
|---|---|---|
| Registro | `supabase/sql/34_execucoes.sql` | Guarda que um processo rodou, quando, com quantos itens e se deu certo |
| Catálogo | `api/src/modules/monitor/monitor.ts` | A lista do que deveria rodar, e de quanto em quanto tempo |
| Alarme | `api/src/modules/monitor/monitor.service.ts` | Compara os dois e avisa pelo WhatsApp |

O catálogo fica em código, não numa tabela, de propósito: processo
agendado nasce e morre junto com o código que o implementa. Numa tabela,
a lista envelheceria em silêncio — o mesmo defeito, um andar acima.

## O que está sendo vigiado

| Processo | Quando deveria rodar | O que custa se parar |
|---|---|---|
| Envio dos diagnósticos | Dias úteis, 8h | Prospects não recebem o relatório prometido |
| Lançamentos recorrentes | Todo dia, 3h | O saldo projetado dos clientes mente |
| Alertas diários | Dias úteis, 8h | Ninguém é avisado de conta vencendo |
| Fechamento mensal | Dia 5, 8h | A curva do score não avança e a cobrança não sai |
| Eventos para a Meta | A cada 15 min | A campanha otimiza às cegas |
| Expurgo das conversas | Todo dia, 4h | Conversas passam do prazo prometido em contrato |

Feriado nacional não é tratado, de propósito: gera um alarme falso por
ano, e alarme falso raro é barato. Uma tabela de feriados que envelhece
sem ninguém notar — e que faria o vigia calar no dia errado — é cara.

## Duas decisões que fazem a diferença

**O alarme vai por WhatsApp, não por e-mail.** Não é preferência de
canal. O alarme anterior era um nó de Gmail que usava a mesma credencial
do envio que ele vigiava; quando o Gmail quebrou, os dois calaram juntos.
A única propriedade que importa num alarme é falhar por motivos
diferentes daquilo que ele vigia. A Evolution é outro processo, outra
credencial, outra rede, outro fornecedor.

**Existe um pulso diário de "tudo certo".** Um vigia morto e um sistema
saudável produzem o mesmo silêncio. Recebendo a mensagem todo dia às 7h,
a ausência dela vira o sinal — e quem percebe é você, que não depende de
credencial nenhuma para continuar funcionando.

---

## Implantação

### 1. O SQL

No editor do Supabase, cole **`supabase/sql/34-para-colar.sql`** inteiro.

```sql
select to_regclass('public.execucoes')                as tabela,
       to_regproc('public.fn_execucao_inicio')        as inicio,
       to_regproc('public.fn_execucoes_ultimo_sucesso') as leitura,
       to_regproc('public.fn_alarme_cabe')            as alarme;
```

Os quatro têm de vir preenchidos.

### 2. As variáveis

```bash
cat >> /opt/finance-src/api/.env <<'EOF'
MONITOR_WHATSAPP=55SEUNUMEROCOMDDD
MONITOR_INSTANCIA=wa_ultimo
MONITOR_ATIVO=true
MONITOR_INTERVALO_MIN=10
MONITOR_HORA_PULSO=7
EOF
```

O número é o seu, em dígitos, com o 55 na frente e sem símbolos.

### 3. Subir

```bash
cd /opt/finance-src && git pull
cd api && docker compose up -d --build finance-api
docker compose logs --tail 20 finance-api | grep -i vigia
```

Tem de aparecer `Vigia ligado`.

### 4. Testar o alarme de propósito

Este passo não é opcional. O caminho do alarme tem quatro pontos que
quebram em silêncio — número, instância, rede e apikey — e nenhum se
manifesta até o dia em que era para tocar.

```bash
SEG=$(grep '^N8N_WEBHOOK_SECRET=' /opt/finance-src/api/.env | cut -d= -f2- | tr -d '"'"'"'\r')

docker exec finance-api wget -qO- --post-data='' \
  --header="x-n8n-secret: $SEG" \
  http://localhost:3333/api/v1/monitor/teste
```

Deve voltar `{"data":{"enviado":true}}` e a mensagem chegar no seu
WhatsApp. **Se não chegar, pare aqui** — daqui para a frente tudo que o
vigia disser é para ninguém.

### 5. Ver a situação

```bash
docker exec finance-api wget -qO- \
  --header="x-n8n-secret: $SEG" \
  http://localhost:3333/api/v1/monitor/situacao
```

---

## O que esperar na primeira semana

**Tudo vai aparecer como atrasado.** A tabela começa vazia, e nenhum
processo sabe ainda registrar que rodou. É o comportamento certo: tratar
"nunca registrou" como "deve estar tudo bem" seria repetir exatamente o
defeito que este trabalho existe para corrigir.

O silêncio volta conforme cada processo passa a chamar
`fn_execucao_inicio` e `fn_execucao_fim` — o que é feito com o auxiliar
`comRegistro()` na API, e com dois nós de HTTP nos fluxos que ainda
vivem no n8n.

**Enquanto isso, o alarme repete a cada seis horas**, não a cada dez
minutos. Alarme que repete demais treina quem lê a ignorá-lo, e alarme
ignorado é igual a alarme inexistente — com a desvantagem de parecer que
existe proteção.

## O que ainda falta

- Ligar `comRegistro()` em cada processo. Sem isso o vigia cobra, mas
  ninguém responde.
- Migrar os diagnósticos do n8n para a API (etapas 1 a 3 combinadas).
- Exportar os fluxos do n8n para o repositório. **O prompt da IA existe
  em um lugar só, e é o banco do n8n.**
