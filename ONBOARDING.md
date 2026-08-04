# Onboarding das empresas do beta

Roteiro para colocar uma empresa no ar e para os primeiros minutos do
empresário dentro do sistema.

## Antes de convidar qualquer um

- [ ] Backup rodando e restauração testada
- [ ] Monitor externo apontando para `/health`, `businesstriage.com.br` e o n8n
- [ ] Recuperação de senha testada da tela, ponta a ponta
- [ ] Um cadastro de teste feito por você, do começo ao fim, como se fosse cliente

O último item é o que mais economiza tempo. Passar pelo fluxo inteiro uma vez
revela em quinze minutos o que vinte pessoas descobririam em três dias.

## Criar uma empresa — 5 minutos, você

1. Entre em `/painel/admin`
2. **Nova empresa**: razão social, CNPJ e o e-mail do responsável
3. O sistema cria a empresa, semeia as categorias padrão e devolve uma
   **senha temporária** no formato `BT-XXXX-9999`
4. **Anote a senha na hora.** Ela aparece uma única vez e não fica gravada em
   lugar nenhum além do hash
5. Envie a mensagem abaixo

O formato da senha foi pensado para ser ditado por telefone: sem `I`, `O`,
`0` nem `1`, que são os caracteres que geram confusão.

## Mensagem para o empresário

> Oi, [nome]. O acesso ao sistema está pronto.
>
> **Endereço:** businesstriage.com.br/login
> **Usuário:** [e-mail]
> **Senha provisória:** BT-XXXX-9999
>
> No primeiro acesso, troque a senha em Perfil.
>
> O primeiro passo dentro do sistema é cadastrar sua conta bancária **com o
> saldo de hoje**. Sem isso o fluxo de caixa começa do zero e as projeções
> ficam erradas. Leva um minuto e está em Cadastros → Contas.
>
> Depois disso, lance as despesas fixas do mês e as contas que você tem a
> receber. Em vinte minutos você já vê a Visão Geral com o seu caixa
> projetado.
>
> É uma versão em teste. Se algo travar ou parecer estranho, me manda — é
> exatamente isso que eu preciso saber.

## Os primeiros 20 minutos do cliente

A ordem importa. Cada passo depende do anterior.

**1. Trocar a senha.** Em Perfil.

**2. Cadastrar a conta e o saldo inicial.** Cadastros → Contas. É o passo que
não pode ser pulado: o saldo de abertura é o ponto de partida de todo o fluxo
de caixa e da projeção de 30/60/90 dias. Quem pula, vê números errados e
conclui que o sistema não funciona.

**3. Lançar as despesas fixas do mês.** Aluguel, salários, energia,
contabilidade, internet. É o que enche o DRE e revela o custo fixo real.

**4. Lançar o que há a receber em aberto.** Os títulos com vencimento futuro.
Sem eles a projeção só mostra saída e o caixa parece pior do que é.

**5. Abrir a Visão Geral.** É aqui que o valor aparece pela primeira vez.

## Limitações conhecidas — avise antes

Dizer de antemão transforma uma frustração em expectativa cumprida.

**Lançamento recorrente ainda não existe.** Para aluguel e salário, use o
campo **Parcelas** — 12 parcelas cobrem o ano. O fluxo de caixa e o DRE ficam
corretos; a diferença é que a série termina em vez de se estender sozinha.

**Não há aplicativo.** O sistema funciona no navegador do celular, mas não é
um app instalável e não funciona sem internet.

**Não há integração bancária.** Os lançamentos são manuais. É proposital: o
objetivo do primeiro mês é o empresário reencontrar os próprios números, não
automatizar antes de entender.

**Baixa parcial não existe.** Um título é liquidado por inteiro ou fica em
aberto.

## O que observar durante o beta

Beta sem pergunta definida vira suporte gratuito. As três que importam:

**Conseguiram sozinhos?** Quantos concluíram os cinco passos sem te chamar.
Se a maioria precisou de ajuda, o problema é de produto, não de usuário.

**Voltaram na segunda semana?** Cadastrar na primeira semana é curiosidade.
Voltar na segunda é uso.

**Onde travaram?** Anote a tela e a frase exata que a pessoa usou. "Não achei
onde põe o dinheiro que entrou" vale mais que "a interface é confusa".

## Suporte

Combine um canal que não seja o seu WhatsApp pessoal, e diga o prazo de
resposta em voz alta. Expectativa dita é expectativa cumprida; expectativa
implícita é sempre frustrada.

Vale um documento compartilhado onde você registra cada problema relatado com
data, empresa e tela. No fim do beta, esse documento é o seu backlog — e ele
vai estar ordenado por frequência, que é a ordem certa.

## Comece com cinco, não com vinte

Os cinco primeiros revelam a maior parte dos problemas. Consertar com cinco
pessoas esperando é muito diferente de consertar com vinte, e convite adiado
é fácil de dar — primeira impressão ruim não se recupera.

## Melhorias que dependem do beta

Não construa antes de ver o uso real:

- **Convite por e-mail** em vez de senha ditada. A API já tem o modo
  `convite`, e o SMTP agora funciona — falta o link do convite cair na tela de
  definir senha, e traduzir o modelo do GoTrue.
- **Lançamento recorrente**, com a interface informada pelo que as pessoas
  tentarem fazer com o campo Parcelas.
- **Troca de senha obrigatória no primeiro acesso**, hoje apenas sugerida na
  mensagem.
