/**
 * Testes de `calc.ts`.
 *
 *   npx tsx src/app/investimentos/lib/calc.test.ts
 *
 * Mesmo estilo de harness do `scripts/verificar-calculos.mts`: o projeto não
 * tem runner de teste, e um arquivo que roda com `tsx` não exige tocar no
 * package.json — regra de isolamento desta fase.
 *
 * Cobre as três contas em que um erro não vira exceção, vira um número
 * plausível e errado: posição, rendimento medido e projeção.
 */
import assert from 'node:assert/strict';
import {
  CENARIOS, baseProjecao, posicaoAtivo, posicoes, projetar, proximaCompetencia,
  rendimentos, resumoGeral, resumoRentabilidade, rotuloCompetencia,
  sequenciaCompetencias, slug, taxaRendaFixaMes,
} from './calc';
import type { Ativo, Lancamento, Premissas } from './types';

let passou = 0;
const falhas: string[] = [];
function teste(nome: string, f: () => void) {
  try { f(); passou++; }
  catch (e) { falhas.push(`${nome}\n    ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`); }
}
const perto = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `esperava ~${b}, veio ${a} (dif ${Math.abs(a - b)})`);

const caixinha: Ativo = { id: 'caixinha', nome: 'Caixinha', classe: 'renda_fixa', modo: 'saldo' };
const mxrf: Ativo = { id: 'mxrf11', nome: 'MXRF11', classe: 'fii', modo: 'cotizado' };

const PREM: Premissas = {
  gasto: 1700, liquido2026: 2750, liquido2027: 3360,
  cdi2026: 13.65, cdi2027: 12.30, ir: 20,
  dividendoFii: 1.0, valorizacaoCota: 0.3, retornoAcoes: 1.1,
  decimoTerceiro: {},
};

// ── posição ────────────────────────────────────────────────────────────────

teste('modo saldo usa o saldo digitado', () => {
  perto(posicaoAtivo(caixinha, { aporte: 100, saldo: 2500 }), 2500);
});

teste('modo cotizado multiplica cotas por preço', () => {
  perto(posicaoAtivo(mxrf, { aporte: 100, cotas: 120, preco: 10.42 }), 1250.4);
});

teste('cotizado IGNORA o saldo mesmo se preenchido', () => {
  // Se os dois valessem, o mesmo ativo daria dois números conforme quem
  // perguntasse. O campo saldo pode sobrar de uma troca de modo.
  perto(posicaoAtivo(mxrf, { aporte: 0, cotas: 100, preco: 10, saldo: 99999 }), 1000);
});

teste('ativo sem lançamento no mês vale zero, não NaN', () => {
  perto(posicaoAtivo(caixinha, undefined), 0);
  perto(posicaoAtivo(mxrf, { aporte: 0 }), 0);
});

teste('posições somam por classe e ordenam por competência', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 2000 }, mxrf11: { aporte: 0, cotas: 100, preco: 10 } } },
    { competencia: '2026-09', itens: { caixinha: { aporte: 0, saldo: 1000 }, mxrf11: { aporte: 0, cotas: 50, preco: 10 } } },
  ];
  const s = posicoes([caixinha, mxrf], lancs);
  assert.equal(s.length, 2);
  assert.equal(s[0].competencia, '2026-09', 'entrada fora de ordem tem que ser ordenada');
  perto(s[1].porClasse.renda_fixa, 2000);
  perto(s[1].porClasse.fii, 1000);
  perto(s[1].total, 3000);
});

// ── rendimento medido ──────────────────────────────────────────────────────

teste('rendimento real com aporte no meio do mês', () => {
  // R$ 1.000 iniciais + R$ 1.000 aportados, fechando em R$ 2.050.
  // O rendimento é R$ 50. O percentual NÃO é 5% (base inicial) nem 2,5%
  // (base final): o aporte rendeu metade do mês, então a base é 1.500.
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { caixinha: { aporte: 0, saldo: 1000 } } },
    { competencia: '2026-10', itens: { caixinha: { aporte: 1000, saldo: 2050 } } },
  ];
  const r = rendimentos([caixinha], posicoes([caixinha], lancs));
  assert.equal(r.length, 1, 'o primeiro mês não tem com o que comparar');
  perto(r[0].rendimento, 50);
  perto(r[0].base, 1500);
  perto(r[0].pct, 3.3333333333, 1e-6);
});

teste('sem aporte, a base é o saldo anterior', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { caixinha: { aporte: 0, saldo: 1000 } } },
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 1010 } } },
  ];
  const r = rendimentos([caixinha], posicoes([caixinha], lancs));
  perto(r[0].pct, 1);
});

teste('prejuízo é rendimento negativo, não zero', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { mxrf11: { aporte: 0, cotas: 100, preco: 10 } } },
    { competencia: '2026-10', itens: { mxrf11: { aporte: 0, cotas: 100, preco: 9 } } },
  ];
  const r = rendimentos([mxrf], posicoes([mxrf], lancs));
  perto(r[0].rendimento, -100);
  perto(r[0].pct, -10);
});

