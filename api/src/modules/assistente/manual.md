---
title: "Ferramentas de Gestão Financeira"
subtitle: "Manual de uso — Fluxo de Caixa, Capital de Giro, Ciclo e Plano de Redução"
author: "Business Triage"
date: "Outubro de 2026"
---

# Como usar este manual

Este manual cobre as **quatro primeiras ferramentas financeiras** da sua
plataforma. Elas não são independentes: foram desenhadas para serem usadas
nesta ordem, e cada uma responde uma pergunta diferente sobre o mesmo
problema.

| Ferramenta | Pergunta que responde | O que ela faz |
|---|---|---|
| Fluxo de Caixa Projetado | **Quando** o caixa aperta, e quanto falta | Mede |
| Capital de Giro | **Quanto** a operação exige, e se é pico ou estrutura | Mede |
| Ciclo Operacional e Financeiro | **Por que** acontece | Mede |
| Plano de Redução de Ciclo | **O que fazer** | Compromete |

As três primeiras medem. A quarta compromete — ela transforma número em ação
com responsável e prazo.

**Se você só tem tempo para uma:** abra o Fluxo de Caixa Projetado. É a que
mostra o problema mais cedo.

---

# Três conceitos que valem para todas

Antes das ferramentas, três ideias que aparecem em todas elas. Entender estas
três economiza metade das dúvidas.

## 1. Venda diária: a régua que converte dias em reais

É o seu faturamento do último mês fechado dividido por 30.

Se você fatura R$ 180.000 no mês, a sua venda diária é **R$ 6.000**.

Esse número é a régua de toda a plataforma. É ele que permite dizer que "um
dia de prazo custa R$ 6.000" — e é o que transforma um conselho vago
("negocie prazo") em uma decisão com valor ("negocie prazo e ganhe R$ 30 mil").

Usamos mês comercial de 30 dias, não 30,4. Seria mais exato e menos
conferível — e num número que serve para decidir, poder confirmar na
calculadora do celular vale mais que a terceira casa decimal.

## 2. O que a plataforma mede e o que você informa

| Vem dos seus lançamentos | Você informa |
|---|---|
| Faturamento do mês | Valor em estoque |
| Contas a receber em aberto | Prazo de estoque (PME) |
| Contas a pagar em aberto | Taxa de capital de giro do banco |
| Prazo de recebimento (PMR) | Ajustes de semanas específicas |
| Prazo de pagamento (PMP) | Alavancas do plano |
| Saldo em caixa hoje | |

Quanto mais você lançar suas contas **com data de vencimento**, menos as
ferramentas dependem de estimativa. Isso vale repetir: a qualidade de todas
elas depende do seu cadastro.

O **estoque é a única exceção importante**: a plataforma não controla estoque
por item, então ele vem do *Fechamento do mês*. Se ninguém informou, as telas
avisam em amarelo em vez de calcular com zero — porque estoque zero encurta o
ciclo e faz a empresa parecer mais saudável do que é.

## 3. Por que o seu contador chega a outro número

Os prazos nestas telas são medidos em **dias de venda**: cada valor dividido
pelo faturamento de um dia.

O seu contador mede o estoque sobre o **custo** da mercadoria e o fornecedor
sobre as **compras**. Com os mesmos dados, ele chega a números maiores.

**Nenhuma das duas está errada.** São réguas diferentes para a mesma coisa.

A régua desta plataforma foi escolhida porque faz uma identidade fechar
exatamente:

> ciclo × venda diária = estoque + a receber − a pagar

Ou seja: o ciclo em dias e o dinheiro parado em reais são sempre o mesmo fato,
visto de duas formas. Se usássemos a régua contábil no ciclo, as telas de
Ciclo, Capital de Giro e Plano de Redução dariam respostas diferentes para a
mesma pergunta.

**O prazo de recebimento é a exceção:** ali a conta é a mesma que o contador
faz. Só estoque e fornecedor divergem.

---

# 1. Fluxo de Caixa Projetado — 12 semanas

## Para que serve

Responder: **em que semana o meu caixa aperta, e quanto vai faltar.**

