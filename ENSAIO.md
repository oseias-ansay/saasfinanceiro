# Ensaio da jornada do cliente

Antes de 1º de setembro de 2026.

## Por que este documento existe

Sete camadas foram construídas nas últimas semanas — diagnóstico, relatório,
onboarding, financeiro, marco zero, plano de ação, camada de consultoria. Cada
uma foi testada **isoladamente**, no momento em que ficou pronta.

Nenhuma foi percorrida na ordem real, por uma pessoa só, do começo ao fim.

É uma diferença que importa. Erros de integração não aparecem no teste de
unidade: eles moram nas junções — o dado que a etapa 3 grava e a etapa 5 espera
em outro formato, o e-mail que sai com o link certo mas para o domínio errado,
a tela que funciona quando você já está logado como staff e quebra quando
alguém chega deslogado. Esses defeitos aparecem na primeira vez que a jornada
inteira é percorrida. A pergunta é se isso acontece agora ou na frente do
primeiro cliente pagante.

**Faça o ensaio como se fosse cliente.** Não como quem construiu. Use um
navegador anônimo, um e-mail que você não usa no sistema, e não corrija nada
no meio do caminho — anote e siga. Corrigir enquanto percorre esconde
justamente o atrito que você quer medir.

---

## Antes de começar

**A etapa do relatório depende do relógio.** O envio roda às 8h da manhã. Se
você quer ver o e-mail chegando de verdade, o diagnóstico precisa ser
preenchido **hoje**, para o relatório chegar amanhã cedo. Se preferir não
esperar, dá para disparar o Fluxo B manualmente no n8n — mas aí você não testa
o agendamento, que é parte do que pode falhar.

Recomendo começar pela etapa 2 ainda hoje.

**Prepare:**

- Um e-mail de teste que ainda não existe no sistema (Gmail com `+` serve:
  `seunome+ensaio@gmail.com`).
- Um navegador anônimo, separado da sua sessão de administrador.
- Um celular com WhatsApp que não seja o número da Business Triage.

---

## As etapas

Marque cada uma e anote o que estranhar — inclusive o que funcionou, mas
incomodou.

### 1. O primeiro contato

- [ ] No celular, abra `businesstriage.com.br` e clique em **Agendar
      diagnóstico**.
- [ ] Confirme que a mensagem do WhatsApp já vem escrita e contém o `(ref: …)`.
- [ ] Envie e cronometre a resposta automática.
- [ ] Confira a saudação: deve corresponder ao horário (bom dia / boa tarde /
      boa noite) e **não** mencionar duração do atendimento.
- [ ] Mande uma segunda mensagem. O fluxo deve ficar em silêncio — a resposta
      automática é uma só.
- [ ] Repita por `teste.businesstriage.com.br`. O `(ref: teste)` deve
      aparecer na mensagem.

**O que se está testando:** que o lead chega identificado. Sem isso, ninguém
sabe se a página do consultor trouxe alguém.

### 2. O diagnóstico

- [ ] Logado como consultor, preencha o formulário de diagnóstico com números
      de uma empresa plausível — não redondos, não perfeitos.
- [ ] Confirme que o cliente **não** consegue abrir esse formulário sozinho.
- [ ] Veja a prévia do resultado antes de enviar.
- [ ] Envie e confirme que entrou na fila.

**Anote o tempo.** Este formulário será preenchido durante uma reunião. Se
levar mais de dez minutos, ele atrapalha a conversa em vez de apoiá-la.

### 3. O relatório

*(na manhã seguinte)*

- [ ] O e-mail chegou às 8h?
- [ ] Caiu na caixa de entrada ou no spam? **Se caiu no spam, pare tudo e
      resolva isso primeiro** — é o defeito mais caro possível: silencioso, e
      derruba a entrega do produto de entrada.
- [ ] Abra o PDF no celular, não no computador. É onde a maioria vai abrir.
- [ ] Confira a pontuação, as fórmulas por extenso e a identidade visual.
- [ ] O PDF chegou também no Drive?

### 4. A empresa

- [ ] Em Administração, crie a empresa com o e-mail de teste.
- [ ] Copie a senha provisória.
- [ ] Grave o **marco zero** a partir do diagnóstico da etapa 2.
- [ ] Confirme que o marco zero registra a versão da régua.

### 5. O primeiro acesso do cliente

*Agora você é o cliente. Navegador anônimo.*

- [ ] Entre com o e-mail e a senha provisória.
- [ ] A troca de senha deve ser obrigatória e sem escapatória.
- [ ] Depois de trocar, confirme que o painel abre na empresa certa.
- [ ] Tente alcançar `/painel/admin` pela URL. Deve barrar.

**Olhe para a primeira tela como quem nunca viu o sistema.** Está óbvio o que
fazer em seguida? Se não estiver, anote — é a tela que decide se o cliente
volta no segundo dia.

### 6. O uso

- [ ] Cadastre uma conta bancária e algumas categorias.
- [ ] Lance umas quinze movimentações de um mês, entradas e saídas.
- [ ] Anexe um comprovante.
- [ ] Edite um lançamento. Exclua outro.
- [ ] Confira o **extrato**: saldo corrente linha a linha, batendo.
- [ ] Gere o **DRE** e exporte em PDF e Excel.
- [ ] Registre uma retirada de sócio.

### 7. O plano de ação

- [ ] Como consultor, monte o plano com quatro ou cinco ações, cada uma com
      responsável, prazo e causa-raiz.
- [ ] Como cliente, abra o quadro. As ações estão claras sem explicação?
- [ ] Marque uma como concluída.
- [ ] Como consultor, confirme que ela aparece no consolidado e que os "dias
      sem movimento" zeraram.

### 8. A leitura do negócio

- [ ] Abra o painel de **Validação**. Os três indicadores fazem sentido com o
      que você acabou de fazer?
- [ ] Abra o consolidado do **PDCA**. A empresa aparece na posição certa?
- [ ] Entre com a conta do **consultor de teste**. Ele vê só a própria
      carteira, sem "Nova empresa" e sem "Validação"?

### 9. A saída

- [ ] Arquive a empresa do ensaio e confirme que o acesso do cliente cai.
- [ ] Desarquive.
- [ ] Exclua de vez, com a confirmação por digitação.
- [ ] Confirme que o registro ficou na auditoria de exclusões.

---

## O que anotar

Três colunas, num papel ou aqui embaixo:

**Quebrou** — não funcionou. Corrigir antes do dia 1º, sem discussão.

**Atritou** — funcionou, mas custou caro: um clique a mais, um texto confuso,
uma espera longa. Priorizar pelo que aparece na jornada de **todo** cliente,
não na sua.

**Faltou** — você esperava algo que não existe. A maioria vira roadmap, não
tarefa desta semana. Mas duas ou três podem ser o que separa "interessante" de
"eu pago por isso".

---

### Achados

| # | Etapa | Tipo | O que aconteceu | Situação |
|---|---|---|---|---|
|   |       |      |                 |          |
