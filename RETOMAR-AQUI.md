# Onde paramos — 01/10/2026

Estado real do projeto, para quem retoma — inclusive o Claude Code, que lê
o `CLAUDE.md` deste repositório antes deste arquivo.

As pendências abrem a lista, da mais urgente para a que pode esperar.
Depois delas, o que está no ar, o que está em avaliação e as lições.

---

## Pendências

### 0. Tirar o Supabase do domínio pessoal — urgente

Em 05/10/2026 a plataforma inteira ficou fora do ar: `oseiasansay.com.br`
venceu, o DNS devolveu NXDOMAIN e **nenhum cliente conseguiu entrar**. O
servidor estava perfeitamente saudável o tempo todo — todos os containers no
ar, a API respondendo ao n8n, o site carregando. Só o login morreu, porque o
Supabase mora nesse domínio.

**O problema não foi o vencimento. Foi a dependência.** O produto é
`businesstriage.com.br`, que continuou funcionando. O login de todos os
clientes depende de um domínio pessoal, e isso vai se repetir todo ano.

A migração, em quatro passos:

1. Registro A de `supabase.businesstriage.com.br` apontando para o IP do VPS
2. Regra do Traefik para esse host no `supabase-kong`
3. `VITE_SUPABASE_URL` no front, e rebuild
4. `SUPABASE_URL` no `.env` da API, e rebuild

**Cuidado que não é opcional:** o Supabase guarda o próprio endereço externo
na configuração (`API_EXTERNAL_URL` e as URLs de redirecionamento do Auth).
Mudar só o DNS e os clientes faz o login confirmar e redirecionar para um
domínio morto.

Enquanto a migração não acontece, **a data de vencimento do domínio é um
risco de produção**, não uma tarefa administrativa.

### 1. Repor os tetos de IA — adiado para quinta, 08/10/2026

Em 02/10 os limites foram afrouxados no `.env` da API para a rodada de testes
do assistente. Mantidos até 08/10 por causa das reuniões de apresentação de
terça e quarta — teto batendo no meio de uma demonstração é o pior cenário.

- `PDCA_CHAT_LIMITE_24H=1000` → voltar para **30**
- `IA_LIMITE_DIARIO` elevado → voltar ao valor anterior

```bash
# no servidor (VPS)
cd /opt/finance-src/api && nano .env && docker compose up -d
```

Sem `--build`: só o ambiente muda.

**Por que isto abre a lista.** Teto de gasto afrouxado não dá sintoma — tudo
funciona melhor. Só aparece na fatura, semanas depois. É a pendência mais fácil
de esquecer e a única que custa dinheiro todo dia em que fica esquecida.

### 1. Rotacionar credenciais expostas

Apareceram em texto claro ao longo do trabalho:

1. **Chave da Anthropic** — trocada em 15/09, a nova verificada em
   produção. **Confirmar que a antiga foi revogada no console.** Trocar no
   `.env` não impede ninguém de usar a velha.
2. **Senha do SMTP** (Hostinger).
3. **Apikey da Evolution**.

Ordem, sempre: criar a nova → publicar → verificar → só então revogar.

### 2. Decidir sobre os cinco processos do vigia

`recorrentes.gerar`, `alertas.diarios`, `mensal.apurar`, `meta.fila` e
`mensagens.purgar` têm `ultimo_sucesso: null` — nunca rodaram. Não há fluxo
correspondente entre os exportados do n8n, o que sugere que nunca foram
construídos.

Enquanto ficarem assim, chega alarme a cada 6 horas. **Cinco alarmes
crônicos ensinam a ignorar a mensagem**, e é assim que o sexto, verdadeiro,
passa despercebido. Ou se constrói o processo, ou se tira do registro —
manter o alarme vermelho de propósito é a pior das três opções.

Duas delas são promessa de produto:

- **`recorrentes.gerar`** — se nunca rodou, os lançamentos recorrentes dos
  clientes nunca foram gerados. O cliente cadastra a recorrência e ela não
  acontece.
- **`mensagens.purgar`** — o expurgo das conversas de WhatsApp vencidas.
  Sem ele há dado guardado além do prazo que a política de privacidade
  promete.

### 3. Corrigir o fluxo 11 do n8n

`workflow-11-credito-drive.json` tem os **três defeitos já corrigidos no
fluxo 12**: segredo em `$env`, URL de retorno com `/pendentes` e o nó
`Guardar o id da pasta` em `runOnceForEachItem`. O JSON do repositório já
está certo; falta reimportar no n8n.

