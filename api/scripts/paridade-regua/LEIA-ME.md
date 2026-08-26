# Paridade da régua

## O que é

`regua-legado.js` é uma **cópia congelada** do nó `Calcular Indicadores e
Score` do n8n, como ele existia antes de a régua ser trazida para a API.
Só o invólucro mudou: em vez de ler `$input`, a função recebe um objeto.

`paridade.mjs` roda vinte mil entradas aleatórias nas duas implementações e
compara score, indicadores, alertas e a tabela de texto, campo a campo.

```bash
npm run paridade:regua
```

Resultado esperado hoje: **20000 casos comparados — 0 divergências**.

## Por que existe

A régua viveu dentro de um nó de workflow, sem histórico e sem cópia.
Trazê-la para cá foi a mudança de maior risco do módulo 1.2.0: se o
porte tivesse introduzido qualquer diferença, o sintoma seria um cliente
recebendo 61 pelo formulário e 58 pelo cálculo automático — e ninguém
descobriria pelo log, só pela reclamação.

Testes de faixa (`regua.test.ts`) provam que cada limiar está onde deveria.
Este script prova outra coisa: que **o conjunto inteiro** se comporta igual,
inclusive nas combinações que ninguém pensou em testar. As entradas
aleatórias incluem de propósito faturamento zero, lucro negativo, passivo
inexistente e valores fora do domínio nas escolhas.

## Quando ele vai falhar — e o que fazer

Quando a régua mudar de verdade. Aí a falha é o comportamento correto, e o
procedimento é:

1. Confirme que a divergência é **só** a que você pretendia. O script
   imprime as duas primeiras entradas divergentes; conferir uma à mão leva
   um minuto e pega mudança acidental.
2. Suba a `VERSAO_REGUA` em `regua.ts`.
3. Registre a versão nova em `regua_versoes`, no banco.
4. Atualize `regua-legado.js` para a versão nova — ela passa a ser o novo
   marco de comparação.

O passo 4 é o que mantém o script útil. Sem ele, a paridade fica falhando
para sempre e vira ruído que todo mundo aprende a ignorar.

## O que este script NÃO prova

Que a régua está certa. Ele prova que ela está **igual**. Se havia um erro
de critério no n8n, ele foi portado fielmente — e continua aqui.