É comum uma empresa fechar o mês no azul e ter passado quinze dias no
vermelho — com o fornecedor esperando, a antecipação de recebível contratada e
o cheque especial usado. O saldo do dia 31 não mostra nada disso.

São doze semanas porque esse é o horizonte em que ainda dá para agir. Com
quarenta dias de antecedência, um problema de caixa é uma conversa. Com quatro
dias, é uma conversa com o gerente do banco — e aí custa caro.

## Antes de começar

Confira se o **Saldo hoje** bate com o seu extrato bancário.

Esse número não é digitado: sai do saldo inicial das contas cadastradas mais
tudo que já foi efetivamente pago e recebido. Se não bate, **corrija o
cadastro das contas — não ajuste a projeção.** Saldo inicial errado erra todas
as doze semanas na mesma direção, e não há como perceber olhando.

## Como ler os três números do topo

**Saldo hoje** — o ponto de partida. Dinheiro que já andou.

**Menor saldo da janela** — o pior momento previsto nas doze semanas. Se
estiver negativo, o cartão fica vermelho e diz "é este o buraco a cobrir".

**Semanas no vermelho** — quantas fecham negativas, e em quantas semanas a
primeira acontece. Esse segundo número é o seu prazo.

> **O buraco é o menor saldo, não a soma das semanas negativas.**
> Se três semanas fecham negativas em R$ 10 mil, R$ 15 mil e R$ 8 mil, o que
> você precisa cobrir são R$ 15 mil — não R$ 33 mil. Somar leva a tomar
> crédito a mais do que o necessário.

## Como ler o gráfico

A curva é o saldo ao fim de cada semana. A linha horizontal é o zero, e o que
afunda abaixo dela aparece em vermelho. Passando o mouse em cada ponto você vê
a semana e o saldo.

## Como ler a tabela: as três origens

Embaixo de cada valor há uma palavra em letra pequena dizendo de onde o número
veio.

**Lançado** — título seu, com data e com dono, cadastrado no Controle
Financeiro. Aparece em letra firme. Não é previsão, é compromisso.

**Estimado pela média** — aparece em *itálico e cinza*. Quando a semana não tem
nada lançado, o sistema usa a média do que de fato entrou e saiu nas suas
últimas treze semanas completas. A semana atual fica fora da média, porque
está pela metade.

**Ajustado** — você escreveu o número à mão.

> **Se existe título lançado na semana, a média não entra.** O lançado é a
> verdade daquela semana. Somar a média ao título que você já cadastrou seria
> somar compromisso com palpite, e inflaria a semana.

## Como preencher

Todo campo da tabela é editável. Clique, digite, clique fora — salva sozinho,
e o rótulo muda para "ajustado". Quando havia título na semana, ele continua
mostrando quanto era o lançado, para você não perder a referência.

Ajuste quando souber algo que o sistema não sabe: o décimo terceiro em
dezembro, o IPVA em janeiro, uma compra grande combinada. Sazonalidade,
campanha nova, cliente grande que saiu — nada disso está nos dados.

> **Campo vazio e zero não são a mesma coisa.**
> Vazio significa "use o que você calculou". Zero significa "não entra nada
> nesta semana". Se você quer declarar uma semana sem entradas — férias
> coletivas, por exemplo — escreva **zero**. Deixar vazio faz o sistema
> preencher com a média, que é o contrário do que você quis dizer.

Use o campo de **observação** para registrar o que fugiu do padrão. Daqui a
dois meses é essa anotação que explica o número diferente.

## Atenção: o vencido está todo na semana 1

Título atrasado não fica no passado — ele ainda vai entrar ou sair, só que
fora do prazo. Então ele é empurrado para a semana atual.

Por isso **a semana 1 costuma ser a maior da tabela**. E quando o atraso é de
*recebimento*, ela é a mais otimista do conjunto: assumir que todo cliente
atrasado vai pagar nesta semana é uma aposta.

Se a sua semana 1 está confortável por causa de recebimento vencido, **ajuste
esse número para baixo**. É o ajuste mais útil de toda a tela.