Pode esperar porque o fluxo 12 drena a fila a cada 15 minutos — nenhum
documento se perde, só atrasa.

### 4. Desativar "Envio de Diagnósticos (8h)" no n8n

A API também envia às 8h. **São dois remetentes lendo a mesma fila**: com um
pendente, o cliente recebe dois e-mails ou os dois marcam o mesmo protocolo
em corrida. Desativar, não apagar.

### 5. Limpar o Google Drive

Pastas órfãs e PDFs duplicados das tentativas de depuração do fluxo 11.
Cuidado: apagar pasta cujo id está em `credito_dossies.drive_folder_id` faz
o fluxo falhar com `File not found` — foi exatamente o que aconteceu. Se
apagar, limpe a coluna também.

---

## O que está no ar e provado

**Controle Financeiro completo**, 12 ferramentas em três grupos (caixa,
margem, plano), com exclusão de lançamentos ponta a ponta: aba "Todos"
lista tudo, filtro por período, lixeira por linha, confirmação em dois
tempos e nenhuma exclusão silenciosa de zero linhas.

**Importação de produtos por planilha** na Margem de Contribuição —
detecção de colunas, participação derivada quando não vem na planilha,
mesclagem por nome preservando imposto e comissão. Branco fica branco.

**Dossiê de documentos para crédito** — 19 itens em três grupos (empresa,
sócios, imóvel), grupo do imóvel opcional, entrega parcial, bucket privado
`credito`, cópia para o Google Drive pelo n8n com fila de reprocessamento de
15 minutos e tela de acompanhamento do consultor ordenada por quem parou há
mais tempo.

**Régua de ciclo unificada** — um dia de ciclo vale uma venda diária nas
três telas. Há teste que falha se divergirem de novo. Os rótulos declaram a
régua porque o contador do cliente chega a outro número.

**Diagnósticos na API**, comercial e financeiro, com envio das 8h próprio e
teto diário de chamadas à IA. `ANTHROPIC_TIMEOUT_MS=300000`.

**O vigia**, com registro de execução, alarme por WhatsApp e pulso diário.

**Evolution → API direto.** Mensagem de WhatsApp vira lead sem n8n.

**Cabeçalhos de cache no nginx** — `no-store` no `index.html`, `immutable`
nos assets. Encerrou uma classe inteira de bug "publicado mas invisível".

**Apresentação para clientes** — 19 páginas, em
`business-triage/apresentacao/`, gerada por `gerar.py` com WeasyPrint.

**Chat sobre o plano de ação** — escrito em 01/10, **ainda não publicado**
(falta colar o SQL 56 e subir API e front). Só leitura: explica o plano,
não altera. Lê `planos_acao` e `acoes`, nunca o PDF — o PDF é um render
congelado, e a ação concluída ontem continua "aberta" nele. Contexto cheio
com cache de prompt, não RAG. Dois tetos em série: o global
`IA_LIMITE_DIARIO` e o `PDCA_CHAT_LIMITE_24H` por empresa, para uma
conversa não comer o orçamento do dia dos outros.

Se `vw_pdca_chat_uso.tokens_cache` viver em zero, o cache de prompt
quebrou e o chat passou a custar cerca de dez vezes mais — sem nenhum
sintoma visível, porque tudo continua respondendo certo.

O **SQL 57** acrescenta `planos_acao.contexto`: o diagnóstico do relatório,
colado pelo consultor no editor do plano. Sem ele o chat conhece as ações e
não o raciocínio que as ordenou. **O 57 é obrigatório junto do 56** — a rota
pede a coluna no `select`, e sem ela a tela do plano quebra inteira.

**Importação do plano a partir do relatório** — `relatorio.ts`, 29 testes.
Lê a tabela 5W2H e o sumário executivo do **markdown** do relatório, propõe
numa tela editável e só grava o que o consultor confirmar.

**É o markdown, não o PDF, e isso é decisão.** A skill
`plano-acao-pdca-triage` escreve `relatorio.md` e só depois roda
`gerar_pdf.py`. A estrutura existe antes da fotografia: as colunas da 5W2H
(`O quê?`, `Quem?`, `Quando?`, `Área`) caem uma-para-uma nos campos de
`acoes`. Importar o PDF seria analisar a própria saída depois de descartar a
estrutura — e o PDF do Auto Posto, medido em 02/10, tem zero fontes e
nenhuma camada de texto: `pdftotext` extrai 18 bytes de 18 páginas, porque
passou por "Microsoft: Print To PDF". OCR seria o único caminho, e OCR de
relatório financeiro erra onde dói.

