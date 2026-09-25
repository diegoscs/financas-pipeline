/**
 * Testes do simulador de metas.
 *
 *   npx tsx src/app/investimentos/lib/simulador.test.ts
 *
 * As três contas se resolvem da mesma fórmula, isolada em variáveis
 * diferentes. O teste que importa é o de consistência: o aporte que o
 * simulador diz ser necessário tem que, de fato, chegar na meta no prazo.
 * Erro de sinal ou de divisão passa despercebido em qualquer conta isolada.
 */
import assert from 'node:assert/strict';
import {
  MAX_MESES, analisarMeta, aporteParaMeta, mesesParaMeta, prazoLegivel,
  serieProjetada, taxaAnualDeMensal, taxaMensalDeAnual, valorFuturo,
} from './simulador';

let passou = 0;
const falhas: string[] = [];
function teste(nome: string, f: () => void) {
  try { f(); passou++; }
  catch (e) { falhas.push(`${nome}\n    ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`); }
}
const perto = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `esperava ~${b}, veio ${a} (dif ${Math.abs(a - b)})`);

// 12% ao ano ≈ 0,948879% ao mês composto
const I_12AA = taxaMensalDeAnual(12);

// ── conversão de taxa ──────────────────────────────────────────────────────

teste('anual vira mensal composto, não dividido por 12', () => {
  // 12/12 = 1% seria juro simples. O composto é menor: 0,9489%.
  perto(I_12AA, 0.00948879, 1e-8);
  assert.ok(I_12AA < 0.01, 'composto tem que ser menor que a divisão simples');
});

teste('a conversão ida e volta fecha', () => {
  perto(taxaAnualDeMensal(taxaMensalDeAnual(13.65)), 13.65, 1e-9);
  perto(taxaAnualDeMensal(taxaMensalDeAnual(0)), 0, 1e-12);
});

// ── valor futuro ───────────────────────────────────────────────────────────

teste('sem juros, é só somar os aportes', () => {
  // Sem o caso separado, a fórmula geral dividiria por zero e daria NaN.
  perto(valorFuturo({ inicial: 1000, aporte: 500, taxaMensal: 0 }, 12), 1000 + 6000);
});

teste('sem aporte, é só o montante rendendo', () => {
  const v = valorFuturo({ inicial: 1000, aporte: 0, taxaMensal: I_12AA }, 12);
  perto(v, 1120, 1e-6);   // 12% ao ano sobre 1.000
});

teste('mês zero é o próprio patrimônio de hoje', () => {
  perto(valorFuturo({ inicial: 777, aporte: 500, taxaMensal: I_12AA }, 0), 777);
  perto(valorFuturo({ inicial: 777, aporte: 500, taxaMensal: I_12AA }, -3), 777);
});

teste('caso conhecido: R$ 1.000 no mês 1', () => {
  // 1.000 × 1,00948879 = 1.009,48879, mais o aporte de 500 que entra no fim
  // do mês e ainda não rendeu.
  perto(valorFuturo({ inicial: 1000, aporte: 500, taxaMensal: I_12AA }, 1), 1509.48879, 1e-5);
});

teste('o aporte entra no fim do mês, não no começo', () => {
  // Se entrasse no começo, o primeiro aporte já renderia e o total do mês 1
  // seria 1.514,23. A diferença é a convenção, e ela é deliberada.
  const fim = valorFuturo({ inicial: 1000, aporte: 500, taxaMensal: I_12AA }, 1);
  const comeco = (1000 + 500) * (1 + I_12AA);
  assert.ok(fim < comeco, 'a convenção de fim de mês é a mais conservadora');
});

// ── série ──────────────────────────────────────────────────────────────────

teste('a série começa em hoje e tem n+1 pontos', () => {
  const s = serieProjetada({ inicial: 1000, aporte: 100, taxaMensal: I_12AA }, 12);
  assert.equal(s.length, 13, 'mês 0 mais doze meses');
  assert.equal(s[0].mes, 0);
  perto(s[0].total, 1000);
  perto(s[0].juros, 0, 1e-9);
});

teste('aportado ignora o rendimento; juros é a diferença', () => {
  const s = serieProjetada({ inicial: 1000, aporte: 100, taxaMensal: I_12AA }, 6);
  const u = s[6];
  perto(u.aportado, 1000 + 600);
  perto(u.juros, u.total - u.aportado, 1e-9);
  assert.ok(u.juros > 0, 'com juro positivo, a diferença tem que ser positiva');
});