## O que fazer com o resultado

Uma vez por semana, de preferência na segunda: olhe o **menor saldo** e **em
quantas semanas** ele acontece.

Se há semana negativa, a ordem de ação é esta — do mais barato para o mais
caro:

1. Antecipar cobrança do que já venceu
2. Adiar compra não essencial
3. Renegociar vencimento com fornecedor
4. Antecipação de recebível
5. Cheque especial

As duas últimas são as mais caras e as primeiras que vêm à cabeça quando o
prazo já acabou. É justamente o prazo que esta tela te dá.

## Erros comuns

- Ajustar a projeção quando o "Saldo hoje" está errado. Corrija o cadastro.
- Deixar o campo vazio querendo dizer zero.
- Somar as semanas negativas para calcular quanto de crédito tomar.
- Ler a semana 1 sem olhar o aviso de atraso.
- Abrir uma vez por mês. Em doze semanas, isso desperdiça dois terços do aviso.

---

# 2. Cálculo de Capital de Giro

## Para que serve

A pergunta "quanto de capital de giro eu preciso?" tem **duas respostas
certas**, e a diferença entre elas decide a ação.

**Travado hoje** — contas a receber em aberto, mais estoque, menos contas a
pagar em aberto. É o dinheiro seu parado na operação neste momento.

**Necessidade estrutural** — ciclo financeiro × venda diária. É quanto a
operação exige **de forma permanente** para girar no ritmo de hoje.

Mostrar só uma produz a decisão errada metade das vezes.

> **Capital de giro não é linha de crédito.** É uma necessidade da operação.
> Tratar os dois como sinônimo é o que leva a resolver com juros um problema
> que se resolve com prazo.

## O ciclo financeiro, em uma linha

Você compra. A mercadoria fica no estoque alguns dias (**PME**). Você vende, e
o cliente leva alguns dias para pagar (**PMR**). Você paga o fornecedor em
algum momento (**PMP**).

> ciclo financeiro = PME + PMR − PMP

É o número de dias em que o seu dinheiro fica fora do seu bolso.

## Como preencher

**Recebimento (PMR) e Pagamento (PMP)** — o sistema mede sozinho, a partir dos
títulos que você deu baixa, **ponderados por valor**. Um cliente de R$ 100 mil
que atrasa pesa mais que dez clientes de R$ 1 mil que pagaram em dia. Embaixo
do campo aparece "seus lançamentos mostram tantos dias".

**Deixe em branco para usar o medido.** Preencha só para simular.

**Estoque (PME)** — você digita, porque a plataforma não mede estoque. Se a
sua empresa é de **serviço, deixe zero** — não é aproximação, serviço não tem
estoque e a conta continua correta.

**Valor em estoque** — em reais. Não entra no ciclo; entra no "Travado hoje".

Os **custos variáveis** vêm do seu DRE automaticamente. Os **custos fixos**
estão na aba ao lado, e são os que você já revisou no Controle Financeiro.

## Como ler os três resultados

**Necessidade estrutural** — embaixo dela está a conta exposta: ciclo de
tantos dias × tanto por dia de venda. Se você conferir na calculadora, bate.

**Travado hoje** — a receber + estoque − a pagar.

**Folga de caixa** — seu saldo menos a necessidade estrutural. Negativo é
buraco. Embaixo aparece **quantos dias de operação o caixa cobre** — e aqui a
régua muda de propósito: é quanto a operação *queima* por dia (fixos +
variáveis ÷ 30).

> **São duas réguas diferentes, de propósito.** "Quanto um dia de prazo
> devolve" usa a venda diária. "Quantos dias o caixa aguenta" usa o
> desembolso. Misturar as duas é o erro mais comum nesta tela.

## A leitura que decide a ação

Compare os dois primeiros números:

**Travado hoje muito acima da estrutural** (a tela avisa quando passa de 30%)
— costuma ser pico: um cliente grande atrasou, uma compra concentrou. **Antes
de buscar crédito, confira se é permanente.** Tomar empréstimo para financiar
um mês ruim é pagar juros por algo que ia passar.