**O prazo nunca é adivinhado.** O gabarito admite período em "Quando?" —
"Onda 2", "Out/2026", "[definido neste plano]". Nada disso vira data: o
campo fica em branco e destacado, com o texto original ao lado, e o salvar
fica bloqueado. Mês sem dia não é chutado para o dia 1 nem para o último: a
diferença entre 01/10 e 31/10 é um mês de cobrança.

**613 testes passando.**

---

## Assistente — Fase 1 no ar e validada

Publicado e testado em 02/10/2026 com o Auto Posto Esperança. Sete
ferramentas, tela própria no painel abaixo de Treinamentos, SQL 59 aplicado.
Cinco perguntas de aceitação passam, incluindo a que separa conceito de
número e a que recusa escrita.

### A regra que as duas falhas de estreia ensinaram

Perguntaram a margem de contribuição e ele **inventou** o valor: a ferramenta
devolvia receita e custos sem a MC, e ele subtraiu. Corrigi a ferramenta e ele
passou a **negar** o mesmo número: a descrição seguia falando em "lucro,
resultado, faturamento", e ele não soube que a MC estava ali.

Daí as duas regras, que valem para toda ferramenta nova:

- **Indicador que a ferramenta não devolve é indicador que o modelo deriva.**
  Se a tela mostra um indicador calculado, a ferramenta devolve ele pronto —
  nunca os ingredientes. Proibir na instrução não basta: derivar não parece
  estimar.
- **A descrição é o contrato.** Indicador devolvido e não nomeado na descrição
  é indicador invisível.

### Dois arquivos órfãos para apagar à mão

O sandbox não tem permissão: `src/modules/pdca/ChatDoPlano.tsx` e
`src/modules/pdca/useChatDoPlano.ts`. Ninguém mais os importa. Deixá-los é
recriar a segunda tela para a mesma coisa, que já custou dois dias aqui.

### Fase 3 — ferramentas candidatas

Os indicadores que a plataforma calcula e o assistente ainda não alcança:
ciclo financeiro e prazos médios (`vw_prazos_medios`), ponto de equilíbrio e
margem por produto (`mix_produtos`), fluxo de caixa projetado
(`vw_fluxo_semanal`), capital de giro. Todos se encaixam no critério acima.

A ordem deve sair das perguntas reais, não desta lista: a coluna
`pdca_mensagens.ferramentas` registra o que foi consultado, e a pergunta sem
ferramenta aparece no texto das mensagens.

### Fase 2 — calibragem

Vocabulário do curso nas explicações de conceito, para o assistente e as aulas
falarem igual. Depende de ver respostas reais primeiro.

## Próximo item combinado

**Transporte automático do relatório de PDCA** — decisão tomada em 02/10,
implementação adiada.

Hoje o consultor copia o markdown do relatório e cola na tela de
importação. O que vale automatizar é o **transporte**, não a conferência:

- A skill `plano-acao-pdca-triage`, ao terminar, envia o markdown para uma
  rota autenticada por token. A empresa é identificada pelo CNPJ do
  cabeçalho do relatório.
- O plano chega como **pendente**, com a prévia montada, e espera um clique
  do consultor para publicar.

**Por que a confirmação fica.** As ações importadas entram num plano de
origem `consultor`, onde prazo e responsável são fixos para o cliente — ele
não pode corrigir. Uma extração errada vira cobrança que ninguém acordou. No
relatório do Auto Posto, duas das dez ações dependeram do D0 escolhido à mão
e uma misturava "esta semana" com "D+30": são exatamente os casos em que um
olho humano decide melhor que uma regra.

Se um dia a confirmação sair, o plano importado precisa passar a `origem =
'automatico'`, para o cliente poder ajustar o que ninguém conferiu.

Estimativa: 3 a 4 horas — rota com token, resolução por CNPJ, estado de
plano pendente, ajuste na skill.

## Em avaliação, sem decisão tomada

**Indicadores econômicos no assistente** — levantado em 02/10/2026, decisão
adiada.

A ideia: o cliente consultar IPCA, IGP-M, Selic, dólar e euro pelo chat. Vira
uma ferramenta como as outras.

**O bloqueio técnico, que decide o caminho.** O container `finance-api` não
resolve `api.bcb.gov.br` — nem o host do VPS resolve. Não é problema do
Docker: `api.anthropic.com` resolve normalmente nos dois. Falta rodar o teste
que separa as hipóteses:

```bash
# no servidor (VPS)
nslookup api.bcb.gov.br 8.8.8.8
nslookup olinda.bcb.gov.br 8.8.8.8
```

