# Boletos — pausado em 15/10/2026 para revisão de requisitos

Captura de boleto a pagar por **foto, PDF, linha digitada e e-mail**. O código
está escrito e passando (848 testes, typecheck limpo nos dois repositórios),
**mas nada foi publicado e o banco não foi alterado.**

Pausado a pedido, para conferir requisitos antes de seguir.

---

## PRIMEIRO: há um `index.lock` preso no repositório

Uma operação de git minha deixou um `.git/index.lock` que eu não consigo
apagar. **Enquanto ele existir, nenhum comando git funciona neste
repositório** — o sintoma é `Unable to create '.git/index.lock': File exists`.

```powershell
# no PowerShell, com o VS Code FECHADO neste repositório
cd C:\Projetos\saasfinanceiro
Remove-Item .git\*.lock -Force
```

Depois disso o git volta ao normal. Nada foi perdido: a branch existe e as
alterações estão todas no índice.

---

## Onde o trabalho está

**`saasfinanceiro`** — branch **`boletos`**, criada a partir da `main`, com 17
arquivos **no índice e ainda não commitados**. A `main` está intacta, no
commit `0cbc0ef`.

Para fechar o commit, depois de tirar o lock:

```powershell
cd C:\Projetos\saasfinanceiro
git status                 # confira que está na branch boletos
git commit -m "Captura de boleto por foto, PDF, linha e e-mail"
```

**`business-triage`** — **nada foi tocado pelo git.** Ainda na `main`, com as
alterações soltas no diretório de trabalho:

```powershell
cd C:\Projetos\business-triage
git checkout -b boletos
git add -A
git commit -m "Tela de boletos: captura, conferencia e endereco de e-mail"
```

Arquivos do front: `pages/Boletos.tsx`, `hooks/useBoletos.ts`,
`components/EnderecoBoletos.tsx`, e alterações em `App.tsx`,
`FinanceiroLayout.tsx` e `.gitignore`.

---

## O que falta para isto ir ao ar

Nenhum destes passos foi dado:

1. **Colar o SQL 62** (tabela, bucket privado, trava de duplicado)
2. **Colar o SQL 63** (origem, remetente, endereço por empresa)
3. **Rodar as duas consultas do 52** para confirmar o banco em dia
4. **Publicar a API** com `--build` (é código novo)
5. **Publicar o front**
6. **`BOLETO_EMAIL_DOMINIO`** no `.env` da API
7. **Credencial IMAP** e ativação do fluxo 13 no n8n
8. **Conferir com um boleto de papel** — o portão antes de cliente

---

## As decisões já tomadas, para você não ter que reabrir

**O modelo só transcreve dígitos.** Não lê valor nem data. A linha digitável
tem dígito verificador, então um erro de transcrição é *detectável*. Se o
modelo lesse "R$ 1.247,80" e devolvesse 124,78, nada no sistema saberia.

**Nada vira conta a pagar sozinho.** Grava como `pendente`; o lançamento nasce
quando uma pessoa confirma na tela.

**No e-mail, quem identifica a empresa é o token do destinatário**, nunca o
remetente — `From` é falsificável e não cobre o caso real do fornecedor
encaminhando.

**Duplicado é impedido por índice**, não por consulta na aplicação.

---

## As perguntas que a revisão de requisitos deveria responder

Estas ficaram em aberto e mudam o desenho se a resposta for diferente do que
eu assumi:

1. **A Hostinger aceita subendereçamento** (`boletos+token@dominio`)? Se não,
   o caminho é um catch-all em subdomínio, e o endereço mostrado ao cliente
   muda de formato. **Vale confirmar antes de publicar a tela**, porque o
   endereço errado tem o pior sintoma possível: o cliente encaminha o boleto,
   nada aparece, e não há erro em log nem tela.

2. **Quem confirma o boleto?** Hoje qualquer papel com escrita (`owner`,
   `admin`, `member`) pode lançar. Se a empresa quiser que só o dono aprove
   pagamento, isso é uma regra a mais — e é plausível que queira.

3. **O consultor deve ver os boletos do cliente?** Hoje sim, pelo
   `is_consultor_de` do RLS, igual ao resto da plataforma.

4. **Boleto que chega por e-mail deve avisar alguém?** Hoje ele só aparece na
   fila. Um boleto encaminhado numa sexta e vencendo no sábado passa batido se
   ninguém abrir a tela. O projeto já tem o canal de WhatsApp do vigia.

5. **Quanto tempo o boleto fica na fila sem conferência?** Não há expiração.
   Fila que só cresce vira fila que ninguém olha.

---

## Pendência anterior, que não é deste assunto e é mais urgente

**Os tetos de IA venceram em 08/10 e hoje é 15/10.** Se o `.env` do servidor
ainda tem `PDCA_CHAT_LIMITE_24H=1000`, está há uma semana sem teto de gasto —
e isso não dá sintoma nenhum, aparece só na fatura. Ver o item 1 do
`RETOMAR-AQUI.md`.

```bash
# no servidor (VPS)
grep -E '^(PDCA_CHAT_LIMITE_24H|IA_LIMITE_DIARIO)=' /opt/finance-src/api/.env
```
