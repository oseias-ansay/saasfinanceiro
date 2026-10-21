# Importação de extrato bancário — onde paramos

**Interrompido em 20/10/2026.** Nada foi publicado. O SQL 66 está escrito
mas **NÃO foi colado** — e precisa de um ajuste antes (ver abaixo).

---

## A decisão tomada

A importação de extrato entra no Portal com **leitor próprio**, copiado do
Contábil — não chamando o Contábil como serviço. A razão é comercial: muitos
clientes não contratam o módulo contábil, e a importação não pode depender de
um sistema que eles não compraram estar no ar.

Formatos: **OFX, CSV e PDF** — paridade com o Contábil.

**O preço dessa decisão, declarado:** são dois leitores que vão divergir. Um
banco muda o layout do CSV, alguém conserta de um lado, e por meses o mesmo
arquivo produz números diferentes nos dois sistemas, sem sintoma. A defesa é
o portão de saldo (ver adiante), que não impede a divergência mas impede que
uma leitura errada vire dado.

---

## O que já existe no Portal

Pronto e testado, em `api/src/modules/transactions/`:

- `extrato.ts` — o núcleo: `valorBancario`, `dataExtrato`, `identidadeLinha`,
  `comIdentidade`, `conferirFechamento`, `conciliar`
- `extrato.test.ts`, `extratoOFX.ts`, `extratoOFX.test.ts`

E `supabase/sql/66-para-colar.sql`, escrito e **não colado**.

---

## O código de referência do Contábil

