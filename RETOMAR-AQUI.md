# Onde paramos — 15/09/2026

Retome pelo **deploy do envio das 8h** (abaixo). Depois disso, falta só
virar a chave no site.

---

## O que aconteceu hoje, e por que importa

Às 8h45 o vigia mandou um alarme no WhatsApp dizendo que o envio das 8h
não tinha acontecido.

Essa mesma falha existia desde antes de 11/09 e nunca tinha se anunciado.
A descoberta anterior veio de fora — alguém percebeu que o relatório não
chegou. Desta vez o sistema avisou sozinho, em 45 minutos, sem depender
de o n8n reportar coisa alguma: o alarme conclui pela **ausência** de
registro de sucesso, que é o modo de falha que ninguém detecta olhando
log.

A causa: o envio das 8h **nunca tinha sido migrado**. A entrada dos
diagnósticos passou para a API em 14/09, mas quem esvaziava a fila
continuava sendo um terceiro fluxo do n8n, parado havia dias.

Isso está resolvido no código. Falta subir.

---

## O que já está de pé e provado em produção

- **Evolution → API direto.** Mensagem de WhatsApp chega e vira lead.
- **O vigia.** SQL 33, 34 e 35 rodados em 15/09. Alarme provado duas
  vezes: no teste proposital e hoje, de verdade.
- **Diagnóstico comercial.** Formulário → régua → Claude → PDF por
  e-mail. Testado ponta a ponta, PDF recebido.
- **Diagnóstico financeiro.** Testado. Confirmação ao lead e aviso
  interno com link de segurar; relatório fica `pendente`.
- **Os fluxos de diagnóstico do n8n:** desativados (não apagados).

**196 testes passando.**

---

## O envio das 8h — pronto no código, falta subir

Arquivos novos:

| Arquivo | O que é |
|---|---|
| `api/src/modules/diagnosticos/fila.ts` | A lógica: quando roda, ordem do envio, isolamento por item, texto do alarme. Sem banco, sem SMTP. |
| `api/src/modules/diagnosticos/fila.service.ts` | As dependências reais e a passada registrada em `execucoes`. |
| `api/src/modules/diagnosticos/fila.agenda.ts` | O relógio: `setInterval` de 5 minutos. |
| `api/src/modules/diagnosticos/fila.test.ts` | 19 testes. |

Mudanças: `server.ts` (liga e desliga o relógio), `config/env.ts` (duas
variáveis), `monitor.routes.ts` (rota de disparo manual).

### Passo 1 — Enviar o código

```powershell
cd C:\Projetos\saasfinanceiro
git add -A
git commit -m "Envio das 8h na API: fila isolada por item, agendador proprio e registro em execucoes"
git push
```

### Passo 2 — As duas variáveis novas

**Confira antes de acrescentar** — o `.env` já duplicou duas vezes neste
projeto, e a última ocorrência é a que vale:

```bash
grep -c '^DIAGNOSTICOS_ENVIO_ATIVO=' /opt/finance-src/api/.env
```

Se der 0:

```bash
cat >> /opt/finance-src/api/.env <<'EOF'
DIAGNOSTICOS_ENVIO_ATIVO=true
DIAGNOSTICOS_HORA_ENVIO=8
EOF
```

### Passo 3 — Subir

```bash
cd /opt/finance-src && git pull
cd api && docker compose up -d --build finance-api
docker compose logs --tail 20 finance-api | grep -i 'Envio das 8h'
```

Tem de aparecer **`Envio das 8h ligado`**. Se aparecer
`Envio das 8h desligado`, a variável não pegou.

### Passo 4 — Soltar a fila represada, sem esperar amanhã

```bash
SEG=$(grep '^N8N_WEBHOOK_SECRET=' /opt/finance-src/api/.env | cut -d= -f2- | tr -d '"'"'"'\r')
docker exec finance-api wget -qO- --post-data='' --header="x-n8n-secret: $SEG" \
  http://localhost:3333/api/v1/monitor/fila
```

O diagnóstico financeiro de teste de 14/09 está nessa fila. O PDF tem de
chegar no e-mail.

Depois:

```sql
select processo, situacao, total, duracao_seg
from public.vw_execucoes where processo = 'diagnosticos.envio'
order by iniciado_em desc limit 3;
```

Com `situacao = 'ok'` registrado, o vigia para de cobrar este processo.

---

## O que falta depois disso

### 1. Virar a chave no site

```powershell
cd "C:\Projetos\business-triage"
npm run build
```

Publicar, e testar pelos dois endereços — **com `www` e sem `www`**. Foi
aí que o "Failed to fetch" mordeu.

Confira que o protocolo da tela é o mesmo do banco:

```sql
select protocolo, tipo, status, score_total from public.diagnosticos
order by created_at desc limit 5;
```

### 2. Credenciais para trocar

1. **Chave da Anthropic** — trocada em 15/09. **Confirmar que a antiga
   foi revogada no console.** Trocar no `.env` não impede ninguém de usar
   a velha.
