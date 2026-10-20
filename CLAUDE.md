# Business Triage — API e banco

Plataforma de gestão financeira para micro e pequenas empresas brasileiras,
operada por uma consultoria. Dois repositórios:

- **`saasfinanceiro`** (este) — API em Node/TypeScript, SQL do Supabase, fluxos do n8n
- **`business-triage`** — front-end React/Vite, publicado em `businesstriage.com.br`

## Como trabalhar aqui

**Teste antes de dar por pronto.** `cd api && npm test` roda a suíte (910 testes,
node:test sobre o `dist`). `npx tsc --noEmit` para o typecheck. Os dois precisam
passar; a suíte já pegou erros meus várias vezes.

**Módulo puro não importa `config/env.js`.** Importação no topo obriga o teste
a ter todas as variáveis de ambiente só para exercitar uma função que não fala
com ninguém — e a suíte quebra pedindo `SUPABASE_SERVICE_ROLE_KEY`. Quando o
mesmo arquivo tem a parte pura e a chamada de rede, o `env` entra por
`await import()` dentro da função. Ver `boletoVisao.ts`.

**A lógica de negócio fica em módulo puro, com teste.** O padrão do projeto:
`api/src/modules/precificacao/*.ts` são funções puras (`calcularGiro`,
`calcularCiclo`, `lerPlanilha`) com um `.test.ts` ao lado. As rotas só buscam
dados, chamam a função e devolvem. Regra sem teste apodrece.

**Comentário explica POR QUÊ, não o quê.** Veja `giro.ts`, `monitor.ts`,
`planilha.ts`. Os cabeçalhos registram a decisão e o que ela custou — é o que
permite alguém entender seis meses depois por que a conta é daquele jeito. Siga
esse tom: direto, em português, sem jargão desnecessário.

**Português em tudo**: nomes de função, variáveis, comentários, mensagens de
erro. O código fala a língua de quem o mantém.

## Arquitetura, em uma passada

**Supabase self-hosted** (`api.oseiasansay.com.br`) — Postgres com RLS por
`tenant_id`, Auth, Storage. Multiempresa: toda tabela tem `tenant_id` e política
de RLS. As funções `is_tenant_member`, `can_write_tenant`, `is_platform_staff`,
`is_consultor_de` decidem acesso.

**API** (`api-financeiro.businesstriage.com.br`) — Express, em Docker no VPS
Hostinger, container `finance-api`, porta 3333 atrás do Traefik. Roda com o JWT
do usuário (`req.supabase`) para que o RLS valha; `supabaseAdmin` só onde é
inevitável, e cada uso justificado em comentário.

**Front** — React, servido por um container nginx (`businestriage-site`) com
`/var/www/bt/dist` montado. Configuração em `/opt/n8n-businestriage/site-nginx.conf`.

**n8n** — fluxos auxiliares. A API já assumiu vários; ver `n8n/README.md`.

## Migrações: ponto de atenção número um

**Não há executor automático.** Os arquivos `supabase/sql/NN-para-colar.sql` são
colados à mão no SQL Editor. Isso já causou três quebras em produção — código
publicado, migração esquecida, tela quebrando para o cliente.

Depois de **toda** publicação, rode `supabase/sql/52-conferir-banco.sql`: ele
compara o que o código referencia com o que o banco tem e lista o que falta.
São **duas consultas** no arquivo — tabelas e views na primeira, colunas
acrescentadas depois na segunda. Rode as duas, separadas. Vazio nas duas
significa banco em dia.

**Ao acrescentar coluna a uma tabela que já existe, registre-a na segunda
parte do 52.** A primeira parte não a enxerga: a tabela está lá, e a consulta
do código falha inteira por causa de uma coluna. Foi assim com o `tx_id` do
extrato.

Arquivos longos truncam no editor do Supabase. Divida em partes se der
`syntax error at end of input`.

**Automatizar isso é a dívida técnica mais cara do projeto.** Vira obrigatório se
houver um segundo ambiente (marca branca).

