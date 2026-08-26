# Fluxo 08 — Diagnóstico mensal

## O que ele faz

Todo dia 5, às 8h:

1. chama `POST /mensal/apurar` na API
2. a API verifica a completude de cada assinante e grava o score **ou** a pendência
3. o fluxo envia um e-mail por cliente pendente e um resumo interno
4. marca as pendências como cobradas

## Importar

**Workflows → ⋮ → Import from File** e escolha
`n8n/workflow-08-diagnostico-mensal.json`.

Se a importação falhar — já aconteceu antes nesta instância — monte à mão. São
seis nós e o código dos dois nós de Code está em
`05-montar-emails-mensal.js` e `06-marcar-cobrados.js`.

## Depois de importar, três coisas

**1. O segredo.** Os dois nós de HTTP Request têm `COLE_AQUI_O_SEGREDO` no
valor do header `x-n8n-secret`. Troque pelo segredo real, o mesmo dos nós de
diagnóstico.

Repetindo a lição que custou caro: **não use credencial de Header Auth aqui.**
Deixe `Authentication: None` e o header visível em `Send Headers`. Credencial
mascarada torna impossível distinguir "chave errada" de "chave vazia", e é
compartilhada entre todos os workflows — mexer nela para um fluxo quebra os
outros oito.

**2. A credencial de SMTP.** O nó `Enviar` precisa da mesma credencial SMTP
dos demais fluxos. Selecione na lista.

**3. Ative o workflow.** Sem isso o agendamento não roda, e o sintoma é
silêncio — que é indistinguível de "estava tudo certo".

## Testar sem esperar o dia 5

Abra o workflow e clique em **Execute Workflow**. Ele roda a apuração do mês
anterior de verdade: grava as pendências e envia os e-mails.

Para testar sem enviar nada, desative o nó `Enviar` (clique com o botão
direito → Deactivate) e execute. A apuração acontece, os e-mails são montados
e ficam visíveis na saída do nó `Montar e-mails`, mas nada sai.

## Por que o resumo interno sai sempre

Inclusive quando está tudo certo. Um relatório que só aparece quando há
problema tem um defeito conhecido: no dia em que o agendamento parar de rodar,
o silêncio vira boa notícia. Recebendo todo mês, a ausência do e-mail é o
próprio alarme.

## Por que marcar como cobrado vem DEPOIS do envio

Se a marcação viesse antes e o SMTP falhasse, o cliente ficaria sem aviso para
sempre e o sistema acharia que avisou. Na ordem certa, o pior caso é o aviso
sair duas vezes — incômodo, não silêncio.

## Um segundo lembrete?

Hoje existe um aviso por mês. Se, com clientes reais, aparecer gente que
precisa de um segundo empurrão, o caminho é rodar a apuração de novo (ela
reapura os incompletos de propósito) e permitir uma nova cobrança — hoje
`cobrado_em` impede isso.

Deixei fora porque cobrar duas vezes por mês irrita quem simplesmente não teve
tempo, e essa é uma decisão que vale tomar olhando o comportamento de dez
clientes, não a priori.
