/**
 * Ciclo operacional e ciclo financeiro.
 *
 * Porta da planilha "Calculadora de Ciclo Financeiro — Aula 4.1".
 *
 * =====================================================================
 * A RÉGUA É "DIAS DE VENDA", E ISSO É UMA ESCOLHA
 * =====================================================================
 * Os três prazos saem de **valor ÷ venda diária**, não da base contábil
 * clássica (estoque sobre CMV, fornecedor sobre compras).
 *
 * É deliberado, e a planilha explica por quê: assim
 * `ciclo × venda diária` fecha EXATAMENTE com a necessidade de capital
 * de giro. Nas duas réguas os mesmos números dão respostas diferentes —
 * no exemplo da loja, 24,0 e 14,4 dias aqui contra 40,0 e 24,0 na base
 * contábil, com ciclo de 32 contra 38,4.
 *
 * Nenhuma das duas está errada. Mas o usuário vai ouvir do contador um
 * número diferente do que a tela mostra, e a tela precisa dizer isso
 * antes de ele descobrir sozinho e parar de confiar em uma das duas.
 *
 * =====================================================================
 * A IDENTIDADE QUE PRECISA SER VERDADE
 * =====================================================================
 *     dinheiro preso = ciclo × venda diária
 *                    = estoque + a receber − a pagar
 *
 * As duas contas têm de dar o mesmo número. Se divergirem, a régua foi
 * quebrada em algum lugar — e há teste para isso.
 */

export interface EntradaCiclo {
  /** Receita do último mês fechado. */
  receitaMensal: number;
  /** Valor de custo do estoque parado hoje. */
  estoque: number;
  /** Tudo que foi vendido e ainda não entrou. */
  aReceber: number;
  /** Tudo que foi comprado e ainda não saiu. */
  aPagar: number;
}

export type SituacaoCiclo = 'confortavel' | 'atencao' | 'critico';

export interface ResultadoCiclo {
  vendaDiaria: number;

  diasEstoque: number;
  diasRecebimento: number;
  diasFornecedor: number;

  cicloOperacional: number;
  cicloFinanceiro: number;

  /** Ciclo × venda diária. O lucro que virou estoque e carnê. */
  dinheiroPreso: number;
  /** Quanto UM dia de ciclo a menos devolve ao caixa. */
  valorDeUmDia: number;

  situacao: SituacaoCiclo | null;
  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularCiclo(e: EntradaCiclo): ResultadoCiclo {
  const receita = num(e.receitaMensal);
  const estoque = num(e.estoque);
  const aReceber = num(e.aReceber);
  const aPagar = num(e.aPagar);

  const vazio = (erro: string): ResultadoCiclo => ({
    vendaDiaria: 0,
    diasEstoque: 0,
    diasRecebimento: 0,
    diasFornecedor: 0,
    cicloOperacional: 0,
    cicloFinanceiro: 0,
    dinheiroPreso: 0,
    valorDeUmDia: 0,
    situacao: null,
    alertas: [],
    erro,
  });

  if (receita <= 0) {
    return vazio(
      'Informe a receita do último mês fechado. Ela é a régua que converte reais em dias — sem ela, nenhum prazo pode ser calculado.',
    );
  }

  if ([estoque, aReceber, aPagar].some((v) => v < 0)) {
    return vazio('Estoque, a receber e a pagar não podem ser negativos.');
  }

  // Mês de 30 dias corridos, como na planilha. Usar dias úteis mudaria
  // todos os prazos e quebraria a comparação com o material do curso.
  const vendaDiaria = r2(receita / 30);

  const diasEstoque = r1(estoque / vendaDiaria);
  const diasRecebimento = r1(aReceber / vendaDiaria);
  const diasFornecedor = r1(aPagar / vendaDiaria);

  const cicloOperacional = r1(diasEstoque + diasRecebimento);
  const cicloFinanceiro = r1(cicloOperacional - diasFornecedor);

  const alertas: string[] = [];

  // Faixas de gestão do curso.
  const situacao: SituacaoCiclo =
    cicloFinanceiro <= 30 ? 'confortavel' : cicloFinanceiro <= 40 ? 'atencao' : 'critico';

  // O dinheiro preso sai dos VALORES, não dos dias arredondados.
  //
  // Multiplicar o ciclo já arredondado pela venda diária produziria uma
  // diferença de centenas de reais num ciclo de 32 dias — e o usuário
  // que conferir na calculadora encontraria a divergência.
  const dinheiroPreso = r2(estoque + aReceber - aPagar);

  if (cicloFinanceiro < 0) {
    alertas.push(
      `Ciclo financeiro negativo em ${Math.abs(cicloFinanceiro)} dias: você recebe do cliente antes de pagar o fornecedor, e a operação se financia sozinha. É a posição mais confortável possível — vale proteger essa condição em qualquer renegociação.`,
    );
  } else if (situacao === 'critico') {
    alertas.push(
      `Ciclo financeiro de ${cicloFinanceiro} dias, acima da faixa crítica de 40. São ${brl(dinheiroPreso)} do seu dinheiro parado fora do caixa — lucro que virou estoque e carnê.`,
    );
  } else if (situacao === 'atencao') {
    alertas.push(
      `Ciclo financeiro de ${cicloFinanceiro} dias. Acima de 30 a operação começa a exigir capital de giro que não vem da venda.`,
    );
  }

  // O maior dos três é onde a alavanca rende mais. Dizer qual evita o
  // erro comum de atacar o fornecedor quando o problema é o estoque.
  if (cicloFinanceiro > 30) {
    const maior = Math.max(diasEstoque, diasRecebimento);
    alertas.push(
      maior === diasEstoque
        ? `O estoque é o maior pedaço: ${diasEstoque} dias. Cada dia cortado dele devolve ${brl(vendaDiaria)} ao caixa.`
        : `O recebimento é o maior pedaço: ${diasRecebimento} dias. Cada dia cortado dele devolve ${brl(vendaDiaria)} ao caixa.`,
    );
  }

  return {
    vendaDiaria,
    diasEstoque,
    diasRecebimento,
    diasFornecedor,
    cicloOperacional,
    cicloFinanceiro,
    dinheiroPreso,
    valorDeUmDia: vendaDiaria,
    situacao,
    alertas,
    erro: null,
  };
}