## Publicar

```bash
# no servidor (VPS), nunca no PowerShell do Windows
cd /opt/finance-src && git pull && cd api && docker compose up -d --build
cd /var/www/bt && git pull && npm ci && npm run build
```

Se o build Docker vier todo em `CACHED` e o container disser "Running" em vez de
"Started", o `git pull` não trouxe nada — confira o commit.

**`--build` e `--force-recreate` resolvem problemas diferentes, e confundir os
dois custa uma hora.**

- **Código novo** → `docker compose up -d --build`. Sem `--build`, o Compose
  sobe o container a partir da imagem antiga e o código novo não entra. O
  sintoma é 404 numa rota que existe no repositório.
- **Só o `.env` mudou** → `docker compose up -d --force-recreate`. O `--build`
  aqui é inútil: a imagem não mudou, o que precisa recarregar é o ambiente.
- **Na dúvida, os dois**: `docker compose up -d --build --force-recreate`.

Aconteceu em 15/10/2026 com as rotas do movimento diário: `git pull` trouxe o
código, `--force-recreate` recriou o container a partir da imagem velha, e a
rota respondeu 404 por meia hora.

## Armadilhas conhecidas

**Git trava com `index.lock`/`HEAD.lock`** quando o VS Code está com o repositório
aberto. `Remove-Item .git\*.lock -Force` no PowerShell.

**Não rode git pela sessão do Claude.** Ele enxerga os repositórios por um
mount que não permite apagar arquivo, e o git depende de apagar: o `index.lock`
que ele cria no começo de cada operação FICA, e a partir daí todo comando git
falha — inclusive no PowerShell, até alguém remover o lock à mão. Também sobram
`tmp_obj_*` em `.git/objects` (inofensivos, mas sujam o diretório). Aconteceu em
15/10/2026: um `checkout -b` + `add` deixou o repositório travado. Se o Claude
precisar commitar, o certo é ele escrever os comandos e você rodar no
PowerShell.

**Arquivo versionado editado no servidor trava TODO deploy futuro, em
silêncio.** É a armadilha mais cara descoberta até agora, e o sintoma não
aponta para ela.

Em 08/10/2026 a integração do CRM (`modules/diagnosticos/crm.ts`,
`publico.routes.ts` e `env.ts`) foi escrita direto em produção e nunca
commitada. A partir dali **todo `git pull` no VPS abortou** com "Your local
changes would be overwritten by merge" — e ninguém viu, porque o comando de
publicar é uma linha com `&&` e a saída rola na tela. O `--build` seguia
rodando em cima do código antigo. **Nove dias de deploy que não chegavam.**

O sintoma apareceu como **404 numa rota nova que existia no repositório** —
idêntico ao de esquecer o `--build`, que é onde eu procurei primeiro, duas
vezes.

**Antes de culpar o build, rode isto:**

```bash
# no servidor (VPS)
cd /opt/finance-src && git status --short
```

Vazio é o esperado. Qualquer linha ali é um deploy que não vai acontecer.

E o teste que diz, sem opinião, se o container tem o código:

```bash
# no servidor (VPS)
docker exec finance-api grep -c "api/v1/boletos" /app/dist/app.js
```

**Nunca rode `git reset --hard` ou `git clean -fd` para destravar.** Pode
haver funcionalidade inteira só ali — foi o caso. Copie para fora do git
primeiro (`cp` para `/root/resgate-...`), traga para o repositório, e só
então limpe. Valor de configuração vai no `.env`, que não é versionado
justamente para isso; o servidor deve ser só `git pull` e build.

**Invariante de tabela não é permissão, e confundir os dois esconde o
defeito atrás da mensagem errada.** Em `tg_acao_protege_campos`, o bloco que
preenche `concluida_em` ficava DEPOIS do `return new` que libera o staff. O
staff saía antes dele, gravava `concluida = true` com data nula, e a trava
`acao_conclusao_ck` recusava. A tela dizia "estado inconsistente da conclusão,
recarregue a página" — apontando para o front, que estava certo. Descoberto em
19/10/2026; corrigido no SQL 65, movendo a coerência para antes de qualquer
bifurcação de papel. Regra: o que a tabela exige de todo mundo vem primeiro; o
que limita um papel vem depois.

