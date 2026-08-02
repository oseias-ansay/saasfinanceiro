# SMTP — envio de e-mail pelo Supabase

A recuperação de senha depende disso. Sem SMTP configurado, a tela funciona,
o usuário vê "verifique seu e-mail", e nada chega — o pior tipo de falha,
porque parece sucesso.

Também é o que destrava o convite por e-mail (hoje contornado com senha
temporária) e as notificações de mudança de endereço.

## Escolher um provedor

Não use Gmail nem servidor caseiro. E-mail transacional saindo de um IP de
VPS sem reputação vai para spam ou é recusado. Opções com plano gratuito
suficiente para o volume atual:

| Serviço | Gratuito | Observação |
|---|---|---|
| **Brevo** (ex-Sendinblue) | 300/dia | Interface em português, aceita domínio próprio |
| **Resend** | 3.000/mês | Configuração simples, boa documentação |
| **Amazon SES** | 3.000/mês (12 meses) | Mais barato em escala, configuração mais trabalhosa |

Qualquer um resolve. Para começar, o Brevo tende a ser o caminho mais curto.

## Configurar no Supabase

No `.env` da instalação (`/opt/supabase/.env`):

```
SMTP_ADMIN_EMAIL=nao-responda@businesstriage.com.br
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=seu-usuario-do-provedor
SMTP_PASS=sua-senha-do-provedor
SMTP_SENDER_NAME=Business Triage

# Base para os links dos e-mails. Sem isto, o link de recuperação aponta
# para localhost e o usuário recebe um endereço que não abre.
SITE_URL=https://businesstriage.com.br

# Endereços autorizados como destino após autenticação.
ADDITIONAL_REDIRECT_URLS=https://businesstriage.com.br/redefinir-senha
```

Aplique:

```bash
cd /opt/supabase
docker compose up -d auth
```

## Autenticar o domínio

No painel do provedor, cadastre `businesstriage.com.br` e siga as instruções
de **SPF** e **DKIM** — são registros DNS que autorizam o serviço a enviar em
nome do seu domínio.

Sem isso, o e-mail chega na caixa de spam, e um link de recuperação que o
cliente não encontra equivale a não ter recuperação.

## Testar

Depois de configurar, na tela de login clique em "Esqueci minha senha" e use
seu próprio endereço. O e-mail deve chegar em segundos.

Se não chegar:

```bash
docker logs supabase-auth --tail 50 | grep -i -E "smtp|mail|error"
```

O GoTrue registra a falha de envio com o motivo — credencial recusada, porta
bloqueada, remetente não autorizado.

## Personalizar as mensagens

Os modelos padrão do Supabase são em inglês e genéricos. Vale trocar antes de
mandar para cliente:

```
MAILER_SUBJECTS_RECOVERY="Redefinir sua senha - Business Triage"
MAILER_TEMPLATES_RECOVERY=https://businesstriage.com.br/emails/recuperacao.html
```

O modelo precisa conter `{{ .ConfirmationURL }}`, que é substituído pelo link
real no envio.
