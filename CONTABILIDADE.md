# Contabilidade dentro do módulo financeiro — estudo de viabilidade

> Consulta de 16/09/2026. Nada aqui está implementado. O objetivo é
> responder: **quais informações e quais módulos seriam necessários** para
> gerar razão, razonete, balancete e balanço automaticamente a partir do
> que o usuário já informa.

---

## A tese, e por que ela é boa

O usuário lança o que pagou e o que recebeu porque precisa disso para
gerir. Hoje esse trabalho morre no fluxo de caixa, e o mesmo fato é
digitado uma segunda vez no escritório de contabilidade. A proposta é
aproveitar o lançamento que já existe.

Isso é real e já foi provado em produto: **o dado contábil é o mesmo dado
financeiro, visto por outro ângulo.** O que muda é o que se registra
sobre ele.

Mas há uma diferença estrutural que decide o projeto inteiro, e é melhor
encará-la antes de qualquer tela.

---

## A mudança estrutural: partidas dobradas

Hoje um lançamento é **uma linha com uma categoria**:

```
Aluguel · R$ 3.000 · despesa · categoria "Aluguel" · pago em 05/09
```

Contabilidade não aceita isso. Todo fato precisa de **duas contas, com
valores iguais e sinais opostos**:

```
D  Despesa de Aluguel          3.000
C  Banco Conta Movimento       3.000
```

Ou seja, o sistema hoje registra **metade** de cada fato. A conta de
destino existe de forma implícita — `bank_account_id` diz de onde saiu —
mas não é tratada como conta contábil, não tem saldo, não entra em
relatório.

Essa é a fronteira do projeto. Tudo o mais é consequência dela.

### A boa notícia

`transactions` já tem as três datas que a contabilidade exige e que a
maioria dos sistemas de fluxo de caixa não tem:

| Campo | Regime | Usado em |
|---|---|---|
| `competence_date` | competência | DRE, razão, balancete |
| `due_date` | — | contas a pagar/receber |
| `paid_date` | caixa | conciliação bancária, DFC |

Ter competência separada de caixa desde o início é o que torna este
projeto viável em vez de refundação. É o acerto mais caro de corrigir
depois, e ele já está feito.

---

## As informações que faltam

### 1. Plano de contas contábil

Hoje existe `categories` com `dre_group` — suficiente para uma DRE
gerencial, insuficiente para contabilidade. Falta:

- **Código hierárquico** (`1.1.01.001`), com nível e conta superior
- **Natureza**: ativo, passivo, patrimônio líquido, receita, despesa
- **Tipo**: sintética (agrupa) ou analítica (recebe lançamento)
- **Saldo natural**: devedor ou credor
- **Vínculo com o Plano de Contas Referencial da RFB**, que é o que a ECD
  exige no registro I051

O plano de contas atual não desaparece: ele vira **um mapa** para o plano
contábil. O usuário continua escolhendo "Aluguel"; o sistema sabe que
"Aluguel" é `3.1.02.004`.

### 2. A contrapartida de cada lançamento

Para cada categoria, a regra de qual conta recebe a outra perna:

- despesa paga em dinheiro → crédito em Banco/Caixa
- despesa a pagar → crédito em Fornecedores
- receita a receber → débito em Clientes
- recebimento de cliente → débito em Banco, crédito em Clientes

Isso é um **motor de regras**, e é o coração do sistema. Ele traduz um
lançamento financeiro em partida dobrada sem o usuário saber que existe
contabilidade acontecendo.

### 3. Contas patrimoniais que hoje não existem

O balanço precisa de coisas que o fluxo de caixa ignora:

- **Caixa e bancos** — existe parcialmente (`bank_accounts.opening_balance`)
- **Clientes a receber / Fornecedores a pagar** — derivável de `transactions`
- **Estoque** — não existe
- **Imobilizado** e depreciação acumulada — não existe
- **Empréstimos e financiamentos**, com separação circulante / não circulante — não existe
- **Obrigações trabalhistas e tributárias**, incluindo provisões de férias e 13º — não existe
- **Capital social**, reservas, lucros acumulados — não existe

### 4. Fatos sem movimento de caixa

Contabilidade registra coisas que nunca passam pelo banco, e nenhuma
delas cabe no modelo atual:

- Depreciação e amortização mensal
- Provisão de férias e 13º
- Apropriação de despesas antecipadas (seguro anual rateado em 12 meses)
- Constituição e reversão de provisões
- Baixa de inadimplência
- Apuração de resultado e encerramento do exercício
- Ajustes e reclassificações do contador

### 5. Saldos de abertura

Balancete e balanço começam com o saldo anterior de **cada conta**, não só
do banco. Uma empresa que entra na plataforma no meio do ano precisa
importar o balancete de abertura do contador atual. Sem isso, o primeiro
balanço não fecha — e um balanço que não fecha é pior que balanço nenhum.

### 6. Documento fiscal

O ganho de produtividade maior não está em digitar melhor: está em não
digitar. Importar o **XML da NF-e e da NFS-e** dá lançamento, valor,
fornecedor, CFOP, impostos e data de competência de uma vez. É onde o
usuário sente a diferença.

