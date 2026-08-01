# Segurança — checklist do servidor

O sistema guarda dado financeiro de empresas clientes. Este documento lista o
que já está protegido, o que falta, e em que ordem resolver.

## Rodar a auditoria

```bash
sudo bash /opt/finance-src/scripts/auditoria-seguranca.sh
```

Somente leitura, não altera nada, e não imprime segredo nenhum — compara
valores internamente e reporta apenas aprovado ou reprovado. Pode rodar com
outra pessoa olhando a tela.

---

## O que já está protegido

**Isolamento entre empresas.** RLS em todas as tabelas, validado com um
usuário sem vínculo retornando zero linhas. Nem a API confia em si mesma: ela
consulta `memberships` com o token do próprio usuário.

**Tráfego.** TLS pelo Traefik em todos os domínios. API e Supabase conversam
pela rede interna do Docker, sem sair do servidor.

**Webhooks.** Segredo compartilhado com comparação em tempo constante e rate
limit de 30 requisições por minuto.

**Banco fechado.** Postgres escuta apenas em `127.0.0.1` — confirmado.

**Escalonamento de privilégio.** `is_staff` só muda por SQL; um gatilho
bloqueia alteração pela aplicação, inclusive via `service_role`.

**Backup.** Diário às 03:30, com verificação de integridade e restauração
testada.

---

## Pendências, em ordem de risco

### 1. Chaves padrão do Supabase — verificar hoje

Se `JWT_SECRET` for o valor de exemplo do repositório oficial, qualquer pessoa
forja um token válido e lê o banco inteiro. O RLS não ajuda: o token seria
legítimo do ponto de vista do sistema.

A auditoria verifica isso. Se acusar, a correção exige regenerar as chaves e
reiniciar o Supabase — o que invalida as sessões ativas e obriga a atualizar
a `ANON_KEY` no `.env.production` do front.

### 2. Login de root por senha

O IP do servidor é conhecido e é alvo constante de tentativas automatizadas.

```bash
# Na sua máquina, se ainda não tiver chave:
ssh-keygen -t ed25519 -C "oseias-notebook"
ssh-copy-id root@187.77.232.125
```

Depois de confirmar que entra sem senha, no servidor:

```bash
sudo nano /etc/ssh/sshd_config
```

```
PermitRootLogin prohibit-password
PasswordAuthentication no
```

```bash
sudo systemctl restart ssh
```

**Não feche a sessão atual antes de testar em outra janela.** Se errar a
configuração e sair, você perde o acesso ao servidor.

### 3. fail2ban e firewall

```bash
sudo apt update && sudo apt install -y fail2ban ufw
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable
sudo systemctl enable --now fail2ban
```

O `ufw allow 22` antes do `enable` não é detalhe: sem ele você se tranca para
fora no momento em que ativa o firewall.

### 4. Studio do Supabase exposto

`api.oseiasansay.com.br` serve o Studio protegido apenas por Basic Auth. Com a
senha correta, alguém tem acesso total ao banco, ignorando todo o RLS.

O ideal é restringir por IP no Traefik, ou tirar do ar e acessar por túnel SSH
quando precisar:

```bash
ssh -L 8000:localhost:8000 root@187.77.232.125
```

### 5. Snapshot do VPS

No hPanel da Hostinger. O backup do banco mora no mesmo disco do banco — não
cobre o servidor sumir.

### 6. Cópia dos `.env`

Guarde `/opt/supabase/.env` e `/opt/finance-src/api/.env` num gerenciador de
senhas. Sem `JWT_SECRET`, restaurar o banco não devolve o sistema: os tokens
não validam e ninguém entra.

---

## O que deliberadamente não foi feito

**Criptografia de coluna.** Discutida e descartada: com a chave no mesmo
servidor, ela não protege contra o cenário realista (comprometimento do VPS) e
quebraria o DRE e o fluxo de caixa, que dependem do banco somar valores.

**Acesso irrestrito do staff.** A equipe da Business Triage administra
empresas e usuários, mas para ver o financeiro precisa ser adicionada como
membro — o que fica registrado e é auditável pelo cliente.

**Autocadastro.** Não existe tela de registro público. Clientes são criados
pela consultoria, o que elimina toda uma classe de abuso.

---

## Rotina

Rode a auditoria depois de qualquer mudança de infraestrutura, e ao menos uma
vez por mês. E repita o teste de restauração descrito no `BACKUP.md` a cada
poucos meses — backup costuma parar de funcionar em silêncio.