**Os dois próximos** — é assim que a sua empresa é. Resolver exige mudar
prazo, não esperar passar.

**Travado abaixo da estrutural** — momento favorável, mas não é o normal. A
operação no ritmo atual continua exigindo o valor estrutural.

**Folga negativa** — essa diferença está sendo financiada por alguém:
fornecedor, banco ou o próprio sócio. Vale saber por quem.

**Cobertura abaixo de 30 dias** — qualquer atraso de recebimento vira
urgência.

## O número que faz agir

> **Cada dia a menos no ciclo devolve uma venda diária ao caixa.**

Com venda diária de R$ 6.000, cortar cinco dias do prazo de recebimento libera
R$ 30.000 — sem vender nada a mais, sem tomar crédito, sem cortar custo. É
dinheiro que já é seu e está preso no prazo.

Três alavancas:

1. **Receber mais rápido** — cobrança ativa, desconto para antecipação, mudar
   a forma de recebimento
2. **Pagar mais devagar** — negociar prazo com fornecedor, sem pagar juros
3. **Girar o estoque mais rápido** — comprar menos e mais vezes

## Simular antes de negociar

Os campos de prazo são editáveis e o resultado recalcula na hora. Se o seu PMR
medido é 42 dias e você quer propor 35, digite 35 e veja o efeito na folga de
caixa.

Agora você entra na conversa com o número: *"se trouxermos o recebimento de 42
para 35 dias, libera R$ X do nosso caixa"*. Isso é diferente de pedir para
"cobrar melhor".

Para voltar ao real, **apague o campo**. O valor medido continua visível
embaixo. A simulação não altera nada no sistema.

## Erros comuns

- Preencher o prazo à mão quando o medido já existe.
- Confundir as duas réguas (venda diária × desembolso diário).
- Somar "travado hoje" com "necessidade estrutural". São duas medidas do mesmo
  fato por caminhos diferentes — não se somam.
- Pedir crédito no pico, sem conferir se é permanente.
- Deixar o PME em branco achando que o sistema mede. Em branco vira zero, o
  que para comércio subestima o ciclo.

---

# 3. Ciclo Operacional e Financeiro

## Para que serve

Responder a pergunta mais comum de todas: **"eu vendo bem, por que nunca tem
dinheiro no caixa?"**

O dinheiro existe. Ele só não está no caixa — está parado no **estoque** e na
**mão dos seus clientes**. Esta tela mede quantos dias e quanto.

## Os dois ciclos, com exemplo

Você compra no dia 1º. A mercadoria fica 20 dias na prateleira. Você vende no
dia 21. O cliente paga em 30 dias, então o dinheiro entra no dia 51.

Da compra até o dinheiro entrar: **51 dias** — esse é o **ciclo operacional**.

Mas você não pagou o fornecedor no dia 1º: pagou em 30 dias. Então 30 dias
foram bancados pelo fornecedor, e **21 você bancou sozinho**.

Esses 21 dias são o **ciclo financeiro**. É o número que importa — a tela
chama de "dias que você banca sozinho".

## Como preencher

**Faturamento mensal** — vem do último mês fechado. É a régua; sem ele nenhum
prazo pode ser calculado.

**Contas a receber e a pagar** — vêm dos seus títulos em aberto.

**Valor em estoque** — vem do *Fechamento do mês*, e a tela mostra de qual
competência. Se ninguém informou, ela avisa em amarelo em vez de calcular com
zero.

Os quatro são editáveis para simulação. Mudar aqui não altera o seu
fechamento.

## Como ler o resultado

**Ciclo operacional** — estoque + recebimento. Da compra até o dinheiro entrar.

**Ciclo financeiro** — o operacional menos o fornecedor. O que você banca.

Vem com uma etiqueta: **Confortável** até 30 dias, **Atenção** de 31 a 40,
**Crítico** acima de 40.

> **A etiqueta é referência, não veredito.** Essas faixas são calibradas para
> comércio. Supermercado opera com ciclo negativo; construtora, com 120 dias —
> e os dois estão bem. A plataforma não sabe o seu setor.