---

## Os módulos necessários

| # | Módulo | O que faz | Sem ele |
|---|---|---|---|
| 1 | **Plano de contas** | Contas hierárquicas, natureza, vínculo com o referencial da RFB | Nada funciona |
| 2 | **Livro diário (partidas dobradas)** | Tabela de lançamentos e partidas, com débito = crédito garantido no banco | Nada funciona |
| 3 | **Motor de regras** | Traduz lançamento financeiro em partida dobrada | O usuário teria de saber contabilidade |
| 4 | **Saldos de abertura** | Importa o balancete inicial | O primeiro balanço não fecha |
| 5 | **Lançamentos manuais** | Para o contador ajustar, reclassificar, encerrar | Contador não trabalha |
| 6 | **Fechamento de período** | Trava o mês; depois disso só estorno | Escrituração sem valor legal |
| 7 | **Homologação** | Fila de revisão, aprovação, assinatura do responsável com CRC | Não há garantia profissional |
| 8 | **Imobilizado** | Cadastro de bens, vida útil, depreciação automática | Balanço incompleto |
| 9 | **Estoque** | Entradas, saídas, CMV | DRE errada em comércio e indústria |
| 10 | **Folha e provisões** | Férias, 13º, encargos | Passivo subestimado |
| 11 | **Apuração de tributos** | Simples, presumido, retenções | Passivo tributário ausente |
| 12 | **Relatórios contábeis** | Razão, razonete, balancete, balanço, DRE, DFC, DMPL | É o produto |
| 13 | **Exportação ECD** | Arquivo do SPED Contábil | Não cumpre a lei |
| 14 | **Importação de XML** | NF-e e NFS-e | O ganho de produtividade fica pela metade |

Os módulos **1, 2, 3, 4, 5, 6 e 12** são o mínimo para gerar os quatro
relatórios que você citou. Os demais determinam se os relatórios estão
*certos*.

---

## Os quatro relatórios, e o que cada um exige

**Razão** — todos os lançamentos de uma conta, em ordem cronológica, com
saldo corrente. Exige módulos 1, 2 e 4. É o mais simples: uma consulta
sobre as partidas, filtrada por conta e período.

**Razonete** — o mesmo dado no formato T, débitos à esquerda e créditos à
direita. Mesma fonte do razão; muda só a apresentação. Vale menos como
relatório e mais como ferramenta de conferência e de ensino.

**Balancete de verificação** — por conta: saldo anterior, soma dos
débitos, soma dos créditos, saldo atual. Exige saldos de abertura (4) e
todos os lançamentos do período. A soma dos saldos devedores tem de ser
igual à dos credores — é o teste que prova que a escrituração está
íntegra.

**Balanço patrimonial** — exige tudo acima **mais** as contas
patrimoniais (módulos 8, 9, 10, 11) e a apuração do resultado do
exercício. É o último a ficar pronto, porque só fecha quando nenhuma
categoria de fato está faltando.

---

## A homologação pelo contador

O desenho que funciona:

1. O usuário lança normalmente, pensando em gestão financeira
2. O motor gera a partida dobrada em estado **provisório**
3. O contador vê uma fila do que entrou, com o que o motor decidiu
4. Ele confirma, corrige a conta, ou lança um ajuste manual
5. Ao fechar o mês, os lançamentos viram **homologados** e ficam imutáveis
6. Correção posterior só por **estorno**, nunca por edição

O passo 6 é o que mais colide com o sistema atual: hoje uma transação
pode ser editada e excluída livremente. Em contabilidade homologada isso
não pode existir — e, como o mesmo registro alimenta os dois lados, essa
regra precisa ser desenhada com cuidado para não engessar a parte
financeira, onde corrigir um erro de digitação tem de continuar sendo
trivial.

A saída provável: **o financeiro permanece editável; o contábil é
imutável a partir do fechamento.** Editar um lançamento financeiro já
homologado gera um estorno e um novo lançamento no diário, em vez de
alterar o que existe.

E o registro profissional: a ECD é assinada digitalmente pelo contador
responsável, com seu CRC. A plataforma é ferramenta; a responsabilidade
técnica é dele. Isso precisa estar claro no contrato e na interface.

---

## Quem realmente precisa disso

Vale dimensionar antes de investir, porque a obrigação legal é menor do
que parece:

- **Lucro Real** — ECD obrigatória, sem exceção
- **Lucro Presumido** — obrigatória quando distribui lucros acima da base
  presumida, que é o caso comum de quem quer isenção no IRPF dos sócios
- **Simples Nacional** — em regra **dispensada** da ECD; a exceção é
  aporte de investidor-anjo

Ou seja: a maior parte da sua base atual provavelmente não é obrigada a
entregar ECD. O que não significa que não precise de contabilidade —
precisa, e por três motivos práticos:

1. **Distribuir lucro isento acima do presumido** exige escrituração
   contábil regular