teste('sem juros, o gráfico é uma reta e não há juros', () => {
  const s = serieProjetada({ inicial: 0, aporte: 100, taxaMensal: 0 }, 3);
  assert.deepEqual(s.map((p) => p.total), [0, 100, 200, 300]);
  for (const p of s) perto(p.juros, 0, 1e-12);
});

teste('a série respeita o teto de 100 anos', () => {
  const s = serieProjetada({ inicial: 1, aporte: 1, taxaMensal: 0 }, 99_999);
  assert.equal(s.length, MAX_MESES + 1);
});

teste('EMPILHÁVEL: aportado + juros dá exatamente o total', () => {
  // O gráfico "de onde vem" empilha as duas faixas e a altura somada tem que
  // ser a mesma linha da visão "quanto chega". Se as definições divergirem,
  // o gráfico mostra um total que não existe — e sem erro nenhum.
  for (const taxa of [0, I_12AA, taxaMensalDeAnual(30)]) {
    const s = serieProjetada({ inicial: 5000, aporte: 1000, taxaMensal: taxa }, 60);
    for (const p of s) perto(p.aportado + p.juros, p.total, 1e-9);
  }
});

teste('o juro acumulado passa o aporte em prazo longo', () => {
  // É o que a visão de composição existe para mostrar. A 12% ao ano, com
  // aporte de 1.000 sobre 5.000 iniciais, a virada existe dentro de 100 anos.
  const s = serieProjetada({ inicial: 5000, aporte: 1000, taxaMensal: I_12AA }, 600);
  const virada = s.find((p) => p.juros > p.aportado);
  assert.ok(virada, 'deveria haver um mês em que o dinheiro trabalha mais que você');
  assert.ok(virada!.mes > 12, `virada cedo demais (${virada!.mes}) sugere erro de conta`);
});

teste('sem juros, a faixa de rendimento é sempre zero', () => {
  const s = serieProjetada({ inicial: 5000, aporte: 1000, taxaMensal: 0 }, 60);
  for (const p of s) perto(p.juros, 0, 1e-9);
  assert.equal(s.find((p) => p.juros > p.aportado), undefined, 'sem juro não há virada');
});

// ── quando chego ───────────────────────────────────────────────────────────

teste('meta já batida é zero mês, não erro', () => {
  assert.equal(mesesParaMeta({ inicial: 20_000, aporte: 500, taxaMensal: I_12AA }, 10_000), 0);
});

teste('sem juros, é divisão pura arredondada para cima', () => {
  // 10.000 faltando, 500 por mês = 20 meses cravados.
  assert.equal(mesesParaMeta({ inicial: 0, aporte: 500, taxaMensal: 0 }, 10_000), 20);
  // 10.001 exige o mês 21: no 20 ainda falta R$ 1.
  assert.equal(mesesParaMeta({ inicial: 0, aporte: 500, taxaMensal: 0 }, 10_001), 21);
});

teste('sem aporte e sem juros, nunca chega', () => {
  assert.equal(mesesParaMeta({ inicial: 100, aporte: 0, taxaMensal: 0 }, 10_000), null);
});

teste('sem aporte mas com juros, chega — só demora', () => {
  const n = mesesParaMeta({ inicial: 1000, aporte: 0, taxaMensal: I_12AA }, 2000);
  assert.ok(n !== null && n > 0);
  // Dobrar a 12% ao ano leva ~73 meses.
  assert.ok(n! >= 72 && n! <= 74, `veio ${n}`);
});

teste('resgate que come o rendimento nunca chega', () => {
  // Tira 200 por mês de um patrimônio que rende ~9,50. O saldo só encolhe;
  // não existe n que resolva.
  assert.equal(mesesParaMeta({ inicial: 1000, aporte: -200, taxaMensal: I_12AA }, 5000), null);
});

teste('meta longe demais devolve null, não um número inútil', () => {
  // Chegaria, mas no ano 2200. "Chega em 2.400 meses" tem cara de resposta.
  assert.equal(mesesParaMeta({ inicial: 0, aporte: 1, taxaMensal: 0 }, 1_000_000), null);
});

teste('o mês devolvido realmente alcança a meta', () => {
  // A verificação que pega erro de arredondamento: no mês anterior falta,
  // no mês devolvido não falta mais.
  const c = { inicial: 3000, aporte: 700, taxaMensal: I_12AA };
  const meta = 25_000;
  const n = mesesParaMeta(c, meta)!;
  assert.ok(valorFuturo(c, n) >= meta, `no mês ${n} ainda falta`);
  assert.ok(valorFuturo(c, n - 1) < meta, `já tinha chegado no mês ${n - 1}`);
});

