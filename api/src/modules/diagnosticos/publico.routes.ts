/**
 * O formulário do site falando direto com a API.
 *
 * =====================================================================
 * POR QUE RESPONDE ANTES DE TERMINAR
 * =====================================================================
 * A régua fecha em milissegundos; a análise do Claude leva de trinta a
 * sessenta segundos. Segurar o navegador todo esse tempo daria a barra de
 * carregamento mais longa do site inteiro, com risco real de timeout no
 * meio — e aí o cliente veria erro num diagnóstico que deu certo.
 *
 * Então a rota devolve o score assim que ele existe e segue trabalhando.
 * É a mesma topologia que o n8n tinha (`Responder ao Site` saía logo
 * depois do nó de cálculo), agora com uma diferença importante: o que
 * acontece depois fica registrado em `execucoes`.
 *
 * =====================================================================
 * O QUE ACONTECE SE O CONTÊINER MORRER NO MEIO
 * =====================================================================
 * A linha aberta em `execucoes` nunca recebe `terminado_em`, e
 * `vw_execucoes` a classifica como `travado`. Não é perfeito — um
 * diagnóstico se perde — mas é VISÍVEL, que é a diferença que importa.
 * No n8n a execução sumia e o lead também.
 *
 * A versão à prova disso seria gravar o registro como `processando`
 * antes da análise e ter uma varredura que retoma os travados. Está
 * anotado como próximo passo, não como pendência esquecida.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { badRequest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { comRegistro } from '../monitor/monitor.service.js';
import { calcularRegua } from '../regua/regua.js';
import { calcularReguaComercial } from '../regua/regua-comercial.js';
import { gerarProtocolo } from './diagnosticos.service.js';
import { dependenciasReais } from './dependencias.js';
import {
  processarDiagnostico,
  type DadosLead,
  type MotorAnalise,
  type TipoDiagnostico,
} from './processar.js';
import { env } from '../../config/env.js';

export const diagnosticoPublicoRouter = Router();

/**
 * Limite apertado, e por um motivo que não é abuso: **cada chamada custa
 * uma requisição paga ao Claude.** Sem teto, um script simples vira uma
 * fatura. Cinco por hora por endereço é folgado para uso real — ninguém
 * preenche dez minutos de formulário seis vezes em uma hora — e fecha a
 * porta para o resto.
 */
diagnosticoPublicoRouter.use(
  rateLimit({
    windowMs: 60 * 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limit', message: 'Muitas solicitações. Tente novamente mais tarde.' } },
  }),
);

const identificacaoSchema = z.object({
  razao_social: z.string().trim().max(200).nullish(),
  cnpj: z.string().trim().max(20).nullish(),
  email: z.string().trim().email('E-mail inválido'),
  telefone: z.string().trim().max(40).nullish(),
  setor: z.string().trim().max(120).nullish(),
  mes_referencia: z.string().trim().max(20).nullish(),
  num_funcionarios: z.union([z.number(), z.string()]).nullish(),
});

/**
 * O corpo aceita os dois formatos do site.
 *
 * O financeiro manda os quatro blocos (`dre`, `caixa`, `endividamento`,
 * `qualitativo`); o comercial manda um bloco `comercial`. Aceitar os dois
 * numa rota só evitaria duplicar validação, mas juntaria dois contratos
 * diferentes num schema frouxo — e schema frouxo é o que deixa passar
 * campo com nome errado, que depois vira score zerado sem explicação.
 */
const corpoFinanceiro = z.object({
  identificacao: identificacaoSchema,
  dre: z.record(z.unknown()).optional(),
  caixa: z.record(z.unknown()).optional(),
  endividamento: z.record(z.unknown()).optional(),
  qualitativo: z.record(z.unknown()).optional(),
});

const corpoComercial = z.object({
  identificacao: identificacaoSchema,
  comercial: z.record(z.unknown()),
});

