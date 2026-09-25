/**
 * Testes de `calc.ts` e da validação de `storage.ts`.
 *
 *   npx tsx src/app/investimentos/lib/calc.test.ts
 *
 * O que está em jogo aqui é não anunciar crescimento que não houve. A série
 * tem duas origens — snapshots de contas (sem bolsa) e carimbos do total —, e
 * comparar uma com a outra mediria a bolsa entrando no gráfico, não dinheiro
 * novo.
 */
import assert from 'node:assert/strict';
import {
  competenciaDe, proximaCompetencia, resumoEvolucao, rotuloCompetencia,
  sequenciaCompetencias, serieEvolucao,
} from './calc';
import { comCarimbo, estadoVazio, normalizar } from './storage';
import type { PontoPatrimonio } from './types';

let passou = 0;
const falhas: string[] = [];
function teste(nome: string, f: () => void) {
  try { f(); passou++; }
  catch (e) { falhas.push(`${nome}\n    ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`); }
}

const carimbo = (competencia: string, reservas: number, bolsa: number): PontoPatrimonio =>
  ({ competencia, reservas, bolsa, total: reservas + bolsa });

// ── competências ───────────────────────────────────────────────────────────

teste('próxima competência vira o ano', () => {
  assert.equal(proximaCompetencia('2026-12'), '2027-01');
  assert.equal(proximaCompetencia('2026-01'), '2026-02');
});