2. **Senha do SMTP** (Hostinger) — primeiros caracteres vazaram numa
   saída de diagnóstico.
3. **Apikey da Evolution** — apareceu várias vezes em conversa.
4. **`N8N_WEBHOOK_SECRET`** — `openssl rand -hex 32`.

As chaves antigas da Anthropic que estavam nos fluxos do n8n podem ser
revogadas.

---

## Em avaliação, sem decisão tomada

**Segundo motor de análise (DeepSeek) para eventos presenciais.** A ideia
é atender grandes grupos sem qualificação a custo menor. Levantado em
15/09:

- O custo é do modelo, não da ferramenta. n8n e API pagam os mesmos
  tokens; **o n8n não economiza nada.**
- Sonnet 4.6: ~US$ 0,16 por diagnóstico. DeepSeek V4.1 Flash: ~US$ 0,007.
  Cem participantes: **R$ 87 contra R$ 4.**
- A proporção é de 20 para 1; o absoluto é pequeno nesse volume.
- Entra na API pelo ponto `analisar` de `dependencias.ts`. Precisaria de
  teto e timeout próprios, e `ia_uso` teria de separar por motor.
- **Ponto aberto:** a página de privacidade. Os dados identificáveis já
  ficam fora do prompt, mas os números financeiros iriam para um provedor
  na China.

**LP de evento, fora do site.** Três armadilhas levantadas:

- **O limite de 5 por hora é por IP.** Trinta pessoas no wi-fi do local
  saem pelo mesmo IP — a sexta em diante seria recusada. A rota de evento
  precisa de outro limite, contado por outra coisa.
- O teto de 60 chamadas/dia seria consumido por um único encontro.
- A origem da LP precisa entrar no CORS **antes**, e ser testada na
  véspera.
- Sugerido: política de janela (não prometer PDF na hora) e um campo
  `origem` com o nome do evento.

**Suprimir "gratuita" do site** (recomendação do consultor de marketing).
Amarração concreta: o e-mail de confirmação diz *"em PDF, sem custo"* em
`dependencias.ts`, e o template do relatório provavelmente repete. Os
textos precisam mudar junto.

---

## Pendências técnicas conhecidas

**A confirmação ao lead espera a análise sem precisar.** Ela só diz
"recebemos". Hoje o prospect fica um minuto sem retorno, e se o Claude
falhar ele não recebe nem isso. Mandar logo depois da régua é mais
correto e mais barato.

**O lead se perde quando a análise falha.** `analisar` lança antes de
`gravar`, então não fica nada em `diagnosticos` — só a linha de falha em
`execucoes`. Aconteceu duas vezes em 14/09 com o timeout. Separar as duas
gravações resolve.

**Diagnóstico perdido se o contêiner morrer no meio.** `vw_execucoes`
marca como `travado`. Visível, não automático.

**O corte de 66 contra o de 70** na classificação comercial diverge do
`corDoScore` do PDF. Score 67 sai com etiqueta de um patamar e cor de
outro. Corrigir exige subir a versão da régua.

**As tabelas de pontuação de `regua.ts` têm o mesmo defeito de protótipo**
que foi corrigido em `regua-comercial.ts`: `TABELA[valor] ?? padrão` acha
`toString` e `constructor`. Só entra por dado malformado, mas entra.

**Os fluxos exportados do n8n ainda não estão no git.** Têm segredo em
texto puro. Cópias em `/root/fluxos-n8n` e `/root/fluxos.tgz`.

**Dois n8n rodando** (`n8n-businestriage-n8n-1` e `n8n-n8n-1`). O segundo
é instalação antiga sem uso e continua exposto.

---

## Comandos que valem guardar

**Saúde dos processos:**

```sql
select processo, situacao, count(*) from public.vw_execucoes
where iniciado_em > now() - interval '1 day' group by 1, 2 order by 1;
```

**Consumo da IA:**

```sql
select dia, chamadas, recusadas, tokens_por_chamada from public.vw_ia_uso;
```

**Testar o alarme de propósito** (vale repetir de tempos em tempos —
alarme não testado é alarme que ninguém sabe se funciona):

```bash
SEG=$(grep '^N8N_WEBHOOK_SECRET=' /opt/finance-src/api/.env | cut -d= -f2- | tr -d '"'"'"'\r')
docker exec finance-api wget -qO- --post-data='' --header="x-n8n-secret: $SEG" \
  http://localhost:3333/api/v1/monitor/teste
```

**Soltar a fila na mão:** a mesma coisa, trocando `/teste` por `/fila`.

---

## Duas lições que vale registrar

**O `.env` acumula linhas duplicadas, e a última vence.** Aconteceu duas
vezes com o SMTP e uma terceira quase aconteceu hoje. Antes de colar
qualquer bloco: `grep -c ^NOME_DA_CHAVE= .env`. Diferente de zero
significa editar, não acrescentar.

**Sistema vigiado avisa; sistema não vigiado espera alguém reclamar.** A
mesma falha das 8h levou dias para ser notada em setembro e 45 minutos
hoje. A diferença não foi o conserto — foi o registro de execução existir.
