/**
 * Testes de `cotacaoCache.ts`.
 *
 *   npx tsx src/app/investimentos/lib/cotacaoCache.test.ts
 *
 * O que está em jogo é a cota da brapi: 15.000 requisições por mês, um ticker
 * por chamada. Cada erro aqui vira requisição desperdiçada — ou preço velho
 * mostrado como se fosse de hoje.
 */
import assert from 'node:assert/strict';
import {
  MAX_TICKERS, TICKER_VALIDO, VALIDADE_CDI_MS, VALIDADE_MS, cdiEstaFresco, comCotacoes,
  estaFresca, planejarBusca,
  type Cache,
} from './cotacaoCache';

let passou = 0;
const falhas: string[] = [];
function teste(nome: string, f: () => void) {
  try { f(); passou++; }
  catch (e) { falhas.push(`${nome}\n    ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`); }
}

const AGORA = 1_700_000_000_000;
const entrada = (ticker: string, preco: number, buscadaEm: number) =>
  ({ ticker, preco, data: '2026-09-23', buscadaEm });

// ── frescor ────────────────────────────────────────────────────────────────

teste('sem entrada no cache, não está fresca', () => {
  assert.equal(estaFresca(undefined, AGORA), false);
});

teste('buscada agora está fresca', () => {
  assert.equal(estaFresca(entrada('PETR4', 30, AGORA), AGORA), true);
});

teste('dentro da validade está fresca; fora, não', () => {
  const quase = entrada('PETR4', 30, AGORA - VALIDADE_MS + 1000);
  const velha = entrada('PETR4', 30, AGORA - VALIDADE_MS);
  assert.equal(estaFresca(quase, AGORA), true);
  assert.equal(estaFresca(velha, AGORA), false, 'exatamente na validade já venceu');
});

teste('carimbo no futuro conta como velha', () => {
  // Relógio do sistema andando para trás (fuso, horário de verão, máquina
  // sincronizando). Confiar no carimbo congelaria o preço até a data
  // alcançá-lo.
  const futuro = entrada('PETR4', 30, AGORA + 60_000);
  assert.equal(estaFresca(futuro, AGORA), false);
});

// ── plano de busca ─────────────────────────────────────────────────────────

teste('ticker fresco vem do cache e não vai à rede', () => {
  const cache: Cache = { PETR4: entrada('PETR4', 30, AGORA) };
  const p = planejarBusca(['PETR4'], cache, AGORA);
  assert.equal(p.aBuscar.length, 0, 'não pode gastar requisição por preço que já temos');
  assert.equal(p.doCache.length, 1);
  assert.equal(p.doCache[0].preco, 30);
});

teste('ticker velho volta para a rede', () => {
  const cache: Cache = { PETR4: entrada('PETR4', 30, AGORA - VALIDADE_MS - 1) };
  const p = planejarBusca(['PETR4'], cache, AGORA);
  assert.deepEqual(p.aBuscar, ['PETR4']);
  assert.equal(p.doCache.length, 0);
});

teste('ticker repetido é pedido uma vez só', () => {
  // Dois ativos podem apontar para o mesmo código; pedir duas vezes gastaria
  // duas requisições pelo mesmo número.
  const p = planejarBusca(['MXRF11', 'MXRF11', 'mxrf11'], {}, AGORA);
  assert.deepEqual(p.aBuscar, ['MXRF11']);
});

teste('normaliza caixa e espaço antes de decidir', () => {
  const cache: Cache = { MXRF11: entrada('MXRF11', 10, AGORA) };
  const p = planejarBusca(['  mxrf11 '], cache, AGORA);
  assert.equal(p.doCache.length, 1, 'minúscula tem que casar com o cache');
  assert.equal(p.aBuscar.length, 0);
});

teste('código inválido nem chega a ser pedido', () => {
  // A rota recusa com 400; filtrar antes evita a viagem e devolve uma
  // mensagem que diz o que fazer.
  const p = planejarBusca(['PETR4', 'ABC', 'MUITO_LONGO', 'AÇÃO1'], {}, AGORA);
  assert.deepEqual(p.aBuscar, ['PETR4']);
  assert.equal(p.invalidos.length, 3);
});

