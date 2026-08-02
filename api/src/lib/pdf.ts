//
// Renderização de HTML para PDF via Chromium.
//
// Usa `puppeteer-core` + o Chromium do sistema (instalado pelo apk no
// Dockerfile). O pacote `puppeteer` completo baixa um Chromium compilado
// contra glibc, que não executa no Alpine — é musl.

import puppeteer, { type Browser } from 'puppeteer-core';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Um render por vez.
 *
 * Cada instância do Chromium chega a 300MB de pico. Num VPS que também
 * carrega Postgres, Supabase e dois n8n, dez requisições simultâneas
 * derrubariam o servidor inteiro por causa de um relatório. O volume real
 * é de alguns diagnósticos por dia — serializar não custa nada e remove a
 * classe de problema.
 */
let fila: Promise<unknown> = Promise.resolve();

function enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
  const proxima = fila.then(tarefa, tarefa);
  // Não deixa a corrente quebrar quando uma renderização falha.
  fila = proxima.catch(() => undefined);
  return proxima;
}

async function abrirNavegador(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: env.CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',                 // container já é o isolamento
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',      // /dev/shm do Docker é 64MB e estoura
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
}

const RODAPE = `
<div style="width:100%;font-size:8px;color:#94A3B8;font-family:Arial,sans-serif;
            padding:0 14mm;display:flex;justify-content:space-between;">
  <span>Business Triage · Relatório de Diagnóstico</span>
  <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
</div>`;

/**
 * Converte HTML completo em PDF A4.
 *
 * O navegador sobe e cai a cada chamada. Manter uma instância viva
 * economizaria cerca de um segundo, mas um Chromium órfão segurando
 * memória por dias custa muito mais do que esse segundo.
 */
export async function htmlParaPdf(html: string): Promise<Buffer> {
  return enfileirar(async () => {
    const inicio = Date.now();
    let browser: Browser | undefined;

    try {
      browser = await abrirNavegador();
      const page = await browser.newPage();

      // `domcontentloaded` basta: o template é autocontido, sem fonte
      // remota nem imagem externa. Esperar `networkidle` só adicionaria
      // atraso — e travaria a geração se a rede do container oscilasse.
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.emulateMediaType('print');

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: RODAPE,
        margin: { top: '14mm', right: '0mm', bottom: '16mm', left: '0mm' },
      });

      logger.info({ ms: Date.now() - inicio, bytes: pdf.length }, 'PDF gerado');
      return Buffer.from(pdf);
    } finally {
      // close() no finally: uma exceção no meio da renderização não pode
      // deixar processo do Chromium para trás.
      await browser?.close().catch((err) => logger.warn({ err }, 'Falha ao fechar o Chromium'));
    }
  });
}
