# Roadmap

As frentes decididas em conversa, na ordem em que fazem sentido construir.
O que está aqui já passou pela discussão: são escolhas, não ideias em aberto.
As perguntas que continuam em aberto estão marcadas como tal.

## Versões

| Versão | Escopo | Situação |
|---|---|---|
| **1.0.0** | Base: controle financeiro, DRE, extrato, diagnósticos comercial e financeiro, painel de staff, WhatsApp por origem, arquivar e excluir empresas | **No ar — em beta** |
| **1.1.0** | Acompanhamento do PDCA dentro do sistema | Planejada |
| **1.2.0** | Diagnóstico periódico a partir dos lançamentos, com a fronteira gratuito × assinante | Planejada |
| **1.3.0** | Camada de consultoria — três níveis, para a microfranquia | Planejada · janela durante a validação |
| **1.4.0** | CRM rastreável, integração com Meta Ads e o score como curva | Planejada |

Numerar assim segue a convenção do versionamento semântico: `1.0.0` é o que
já está de pé e funcionando, não o que vem depois. As frentes abaixo são os
incrementos — e por serem funcionalidades novas sem quebra de compatibilidade,
avançam o número do meio.

---

## 1.1.0 — Acompanhamento do PDCA dentro do sistema

**O que é.** O cliente vê no painel dele as ações que precisa executar e marca
conforme realiza. O consultor vê o mesmo quadro consolidado, em tempo real.

**Por que primeiro.** É o que fecha a tese do negócio. Hoje o SaaS é uma
ferramenta de controle financeiro vendida junto com a consultoria. Com o PDCA
dentro dele, o sistema passa a ser o instrumento da consultoria — o lugar onde
o trabalho pago acontece e fica registrado.

O ganho concreto é na reunião. Sem o quadro, ela começa com "e aí, como foram
as ações?" e a resposta é uma versão editada da memória. Com o quadro, começa
com "a ação 3 está 40 dias parada". Deixa de gastar a reunião levantando fatos.

**O risco.** O check virar teatro: o cliente marca sem ter feito, ou para de
marcar na terceira semana. O painel passa a mostrar um quadro falso — pior que
não ter painel, porque você confia nele.

**As três decisões que reduzem isso:**

- **Poucas ações abertas por vez** — três a cinco, não o plano do ano. Lista
  longa não é acompanhada, é ignorada.
- **Dono e prazo em cada ação** — nome de pessoa, não "a empresa". Ação sem
  dono não tem quem marque.
- **Verificação automática onde já existe dado.** Esta é a parte que quase
  ninguém tem: "separar PF de PJ" é medido pelo módulo de retiradas; "reduzir o
  custo X" pelo DRE; "registrar as vendas diariamente" pela frequência de
  lançamentos. Ação verificada pelo sistema vale mais que ação autodeclarada.
  As que não dão para verificar seguem com check manual, sem problema.

**O sinal a monitorar é a ausência.** Não é o que foi marcado — é quem parou de
marcar. Catorze dias sem movimento no quadro é o alerta que antecede o
cancelamento.

**Escopo mínimo da primeira versão:** lista de ações com prazo, dono e check,
mais a visão consolidada do consultor. O PDF do PLAN entra como anexo. Matriz
GUT e o resto do PDCA ficam fora.

**Antes de construir:** usar o beta para colher o vocabulário. Anotar as ações
reais prescritas nas primeiras consultorias. O que separa esse recurso de um
genérico é a lista ser reconhecível pelo cliente, e isso não se projeta de
cabeça.

---

## 1.2.0 — Diagnóstico financeiro periódico, a partir dos lançamentos

**O que é.** Em vez do formulário, o score sai dos dados que o cliente já
registra no Controle Financeiro. Mensal, automático.

**A restrição que define o desenho.** O sistema não sabe tudo o que a régua
pede:

| Sai dos lançamentos | Não existe no sistema |
|---|---|
| Faturamento, custos variáveis, despesas fixas | Passivo de curto e longo prazo |
| Pró-labore (módulo de retiradas) | Custo da dívida (% a.m.) |
| Saldo de caixa, inadimplência | Concentração de clientes |
| Prazos médios (PMR, PMP) | Regime tributário, mistura PF/PJ |

Então o diagnóstico automático calcula o que consegue e pede **quatro ou cinco
campos** por mês, em vez dos trinta do formulário original. É isso que torna a
coisa sustentável mensalmente — ninguém preenche o formulário longo doze vezes
por ano.

**A disciplina inegociável: recusar-se a pontuar com dados incompletos.** Se o
cliente lançou as receitas e metade das despesas, o score sai alto e falso — e
pior, sai com aparência de precisão. Melhor dizer "faltam as despesas de julho"
do que entregar um número errado com cara de certo. É o mesmo princípio do
silêncio no fluxo de WhatsApp: não responder é melhor que responder errado.

Precisa de um indicador de completude, e de um limiar abaixo do qual o
relatório simplesmente não é gerado.

**O produto novo é a curva, não o score.** Score de 46 em março e 61 em agosto
conta uma história que uma foto isolada não conta. É a evolução que segura a
assinatura e justifica a consultoria.

**Cobrança por e-mail.** Um só, quando o mês fechar sem dados suficientes,
dizendo o que especificamente falta. "Você não preencheu" irrita; "faltam as
despesas de julho para fechar seu diagnóstico" tem chance de gerar ação. O
mesmo sinal alimenta o painel de staff.

---

### A fronteira entre gratuito e assinatura

Parte da 1.2.0: é a decisão de produto que define o que o cálculo automático
entrega a quem paga.

Decidida assim:

**Gratuito** — formulário manual, uma vez por mês, sem histórico acumulado, sem
plano de ação. É uma amostra honesta: mostra o método e o rigor.

**Assinante** — cálculo automático a partir dos lançamentos, curva ao longo do
tempo, e o acompanhamento das ações do PDCA.

O gratuito vende o **diagnóstico**. O pago vende a **continuidade**. São coisas
diferentes o suficiente para não competirem — e é isso que impede o gratuito de
canibalizar a assinatura.

---

## 1.3.0 — Camada de consultoria (microfranquia)

**A decisão de negócio.** A replicação será por **microfranquia**, não por
venda de ferramenta: método definido, regras claras, consultor certificado. O
público inicial são os Personal Bankers da Franq — ex-gerentes de banco, já
acostumados a atuar como consultores, com carteira de PME construída.

O princípio que torna as duas atividades complementares em vez de concorrentes
é o **crédito com responsabilidade**: o consultor não vende crédito, vende a
decisão de tomar ou não tomar. A operação passa a ser consequência do
diagnóstico, não sua finalidade.

**A auditoria precisa morar no sistema.** É a diferença entre uma franquia que
sustenta a marca e uma que a dilui. Manual em PDF ninguém lê e ninguém verifica;
o dado que já circula na plataforma, sim. Indicadores de aderência ao método:

- O diagnóstico foi rodado **antes** da indicação de crédito?
- O PDCA foi registrado, ou o consultor pulou direto para a execução?
- O quadro de ações do cliente tem movimento, ou está parado há semanas?
- O relatório entregue é o que a régua gerou, ou foi alterado?

Isso transforma auditoria de visita presencial em painel — e é o que sustenta
o padrão quando o franqueador não está na sala.

**A mudança técnica: três níveis em vez de dois.**

```
plataforma (Business Triage)
  └── consultoria (franqueado)
        └── empresa (cliente)
```

Hoje existem dois níveis, e `is_staff` é uma chave global: quem é staff enxerga
**todas** as empresas. Para vários consultores, cada um precisa ver apenas a
própria carteira, e a Business Triage precisa continuar vendo tudo — papéis
diferentes, hoje colapsados no mesmo booleano.

O esboço:

- tabela `consultorias` (nome, CNPJ, situação, data de certificação);
- `tenants.consultoria_id` — a empresa pertence a uma consultoria;
- vínculo do consultor com a consultoria, separado de `memberships`, que
  continua sendo o vínculo com a **empresa**;
