// =====================================================================
// ⚠️ ARQUIVO PROVISÓRIO — SUBSTITUA PELO GERADO A PARTIR DO SEU BANCO.
// =====================================================================
//
// O type-safety das queries está DESLIGADO enquanto este arquivo estiver
// assim. Toda query retorna `any`: um erro de digitação no nome de uma
// coluna passa pela compilação e só quebra em produção. É uma dívida
// técnica conhecida e localizada — mas é dívida.
//
// PARA ATIVAR O TYPE-SAFETY DE VERDADE:
//
// Requer Docker no ambiente onde o comando roda (o CLI do Supabase sobe o
// postgres-meta num container). No Windows isso significa Docker Desktop,
// que por sua vez exige virtualização habilitada na BIOS.
//
//   1. Abra o túnel SSH numa janela e deixe-a aberta:
//        ssh -L 5433:localhost:5432 root@SEU_IP
//
//   2. Em outra janela, na pasta api/, gere para um arquivo TEMPORÁRIO:
//        supabase gen types typescript --schema public `
//          --db-url "postgresql://postgres:SENHA@localhost:5433/postgres" `
//          | Out-File -Encoding utf8 types.tmp.ts
//
//   3. Confira que types.tmp.ts começa com "export type Database = {" e só
//      então substitua:
//        Move-Item -Force types.tmp.ts src/types/database.types.ts
//
// O passo do arquivo temporário não é frescura: o `>` e o `Out-File` do
// PowerShell esvaziam o destino ANTES de o comando rodar. Se o comando
// falhar, você perde o stub e o build acusa "is not a module".
//
// Refaça sempre que alterar o schema.
// =====================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = any;
