# Onde paramos — 16/09/2026

Três pendências operacionais abrem a lista, todas curtas. Depois delas, o
que está no ar e o que ficou anotado.

---

## O que precisa ser feito antes de qualquer coisa nova

### 1. Rotacionar credenciais

Quatro apareceram em texto claro ao longo do trabalho:

1. **Chave da Anthropic** — trocada em 15/09. **Confirmar que a antiga foi
   revogada no console.** Trocar no `.env` não impede ninguém de usar a
   velha.
2. **Senha do SMTP** (Hostinger) — primeiros caracteres vazaram numa saída
   de diagnóstico.
3. **Apikey da Evolution**.
4. **`N8N_WEBHOOK_SECRET`** — `openssl rand -hex 32`.

### 2. Desativar "Envio de Diagnósticos (8h)" no n8n

Esse fluxo rodou em 16/09, e agora a API também roda às 8h. **São dois
remetentes lendo a mesma fila.** Ontem não houve dano porque a fila estava
vazia; com um pendente, o cliente recebe dois e-mails ou os dois marcam o
mesmo protocolo em corrida.

Desativar, não apagar.

### 3. Decidir sobre os cinco processos do vigia

`recorrentes.gerar`, `alertas.diarios`, `mensal.apurar`, `meta.fila` e
`mensagens.purgar` têm `ultimo_sucesso: null` — nunca rodaram. Não há
fluxo correspondente entre os exportados do n8n, o que sugere que nunca
foram construídos.

Enquanto ficarem assim, chega alarme a cada 6 horas. **Cinco alarmes
crônicos ensinam a ignorar a mensagem**, e é assim que o sexto, verdadeiro,
passa despercebido.

Duas dessas consequências são promessas de produto, e valem atenção:

- **`recorrentes.gerar`** — se nunca rodou, os lançamentos recorrentes dos
  clientes nunca foram gerados. O cliente cadastra a recorrência e ela não
  acontece.
- **`mensagens.purgar`** — o expurgo das conversas de WhatsApp vencidas.
  Sem ele, há dado guardado além do prazo que a política de privacidade
  promete.

As outras três são funcionalidade que falta, não promessa descumprida.

---

## O que está no ar e provado

**Evolution → API direto.** Mensagem de WhatsApp vira lead sem n8n.

**O vigia**, com um defeito importante corrigido em 16/09: ele **punia a
pontualidade**. `ultimoPrazo` devolvia hora + tolerância e `avaliar`
exigia sucesso posterior a isso — quem rodava às 8h03, dentro da
tolerância de 45 minutos, era marcado como atrasado o dia inteiro. Agora a
janela tem dois instantes: `inicio` (a hora marcada, contra a qual o
sucesso é comparado) e `limite` (quando a cobrança começa).

**Diagnósticos na API**, comercial e financeiro, com envio das 8h próprio.
`ANTHROPIC_TIMEOUT_MS=300000` — a análise financeira não cabia em dois
minutos.

**Contas a pagar/receber consolidadas** — `vw_contas_por_pessoa` e
`vw_contas_resumo`, com a aba "A pagar / receber" entre DRE e Diagnóstico.

**Precificação** — preço mínimo por markup divisor, com margem de
contribuição e ponto de equilíbrio por item.

**Margem de contribuição com mix de produtos** — média ponderada pela
participação de cada item no faturamento, imposto em campo próprio, MC
bruta e líquida lado a lado.

**Capital de giro (NCG)** — estrutural e realizada, com PMR e PMP medidos
de `vw_prazos_medios`.

**294 testes passando.**

---

## Disponível, desligado por opção

**O redator sem IA** (`redator.ts`). Escreve os cinco campos do relatório
a partir dos alertas da régua — mesmo schema Zod, em milissegundos, de
graça. O padrão continua `MOTOR_ANALISE=ia`; `?motor=codigo` na rota
pública usa o código.

A régua, o score e os indicadores **nunca dependeram de IA** — isso é
`regua.ts`, código puro, 49 testes. O modelo só redigia texto.