function tratar(tipo: TipoDiagnostico) {
  return async (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    try {
      const esquema = tipo === 'comercial' ? corpoComercial : corpoFinanceiro;
      const parsed = esquema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          badRequest(
            parsed.error.issues[0]?.message ?? 'Dados do formulário inválidos',
            parsed.error.flatten().fieldErrors,
          ),
        );
      }

      const body = parsed.data as z.infer<typeof corpoFinanceiro> & { comercial?: Record<string, unknown> };
      const lead: DadosLead = body.identificacao;

      // `?motor=codigo` escreve o relatório sem IA: instantâneo e sem
      // custo. É o que a landing page de evento usa, onde o volume é
      // alto e o público não foi qualificado. Qualquer outro valor cai no
      // padrão do `.env` — texto inválido não vira erro, vira o
      // comportamento de sempre.
      const motor: MotorAnalise = req.query.motor === 'codigo' ? 'codigo' : env.MOTOR_ANALISE;

      const entrada: Record<string, unknown> =
        tipo === 'comercial'
          ? (body.comercial ?? {})
          : {
              dre: body.dre ?? {},
              caixa: body.caixa ?? {},
              endividamento: body.endividamento ?? {},
              qualitativo: body.qualitativo ?? {},
            };

      // A régua roda AQUI, na frente, porque é o que o site precisa ver.
      // Roda de novo dentro da orquestração — é barato e determinístico, e
      // passar o resultado adiante criaria duas fontes para o mesmo número.
      const regua =
        tipo === 'comercial'
          ? calcularReguaComercial(entrada)
          : calcularRegua(entrada as Parameters<typeof calcularRegua>[0]);

      const protocolo = gerarProtocolo(lead.cnpj, tipo);
      const score = regua.score.scoreTotal;
      const nivel =
        'nivelSaude' in regua.score ? regua.score.nivelSaude : regua.score.nivelMaturidade;

      // O site recebe a resposta agora. O resto continua atrás.
      res.status(202).json({
        ok: true,
        protocolo,
        scoreTotal: score,
        nivelSaude: nivel,
      });

      // ---- daqui para baixo, ninguém mais está esperando ---------------
      //
      // O `.catch` no fim não é enfeite. Sem ele a rejeição vira
      // `unhandledRejection`, e no Node 22 isso DERRUBA O PROCESSO por
      // padrão — uma análise que falha levaria a API inteira junto,
      // tirando do ar o painel de todos os clientes por causa de um
      // formulário. O `server.ts` tem um tratador global que segura, mas
      // depender dele para o caminho normal de falha é frágil: basta
      // alguém rodar este código em outro contexto.
      void comRegistro(`diagnostico.${tipo}`, async () => {
        try {
          const r = await processarDiagnostico(
            tipo,
            lead,
            entrada,
            dependenciasReais,
            protocolo,
            motor,
          );

          logger.info(
            { protocolo, tipo, motor, score, falhas: r.falhas.length, enviado: r.relatorio_enviado },
            'Diagnóstico processado',
          );

          // Lançar aqui é o que faz o registro de execução ficar marcado
          // como falho. Sem isso, uma execução com três falhas parciais
          // seria contada como sucesso pelo vigia.
          if (!r.ok) throw new Error(r.falhas.join(' | '));

          return { total: 1 };
        } catch (e) {
          logger.error(
            { protocolo, tipo, erro: e instanceof Error ? e.message : String(e) },
            'Diagnóstico falhou depois da resposta ao site',
          );
          throw e;
        }
      }).catch(() => {
        // Já foi registrado em `execucoes` e escrito no log pelo bloco
        // acima. Aqui só se impede que a rejeição escape para o processo.
      });
    } catch (e) {
      next(e);
    }
  };
}

diagnosticoPublicoRouter.post('/financeiro', tratar('financeiro'));
diagnosticoPublicoRouter.post('/comercial', tratar('comercial'));