teste('sequência atravessa dezembro', () => {
  assert.deepEqual(sequenciaCompetencias('2026-11', 4), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

teste('rótulo curto para eixo', () => {
  assert.equal(rotuloCompetencia('2026-10'), 'out/26');
  assert.equal(rotuloCompetencia('2027-01'), 'jan/27');
});

teste('competência de uma data, sem passar por fuso', () => {
  assert.equal(competenciaDe(new Date(2026, 0, 31)), '2026-01');
  assert.equal(competenciaDe(new Date(2026, 11, 1)), '2026-12');
});

// ── série de evolução ──────────────────────────────────────────────────────

teste('só snapshots de conta: série parcial, marcada como tal', () => {
  const s = serieEvolucao([
    { competencia: '2026-07', total: 1000 },
    { competencia: '2026-08', total: 1200 },
  ], []);
  assert.equal(s.length, 2);
  assert.equal(s[0].completo, false);
  assert.equal(s[0].bolsa, 0);
  assert.equal(s[1].total, 1200);
});

teste('o carimbo manda onde existe — é o único que conhece a bolsa', () => {
  const s = serieEvolucao(
    [{ competencia: '2026-08', total: 1200 }],
    [carimbo('2026-08', 1200, 800)],
  );
  assert.equal(s.length, 1);
  assert.equal(s[0].total, 2000);
  assert.equal(s[0].bolsa, 800);
  assert.equal(s[0].completo, true);
});

teste('meses sem carimbo convivem com meses carimbados', () => {
  const s = serieEvolucao(
    [{ competencia: '2026-07', total: 1000 }, { competencia: '2026-08', total: 1200 }],
    [carimbo('2026-09', 1300, 700)],
  );
  assert.deepEqual(s.map((p) => p.competencia), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(s.map((p) => p.completo), [false, false, true]);
});

teste('a série sai ordenada mesmo com entrada bagunçada', () => {
  const s = serieEvolucao(
    [{ competencia: '2026-12', total: 1 }, { competencia: '2026-07', total: 2 }],
    [carimbo('2026-09', 1, 1)],
  );
  assert.deepEqual(s.map((p) => p.competencia), ['2026-07', '2026-09', '2026-12']);
});

teste('nada lançado é série vazia, não erro', () => {
  assert.deepEqual(serieEvolucao([], []), []);
});

// ── resumo ─────────────────────────────────────────────────────────────────

teste('variação compara com o mês anterior', () => {
  const s = serieEvolucao([], [carimbo('2026-08', 1000, 0), carimbo('2026-09', 1100, 0)]);
  const r = resumoEvolucao(s);
  assert.equal(r.atual, 1100);
  assert.equal(r.variacao, 100);
  assert.ok(Math.abs(r.variacaoPct! - 10) < 1e-9);
});

teste('NÃO compara mês parcial com mês completo', () => {
  // O mês de agosto só tem contas; setembro tem carimbo com bolsa. A
  // diferença de 800 é a bolsa entrando na série, não dinheiro novo —
  // anunciá-la como crescimento seria mentira.
  const s = serieEvolucao(
    [{ competencia: '2026-08', total: 1200 }],
    [carimbo('2026-09', 1200, 800)],
  );
  const r = resumoEvolucao(s);
  assert.equal(r.atual, 2000);
  assert.equal(r.variacao, null, 'sem base comparável, a variação tem que ser nula');
  assert.equal(r.variacaoPct, null);
  assert.equal(r.crescimento, null);
});

teste('um mês só não tem com o que comparar', () => {
  const r = resumoEvolucao(serieEvolucao([], [carimbo('2026-09', 1000, 0)]));
  assert.equal(r.anterior, null);
  assert.equal(r.variacao, null);
  assert.equal(r.meses, 1);
});

teste('série vazia devolve zeros, não NaN', () => {
  const r = resumoEvolucao([]);
  assert.equal(r.atual, 0);
  assert.equal(r.variacao, null);
  assert.ok(Number.isFinite(r.atual));
});

teste('base zero não vira divisão por zero no percentual', () => {
  const s = serieEvolucao([], [carimbo('2026-08', 0, 0), carimbo('2026-09', 500, 0)]);
  const r = resumoEvolucao(s);
  assert.equal(r.variacao, 500);
  assert.equal(r.variacaoPct, null, 'sem base, não existe percentual');
});

// ── carimbo ────────────────────────────────────────────────────────────────

teste('carimbar duas vezes no mesmo mês não cria dois pontos', () => {
  // Visitar a tela três vezes em setembro não pode virar três pontos no
  // gráfico. O último valor do mês é o que vale.
  let e = estadoVazio();
  e = comCarimbo(e, carimbo('2026-09', 1000, 0));
  e = comCarimbo(e, carimbo('2026-09', 1500, 200));
  assert.equal(e.historico.length, 1);
  assert.equal(e.historico[0].total, 1700);
});

teste('carimbos saem ordenados', () => {
  let e = estadoVazio();
  e = comCarimbo(e, carimbo('2026-12', 1, 0));
  e = comCarimbo(e, carimbo('2026-07', 2, 0));
  assert.deepEqual(e.historico.map((p) => p.competencia), ['2026-07', '2026-12']);
});

// ── validação do estado ────────────────────────────────────────────────────

teste('lixo no lugar do estado vira estado vazio', () => {
  for (const entrada of [null, undefined, 42, 'texto', [], true]) {
    const s = normalizar(entrada);
    assert.deepEqual(s.historico, []);
    assert.deepEqual(s.metas, []);
    assert.equal(s.rendimentoAnual, null);
  }
});

teste('competência inválida no histórico é descartada', () => {
  const s = normalizar({ historico: [
    { competencia: '2026-13', total: 1 },
    { competencia: 'setembro', total: 1 },
    { competencia: '2026-09', reservas: 10, bolsa: 5, total: 15 },
  ] });
  assert.equal(s.historico.length, 1);
  assert.equal(s.historico[0].total, 15);
});

teste('total ausente cai na soma das partes', () => {
  const s = normalizar({ historico: [{ competencia: '2026-09', reservas: 10, bolsa: 5 }] });
  assert.equal(s.historico[0].total, 15);
});

teste('meta sem id é descartada; id repetido também', () => {
  const s = normalizar({ metas: [
    { id: '', nome: 'sem id', valor: 1 },
    { id: 'a', nome: 'boa', valor: 1000, prazoMeses: 24, aporte: 50 },
    { id: 'a', nome: 'repetida', valor: 9 },
  ] });
  assert.equal(s.metas.length, 1);
  assert.equal(s.metas[0].nome, 'boa');
});

teste('prazo de meta nunca é zero — não simula nada', () => {
  const s = normalizar({ metas: [{ id: 'a', valor: 1000, prazoMeses: 0, aporte: 0 }] });
  assert.equal(s.metas[0].prazoMeses, 1);
  assert.equal(s.metas[0].nome, 'Meta', 'meta sem nome ganha um');
});

teste('rendimento só aceita número; o resto vira "usar o CDI"', () => {
  assert.equal(normalizar({ rendimentoAnual: 15 }).rendimentoAnual, 15);
  assert.equal(normalizar({ rendimentoAnual: 'muito' }).rendimentoAnual, null);
  assert.equal(normalizar({ rendimentoAnual: NaN }).rendimentoAnual, null);
  assert.equal(normalizar({}).rendimentoAnual, null);
});

// ── saída ──────────────────────────────────────────────────────────────────

console.log(`${passou} passou · ${falhas.length} falhou`);
if (falhas.length) {
  console.log('── falhas ──');
  for (const f of falhas) console.log('  ✗ ' + f);
  process.exit(1);
}