**Escrita por `supabase-js` sem `.select()` falha em silêncio.** O PostgREST
responde 204 e o cliente devolve `error: null` mesmo quando o RLS escondeu a
linha — zero linhas afetadas não é erro no Postgres. O sintoma é o pior
possível: o clique não faz nada, sem mensagem e sem log. Foi o que deixou o
PDCA sem marcar ação por semanas. Toda escrita passa por `escrever()` em
`usePdca.ts`, que pede `.select()` e trata lista vazia como erro.

**Cache do navegador** mascarava deploys: o `index.html` ficava em cache
apontando para o JS antigo. Resolvido em `site-nginx.conf` com `no-store` no
index e `immutable` nos assets. Se alguém recriar esse arquivo, reponha.

**`$env` não funciona nas expressões do n8n** — bloqueado por padrão. Use valor
literal ou credencial. Ver `n8n/LEIA-ME-CREDITO-DRIVE.md`.

**Duas telas para a mesma coisa**: `tools/MargemContribuicaoTool.tsx` (card do
painel) e `pages/Precificacao.tsx` (aba do Controle Financeiro) gerenciam os
mesmos produtos. Mudança numa costuma precisar da outra.

## Decisões metodológicas que não são arbitrárias

**Um dia de ciclo vale uma venda diária** (receita ÷ 30), nas três telas que
usam ciclo. Unificado em 24/09 porque Capital de Giro e Ciclo davam respostas
diferentes para a mesma pergunta. Há teste que falha se divergirem de novo.

**Os prazos saem de `saldo ÷ venda diária`**, não da base contábil clássica.
Faz `ciclo × venda diária` bater com `estoque + a receber − a pagar`. Os rótulos
declaram isso porque o contador do cliente chega a outro número.

**O diagnóstico é gerado por IA com teto diário** (`IA_LIMITE_DIARIO`). Cada
chamada custa dinheiro real.

**O plano automático espelha o diagnóstico mais recente, e plano de
consultor sempre vence.** Uma regra, duas portas: o marco zero cria o plano
de entrada a partir de `diagnosticos.analise` (que já está pago e guardado —
não chama IA), e a apuração mensal substitui pelo plano dos lançamentos
reais. Se existe plano com `origem = 'consultor'`, nenhuma das duas faz nada.
É o que faz o upgrade funcionar sem migração.

**O assistente não recebe dados; recebe o direito de perguntar.** Nenhuma
ferramenta de `modules/assistente/ferramentas.ts` tem campo de empresa — o
`tenant_id` é injetado pelo executor, a partir do JWT. Há teste que varre o
catálogo procurando `tenant`, `empresa`, `cliente_id`: é a única barreira
automática entre o assistente e o dado do concorrente, e ela não depende de o
modelo se comportar.

**A lista de ferramentas é constante, nunca montada por empresa.** Ela vai no
prompt antes do bloco cacheado; variar entre clientes faria o cache nunca
acertar, e o custo subiria cerca de dez vezes sem sintoma visível. Quem não tem
dado numa área recebe "não há" quando a ferramenta roda.

**O manual das telas vive no prompt, com quebra de cache própria.** O
assistente recebe três blocos de sistema, do mais compartilhado para o mais
específico: instrução (constante), manual (constante, ~14 mil tokens com oito
ferramentas), contexto
(varia por empresa). A quebra **depois do manual** faz o prefixo —
ferramentas + instrução + manual — ser idêntico para todos os clientes e
dividir uma única entrada de cache. Com uma quebra só no fim, cada empresa
teria a própria entrada carregando o manual dentro: nada quebraria, o custo
subiria em silêncio. Cache é por prefixo, então a ordem é o que faz a
economia — bloco que varia antes de um constante invalida tudo depois.