teste('regra do ticker: 4 a 6 letras ou números', () => {
  for (const bom of ['PETR4', 'MXRF11', 'BOVA11', 'ABCD', 'ROXO34']) {
    assert.ok(TICKER_VALIDO.test(bom), `${bom} deveria passar`);
  }
  for (const ruim of ['ABC', 'ABCDEFG', 'petr4', 'PETR-4', '']) {
    assert.ok(!TICKER_VALIDO.test(ruim), `${ruim} deveria ser recusado`);
  }
});

teste('mistura de fresco e velho separa os dois', () => {
  const cache: Cache = {
    PETR4: entrada('PETR4', 30, AGORA),
    VALE3: entrada('VALE3', 60, AGORA - VALIDADE_MS - 1),
  };
  const p = planejarBusca(['PETR4', 'VALE3', 'ITUB4'], cache, AGORA);
  assert.deepEqual(p.doCache.map((c) => c.ticker), ['PETR4']);
  assert.deepEqual(p.aBuscar.sort(), ['ITUB4', 'VALE3']);
});

teste('lista vazia não inventa busca', () => {
  const p = planejarBusca([], {}, AGORA);
  assert.equal(p.aBuscar.length, 0);
  assert.equal(p.doCache.length, 0);
  assert.equal(p.invalidos.length, 0);
});

teste('o teto da rota é 30 por chamada', () => {
  assert.equal(MAX_TICKERS, 30);
});

// ── gravação ───────────────────────────────────────────────────────────────

teste('cotação nova entra com o carimbo de agora', () => {
  const c = comCotacoes({}, [{ ticker: 'PETR4', preco: 31.5, data: '2026-09-23' }], AGORA);
  assert.equal(c.PETR4.preco, 31.5);
  assert.equal(c.PETR4.buscadaEm, AGORA);
});

teste('cotação nova substitui a velha do mesmo ticker', () => {
  const antes: Cache = { PETR4: entrada('PETR4', 30, AGORA - 99_999) };
  const c = comCotacoes(antes, [{ ticker: 'PETR4', preco: 31.5, data: '2026-09-23' }], AGORA);
  assert.equal(c.PETR4.preco, 31.5);
  assert.equal(c.PETR4.buscadaEm, AGORA);
});

teste('gravar não muta o cache recebido', () => {
  // O React compara referência; mutar o objeto anterior esconderia a mudança.
  const antes: Cache = { PETR4: entrada('PETR4', 30, AGORA) };
  const depois = comCotacoes(antes, [{ ticker: 'VALE3', preco: 60, data: '2026-09-23' }], AGORA);
  assert.equal(antes.VALE3, undefined);
  assert.ok(depois.VALE3);
});

teste('ticker que não voltou continua no cache com o preço antigo', () => {
  const antes: Cache = { VALE3: entrada('VALE3', 60, AGORA - 10) };
  const depois = comCotacoes(antes, [{ ticker: 'PETR4', preco: 31, data: '2026-09-23' }], AGORA);
  assert.equal(depois.VALE3.preco, 60);
});

// ── CDI ────────────────────────────────────────────────────────────────────

const cdi = (buscadoEm: number) => ({ diario: 0.0534, anual: 14.4, data: '2026-09-22', buscadoEm });

teste('CDI sem cache não está fresco', () => {
  assert.equal(cdiEstaFresco(null, AGORA), false);
});

teste('CDI vale um dia, não meia hora', () => {
  // A série 12 do BCB só publica em dia útil: buscar de hora em hora
  // devolveria o mesmo número e gastaria ida ao servidor à toa.
  assert.equal(cdiEstaFresco(cdi(AGORA - 60 * 60 * 1000), AGORA), true, 'uma hora ainda vale');
  assert.equal(cdiEstaFresco(cdi(AGORA - VALIDADE_CDI_MS + 1000), AGORA), true);
  assert.equal(cdiEstaFresco(cdi(AGORA - VALIDADE_CDI_MS), AGORA), false);
});

teste('CDI com carimbo no futuro conta como velho', () => {
  assert.equal(cdiEstaFresco(cdi(AGORA + 60_000), AGORA), false);
});

teste('a validade do CDI é bem maior que a da cotação', () => {
  assert.ok(VALIDADE_CDI_MS > VALIDADE_MS * 10);
});

// ── saída ──────────────────────────────────────────────────────────────────

console.log(`${passou} passou · ${falhas.length} falhou`);
if (falhas.length) {
  console.log('── falhas ──');
  for (const f of falhas) console.log('  ✗ ' + f);
  process.exit(1);
}
