/**
 * A régua exposta como serviço.
 *
 * Existe para o n8n parar de ter a própria cópia das fórmulas. O nó
 * `Calcular Indicadores e Score` vira uma chamada HTTP a este endereço, e
 * o formato de saída é exatamente o que ele produzia — incluindo
 * `protocolo`, `identificacao` e `entrada` — para que os nós seguintes do
 * workflow não precisem mudar nada.
 *
 * Protegido pelo mesmo segredo dos demais webhooks. Não é rota pública:
 * a régua é o método, e o método não se entrega de graça a quem faz um
 * curl.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { calcularRegua, VERSAO_REGUA, type EntradaRegua } from './regua.js';
import { requireWebhookSecret } from '../webhooks/secret.js';

export const reguaRouter = Router();

reguaRouter.use(
  rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  requireWebhookSecret,
);

/**
 * Protocolo do atendimento.
 *
 * Mesma regra de antes: oito primeiros dígitos do CNPJ, mais o instante em
 * base 36. Não é identificador de banco — é o número que o cliente cita
 * quando liga perguntando do relatório dele.
 */
function gerarProtocolo(cnpj?: string | null): string {
  const base = String(cnpj ?? '00000000').replace(/\D/g, '').slice(0, 8) || '00000000';
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Calcula a régua sobre a entrada do formulário.
 *
 * Sem validação por schema, de propósito: a régua já trata ausência e
 * lixo em qualquer campo — `Number(v) || 0` para números, mapa com padrão
 * para escolhas. Recusar a requisição por um campo malformado seria pior
 * que calcular: o cliente perderia o diagnóstico inteiro por causa de um
 * campo que ele deixou em branco.
 *
 * O que ninguém pode fazer é confiar em score calculado sobre entrada
 * incompleta — e isso é problema do limiar de completude, não desta rota.
 */
reguaRouter.post('/financeiro', (req, res) => {
  const corpo = (req.body ?? {}) as EntradaRegua & {
    identificacao?: Record<string, unknown>;
  };

  const identificacao = corpo.identificacao ?? {};
  const resultado = calcularRegua(corpo);

  res.json({
    protocolo: gerarProtocolo(identificacao.cnpj as string | undefined),
    recebido_em: new Date().toISOString(),
    identificacao,
    entrada: {
      dre: corpo.dre ?? {},
      caixa: corpo.caixa ?? {},
      endividamento: corpo.endividamento ?? {},
      qualitativo: corpo.qualitativo ?? {},
    },
    ...resultado,
  });
});

/** Qual régua está no ar. Serve para conferir um deploy sem calcular nada. */
reguaRouter.get('/versao', (_req, res) => {
  res.json({ data: { versao: VERSAO_REGUA } });
});
