/**
 * Testes das funções puras que decidem números na tela.
 *
 *   npm run verificar-calculos
 *
 * Cobre marco zero, CDI e estimativa de provento. São as três contas em que um
 * erro não aparece como exceção — aparece como um número plausível e errado.
 */
import assert from 'node:assert/strict';
import { marcoZeroNecessario, proximoVencimento, type ContaCiclo } from '../src/lib/ciclo.ts';
import { cdiAnual, renderNoPeriodo } from '../src/lib/mercado.ts';
import { estimarProximo, palpitarTipo, mesSeguinte, type Provento } from '../src/lib/proventos.ts';

let passou = 0;
const falhas: string[] = [];
function teste(nome: string, f: () => void) {
  try { f(); passou++; }
  catch (e) { falhas.push(`${nome}\n    ${(e as Error).message.split('\n')[0]}`); }
}

const cartao = (id: number, nome: string, fecha: number, vence: number): ContaCiclo => ({
  id, nome, instituicao: 'itau', tipo: 'cartao',
  dia_fechamento: fecha, dia_vencimento: vence,
});

// ── marco zero ─────────────────────────────────────────────────────────────

teste('Itaú fecha 3 / vence 10, hoje 04/08 → precisa desde 04/07', () => {
  const m = marcoZeroNecessario([cartao(1, 'Itaú', 3, 10)], new Date(2026, 7, 4));
  assert.equal(m.desde, '2026-07-04');
  assert.equal(m.ciclos[0].vence, '2026-08-10');
});

teste('Nubank fecha 31 / vence 8, hoje 04/08 → precisa desde 01/07', () => {
  const m = marcoZeroNecessario([cartao(2, 'Nubank', 31, 8)], new Date(2026, 7, 4));
  assert.equal(m.desde, '2026-07-01');
  assert.equal(m.ciclos[0].vence, '2026-08-08');
});

teste('dois cartões → vale o ciclo mais antigo', () => {
  const m = marcoZeroNecessario(
    [cartao(1, 'Itaú', 3, 10), cartao(2, 'Nubank', 31, 8)], new Date(2026, 7, 4),
  );
  assert.equal(m.desde, '2026-07-01');
  assert.equal(m.ciclos.length, 2);
});

teste('depois de paga a fatura, a janela anda para o ciclo aberto', () => {
  // Em 15/08 a fatura que venceu em 10/08 já foi paga: compra e pagamento
  // ficaram os dois no passado, nada pendurado. Sobra o ciclo aberto em 04/08.
  const m = marcoZeroNecessario([cartao(1, 'Itaú', 3, 10)], new Date(2026, 7, 15));
  assert.equal(m.desde, '2026-08-04');
  assert.equal(m.ciclos[0].vence, '2026-09-10');
});

teste('fecha 28 / vence 5: vencimento cai no mês seguinte', () => {
  const m = marcoZeroNecessario([cartao(1, 'X', 28, 5)], new Date(2026, 7, 4));
  // Último fechamento foi 28/07; a fatura vence 05/08, ainda não paga.
  assert.equal(m.ciclos[0].vence, '2026-08-05');
  assert.equal(m.desde, '2026-06-29');
});

teste('fechamento dia 31 em fevereiro não escorrega para março', () => {
  const m = marcoZeroNecessario([cartao(1, 'X', 31, 8)], new Date(2026, 2, 4));
  assert.equal(m.desde, '2026-02-01');
});

teste('virada de ano: hoje 04/01 olha para dezembro', () => {
  const m = marcoZeroNecessario([cartao(1, 'Itaú', 3, 10)], new Date(2026, 0, 4));
  assert.equal(m.desde, '2025-12-04');
  assert.equal(m.ciclos[0].vence, '2026-01-10');
});

teste('sem cartão → primeiro dia do mês corrente', () => {
  assert.equal(marcoZeroNecessario([], new Date(2026, 7, 20)).desde, '2026-08-01');
});

teste('proximoVencimento concorda com o marco zero', () => {
  const { fecha, vence } = proximoVencimento(new Date(2026, 7, 4), 3, 10);
  assert.equal(fecha, '2026-09-03');   // o de agosto já passou em 04/08
  assert.equal(vence, '2026-09-10');
});

// ── CDI ────────────────────────────────────────────────────────────────────

teste('CDI diário de 0,0534% dá ~14,4% ao ano', () => {
  const a = cdiAnual(0.0534);
  assert.ok(a > 14.2 && a < 14.6, `esperava ~14,4%, veio ${a.toFixed(3)}%`);
});