// ── quanto preciso aportar ─────────────────────────────────────────────────

teste('sem juros, divide o que falta pelo prazo', () => {
  perto(aporteParaMeta({ inicial: 2000, meta: 14_000, meses: 24, taxaMensal: 0 })!, 500);
});

teste('com juros, exige menos que a divisão simples', () => {
  const semJuros = aporteParaMeta({ inicial: 2000, meta: 14_000, meses: 24, taxaMensal: 0 })!;
  const comJuros = aporteParaMeta({ inicial: 2000, meta: 14_000, meses: 24, taxaMensal: I_12AA })!;
  assert.ok(comJuros < semJuros, 'o rendimento tem que aliviar o aporte');
});

teste('se o patrimônio sozinho já chega, o aporte é zero e não negativo', () => {
  // Sem o piso em zero, sairia um número negativo sugerindo que dá para
  // sacar todo mês — resposta certa para outra pergunta.
  const a = aporteParaMeta({ inicial: 10_000, meta: 10_500, meses: 24, taxaMensal: I_12AA });
  assert.equal(a, 0);
});

teste('meta já batida pede zero de aporte', () => {
  assert.equal(aporteParaMeta({ inicial: 20_000, meta: 10_000, meses: 12, taxaMensal: I_12AA }), 0);
});

teste('prazo zero não tem resposta', () => {
  assert.equal(aporteParaMeta({ inicial: 0, meta: 1000, meses: 0, taxaMensal: I_12AA }), null);
});

teste('CONSISTÊNCIA: o aporte calculado chega na meta no prazo', () => {
  // O teste que amarra as três contas. Erro de sinal ou de divisão passa
  // despercebido em qualquer uma isolada, mas quebra aqui.
  for (const taxa of [0, I_12AA, taxaMensalDeAnual(30)]) {
    for (const meses of [1, 6, 24, 120]) {
      const inicial = 3500;
      const meta = 100_000;
      const a = aporteParaMeta({ inicial, meta, meses, taxaMensal: taxa })!;
      const chegou = valorFuturo({ inicial, aporte: a, taxaMensal: taxa }, meses);
      perto(chegou, meta, 1e-6);
    }
  }
});

// ── análise conjunta ───────────────────────────────────────────────────────

teste('a análise responde as duas perguntas de uma vez', () => {
  const r = analisarMeta({
    inicial: 5000, meta: 50_000, prazoMeses: 36, aporte: 1000, taxaMensal: I_12AA,
  });
  assert.equal(r.jaChegou, false);
  assert.ok(r.mesesComAporteAtual !== null);
  assert.ok(r.aporteNecessario !== null);
  perto(r.ajusteNoAporte!, r.aporteNecessario! - 1000, 1e-9);
  perto(r.totalNoPrazo, valorFuturo({ inicial: 5000, aporte: 1000, taxaMensal: I_12AA }, 36), 1e-9);
});

teste('aporte que já basta dá ajuste negativo — sobra, não falta', () => {
  const r = analisarMeta({
    inicial: 5000, meta: 20_000, prazoMeses: 36, aporte: 1000, taxaMensal: I_12AA,
  });
  assert.ok(r.ajusteNoAporte! < 0, 'aportando demais, o ajuste é para baixo');
  assert.ok(r.mesesComAporteAtual! < 36, 'e chega antes do prazo');
});

teste('meta já batida se reconhece', () => {
  const r = analisarMeta({
    inicial: 60_000, meta: 50_000, prazoMeses: 36, aporte: 1000, taxaMensal: I_12AA,
  });
  assert.equal(r.jaChegou, true);
  assert.equal(r.mesesComAporteAtual, 0);
  assert.equal(r.aporteNecessario, 0);
});

// ── prazo legível ──────────────────────────────────────────────────────────

teste('prazo vira anos e meses', () => {
  assert.equal(prazoLegivel(0), 'agora');
  assert.equal(prazoLegivel(1), '1 mês');
  assert.equal(prazoLegivel(11), '11 meses');
  assert.equal(prazoLegivel(12), '1 ano');
  assert.equal(prazoLegivel(18), '1 ano e 6 meses');
  assert.equal(prazoLegivel(24), '2 anos');
  assert.equal(prazoLegivel(25), '2 anos e 1 mês');
});

// ── saída ──────────────────────────────────────────────────────────────────

console.log(`${passou} passou · ${falhas.length} falhou`);
if (falhas.length) {
  console.log('── falhas ──');
  for (const f of falhas) console.log('  ✗ ' + f);
  process.exit(1);
}
