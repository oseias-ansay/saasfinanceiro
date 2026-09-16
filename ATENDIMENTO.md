# Chat, chamados e agendamento — estudo

> Conversa de 16/09/2026. Nada implementado. Premissa de escala:
> **60 clientes pagantes.**

---

## Os três degraus

| Degrau | Para quê | Custo por uso |
|---|---|---|
| **Chat** | "Quanto tenho a receber?", "Por que meu score caiu?" | centavos |
| **Chamado** | Perguntas que exigem análise, com prazo declarado | seu tempo |
| **Consulta online** | Julgamento, decisão, plano | sua agenda |

O desenho funciona porque cada degrau tem custo proporcional ao valor, e
porque o chat **deixa de precisar fingir julgamento** — ele tem para onde
mandar.

---

## A decisão que mais importa: ferramentas, não busca vetorial

A tentação natural é RAG — uma pasta de PDFs por cliente, embeddings,
Qdrant. **Para a pergunta que importa, isso é a arquitetura errada.**

Busca vetorial recupera texto que *se parece* com a pergunta. Para
"quanto tenho a receber", parecença não serve: é preciso o número. Um PDF
gerado em agosto responderia com o saldo de agosto, **com cara de resposta
atual** — a falha silenciosa na forma mais convincente que ela tem.

A informação financeira do cliente já está no banco, estruturada e do
minuto: `vw_dre_monthly`, `vw_contas_por_pessoa`, `vw_cashflow_projection`,
a régua, o ponto de equilíbrio, a NCG.

**O modelo chama as rotas da API.** O número vem exato, e ele não tem como
errar a conta porque não faz conta: lê e explica.

### Onde o documento de fato cabe

O PDCA do cliente é narrativa, é específico, e não existe de forma
consultável no banco. *"O que vocês recomendaram que eu fizesse primeiro?"*
só um documento responde.

Mas são poucos documentos por cliente — o PDCA, os diagnósticos, notas de
reunião. **Qdrant para cinco PDFs é montar biblioteca para guardar cinco
livros.** Passá-los inteiros no contexto custa menos e não erra na
recuperação. Vetorial só compensa quando o corpus não cabe no contexto, e
este cabe.

### Os conceitos genéricos vão no prompt

Vinte definições — margem de contribuição, ciclo financeiro, NCG, ponto de
equilíbrio — ocupam duas páginas. No prompt do sistema estão sempre
disponíveis, entram no cache e nunca falham na recuperação.

Elas servem para o modelo **explicar bem os números do cliente**, não como
produto: informação genérica tem pouco valor, e foi por isso que a
primeira versão do chat foi descartada.

---

## As ferramentas que o chat teria

Todas já existem, testadas e com RLS:

| Ferramenta | Rota | Responde |
|---|---|---|
| `contas` | `/reports/contas` | quem deve, quanto, há quanto tempo |
| `projecao` | `/reports/cashflow-projection` | quando o caixa aperta |
| `dre` | `/reports/dre` | resultado do período |
| `equilibrio` | `/equilibrio` | quanto precisa vender |
| `giro` | `/equilibrio/giro` | quanto está travado na operação |
| `diagnostico` | último diagnóstico do tenant | score, pilares, plano |

---

## Os riscos, em ordem de gravidade

**1. Vazamento entre empresas.** O modo de falha mais grave: o chat do
cliente A trazendo dado do cliente B. Com pastas e filtro de metadados, um
filtro mal configurado expõe um balanço. Com chamada às rotas, o RLS e o
`tenantId` já barram — o mesmo caminho que o painel usa há meses. É mais
um argumento forte a favor de ferramentas.

**2. Número inventado.** Regra no prompt, e conferível: o modelo só cita
números que uma ferramenta devolveu. Nunca deriva, nunca soma de cabeça.

**3. Falha silenciosa.** Ferramenta que falha tem de virar "não consegui
consultar agora", nunca uma resposta plausível sem dado. É o defeito que
esta plataforma passou a semana de 11 a 16/09 eliminando.

**4. Conselho.** *"Devo pegar esse empréstimo?"* — o chat não responde.
É o trabalho do consultor e é onde está a margem. Ele reconhece a pergunta
e oferece os dois botões ali, na linha da resposta.

---

## O chamado é uma promessa

Um botão "Abrir chamado" na tela de um cliente pagante cria expectativa de
resposta. Ele nasce com três coisas, ou não nasce:

- **prazo declarado na própria tela** — "respondo em até 1 dia útil" é
  cobrável; "em breve" não é
- **alarme no WhatsApp** quando um chamado passa do prazo, pelo caminho do
  vigia
- **o processo no catálogo de `PROCESSOS`**, para chamado esquecido virar
  atraso visível em vez de sumir

Sem isso o botão faz o oposto do que pretende: o cliente abre, ninguém vê,
e ele conclui que a plataforma não responde. Pior que não ter botão.

**O chamado precisa carregar o contexto.** Formulário em branco joga fora
tudo que o chat já sabe. Levando junto a conversa e um retrato dos números
do momento — score, saldo, o que está vencido, o último diagnóstico —, o
chamado chega **já triado**.

A resposta volta pela tabela `notifications`, que já existe e já aparece no
painel do cliente.

---

## Agendamento: não construir

Um agendador é semanas — disponibilidade, fusos, cancelamento, lembrete,
reagendamento. Cal.com ou equivalente resolve numa tarde, com link no
botão e administração pelo Google Calendar.

Se um dia o volume justificar trazer para dentro, aí sim.

---

## Os números com 60 clientes

**Custo do chat.** Três conversas por cliente por mês, quatro turnos cada:
cerca de 720 chamadas mensais. Com Sonnet, algo como **R$ 70/mês** — R$
1,18 por cliente. Com cache do prompt, que aqui é constante, perto da
metade. Irrelevante.

**Volume de atendimento.** Uns 90 chamados por mês, quatro ou cinco por dia
útil. **É aqui que está o custo real**, e é o que o WhatsApp deixa de dar
conta: cabe na agenda, mas perde-se o rastro de quem espera o quê.

**Por que o chat se paga.** Não por responder — **por filtrar.** Se metade
das perguntas for "quanto vence esta semana" e ele resolver sozinho, os
chamados que chegam são os que merecem o tempo do consultor. Sem o filtro,
atendem-se cinco fáceis para chegar na difícil.

**A métrica que diz se está funcionando:** quantas conversas terminam sem
virar chamado. Vale medir desde o primeiro dia.

---

## Ordem sugerida

1. **Chat com ferramentas** sobre as rotas existentes. Nenhuma
   infraestrutura nova. Teto de uso por empresa, como o `ia_uso`.
2. **Chamados** — tabela pequena, prazo declarado, alarme no vigia,
   resposta por `notifications`.
3. **Agendamento** — link externo.
4. **Documentos do cliente no contexto**, quando houver PDCA.
5. **Qdrant** — só se a base por cliente crescer a ponto de não caber.
   Pode nunca acontecer.

---

## O que já existe

`src/components/AssistantChat.tsx` — protótipo com respostas fixas por
palavra-chave e o comentário *"trocar por chamada à API quando houver
backend"*. A casca da interface está pronta.

Não existe tabela de chamados nem agendamento. `notifications` existe e
serve para a resposta voltar.