O que vale mais é o painel **"O seu ciclo ao longo do tempo"**. Trinta e cinco
dias numa construtora é excelente e num supermercado é problema — mas 35 dias
depois de você estar em 28 é piora em qualquer ramo.

**Olhe o seu histórico antes de olhar a etiqueta.**

## Ciclo negativo é a melhor posição

Se o seu ciclo financeiro der negativo, você **recebe do cliente antes de
pagar o fornecedor**: a operação se financia sozinha, sem capital seu parado.

É assim que supermercado e posto de combustível vivem — vendem à vista e pagam
o fornecedor em 30 dias.

Se é o seu caso, **proteja essa condição em qualquer renegociação**. É comum
trocar prazo de fornecedor por desconto sem perceber que o desconto custa
caixa.

## Onde atacar

A faixa escura mostra quanto do seu dinheiro está parado. E quando o ciclo
passa de 30 dias, a ferramenta diz **qual dos pedaços é o maior** — estoque ou
recebimento.

> Isso existe para evitar o erro mais comum: **ir brigar com o fornecedor
> quando o problema é o estoque.** Se o estoque são 25 dias e o recebimento
> são 10, negociar prazo resolve pouco. O dinheiro está na prateleira, não no
> carnê.

## Erros comuns

- Rodar sem informar o estoque. Zero encurta o ciclo e engana para o lado bom.
- Ler a etiqueta como veredito, ignorando o próprio histórico.
- Atacar o fornecedor quando o estoque é o maior pedaço.
- Trocar prazo de fornecedor por desconto sem calcular. Cada dia perdido custa
  uma venda diária em caixa — compare antes de aceitar.
- Confundir ciclo operacional com financeiro. Para caixa, o que importa é o
  financeiro.

---

# 4. Plano de Redução de Ciclo

## Para que serve

As três ferramentas anteriores **medem**. Esta **compromete**.

Você já sabe quantos dias o seu dinheiro fica fora do caixa e qual pedaço é o
maior. Aqui você transforma isso em ações.

> **Só entra no plano o que tem responsável e prazo.** Alavanca sem dono não é
> plano — é intenção. E intenção não reduz ciclo nenhum.

## Antes de começar

Você precisa de **ciclo financeiro medido** (logo: faturamento, estoque
informado, contas em aberto) e de um **plano de ação ativo** na empresa. As
alavancas viram ações desse plano.

## Como ler o topo

**Ciclo hoje** — os dias que você banca, e quanto isso representa em dinheiro
parado. Vem dos seus lançamentos, não é digitado aqui.

**A seta do meio** — quantos dias o plano tira, e quantas alavancas você tem.

**Ciclo depois do plano** — onde você chega *se as alavancas acontecerem*.

A diferença entre os dois valores em reais é o dinheiro que volta ao caixa.

> Esta tela não projeta um futuro provável. Ela projeta a **consequência dos
> compromissos que você assumiu**. Se ninguém fizer, o ciclo depois é igual ao
> de hoje.

## Como criar uma alavanca

São cinco campos:

**Título** — o nome curto. Exemplo: "Girar o estoque parado".

**Detalhe** — parece opcional e é o campo mais importante. Exemplo: "Liquidar
os itens sem saída há mais de 90 dias e não recomprá-los".

Compare os dois. O título é uma direção; o detalhe é uma **ação** — tem
começo, tem critério, e dá para saber se foi feita.

**Ganho em dias** — quantos dias você acredita que a alavanca tira. Enquanto
você digita, a tela mostra quanto isso **libera em reais**.

**Responsável e Prazo** — obrigatórios. Não por rigor da tela: a alavanca vira
uma **ação do seu plano de ação**, que aparece no painel inicial como
pendência e no card de ações em atraso.

Uma tabela só de alavancas seria vista uma vez, no dia em que foi escrita. Uma
ação cobra o responsável toda semana.

### Alavanca boa e alavanca ruim

