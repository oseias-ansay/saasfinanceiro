// ============================================================
// Business Triage — fecha a rodada mensal
//
// Roda DEPOIS dos envios. Junta os tenants que receberam cobrança
// e devolve um item só, no formato que a API espera.
//
// A ordem importa: marcar antes de enviar deixaria o cliente sem
// aviso para sempre numa falha de SMTP, e o sistema achando que
// avisou. Marcar depois pode, no pior caso, mandar o aviso duas
// vezes — incômodo, não silêncio.
// ============================================================

const itens = $input.all();

// O item interno carrega a competência e a lista completa.
const interno = itens.map((i) => i.json).find((j) => j.tipo === 'interno');

if (!interno || !Array.isArray(interno.cobrados) || interno.cobrados.length === 0) {
  // Nada a marcar. Devolver vazio faz o nó seguinte não executar,
  // que é o comportamento certo — chamar a API com lista vazia só
  // gastaria uma requisição para ouvir "zero".
  return [];
}

return [
  {
    json: {
      competencia: interno.competencia,
      tenant_ids: interno.cobrados,
    },
  },
];
