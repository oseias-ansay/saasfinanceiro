# Onde paramos — 01/10/2026

Estado real do projeto, para quem retoma — inclusive o Claude Code, que lê
o `CLAUDE.md` deste repositório antes deste arquivo.

As pendências abrem a lista, da mais urgente para a que pode esperar.
Depois delas, o que está no ar, o que está em avaliação e as lições.

---

## Pendências

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

**613 testes passando.**

---

## Em avaliação, sem decisão tomada

**Chat sobre o PDCA do cliente.** Desenho acordado: ler as tabelas
`planos_acao` e `acoes`, **não o PDF** — o plano estruturado é a fonte, o
PDF é um render dele. Contexto cheio em vez de RAG (25–30 páginas cabem, e
o modelo raciocina melhor sobre o plano inteiro que sobre trechos
recuperados). Isolamento por tenant **no servidor**, nunca por instrução no
prompt. Estimativa de 2 a 3 dias.

**Pergunta aberta, que decide a arquitetura:** o chat deve poder *alterar* o
plano — marcar ação concluída, mudar prazo — ou apenas responder sobre ele?
Só responder é um endpoint de leitura; poder alterar exige confirmação,
trilha de auditoria e tratamento de ambiguidade ("conclui a primeira" sobre
qual lista?).

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

## Pendências técnicas conhecidas

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