| Ruim | Boa |
|---|---|
| Melhorar a cobrança | Ligar para todo cliente no terceiro dia de atraso |
| Reduzir estoque | Liquidar itens sem saída há mais de 90 dias e não recomprar |
| Negociar com fornecedor | Pedir 45 dias nos dois fornecedores que são 60% das compras |
| Encurtar o recebimento | Reduzir o carnê de 3x para 2x nas vendas abaixo de R$ 300 |

A diferença entre as colunas é a diferença entre algo que dá para cobrar e
algo que não dá.

## Só alavanca aberta conta

Alavanca concluída aparece em cinza, com os dias que rendeu, mas **não entra
na projeção**.

O efeito dela já está dentro do ciclo de hoje, porque o ciclo de hoje sai dos
seus lançamentos reais. Se continuasse contando, o plano prometeria duas vezes
a mesma redução — e nunca fecharia com a realidade.

Quando todas estiverem concluídas, rode a calculadora de ciclo de novo: o
número novo é o seu ponto de partida para a próxima rodada.

## O valor real: o juro que você não paga

> **Liberar R$ 30.000 de capital de giro não é ganhar R$ 30.000. É deixar de
> tomar R$ 30.000 emprestado.**

No fim da página há um campo para a **taxa de capital de giro do seu banco**,
em % ao mês. Se você informou no Fechamento do mês, já vem preenchido.

Com a taxa, a tela calcula o **juro que você não vai pagar em doze meses**. É
juro **composto**, não a taxa × 12 — porque capital de giro se renova mês a
mês: você não toma emprestado uma vez, você rola a dívida.

É por isso que este plano vem **antes** da decisão de tomar crédito.

A sequência que quase toda empresa segue é: aperta o caixa, procura o banco,
paga juros. A sequência que esta tela propõe é: aperta o caixa, **corta os
dias de ciclo que der**, e vai ao banco só pelo que sobrar.

> **Dinheiro de ciclo é mais barato que dinheiro de banco, porque já é seu.**

## Os testes de realidade

A ferramenta avisa em três situações:

**Alavancas somam mais da metade do ciclo atual** — *"planos assim costumam
ser otimismo em forma de tabela"*. A recomendação é o contrário do instinto:
**menos alavancas, com ganho que você consegue defender.** Um plano que
promete cortar 20 de 35 dias não acontece — e plano que não acontece queima a
credibilidade da ferramenta com a equipe.

**Resultado levaria o ciclo a negativo** — possível, mas raro. Vale conferir
se os ganhos não estão otimistas.

**Alavanca sem detalhe** — a mais fácil de ignorar e a que mais mata plano.
Em sessenta dias, ninguém vai saber se "melhorar a cobrança" foi feito.

**Plano vazio** — a ferramenta sugere começar por **girar o estoque parado**,
porque é a única alavanca que não depende de terceiro nenhum. Não precisa
negociar com fornecedor nem mudar política com cliente.

## Como usar, na prática

1. Veja no Ciclo qual é o maior pedaço — estoque ou recebimento. Comece por lá.
2. Crie **duas ou três** alavancas. Não dez. Com responsável, prazo e detalhe.
3. Informe a taxa do banco e olhe o juro evitado. É esse número que vai para a
   reunião, não os dias.
4. As alavancas estão no seu plano de ação. Elas vão te cobrar.
5. Ao concluir, rode a calculadora de ciclo de novo e monte a próxima rodada.

## Erros comuns

- Montar dez alavancas. Plano grande não acontece.
- Deixar o detalhe vazio.
- Confundir dinheiro liberado com lucro. É juro evitado, não receita.
- Não informar a taxa do banco. Sem ela o plano fica em dias, e dias não
  convencem numa reunião.
- Pôr o dono como responsável de tudo. Alavanca sem dono real é alavanca sem
  dono.

---

# Perguntas frequentes

**Por que o número da plataforma é diferente do que o meu contador calculou?**

Porque as réguas são diferentes, e nenhuma das duas está errada. A plataforma
mede os prazos em dias de venda; o contador mede o estoque sobre o custo da
mercadoria e o fornecedor sobre as compras, e chega a números maiores. A régua
da plataforma existe para que o ciclo em dias e o dinheiro parado em reais
sejam sempre o mesmo fato. O prazo de recebimento é a exceção: ali as duas
contas coincidem.

