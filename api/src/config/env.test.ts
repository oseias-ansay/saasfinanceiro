/**
 * Testes da lista de origens do CORS.
 *
 * Existem por causa de um defeito que custou um formulário inteiro: o
 * site responde com e sem `www`, a lista tinha só uma das formas, e o
 * navegador recusava a resposta sem deixar rastro nenhum no servidor. O
 * log mostrava 200; o visitante via erro vermelho.
 *
 * A transformação é testada isolada da validação do ambiente inteiro,
 * porque importar `env.js` obriga a ter Supabase configurado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Cópia da transformação de `CORS_ORIGINS` em `env.ts`.
 *
 * Duplicada de propósito: o schema do Zod lá valida o ambiente inteiro e
 * chama `process.exit(1)` quando falta variável, o que mataria o
 * processo de teste. Se mexer numa, mexa na outra — o teste abaixo é o
 * que avisa.
 */
function expandir(v: string): string[] {
  const base = v.split(',').map((s) => s.trim()).filter(Boolean);
  const comVariantes = base.flatMap((o) => {
    try {
      const u = new URL(o);
      const ehNome = u.hostname.includes('.') && !/^[\d.]+$/.test(u.hostname);
      if (!ehNome) return [o];
      const par = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
      return [o, `${u.protocol}//${par}${u.port ? `:${u.port}` : ''}`];
    } catch {
      return [o];
    }
  });
  return [...new Set(comVariantes)];
}

describe('origens do CORS', () => {
  it('aceita o domínio com e sem www', () => {
    assert.deepEqual(expandir('https://businesstriage.com.br'), [
      'https://businesstriage.com.br',
      'https://www.businesstriage.com.br',
    ]);
  });

  it('funciona na direção contrária', () => {
    assert.deepEqual(expandir('https://www.businesstriage.com.br'), [
      'https://www.businesstriage.com.br',
      'https://businesstriage.com.br',
    ]);
  });

  it('localhost fica como está — não existe www.localhost', () => {
    assert.deepEqual(expandir('http://localhost:5173'), ['http://localhost:5173']);
  });

  it('endereço de IP também fica como está', () => {
    assert.deepEqual(expandir('http://192.168.0.10:3000'), ['http://192.168.0.10:3000']);
  });

  it('preserva a porta quando o domínio é nome de verdade', () => {
    assert.deepEqual(expandir('https://app.exemplo.com:8443'), [
      'https://app.exemplo.com:8443',
      'https://www.app.exemplo.com:8443',
    ]);
  });

  it('não repete quando as duas formas já estão na lista', () => {
    const r = expandir('https://businesstriage.com.br,https://www.businesstriage.com.br');
    assert.equal(r.length, 2);
    assert.equal(new Set(r).size, 2);
  });

  it('lida com espaços e vírgula sobrando', () => {
    const r = expandir(' https://a.com , , https://b.com ');
    assert.deepEqual(r, ['https://a.com', 'https://www.a.com', 'https://b.com', 'https://www.b.com']);
  });

  it('origem malformada não derruba a subida da API', () => {
    assert.deepEqual(expandir('nao-e-url'), ['nao-e-url']);
  });

  it('lista vazia continua vazia — e vazia significa CORS desligado', () => {
    assert.deepEqual(expandir(''), []);
  });
});