- `is_staff` se desdobra em dois papéis: *franqueador* (vê tudo) e *consultor*
  (vê a própria carteira);
- as funções de RLS ganham o terceiro nível.

**A janela.** Migrar com uma consultoria na base — a sua — é trivial: toda
empresa existente recebe o mesmo `consultoria_id`. Com trinta consultores e
trezentas empresas, vira projeto com risco de vazamento entre carteiras. O
custo dessa mudança cresce todo mês.

Some-se o argumento do funil: cada empresa em modo gratuito precisa ter um dono
desde o cadastro, senão não há a quem atribuir a conversão. Esse campo nasce
junto com a camada — e é retrabalho se vier depois.

**Recomendação de sequência:** desenhar e aplicar a camada durante os 90 dias
de validação comercial, ainda sem uso real. Chega na replicação com a estrutura
pronta e testada, em vez de fazer migração de dados com clientes pagantes
dentro.

---

## 1.4.0 — CRM rastreável e o score como curva

**A tese.** O diagnóstico deixa de ser uma fotografia — "a empresa tem score
48" — e vira uma trajetória: "saiu de 48 e chegou a 86". Isso muda o produto de
lugar. A foto é um serviço que se entrega uma vez; a curva é a prova de que a
consultoria funcionou, e é ela que sustenta a renovação.

O CRM entra como a peça que faltava para fechar o ciclo de medição.

### Duas ameaças à honestidade da curva

**A régua vai mudar.** Você vai querer melhorar a pontuação em algum momento, e
no dia em que mudar, os scores antigos deixam de ser comparáveis — a curva vira
ficção sem ninguém perceber.

*Providência:* gravar a **versão da régua** junto com cada score, desde o
primeiro. Quando a régua mudar, ou mantém-se as duas séries, ou recalcula-se o
histórico inteiro e diz-se claramente que foi recalculado. O que não pode é
misturar em silêncio.

**Estrutura e resultado sobem por motivos diferentes.** Com dados automáticos, o
score sobe tanto quando a empresa melhora quanto quando ela apenas passa a
*registrar* melhor. "Usa CRM" vale 10 pontos e vai de zero a dez no dia da
instalação, antes de qualquer venda acontecer.

*Providência:* separar a leitura em duas frentes —

| Pontos de estrutura | Pontos de resultado |
|---|---|
| Usa CRM, funil definido, métricas do funil | Margem líquida e de contribuição |
| Contas PF/PJ separadas | Ciclo financeiro, reserva operacional |
| Metas acompanhadas, pós-venda estruturado | CAC, relação ticket/CAC |

A narrativa fica mais forte porque fica verificável: *"de 48 para 86 — 22
pontos vieram de organizar a operação nos primeiros 60 dias; 16 vieram de
margem e ciclo, que só melhoraram depois."* Isso é um caso. "Subiu 38 pontos" é
uma promessa.

### O CRM: só o que alimenta a régua

CRM genérico é mercado saturado e produto enorme — Pipedrive, Kommo, RD. Não é
essa a disputa. O que ninguém tem é o CRM **alimentando o diagnóstico**: funil,
contato, valor, etapa e origem, o suficiente para que o score comercial se
calcule sozinho e a curva apareça para o cliente.

### Meta Ads nos dois sentidos

**Entrando** — verba e leads da campanha alimentam o **CAC automático**. É o
indicador que o diagnóstico pergunta e que quase nenhuma PME calcula, porque
exige cruzar investimento com venda fechada. Com o CRM no meio, sai sozinho.

**Saindo** — devolver ao Meta as conversões **reais** pela Conversions API: não
o formulário preenchido, mas o lead que virou venda. O algoritmo passa a
otimizar por cliente que compra, e não por cadastro. Isso muda o resultado da
campanha de um jeito que nenhum ajuste de criativo alcança — e só é possível
porque o CRM sabe qual lead fechou.

O ciclo fechado, que é raro ver junto:

```
diagnóstico → CRM → anúncio → CAC real → diagnóstico
```

**Aviso prático:** a Conversions API exige Business Manager, pixel e token de
acesso **por cliente**. Não é autoatendimento — é implantação, cliente a
cliente. Na estrutura de microfranquia isso não é defeito: é serviço faturável
do consultor.

### Providência que não pode esperar

**Guardar a fotografia inicial de cada cliente pagante** — score, indicadores e
data, no momento da assinatura. O "de 48 para 86" só existe se o 48 tiver sido
registrado no dia certo. Isso não se reconstrói depois, e custa uma linha de
código hoje.

---

## Subdomínios por cliente — avaliado, adiado

**Pergunta:** dar a cada cliente premium um endereço próprio, tipo
`bellamodaspraia.businesstriage.com.br`.

**Viável?** Sim: DNS curinga, certificado curinga e uma regra no Traefik
roteando tudo para a mesma aplicação. A estrutura do site não é comprometida.

**Os dois custos que se subestimam:**

- **O certificado curinga muda o modo de emissão.** Hoje a validação é por
  HTTP, simples. Curinga exige validação por DNS, com acesso do servidor à API
  do provedor. E o ponto de falha muda de escala: hoje uma falha derruba um
  domínio; com curinga, derruba **todos** de uma vez.
- **A sessão não atravessa origens.** O usuário logado em
  `businesstriage.com.br` não está logado em `bella.businesstriage.com.br` — o
  navegador trata como sites distintos e o token do Supabase fica na origem
  original. Resolver exige passar o token na navegação e reidratar a sessão do
  outro lado: factível, mas é código de autenticação, onde erro custa caro.

**Onde o subdomínio vale de verdade é um nível acima.** Para o cliente final é
percepção de exclusividade — real, mas cosmética. Para o **franqueado**,
`consultoriasilva.businesstriage.com.br` é white-label: ele apresenta a
plataforma como ferramenta dele. Isso muda o que ele pode cobrar, e é argumento
de venda da microfranquia. Se for pagar o custo do curinga, que seja por esse
uso — junto da 1.3.0.

**Para o cliente**, o mesmo efeito sai quase de graça com um caminho:
`businesstriage.com.br/bellamodaspraia`, com nome e logo da empresa no topo.
Mesma sessão, mesmo certificado, zero CORS.

---

## Cronograma

| Fase | Prazo | Objetivo |
|---|---|---|
| Beta | agosto | Corrigir o que aparecer com empresas reais |
| Uso comercial | a partir de 1º de setembro | Operação real, cobrança ativa |
| Validação comercial | ~90 dias | Interesse de mercado, monetização, projeção de receita |
| Replicação | após validação positiva | Recrutar e certificar consultores (PBs da Franq) |

**O que medir na validação** — três indicadores, e o terceiro é o que menos se
mede e mais revela:

1. Conversão de diagnóstico gratuito em contrato.
2. Retenção no terceiro mês.
3. **Se o cliente continua lançando dados sem ser cobrado.** Ferramenta
   financeira para PME raramente morre de cancelamento — morre de abandono
   silencioso. Se em 90 dias as pessoas ainda lançam por conta própria, há
   produto.

**Limite do prazo:** 90 dias entregam retenção, não resultado. A pergunta "a
consultoria melhorou a empresa?" exige um ciclo anual. Se a validação depender
de provar isso, o prazo é outro.

---

## Em aberto

- Agendamento pelo calendário no fluxo de WhatsApp. Decidido adiar: obriga o
  robô a manter conversa, e é o padrão de várias mensagens seguidas que mais
  rápido derruba número não oficial. O meio-termo é um link de agendamento
  (Google Agenda ou Cal.com) na saudação, mantendo uma mensagem só.
- Lançamentos recorrentes: existem no banco (`recurring_templates` e
  `fn_generate_recurring`) mas não têm tela nem rota na API.
- Aplicativo de finanças pessoais a partir do módulo `pessoa_fisica`.
- Captcha ou limite de taxa nos webhooks públicos do n8n.