2. **Crédito bancário e licitação** pedem balanço assinado
3. O **Código Civil** exige escrituração do empresário, e a NBC ITG 1000
   é o modelo simplificado aplicável a ME e EPP

Esse terceiro ponto é o argumento de venda mais honesto: não é "entregue
a ECD", é **"tenha balanço sem pagar duas vezes pelo mesmo trabalho"**.

---

## Ordem sugerida

**Fase 1 — o esqueleto (o que gera razão, razonete e balancete)**
Plano de contas, livro diário, motor de regras, saldos de abertura,
lançamentos manuais, fechamento de período, e os três relatórios.
Já é entregável: um contador consegue trabalhar com isso.

**Fase 2 — o balanço fechar de verdade**
Imobilizado com depreciação, provisões de folha, apuração de tributos.
Sem eles o balanço sai, mas errado.

**Fase 3 — a produtividade prometida**
Importação de XML de NF-e e NFS-e, conciliação bancária automática
(OFX ou Open Finance), sugestão de conta por histórico.

**Fase 4 — a obrigação legal**
Exportação da ECD, e depois ECF.

Estoque entra na fase em que você atender comércio ou indústria; para
serviço, pode esperar.

---

## Como ele é habilitado: um recurso, como o CRM

Decisão de 16/09/2026: o Módulo Contábil é **desligado por padrão** e
habilitado cliente a cliente.

Isso não exige mecanismo novo — a plataforma já tem exatamente esse
desenho, e é como o CRM e o diagnóstico mensal aparecem ou somem do menu:

| Tabela | Papel |
|---|---|
| `recursos` | O catálogo. Uma linha por funcionalidade vendável. |
| `plano_recursos` | O que cada plano inclui. **Estar fora daqui é o que deixa o recurso desligado por padrão.** |
| `tenant_recursos` | A concessão por cliente, com `inicio`, `fim` e `tipo` (contratado, cortesia, piloto). |

No banco, `fn_tenant_tem_recurso(tenant, 'contabilidade')`; no front,
`tem('contabilidade')` pelo `useRecursos`. A aba simplesmente não existe
para quem não tem — mesmo padrão do Funil e do Diagnóstico em
`FinanceiroLayout.tsx`, onde a aba some em vez de levar a uma tela
bloqueada.

Quando chegar a hora, a habilitação é:

```sql
-- 1. O recurso entra no catálogo.
insert into public.recursos (codigo, nome, descricao, ordem) values
  ('contabilidade', 'Módulo Contábil',
   'Escrituração em partidas dobradas, razão, balancete e balanço, com homologação do contador.', 70)
on conflict (codigo) do update set
  nome = excluded.nome, descricao = excluded.descricao, ordem = excluded.ordem;

-- 2. NENHUMA linha em plano_recursos. É isto que o mantém desligado.

-- 3. Concessão, cliente a cliente:
insert into public.tenant_recursos (tenant_id, recurso, inicio, fim, tipo, observacao)
values ('<tenant>', 'contabilidade', current_date, null, 'piloto', 'Primeiro cliente do módulo');
```

O `fim` preenchido faz o recurso cair sozinho no vencimento — útil para
piloto com prazo, que é como este módulo deve nascer.

**A implicação comercial**, que vale decidir junto: contabilidade tem
custo recorrente de verdade do outro lado (o contador revisa todo mês).
Isso a aproxima do CRM — add-on com contrato, não degrau de plano — e não
do diagnóstico mensal, que escala sem trabalho humano adicional.

---

## O que decidir antes de começar

**1. Um contador sócio do projeto, desde o desenho.** Não como revisor no
fim — como quem define o plano de contas, as regras de contrapartida e o
que conta como fechamento. Meia dúzia de decisões erradas aqui custam
mais que o desenvolvimento inteiro.

**2. Escrituração própria ou parceria com escritórios.** São produtos
diferentes. No primeiro, você assume a responsabilidade técnica. No
segundo, você vende a ferramenta ao escritório e o cliente ganha a
integração. O segundo é mais barato de construir e mais rápido de vender;
o primeiro tem margem maior.

**3. O tamanho honesto.** Os módulos 1 a 6 e o 12 são, sozinhos,
comparáveis em esforço a tudo que existe hoje na plataforma. Isto não é
uma funcionalidade a mais no módulo financeiro — é um segundo produto que
compartilha a base de dados do primeiro.

---

> **Ressalva:** não sou contador. Este documento organiza o problema do
> ponto de vista de arquitetura de sistema. Antes de qualquer linha de
> código, cada regra aqui — especialmente plano de contas, contrapartidas
> e o que constitui fechamento — precisa ser validada por profissional
> registrado no CRC.

---

## Fontes consultadas

- [ECD no Simples Nacional 2026 — Sittax](https://sittax.com.br/artigo/ecd-simples-nacional-2026/)
- [ECD 2026: quem precisa declarar — IOB](https://noticias.iob.com.br/ecd/)
- [ECD: Escrituração Contábil Digital — Guia 2026](https://contaazul.com/blog/parceiros/ecd/)