teste('aporte que não rendeu nada dá 0%, não divisão por zero', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { caixinha: { aporte: 0, saldo: 0 } } },
    { competencia: '2026-10', itens: { caixinha: { aporte: 500, saldo: 500 } } },
  ];
  const r = rendimentos([caixinha], posicoes([caixinha], lancs));
  perto(r[0].rendimento, 0);
  perto(r[0].pct, 0);
  assert.ok(Number.isFinite(r[0].pct));
});

teste('rendimento por classe consolida os ativos da classe', () => {
  const outro: Ativo = { id: 'tesouro', nome: 'Tesouro', classe: 'renda_fixa', modo: 'saldo' };
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { caixinha: { aporte: 0, saldo: 1000 }, tesouro: { aporte: 0, saldo: 1000 } } },
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 1010 }, tesouro: { aporte: 0, saldo: 1030 } } },
  ];
  const r = rendimentos([caixinha, outro], posicoes([caixinha, outro], lancs));
  perto(r[0].porClasse.renda_fixa!.rendimento, 40);
  perto(r[0].porClasse.renda_fixa!.pct, 2);
});

// ── projeção ───────────────────────────────────────────────────────────────

teste('taxa da renda fixa: CDI anual vira mês e desconta IR', () => {
  // 13,65% a.a. → (1,1365)^(1/12) − 1 = 1,071983% ao mês bruto
  //             → × 0,8 = 0,8575864% líquido
  perto(taxaRendaFixaMes(13.65, 20), 0.008575864, 1e-8);
  perto(taxaRendaFixaMes(13.65, 0), 0.01071983, 1e-8);
});

teste('projeção ancora no mês seguinte ao último fechamento', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { caixinha: { aporte: 0, saldo: 500 } } },
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 1000 } } },
  ];
  const b = baseProjecao(posicoes([caixinha], lancs))!;
  assert.equal(b.inicio, '2026-11', 'tem que continuar a linha, não recomeçar');
  perto(b.renda_fixa, 1000);
});

teste('sem lançamento não há projeção', () => {
  assert.equal(baseProjecao([]), null);
  assert.deepEqual(projetar([], PREM, 'conservador'), []);
});

teste('caso conhecido: R$ 1.000 em RF, conservador, primeiro mês', () => {
  // Conta feita à mão:
  //   mensal líquido = ((1,1365)^(1/12) − 1) × 0,8 = 0,008575864
  //   rende primeiro : 1000 × 1,008575864 = 1.008,575864
  //   aporta depois  : 2750 − 1700 = 1.050
  //   total          : 2.058,575864
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 1000 } } },
  ];
  const p = projetar(posicoes([caixinha], lancs), PREM, 'conservador');

  assert.equal(p.length, 15, 'horizonte de 15 meses');
  assert.equal(p[0].competencia, '2026-11');
  perto(p[0].rendimento, 8.575864, 1e-5);
  perto(p[0].aporte, 1050);
  perto(p[0].total, 2058.575864, 1e-5);
  perto(p[0].aportado, 2050);
  perto(p[0].juros, 8.575864, 1e-5);
  perto(p[0].meses, 2058.575864 / 1700, 1e-8);
});

teste('o aporte só rende a partir do mês seguinte', () => {
  // Se o aporte do mês 1 rendesse já no mês 1, o rendimento do mês 2 seria
  // maior. A ordem (rende, depois aporta) é o que define a curva inteira.
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 1000 } } },
  ];
  const p = projetar(posicoes([caixinha], lancs), PREM, 'conservador');
  perto(p[1].rendimento, 2058.575864 * 0.008575864, 1e-4);
});

teste('cenários dividem o aporte na proporção anunciada', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 0 } } },
  ];
  const serie = posicoes([caixinha], lancs);

  const misto = projetar(serie, PREM, 'misto')[0];
  perto(misto.renda_fixa, 525);   // 50% de 1.050
  perto(misto.fii, 315);          // 30%
  perto(misto.acao, 210);         // 20%
  perto(misto.total, 1050);

  const arrojado = projetar(serie, PREM, 'arrojado')[0];
  perto(arrojado.renda_fixa, 210);
  perto(arrojado.acao, 525);
});

teste('toda alocação de cenário soma 1', () => {
  for (const [nome, c] of Object.entries(CENARIOS)) {
    const soma = c.alocacao.renda_fixa + c.alocacao.fii + c.alocacao.acao;
    perto(soma, 1, 1e-12);
    assert.ok(nome.length > 0);
  }
});

teste('13º entra no aporte só na competência configurada', () => {
  const prem: Premissas = { ...PREM, decimoTerceiro: { '2026-12': 1625 } };
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 0 } } },
  ];
  const p = projetar(posicoes([caixinha], lancs), prem, 'conservador');
  perto(p[0].aporte, 1050);          // nov/26, sem 13º
  perto(p[1].aporte, 1050 + 1625);   // dez/26
  perto(p[2].aporte, 3360 - 1700);   // jan/27 já usa o líquido de 2027
});

