# SaaS Financeiro para EPPs — MVP

Sistema de gestão financeira para Empresas de Pequeno Porte, com contas a
pagar/receber, fluxo de caixa projetado e DRE gerencial por competência.

## Stack

| Camada | Tecnologia |
|---|---|
| Banco / Auth / Storage | Supabase self-hosted (PostgreSQL + RLS) |
| API | Node.js 20 + Express + TypeScript |
| Automação | n8n (recorrências e alertas) |
| Front | React + Vite + Tailwind (Etapa 4) |

## Estrutura

```
saasfinanceiro/
├── api/                 # Etapa 2 — API Node.js
│   ├── src/
│   │   ├── config/      # validação de env com Zod
│   │   ├── lib/         # supabase (2 clientes), errors, logger
│   │   ├── middlewares/ # auth, tenant, validate, error-handler
│   │   ├── modules/     # transactions, reports, onboarding, webhooks
│   │   ├── types/       # database.types.ts (GERADO — ver abaixo)
│   │   ├── app.ts
│   │   └── server.ts
│   ├── Dockerfile
│   └── docker-compose.yml
├── supabase/sql/        # Etapa 1 — scripts do banco (01 a 05)
└── web/                 # Etapa 4 — front (a fazer)
```

## Status

- [x] **Etapa 1** — Modelagem do banco, RLS, RPCs e views. Validada no Supabase.
- [x] **Etapa 2** — API Node.js. Código escrito, **ainda não compilado**.
- [ ] **Etapa 3** — Workflows n8n.
- [ ] **Etapa 4** — Interface React.

## Como rodar a API

```bash
cd api
cp .env.example .env        # preencha com as chaves do .env do Supabase
npm install

# OBRIGATÓRIO: gerar os tipos reais do banco
supabase gen types typescript \
  --db-url "postgresql://postgres:SENHA@HOST:5432/postgres" \
  --schema public > src/types/database.types.ts

npm run dev                 # http://localhost:3333/health
```

> O `src/types/database.types.ts` versionado é um **stub provisório** que
> desliga o type-safety. Substitua pelo gerado antes de levar a sério.

## Conceito central: as três datas

Cada lançamento em `transactions` carrega três datas, e é isso que faz o
sistema responder duas perguntas diferentes que a EPP confunde:

- `competence_date` — quando o fato aconteceu → **DRE** (dá o lucro real)
- `due_date` — quando vence → **contas a pagar/receber e projeção**
- `paid_date` — quando o dinheiro andou → **fluxo de caixa**

É comum a empresa ter caixa positivo e prejuízo no mesmo mês. Sem separar
essas datas, o dono não enxerga isso.

## Segurança

- Multi-tenancy por `tenant_id` + RLS em todas as tabelas.
- A API usa o JWT do usuário nas rotas autenticadas: o RLS continua ativo.
- `service_role` só em `modules/webhooks` e no convite de usuário.
- Nunca coloque a `service_role key` no front.