**O "Saldo hoje" não bate com o meu extrato. O que faço?**

Corrija o saldo inicial das contas bancárias no cadastro. Não ajuste a
projeção — saldo errado erra todas as semanas na mesma direção e não há como
perceber olhando.

**Por que a semana 1 do fluxo de caixa é sempre a maior?**

Porque todo título vencido é empurrado para ela. Título atrasado ainda vai
entrar ou sair, só que fora do prazo. Quando o atraso é de recebimento, essa
semana fica otimista — vale ajustar o valor para baixo.

**Qual a diferença entre "Travado hoje" e "Necessidade estrutural"?**

"Travado hoje" é o que está parado na operação neste momento. "Necessidade
estrutural" é o que a operação exige de forma permanente no ritmo atual. Se o
primeiro está muito acima do segundo, costuma ser pico passageiro. Se estão
próximos, é estrutura — e só mudar prazo resolve.

**Posso somar as duas necessidades de capital de giro?**

Não. São duas medidas do mesmo fato por caminhos diferentes.

**Meu ciclo financeiro deu negativo. Está errado?**

Não, é a melhor posição possível: você recebe antes de pagar e a operação se
financia sozinha. Proteja essa condição em qualquer renegociação com
fornecedor.

**O meu ciclo é de 45 dias. É ruim?**

Depende do ramo. As faixas da tela são calibradas para comércio. Construtora
opera com 120 dias; supermercado, com ciclo negativo. Compare com o seu
próprio histórico — é o diagnóstico que vale em qualquer setor.

**Quanto vale cortar um dia do ciclo?**

Uma venda diária. Com faturamento de R$ 180 mil ao mês, cada dia vale R$ 6
mil.

**Devo deixar o campo em branco ou escrever zero?**

Não é a mesma coisa. Em branco, o sistema usa o que calculou (a média ou o
medido). Zero significa "não há nada". Para declarar uma semana sem entradas,
escreva zero.

**Minha empresa é de serviço. O que faço com o estoque?**

Deixe zero nos dois campos. Não é aproximação: serviço não tem estoque, e a
conta continua correta.

**Por que o plano exige responsável e prazo?**

Porque a alavanca vira uma ação do seu plano de ação, que cobra o responsável
toda semana. Sem dono e sem data, o banco não aceita o registro — e, mais
importante, ninguém executa.

**Liberar capital de giro é a mesma coisa que lucro?**

Não. É deixar de tomar emprestado. O ganho é o juro que você não paga.

**Por que o juro evitado é composto e não simples?**

Porque capital de giro se renova mês a mês. Você não toma o empréstimo uma
vez — você rola a dívida ao longo do ano.

---

# Glossário

**Ciclo financeiro** — PME + PMR − PMP. Os dias em que o seu dinheiro fica
fora do caixa, financiado por você.

**Ciclo operacional** — PME + PMR. Da compra da mercadoria até o dinheiro
entrar.

**NCG** — Necessidade de Capital de Giro. Quanto a operação exige de dinheiro
parado para girar.

**PMR** — Prazo Médio de Recebimento. Dias entre vender e receber.

**PMP** — Prazo Médio de Pagamento. Dias entre comprar e pagar o fornecedor.

**PME** — Prazo Médio de Estoque. Dias entre comprar e vender.

**Venda diária** — faturamento do último mês fechado ÷ 30. A régua que
converte dias em reais.

**Desembolso diário** — (custos fixos + variáveis) ÷ 30. Quanto a operação
queima por dia. Serve à cobertura de caixa, não ao valor do ciclo.

**Competência** — o mês a que o fato pertence, independente de quando o
dinheiro andou.

**Caixa** — o regime que olha quando o dinheiro de fato entrou ou saiu.

**Alavanca** — uma ação específica que reduz o ciclo, com responsável e prazo.

---

*Business Triage · Manual de Ferramentas de Gestão Financeira · Outubro de 2026*