teste('virada de ano troca CDI e salário', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-11', itens: { caixinha: { aporte: 0, saldo: 10_000 } } },
  ];
  const p = projetar(posicoes([caixinha], lancs), PREM, 'conservador');
  assert.equal(p[0].competencia, '2026-12');
  assert.equal(p[1].competencia, '2027-01');
  // dez/26 rende ao CDI de 2026 sobre 10.000; jan/27 ao de 2027, que é menor,
  // sobre uma base maior. Comparar as taxas, não os valores.
  perto(p[0].rendimento / 10_000, taxaRendaFixaMes(13.65, 20), 1e-9);
  const baseJan = p[0].total;
  perto(p[1].rendimento / baseJan, taxaRendaFixaMes(12.30, 20), 1e-9);
});

teste('cripto projeta junto com ações', () => {
  const btc: Ativo = { id: 'btc', nome: 'Bitcoin', classe: 'cripto', modo: 'saldo' };
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { btc: { aporte: 0, saldo: 1000 } } },
  ];
  const p = projetar(posicoes([btc], lancs), PREM, 'conservador')[0];
  perto(p.acao, 1000 * 1.011);
});

// ── competências e utilitários ─────────────────────────────────────────────

teste('próxima competência vira o ano', () => {
  assert.equal(proximaCompetencia('2026-12'), '2027-01');
  assert.equal(proximaCompetencia('2026-01'), '2026-02');
  assert.equal(proximaCompetencia('2026-09'), '2026-10');
});

teste('sequência de competências atravessa dezembro', () => {
  assert.deepEqual(sequenciaCompetencias('2026-11', 4), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

teste('rótulo curto para eixo de gráfico', () => {
  assert.equal(rotuloCompetencia('2026-10'), 'out/26');
  assert.equal(rotuloCompetencia('2027-01'), 'jan/27');
});

teste('slug tira acento, espaço e pontuação', () => {
  assert.equal(slug('Caixinha Nubank'), 'caixinha_nubank');
  assert.equal(slug('Ações & Cia.'), 'acoes_cia');
  assert.equal(slug('MXRF11'), 'mxrf11');
});

// ── resumos ────────────────────────────────────────────────────────────────

teste('o saldo inicial não conta como aporte do período', () => {
  // Quem já tinha R$ 1.000 antes de começar a medir não aportou R$ 1.000
  // neste período. Contar o primeiro mês infla o "aportado" e desconta do
  // rendimento na leitura da tela.
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { caixinha: { aporte: 999, saldo: 1000 } } },
    { competencia: '2026-10', itens: { caixinha: { aporte: 500, saldo: 1510 } } },
  ];
  const g = resumoGeral(posicoes([caixinha], lancs), 1700);
  perto(g.aportadoNoPeriodo, 500);
  perto(g.patrimonio, 1510);
});

teste('metas de reserva e quanto falta', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 5100 } } },
  ];
  const g = resumoGeral(posicoes([caixinha], lancs), 1700);
  perto(g.metaSeisMeses, 10_200);
  perto(g.faltaSeisMeses, 5100);
  perto(g.mesesCobertos, 3);
});

teste('meta batida não vira falta negativa', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 30_000 } } },
  ];
  const g = resumoGeral(posicoes([caixinha], lancs), 1700);
  perto(g.faltaSeisMeses, 0);
  perto(g.faltaDozeMeses, 0);
});

teste('média mensal vira equivalente anual composto', () => {
  const lancs: Lancamento[] = [
    { competencia: '2026-09', itens: { caixinha: { aporte: 0, saldo: 1000 } } },
    { competencia: '2026-10', itens: { caixinha: { aporte: 0, saldo: 1010 } } },
  ];
  const serie = posicoes([caixinha], lancs);
  const r = resumoRentabilidade(serie, rendimentos([caixinha], serie));
  perto(r.mediaMensalPct, 1);
  perto(r.equivalenteAnualPct, (Math.pow(1.01, 12) - 1) * 100, 1e-9);
  perto(r.acumulado, 10);
  assert.equal(r.mesesMedidos, 1);
});

teste('base vazia não quebra os resumos', () => {
  const g = resumoGeral([], 1700);
  perto(g.patrimonio, 0);
  perto(g.mesesCobertos, 0);
  const r = resumoRentabilidade([], []);
  perto(r.mediaMensalPct, 0);
  perto(r.pctDoPatrimonio, 0);
});

teste('gasto zero não vira divisão por zero', () => {
  const g = resumoGeral([], 0);
  assert.ok(Number.isFinite(g.mesesCobertos));
});

// ── saída ──────────────────────────────────────────────────────────────────

console.log(`${passou} passou · ${falhas.length} falhou`);
if (falhas.length) {
  console.log('── falhas ──');
  for (const f of falhas) console.log('  ✗ ' + f);
  process.exit(1);
}