Para ler o que ele produz hoje, sem deploy:

```bash
cd api && npm run redator:exemplo -- todos
```

Os textos ficam em `TEXTOS_FINANCEIRO` (15 indicadores, linhas 92–295) e
`TEXTOS_COMERCIAL` (11 critérios, linhas 319–369) do `redator.ts`. São
rascunhos. Regra ao editar: **toda frase carrega um número do cliente** —
é o que separa relatório personalizado de carta-modelo, e tem teste.

---

## Em avaliação, sem decisão tomada

**Módulo Contábil** — ver `CONTABILIDADE.md` e a entrada 2.0.0 do
`ROADMAP.md`. Nasce como recurso desligado por padrão, habilitado por
`tenant_recursos`. A fronteira técnica: hoje um lançamento é uma linha com
uma categoria, e contabilidade exige duas contas com sinais opostos.

**DeepSeek para eventos** — levantado e provavelmente superado pelo
redator sem IA: R$ 0 é melhor que R$ 0,04, e sem mandar dado financeiro
para fora do país.

**LP de evento** — três armadilhas levantadas: o limite de 5 por hora é
**por IP** (trinta pessoas no wi-fi do local saem pelo mesmo), o teto de 60
chamadas/dia seria consumido por um encontro, e a origem precisa entrar no
CORS antes.

**Suprimir "gratuita" do site** — amarração concreta: o e-mail de
confirmação diz *"em PDF, sem custo"* em `dependencias.ts`.

**Tornar o cliente obrigatório em receita.** Hoje `entity_id` é opcional, e
por isso toda a carteira aparece como "sem cliente informado". Com dados de
demonstração não custa nada; com clientes reais vira migração.

---

## Pendências técnicas conhecidas

**Node 20 no servidor, Supabase pede 22.** São avisos hoje; podem virar
erro num `npm ci` futuro.

**A confirmação ao lead espera a análise sem precisar.** Ela só diz
"recebemos". Se o Claude falhar, o prospect não recebe nem isso.

**O lead se perde quando a análise falha** — `analisar` lança antes de
`gravar`, então não fica nada em `diagnosticos`.

**O corte de 66 contra o de 70** na régua comercial diverge do `corDoScore`
do PDF.

**As tabelas de pontuação de `regua.ts` têm o defeito de protótipo** já
corrigido em `regua-comercial.ts`: `TABELA[valor] ?? padrão` acha
`toString`.

**`vw_consultor_publico` é SECURITY DEFINER** — o Advisor do Supabase
marca como crítico. "Pública" no nome e "ignora RLS" na definição é
combinação que costuma terminar mal.

**Dois n8n rodando.** `n8n-n8n-1` em `n8n.oseiasansay.com.br` é instalação
antiga sem uso e continua exposta.

**Os fluxos exportados do n8n não estão no git** — têm segredo em texto
puro. Cópias em `/root/fluxos-n8n` e em `C:\Projetos\Claude\n8n`.

---

## Lições que valem registrar

**O `.env` acumula linhas duplicadas, e a última vence.** Antes de colar
qualquer bloco: `grep -c ^NOME_DA_CHAVE= .env`. Diferente de zero significa
editar, não acrescentar.

**Nada sai do PC sem commit.** Em 16/09 um `.git/index.lock` de 31 de
agosto bloqueava `add` e `commit` em silêncio, e o `git push` respondia
"Everything up-to-date". O build local funcionava; o servidor via código de
duas semanas atrás.

**Debounce sobre objeto não debounce nada.** Objeto literal é recriado a
cada render, a dependência do efeito muda sempre e o valor nunca assenta. A
correção saiu instalada e inútil até alguém testar de novo.

**`on conflict` não enxerga índice parcial.** O `upsert` de
`mix_custos_fixos` falhava em silêncio — a tela aceitava o clique e o valor
não mudava.

**Sistema vigiado avisa; sistema não vigiado espera alguém reclamar.** A
falha do envio das 8h levou dias para ser notada em setembro e 45 minutos
em 16/09. A diferença não foi o conserto — foi o registro de execução
existir.