Resolvendo pelo 8.8.8.8, é o resolvedor da Hostinger, e a correção é `dns:
[8.8.8.8, 1.1.1.1]` no serviço do `docker-compose.yml`. Falhando também, o
caminho é o n8n buscar e gravar numa tabela — o que não muda a funcionalidade,
só quem vai até o BCB.

**O cache não é otimização, é o desenho.** IPCA e IGP-M mudam uma vez por mês.
Buscar a cada pergunta adiciona latência e um ponto de falha sem trazer
informação nova.

**Decisões de produto ainda abertas:**

- *Dólar intradiário é mesmo necessário?* Para precificar insumo importado ou
  entender um reajuste, o fechamento resolve. Precisão de minuto interessa a
  quem opera câmbio, e essa pessoa não consulta aqui.
- *PTAX ou cotação de mercado?* A PTAX é a referência que o contador do cliente
  usa — duas fontes para a mesma pergunta é o problema que já evitamos dentro
  da plataforma.

**Raspar portal de notícias foi descartado**, por dois motivos: o HTML muda numa
reformulação qualquer e a ferramenta passa a devolver vazio ou o número errado,
sem sintoma; e conteúdo de portal não é dado aberto para redistribuir dentro de
produto pago.

**Regra que vale desde já:** o horário da cotação entra na resposta junto com o
valor. Mostrar câmbio dentro de uma ferramenta de gestão sugere que ele é
acionável — se estiver atrasado e alguém fechar compra em cima, a conversa
seguinte é ruim.

**Marca branca para a agência de marketing.** Avaliada: tecnicamente é
viável, o gargalo não é o código e sim a operação — segundo banco, segundo
deploy, segundo conjunto de migrações manuais. **Automatizar as migrações
deixa de ser opcional** no dia em que existir o segundo ambiente.

**Módulo Contábil** — ver `CONTABILIDADE.md` e a entrada 2.0.0 do
`ROADMAP.md`. Nasce desligado, habilitado por `tenant_recursos`. A fronteira
técnica: hoje um lançamento é uma linha com uma categoria, e contabilidade
exige duas contas com sinais opostos.

**Plano de Redução de Ciclo** — todas as alavancas multiplicam pela mesma
`vendaDiaria`, mas um dia ganho no estoque libera **custo** e um dia nos
recebíveis libera **preço de venda**. Levantado três vezes, nunca corrigido.
É o item metodológico mais antigo em aberto.

**Tornar o cliente obrigatório em receita.** Hoje `entity_id` é opcional, e
por isso toda a carteira aparece como "sem cliente informado". Com dados de
demonstração não custa nada; com clientes reais vira migração.

**O redator sem IA** (`redator.ts`) está pronto e desligado. Escreve os
cinco campos do relatório a partir dos alertas da régua, no mesmo schema
Zod, em milissegundos, de graça. Padrão continua `MOTOR_ANALISE=ia`;
`?motor=codigo` na rota pública usa o código. A régua, o score e os
indicadores **nunca dependeram de IA**.

---

## Pendências

### 0. Tirar o Supabase do domínio pessoal — urgente

Em 05/10/2026 a plataforma inteira ficou fora do ar: `oseiasansay.com.br`
venceu, o DNS devolveu NXDOMAIN e **nenhum cliente conseguiu entrar**. O
servidor estava perfeitamente saudável o tempo todo — todos os containers no
ar, a API respondendo ao n8n, o site carregando. Só o login morreu, porque o
Supabase mora nesse domínio.

**O problema não foi o vencimento. Foi a dependência.** O produto é
`businesstriage.com.br`, que continuou funcionando. O login de todos os
clientes depende de um domínio pessoal, e isso vai se repetir todo ano.

A migração, em quatro passos:

1. Registro A de `supabase.businesstriage.com.br` apontando para o IP do VPS
2. Regra do Traefik para esse host no `supabase-kong`
3. `VITE_SUPABASE_URL` no front, e rebuild
4. `SUPABASE_URL` no `.env` da API, e rebuild

**Cuidado que não é opcional:** o Supabase guarda o próprio endereço externo
na configuração (`API_EXTERNAL_URL` e as URLs de redirecionamento do Auth).
Mudar só o DNS e os clientes faz o login confirmar e redirecionar para um
domínio morto.

Enquanto a migração não acontece, **a data de vencimento do domínio é um
risco de produção**, não uma tarefa administrativa.

### 1. Repor os tetos de IA — adiado para quinta, 08/10/2026

