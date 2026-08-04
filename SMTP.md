# SMTP — envio de e-mail pelo Supabase

Estado: **funcionando**, via Brevo, com domínio autenticado.

A recuperação de senha depende disso. Sem SMTP a tela funciona, o usuário vê
"verifique seu e-mail", e nada chega — o pior tipo de falha, porque parece
sucesso.

## Configuração atual

No `/opt/supabase/.env`:

```
SMTP_ADMIN_EMAIL=contato@businesstriage.com.br
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=b422e8001@smtp-brevo.com
SMTP_PASS=<chave SMTP do Brevo, começa com xsmtpsib->
SMTP_SENDER_NAME=Business Triage

SITE_URL=https://businesstriage.com.br
ADDITIONAL_REDIRECT_URLS=https://businesstriage.com.br/redefinir-senha
```

Aplicar mudanças:

```bash
cd /opt/supabase && docker compose config --quiet && docker compose up -d --force-recreate auth
```

## As quatro armadilhas — nesta ordem

Levamos dias nisso porque cada camada só aparece depois de vencer a anterior.
Se for configurar outro provedor, confira todas antes de começar.

### 1. Chave de API não é chave SMTP

O Brevo tem duas credenciais diferentes. A **chave de API** começa com
`xkeysib-` e serve para a API REST. A **chave SMTP** começa com `xsmtpsib-`,
tem 90 caracteres, e é a única que autentica no relay.

Usar a primeira dá `535 5.7.8 Authentication failed`, que não sugere em nada
qual é o problema real.

Gerar em: **SMTP & API → Configurações SMTP → Gerar uma nova chave SMTP**.

### 2. O IP precisa ser autorizado

Contas novas do Brevo bloqueiam IPs desconhecidos. O sintoma é
`525 5.7.1 Unauthorized IP address` — repare que é **525**, não 535: a
credencial foi aceita e a recusa veio depois.

Liberar em: **Configurações → Segurança → IPs autorizados**.

Isso volta a morder se você trocar de servidor.

### 3. O remetente precisa existir no Brevo

O Brevo aceita a mensagem no SMTP (responde `250 Roger, accepting mail from`)
e **descarta depois**, sem erro visível, se o endereço do `From` não for um
remetente cadastrado nem pertencer a domínio autenticado.

Foi o que aconteceu com `nao-responda@businesstriage.com.br`: o swaks dizia
sucesso e nada chegava. No painel, em **Transacional → Tempo real**, apareciam
2 enviados e 0 entregues.

Trocamos para `contato@businesstriage.com.br`, que é uma caixa real. Vale a
pena por outro motivo também: um endereço "não-responda" que sequer recebe faz
a resposta de um cliente confuso bater na parede.

### 4. Sem SPF e DKIM, vai para spam

Desde 2024, Google e Microsoft exigem autenticação de domínio. Sem ela o
e-mail é entregue e ninguém lê.

Autenticado em **Remetentes, domínio, IPs → Domínios → Autenticar domínio**.
Registros criados na zona DNS da Hostinger:

| Tipo | Nome | Valor |
|---|---|---|
| CNAME | `brevo1._domainkey` | `b1.businesstriage-com-br.dkim.brevo.com` |
| CNAME | `brevo2._domainkey` | `b2.businesstriage-com-br.dkim.brevo.com` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:...` |

**Cuidado com o SPF.** O domínio já tinha
`v=spf1 include:_spf.mail.hostinger.com ~all` por causa do e-mail da
Hostinger. Dois registros SPF no mesmo domínio **anulam os dois**. Se
precisar incluir o Brevo, edite o existente em vez de criar outro:

```
v=spf1 include:_spf.mail.hostinger.com include:spf.brevo.com ~all
```

## Diagnóstico

O comando que responde tudo, direto no servidor:

```bash
swaks --to voce@exemplo.com --from contato@businesstriage.com.br \
  --server smtp-relay.brevo.com:587 -tls --auth LOGIN \
  --auth-user b422e8001@smtp-brevo.com --auth-password "$CHAVE" 2>&1 \
  | grep -E '^(===|\*\*\*|<[-~])' | tail -30
```

Esse `grep` mantém as linhas de status e **as respostas do servidor**,
descartando as que o swaks envia — que são justamente as que carregam a chave
em base64. Foi por não filtrar que uma chave vazou numa saída colada em
conversa e teve de ser revogada.

Leitura dos códigos:

| Código | Significado |
|---|---|
| `535` | credencial errada — provavelmente chave de API no lugar da SMTP |
| `525` | IP não autorizado |
| `235` + `250 OK: queued` | autenticou e aceitou |

Aceito mas não entregue → o problema é remetente ou reputação. Confira em
**Transacional → Logs**, que mostra cada mensagem com o motivo.

Do lado do Supabase:

```bash
docker logs supabase-auth --since 20m 2>&1 | grep -i -E "smtp|mail|error"
```

E lembre do limite do GoTrue: **um e-mail de recuperação por endereço a cada
60 segundos**. Tentativas dentro da janela são descartadas em silêncio, com a
tela mostrando sucesso — o que faz parecer que o envio quebrou de novo.

## Manuseio da chave

Nunca use `read -s -p` para capturar a chave colando um bloco de comandos: o
`read` consome a linha seguinte do próprio texto colado como se fosse
digitação. Isso nos custou uma sessão inteira, e ainda gravou o texto de um
comando dentro do `SMTP_PASS` — o que depois impediu o `docker compose` de
sequer ler o `.env`.

O caminho seguro:

```bash
nano /tmp/chave.txt        # cola a chave, salva, sai
CHAVE=$(tr -d '\r\n' < /tmp/chave.txt)
echo "len=${#CHAVE} inicio=$(printf '%s' "$CHAVE" | cut -c1-9)"
# ... testa com swaks, e só então grava no .env
shred -u /tmp/chave.txt
```

## Cuidado com duplicatas no .env

O `.env` do Supabase tinha `SITE_URL` e `ADDITIONAL_REDIRECT_URLS` definidos
**duas vezes**, com valores diferentes — um apontando para o domínio da API e
outro para o site. O primeiro faria o link de recuperação chegar ao cliente
apontando para um endereço sem página de redefinição.

O mesmo já havia acontecido com um bloco `SMTP_*` duplicado. A causa é sempre
a mesma: acrescentar um bloco no fim do arquivo em vez de editar no lugar.

Confira antes de investigar qualquer outra coisa:

```bash
grep -n '^SMTP_\|^SITE_URL\|^ADDITIONAL_REDIRECT' /opt/supabase/.env \
  | sed 's/^\(.*SMTP_PASS=\).*/\1***/'
```

Uma linha de cada. Mais que isso, resolva antes de seguir.

## Pendências

- Endurecer o DMARC para `p=quarantine` depois de algumas semanas com SPF e
  DKIM estáveis.
- Personalizar os modelos de e-mail do GoTrue, que ainda são os padrões em
  inglês. `MAILER_SUBJECTS_RECOVERY` e `MAILER_TEMPLATES_RECOVERY` no `.env`;
  o modelo precisa conter `{{ .ConfirmationURL }}`.
- Configurar o subdomínio de marca no Brevo (opcional), para os links de
  rastreamento usarem `businesstriage.com.br` em vez do domínio do Brevo.
- Migrar os workflows do n8n de Gmail para este mesmo SMTP, para que os
  e-mails de diagnóstico saiam de `@businesstriage.com.br` em vez de uma conta
  Gmail pessoal.
