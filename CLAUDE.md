# Business Triage — API e banco

Plataforma de gestão financeira para micro e pequenas empresas brasileiras,
operada por uma consultoria. Dois repositórios:

- **`saasfinanceiro`** (este) — API em Node/TypeScript, SQL do Supabase, fluxos do n8n
- **`business-triage`** — front-end React/Vite, publicado em `businesstriage.com.br`

## Como trabalhar aqui

**Teste antes de dar por pronto.** `cd api && npm test` roda a suíte (613 testes,
node:test sobre o `dist`). `npx tsc --noEmit` para o typecheck. Os dois precisam
passar; a suíte já pegou erros meus várias vezes.

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

## Armadilhas conhecidas

**Git trava com `index.lock`/`HEAD.lock`** quando o VS Code está com o repositório
aberto. `Remove-Item .git\*.lock -Force` no PowerShell.

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

**O modelo não faz conta.** As ferramentas leem as mesmas views das telas e
devolvem o valor já somado. Dois lugares calculando o mesmo número terminam
divergindo, e aí o cliente perde a confiança nos dois.

**A análise gratuita não usa IA, e a razão não é só custo.** `MOTOR_PUBLICO`
é `codigo`: o `redator.ts` não tem rede, formato para errar, timeout nem teto
diário. No formulário público quem espera é um prospect — se a IA estiver fora
ou o teto tiver estourado, ele preenche tudo e não recebe nada, e lead perdido
não volta. O painel manda `?motor=ia` e segue na Anthropic, porque o texto
adaptado ao setor é parte do que o cliente pagante compra.

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