**O manual é gerado, nunca editado à mão.** `manual.md` é a fonte e também
vira o PDF do cliente; `npm run manual` produz `manual.ts`. Há teste que falha
se os dois divergirem — editar o markdown e esquecer de gerar deixaria o chat
ensinando uma versão e o cliente lendo outra, sem nenhum sintoma. Embutido em
`.ts` e não lido em execução porque o runtime do Dockerfile copia só o `dist`:
um `.md` em `src` não chega ao container. Quando passar de ~60 mil caracteres
(o teste avisa), vira ferramenta `consultar_manual` em vez de seguir inteiro
no prefixo. Em 17/10/2026 ele está em 50 mil com oito das doze ferramentas —
as quatro que faltam devem estourar o teto, e isso é o sinal combinado, não um
acidente.

**O modelo não faz conta.** As ferramentas leem as mesmas views das telas e
devolvem o valor já somado. Dois lugares calculando o mesmo número terminam
divergindo, e aí o cliente perde a confiança nos dois.

**A análise gratuita não usa IA, e a razão não é só custo.** `MOTOR_PUBLICO`
é `codigo`: o `redator.ts` não tem rede, formato para errar, timeout nem teto
diário. No formulário público quem espera é um prospect — se a IA estiver fora
ou o teto tiver estourado, ele preenche tudo e não recebe nada, e lead perdido
não volta. O painel manda `?motor=ia` e segue na Anthropic, porque o texto
adaptado ao setor é parte do que o cliente pagante compra.

**E relatório escrito por código sai na hora.** A janela das 8h do financeiro
existe pelo link de "segurar" no aviso interno — revisão de um texto que um
modelo escreveu. Sem modelo não há o que revisar, e segurar até amanhã um
relatório pronto em milissegundos custa a atenção do prospect. Ver
`politicaDeEnvio`.

**Venda não é recebimento.** O movimento diário lança a venda com
`competence_date` no dia e `due_date` no dia em que o dinheiro entra, conforme
o prazo da forma de recebimento (`formas_recebimento.prazo_dias`). Cartão de
crédito a 30 dias entra como conta a receber, não como caixa. Tratar tudo como
recebido inflaria a cobertura de caixa e encurtaria o PMR — os dois indicadores
que sustentam o diagnóstico. Ver `modules/transactions/movimento.ts`.

**O movimento diário produz `transactions`, não um modelo paralelo.** Extrato,
DRE, contas, prazos médios, diagnóstico e assistente continuam lendo o que já
liam. Salvar o mesmo dia substitui — há um registro por empresa por data, e os
lançamentos nascem amarrados a ele com `on delete cascade`. Lançamento manual
tem `movimento_id` nulo e fica fora do alcance do formulário.

**Na captura de boleto, o modelo só transcreve dígitos.** Ele devolve a linha
digitável e nada mais — não lê valor, não lê data. A razão não é custo: a
linha tem dígito verificador, então um erro de transcrição é **detectável** e
`lerBoleto` recusa. Se o modelo lesse "R$ 1.247,80" e devolvesse 124.78, nada
no sistema teria como saber, e a empresa pagaria um décimo da conta. Valor e
vencimento saem da aritmética, em `modules/transactions/boleto.ts`. A
instrução que proíbe o modelo de ler valor e data tem teste de contrato.

**E nada vira lançamento sozinho.** A captura grava como `pendente`; o
`transactions` nasce quando uma pessoa confirma. Automatizar a leitura
economiza digitação; automatizar a confirmação entregaria ao modelo a decisão
de quanto a empresa paga. Na tela, valor e vencimento lidos do código
aparecem como **texto, não como campo** — quem discorda descarta e confere o
papel, não sobrescreve um número que passou por dígito verificador.

**Pagar o mesmo boleto duas vezes é impedido por índice, não por consulta.**
`boletos_sem_repetir_idx`, no SQL 62. A consulta na rota existe só para a
mensagem ser compreensível; a garantia é do banco, porque aplicação erra em
corrida.