teste('juro composto, não simples', () => {
  // Simples daria 0.0534 * 252 = 13,46%. Composto tem que ser maior.
  assert.ok(cdiAnual(0.0534) > 0.0534 * 252);
});

teste('R$ 10.000 a 100% do CDI rendem ~R$ 112 em 21 dias úteis', () => {
  const r = renderNoPeriodo(10_000, 0.0534, 1, 21);
  assert.ok(r > 110 && r < 115, `veio ${r.toFixed(2)}`);
});

teste('102% do CDI rende mais que 100%', () => {
  assert.ok(renderNoPeriodo(10_000, 0.0534, 1.02, 21) > renderNoPeriodo(10_000, 0.0534, 1, 21));
});

teste('saldo zero não rende', () => {
  assert.equal(renderNoPeriodo(0, 0.0534, 1, 21), 0);
});

// ── proventos ──────────────────────────────────────────────────────────────

const prov = (comp: string, v: number, origem: 'manual' | 'estimado' = 'manual'): Provento => ({
  id: Math.random(), ativo_id: 1, competencia: comp, valor_por_cota: v,
  data_pagamento: null, tipo: 'rendimento', origem,
});

teste('um pagamento só não vira previsão', () => {
  assert.equal(estimarProximo([prov('2026-07-01', 0.1)]), null);
});

teste('nenhum pagamento não vira previsão', () => {
  assert.equal(estimarProximo([]), null);
});

teste('FII estável: média dos três e mês seguinte', () => {
  const e = estimarProximo([
    prov('2026-05-01', 0.10), prov('2026-06-01', 0.10), prov('2026-07-01', 0.10),
  ])!;
  assert.ok(Math.abs(e.valorPorCota - 0.10) < 1e-9);
  assert.equal(e.competencia, '2026-08-01');
  assert.equal(e.base, 3);
  assert.ok(e.variacao < 0.01, 'série constante tem variação ~0');
});

teste('série irregular acusa variação alta', () => {
  const e = estimarProximo([
    prov('2026-05-01', 0.02), prov('2026-06-01', 0.90), prov('2026-07-01', 0.15),
  ])!;
  assert.ok(e.variacao > 0.25, `variação ${e.variacao.toFixed(2)} deveria disparar o aviso`);
});

teste('estimativa anterior NÃO entra na média seguinte', () => {
  // Se entrasse, o erro se realimentaria e em alguns meses o número não teria
  // mais relação com o que o fundo pagou.
  const e = estimarProximo([
    prov('2026-07-01', 9.99, 'estimado'), prov('2026-06-01', 0.10), prov('2026-05-01', 0.10),
  ])!;
  assert.ok(Math.abs(e.valorPorCota - 0.10) < 1e-9, `contaminou: ${e.valorPorCota}`);
  assert.equal(e.base, 2);
});

teste('ordem de entrada não importa', () => {
  const a = estimarProximo([prov('2026-05-01', 0.1), prov('2026-07-01', 0.2), prov('2026-06-01', 0.3)])!;
  assert.equal(a.competencia, '2026-08-01');
});

teste('estimativa nunca aponta para um mês que já passou', () => {
  // Bug real: com o último registro em abril e hoje em agosto, `mesSeguinte`
  // devolvia maio — a tela dizia "estimativa para maio/2026" no meio de agosto.
  const e = estimarProximo(
    [prov('2026-03-01', 0.10), prov('2026-04-01', 0.12)], new Date(2026, 7, 4),
  )!;
  assert.equal(e.competencia, '2026-08-01');
});

teste('com histórico em dia, a estimativa é do mês seguinte', () => {
  const e = estimarProximo(
    [prov('2026-07-01', 0.10), prov('2026-08-01', 0.12)], new Date(2026, 7, 4),
  )!;
  assert.equal(e.competencia, '2026-09-01');
});

teste('mesSeguinte vira o ano', () => {
  assert.equal(mesSeguinte('2026-12-01'), '2027-01-01');
  assert.equal(mesSeguinte('2026-01-01'), '2026-02-01');
});

teste('palpite de tipo pelo sufixo', () => {
  assert.equal(palpitarTipo('MXRF11'), 'fii');
  assert.equal(palpitarTipo('PETR4'), 'acao');
  assert.equal(palpitarTipo('BOVA11'), 'etf');
  assert.equal(palpitarTipo('ROXO34'), 'bdr');
});

// ── saída ──────────────────────────────────────────────────────────────────

console.log(`\n${passou} passou · ${falhas.length} falhou`);
if (falhas.length > 0) {
  console.log('\n── falhas ──');
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}