Copiado do servidor em 20/10/2026 para **`C:\Projetos\Claude\contabil-bank\`**:

| arquivo | linhas | o que é |
|---|---|---|
| `parse.ts` | 303 | OFX + CSV, sem dependências |
| `text.ts` | 30 | `normalizeText`, `signature`, `patternFromDescription` |
| `pdf.ts` | 416 | PDF por geometria, com `pdfjs-dist` |

Faltou copiar: `service.ts` (350 linhas) e `http.ts` (59). O `service.ts` é a
orquestração — vale ver antes de escrever as rotas.

Origem: `/opt/apps/triage-contabil/src/lib/bank/` no VPS.

---

## Quatro achados que mudam o plano

### 1. O Contábil trabalha em CENTAVOS INTEIROS; o Portal, em reais

A régua do Contábil está certa — float acumula sujeira, e `Math.round` em
cima de soma de float erra de vez em quando.

**Ação: ajustar o SQL 66 de `numeric(14,2)` para inteiro em centavos, ANTES
de colar.** Depois de colado, mudar tipo de coluna com dado dentro é outra
migração.

### 2. O Portal já tem um leitor de OFX próprio

Trazer o `parseOfx` do Contábil criaria **dois leitores de OFX no mesmo
repositório** — pior que a duplicação entre sistemas, porque ninguém vai
lembrar qual é o bom.

**Ação: aposentar `extratoOFX.ts`** e transformar `extratoOFX.test.ts` em
teste de conformidade contra o leitor portado. Se os testes passarem, os dois
leitores concordavam; se falharem, descobrimos onde divergiam — informação que
hoje ninguém tem.

### 3. O PDF do Contábil NÃO usa IA — e é melhor assim

`pdfLines` usa `pdfjs-dist` e lê a tabela pela **geometria da página**:
posição horizontal das células contra a posição dos títulos do cabeçalho.
Determinístico, sem custo por página, sem alucinação. Trata PDF com senha,
com a mensagem certa ("muitos bancos usam os números do CPF ou CNPJ").

O Portal ganha a dependência `pdfjs-dist`.

### 4. O Contábil NÃO confere o fechamento de saldo — e isso é uma lacuna

`grep "saldo|balance|conferir|anterior" service.ts` voltou **vazio**. O
`pdf.ts` LÊ o saldo de cada linha, mas só para deduzir o sinal; nunca para
validar o total.

Importa por causa da cascata de sinal no PDF:

1. coluna débito/crédito — confiável
2. sinal no número (`-`, `D`, `C`, parênteses) — confiável
3. variação do saldo impresso na linha — confiável
4. **palavras do histórico** (`pagamento`, `recebido`…) — palpite
5. **nada bateu → considera entrada** — chute

Os passos 4 e 5 avisam na prévia, e o aviso é honesto. Mas um sinal invertido
num lançamento de R$ 8.000 erra o saldo em R$ 16.000, e quem aprendeu a
clicar "confirmar" não vai ler o aviso.

**Ação: manter `conferirFechamento` do Portal, ligado na saída dos três
formatos.** É a única coisa em que o Portal deliberadamente NÃO faz
"exatamente igual" — porque aqui o Contábil tem uma lacuna, não uma decisão.

---

## O teste com extrato real: o que aprendemos

O arquivo enviado (`extrato.pdf`, Nubank, 2 páginas) **não tem camada de
texto**:

```
pdftotext  → 2 bytes
pdffonts   → nenhuma fonte
/Image     → 0 imagens
```

O texto está desenhado como **curvas vetoriais**. Metadados: `Producer:
Microsoft: Print To PDF`, `Title: Extrato Nubank.pdf` — ou seja, o PDF
original do Nubank foi aberto e **reimpresso para PDF**, e esse passo
converteu as letras em desenho.

O leitor do Contábil recusaria esse arquivo, corretamente.

**Pendente: obter o PDF ORIGINAL do app do Nubank, sem reimprimir — e,
melhor ainda, o OFX e o CSV, que o Nubank também exporta.** Deixar em
`C:\Projetos\Claude\extratos-teste\`.

### O layout do Nubank, lido da imagem renderizada

Não é tabela. Agrupa por dia, com **"Total de entradas" / "Total de saídas"
como cabeçalhos de seção**, e as linhas individuais **sem sinal** (`350,00`,
`125,00`, sem `-` nem `D`).

O `sectionSign` do `pdf.ts` do Contábil trata exatamente isso — alguém já
bateu no Nubank e resolveu. Bom sinal sobre o que estamos portando.

### E o portão de saldo é viável nesse formato

O cabeçalho declara tudo. Conferido na mão, no extrato enviado:

```
saldo inicial       2,00
+ total entradas  920,00
− total saídas    920,57
= saldo final       1,43   ← bate com o declarado
```

Fecha exatamente. Um sinal invertido pelo palpite de palavras **seria pego**.

---

## Ordem de trabalho ao retomar

1. **Ajustar o SQL 66 para centavos inteiros**, e só então colar
2. Registrar `extratos_importados` e `extrato_linhas` na **primeira parte do
   `52-conferir-banco.sql`**
3. Copiar `service.ts` e `http.ts` do VPS
4. Portar `parse.ts` + `text.ts` → `extratoBanco.ts`, com teste
5. Aposentar `extratoOFX.ts`; os testes dele viram conformidade
6. Portar `pdf.ts` + dependência `pdfjs-dist`
7. Ligar `conferirFechamento` na saída dos três formatos
8. Rotas: prévia → confirmação de colunas (CSV) → importar → conciliar
9. Aba no Controle Financeiro — **o CSV precisa da etapa de confirmar
   colunas**, não dá para ser "escolher arquivo e pronto" como no OFX
10. `npm test` e `npx tsc --noEmit` nos dois repositórios

---

## Risco aberto, fora do escopo desta tarefa

**`/opt/apps/triage-contabil` não é um repositório git.** Não é um repo com
alterações pendentes como o `finance-src` em 08/10 — é código solto numa
pasta, sem `.git`.

Consequência: não há como comparar o que roda em produção com o que está em
`github.com/oseias-ansay/contabil.businesstriage`. Pode estar igual, pode
estar meses atrás. **Não há como responder.**

Por isso o espelhamento partiu do **código do servidor**, não do GitHub: é
esse que está lendo os extratos dos clientes hoje.

Procedimento sugerido, quando houver tempo: clonar o GitHub em outra pasta do
VPS, `diff -ru` contra `/opt/apps/triage-contabil`, decidir o que fica, e só
então transformar a pasta de produção num clone de verdade. Cerca de uma hora,
e fecha um risco que hoje não tem fundo.