**No boleto por e-mail, quem diz de qual empresa é o boleto é o token do
destinatário — nunca o remetente.** Cada empresa tem um endereço
`boletos+TOKEN@dominio` (SQL 63), e o token resolve o `tenant_id`. O `From` é
trivial de falsificar e nem resolve o caso real: fornecedor que encaminha
boleto não é usuário de empresa nenhuma. O corpo do webhook **não tem campo de
empresa**, mesma regra das ferramentas do assistente, e há teste que varre o
schema procurando `tenant|empresa|cliente`. Sem token, com token desconhecido
ou com dois tokens, não grava nada.

**O endereço de entrada é uma credencial, e o aviso na tela faz parte da
segurança.** Quem souber o endereço põe boleto na fila daquela empresa — é o
que um endereço de e-mail faz. O teto do dano é lixo na fila, porque nada vira
`transactions` sem confirmação. Mas há um ataque que o lixo não cobre, e é a
fraude mais comum do Brasil: código com DV perfeito, valor plausível,
**beneficiário trocado**. A leitura do código não protege disso. Por isso
`origem` e `remetente` são colunas, a tela destaca boleto de e-mail com borda
e pergunta própria, e o endereço é rotacionável.

**O webhook de e-mail responde 200 para e-mail que não serve.** Spam, token
revogado, anexo que não é boleto: `gravados: 0` com o motivo. Erro faria o
fluxo IMAP reentregar para sempre um e-mail que nunca vai dar em nada. Erro de
verdade (banco ou modelo fora) continua 5xx, porque ali reentregar é o certo.
E `23505` da trava de duplicado é esperado, não defeito — é o que torna a rota
segura de rechamar.

**PDF entra como `document`, não como `image`.** Boleto por e-mail é quase
sempre PDF, e PDF é o caso mais FÁCIL: tem camada de texto, a linha digitável
está lá como caractere. Mandar PDF como imagem faz a API recusar, e o sintoma
chega ao cliente como "não consegui ler" — indistinguível de foto ruim. Ver
`blocoDoArquivo`, com teste. HEIC fica fora da leitura mas é aceito no bucket:
o arquivo guardado é o que permite digitar a linha sem fotografar de novo.

**A triagem de anexos é no módulo puro, não no n8n.** E-mail de banco vem com
logo, ícone de assinatura e `.ics`. Cada anexo mandado ao modelo custa
dinheiro, e PNG de 3 KB nunca é boleto. Filtrar nos dois lugares cria duas
regras que divergem, e a do n8n é a que ninguém testa. Ver `triarAnexos` — PDF
vai na frente de imagem de propósito.

**O fator de vencimento tem duas bases, e elas não se contam igual.** A antiga
(07/10/1997) é fator **zero**; a nova (22/02/2025) é fator **mil**, porque a
contagem reiniciou em 1000. Aplicar o `-1000` nas duas desloca todo boleto do
ciclo antigo em 2,7 anos — e o erro é invisível, porque a data errada cai fora
da janela de sanidade e a função devolve nulo: o sintoma é "não consigo ler
este boleto", nunca uma data errada. Conferido contra exemplos publicados em
15/10/2026; há teste com eles, e é o único teste do arquivo que não depende
do nosso próprio código.

**Importação lê o markdown, nunca o PDF.** O relatório de PDCA nasce como
`relatorio.md` e só depois é renderizado. Importar o PDF é analisar a própria
saída depois de descartar a estrutura — e o PDF impresso perde até a camada de
texto. Ver `modules/pdca/relatorio.ts`.

**Dado ausente ou ambíguo sai como `null`, com aviso.** Vale para planilha e
para relatório. Prazo que o relatório deu como período ("Onda 2") não vira
data: fica em branco, destacado, e a tela bloqueia o salvar. Número inventado
num plano de ação é compromisso que ninguém assumiu.

## Estado atual

`RETOMAR-AQUI.md` tem o que está pendente. Leia antes de começar.