Em 02/10 os limites foram afrouxados no `.env` da API para a rodada de testes
do assistente. Mantidos até 08/10 por causa das reuniões de apresentação de
terça e quarta — teto batendo no meio de uma demonstração é o pior cenário.

- `PDCA_CHAT_LIMITE_24H=1000` → voltar para **30**
- `IA_LIMITE_DIARIO` elevado → voltar ao valor anterior

```bash
# no servidor (VPS)
cd /opt/finance-src/api && nano .env && docker compose up -d
```

Sem `--build`: só o ambiente muda.

**Por que isto abre a lista.** Teto de gasto afrouxado não dá sintoma — tudo
funciona melhor. Só aparece na fatura, semanas depois. É a pendência mais fácil
de esquecer e a única que custa dinheiro todo dia em que fica esquecida. técnicas conhecidas

**Node 20 no servidor, Supabase pede 22.** Avisos hoje; podem virar erro num
`npm ci` futuro.

**O lead se perde quando a análise falha** — `analisar` lança antes de
`gravar`, então não fica nada em `diagnosticos`. E a confirmação ao lead
espera a análise sem precisar: ela só diz "recebemos".

**O corte de 66 contra o de 70** na régua comercial diverge do `corDoScore`
do PDF.

**As tabelas de pontuação de `regua.ts`** têm o defeito de protótipo já
corrigido em `regua-comercial.ts`: `TABELA[valor] ?? padrão` acha
`toString`.

**`vw_consultor_publico` é SECURITY DEFINER** — o Advisor do Supabase marca
como crítico. "Pública" no nome e "ignora RLS" na definição é combinação que
costuma terminar mal.

**Dois n8n rodando.** `n8n-n8n-1` em `n8n.oseiasansay.com.br` é instalação
antiga sem uso e continua exposta.

**Os fluxos exportados do n8n não estão todos no git** — alguns têm segredo
em texto puro. Cópias em `/root/fluxos-n8n` e em `C:\Projetos\Claude\n8n`.
Os do crédito (11 e 12) estão no git porque foram escritos sem segredo.

---

## Lições que valem registrar

**Migração esquecida quebra produção, e já quebrou três vezes.** Depois de
toda publicação, rode `supabase/sql/52-conferir-banco.sql`. Vazio significa
banco em dia.

**Diga a máquina em cada bloco de comando.** PowerShell do Windows e shell
do VPS já foram confundidos duas vezes, uma delas colando configuração de
nginx direto no terminal. O padrão agora é `# no servidor (VPS)` ou
`# no PowerShell`.

**Antes de mandar alguém depurar, confirme que o commit subiu.** Uma
correção certa, commitada e não enviada, custou uma rodada inteira de
diagnóstico em cima de código antigo.

**Duas telas para a mesma coisa custaram dois dias.**
`tools/MargemContribuicaoTool.tsx` e `pages/Precificacao.tsx` gerenciam os
mesmos produtos. Editei uma e mandei o usuário limpar cache por dois dias.
Antes de culpar o cache: confirme qual arquivo a tela usa.

**O `.env` acumula linhas duplicadas, e a última vence.** Antes de colar
qualquer bloco: `grep -c ^NOME_DA_CHAVE= .env`. Diferente de zero significa
editar, não acrescentar.

**Nada sai do PC sem commit.** Um `.git/index.lock` antigo bloqueava `add` e
`commit` em silêncio, e o `git push` respondia "Everything up-to-date". O
build local funcionava; o servidor via código de duas semanas atrás.

**Segredo não se imprime.** Para testar com uma chave, substitua dentro do
container: `docker exec finance-api sh -c 'wget ... --header="x-api-key:
$ANTHROPIC_API_KEY" ...'`. O valor não passa pelo histórico nem pela
conversa.

**Debounce sobre objeto não debounce nada.** Objeto literal é recriado a
cada render, a dependência do efeito muda sempre e o valor nunca assenta.

**`on conflict` não enxerga índice parcial.** O `upsert` de
`mix_custos_fixos` falhava em silêncio — a tela aceitava o clique e o valor
não mudava.

**Sistema vigiado avisa; sistema não vigiado espera alguém reclamar.** A
falha do envio das 8h levou dias para ser notada em setembro e 45 minutos
depois do registro de execução existir. A diferença não foi o conserto.

**Pergunta ambígua gera implementação errada.** Perguntei sobre
obrigatoriedade dos documentos do imóvel de um jeito que admitia duas
leituras, implementei a errada e precisei desfazer. Quando a pergunta tem
opções, escreva cada uma por extenso.
