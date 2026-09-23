'use client';

/**
 * Projeção.
 *
 * Quinze meses a partir do último fechamento lançado — nunca de um valor
 * fixo: a linha tem que continuar o realizado, não começar de outro patamar.
 *
 * Três cenários mudam só a ALOCAÇÃO dos aportes futuros, não o quanto se
 * aporta. O aporte é o mesmo nos três: líquido menos custo de vida.
 */
import { useMemo, useState } from 'react';
import { CENARIOS, projetar, rotuloCompetencia } from '../lib/calc';
import { dinheiro, eixoDinheiro, meses, numero } from '../lib/formato';
import type { InvestState, NomeCenario, Posicao } from '../lib/types';
import type { ResumoGeral } from '../lib/calc';
import css from '../investimentos.module.css';
import { Linha } from './charts/Linha';
import { CORES } from './charts/base';
import { Cartao, Kpi, Kpis, Seletor, Tabela, Vazio } from './ui';

const ORDEM: NomeCenario[] = ['conservador', 'misto', 'arrojado'];
const COR_CENARIO: Record<NomeCenario, string> = {
  conservador: CORES[3], misto: CORES[0], arrojado: CORES[2],
};

export function Projecao({ estado, posicoes, geral }: {
  estado: InvestState;
  posicoes: Posicao[];
  geral: ResumoGeral;
}) {
  const [cenario, setCenario] = useState<NomeCenario>('conservador');

  const sims = useMemo(() => {
    const out = {} as Record<NomeCenario, ReturnType<typeof projetar>>;
    for (const c of ORDEM) out[c] = projetar(posicoes, estado.premissas, c);
    return out;
  }, [posicoes, estado.premissas]);

  const serie = useMemo(() => sims.conservador.map((_, i) => {
    const linha: Record<string, unknown> = { rotulo: rotuloCompetencia(sims.conservador[i].competencia) };
    for (const c of ORDEM) linha[c] = sims[c][i]?.total ?? null;
    linha.meta6 = geral.metaSeisMeses;
    linha.meta12 = geral.metaDozeMeses;
    return linha;
  }), [sims, geral.metaSeisMeses, geral.metaDozeMeses]);

  const serieMeses = useMemo(() => sims.conservador.map((_, i) => {
    const linha: Record<string, unknown> = { rotulo: rotuloCompetencia(sims.conservador[i].competencia) };
    for (const c of ORDEM) linha[c] = sims[c][i]?.meses ?? null;
    linha.seis = 6;
    linha.doze = 12;
    return linha;
  }), [sims]);

  if (posicoes.length === 0) {
    return (
      <Cartao>
        <Vazio>
          A projeção ancora no último fechamento.<br />
          Lance pelo menos <strong>um mês</strong> para ela ter de onde partir.
        </Vazio>
      </Cartao>
    );
  }

  const escolhido = sims[cenario];
  const ultimo = escolhido[escolhido.length - 1];
  const bateSeis = escolhido.find((m) => m.total >= geral.metaSeisMeses);
  const bateDoze = escolhido.find((m) => m.total >= geral.metaDozeMeses);

  return (
    <>
      <Seletor<NomeCenario>
        valor={cenario} onEscolher={setCenario}
        opcoes={ORDEM.map((c) => ({ id: c, rotulo: CENARIOS[c].nome }))}
      />

      <Kpis>
        <Kpi rotulo="Em dez/27" valor={dinheiro(ultimo.total)} dica={CENARIOS[cenario].nome} />
        <Kpi rotulo="Custo coberto ao fim" valor={meses(ultimo.meses)}
             dica={`a ${dinheiro(estado.premissas.gasto)}/mês`} />
        <Kpi rotulo="Chega aos 6 meses" valor={bateSeis ? bateSeis.competencia : 'depois do período'}
             dica={dinheiro(geral.metaSeisMeses)} />
        <Kpi rotulo="Chega aos 12 meses" valor={bateDoze ? bateDoze.competencia : 'depois do período'}
             dica={dinheiro(geral.metaDozeMeses)} />
      </Kpis>

      <Cartao titulo="Patrimônio projetado" sub="O cenário selecionado aparece com traço mais grosso.">
        <Linha
          alto dados={serie} formatar={dinheiro} formatarEixo={eixoDinheiro}
          series={[
            ...ORDEM.map((c) => ({
              chave: c, nome: CENARIOS[c].nome, cor: COR_CENARIO[c],
              grossura: c === cenario ? 3 : 1.5,
            })),
            { chave: 'meta6', nome: 'Meta 6 meses', cor: CORES[4], tracejada: true, grossura: 1.5 },
            { chave: 'meta12', nome: 'Meta 12 meses', cor: CORES[1], tracejada: true, grossura: 1.5 },
          ]}
        />
      </Cartao>

      <Cartao titulo="Meses de custo cobertos"
              sub="O mesmo patrimônio, medido em tempo de vida em vez de reais.">
        <Linha
          dados={serieMeses}
          formatar={(v) => `${numero(v, 1)} meses`}
          formatarEixo={(v) => `${v.toFixed(0)}m`}
          series={[
            ...ORDEM.map((c) => ({
              chave: c, nome: CENARIOS[c].nome, cor: COR_CENARIO[c],
              grossura: c === cenario ? 3 : 1.5,
            })),
            { chave: 'seis', nome: '6 meses', cor: CORES[4], tracejada: true, grossura: 1.5 },
            { chave: 'doze', nome: '12 meses', cor: CORES[1], tracejada: true, grossura: 1.5 },
          ]}
        />
      </Cartao>

      <Cartao titulo="Mês a mês" sub="Linhas destacadas são as competências em que uma meta é atingida.">
        <Tabela>
          <thead>
            <tr>
              <th>Competência</th><th>Aporte</th><th>Rendimento</th>
              <th>Renda fixa</th><th>FII</th><th>Ações</th>
              <th>Total</th><th>Juros</th><th>Meses</th>
            </tr>
          </thead>
          <tbody>
            {escolhido.map((m) => {
              const meta = (bateSeis && m.competencia === bateSeis.competencia)
                || (bateDoze && m.competencia === bateDoze.competencia);
              return (
                <tr key={m.competencia} className={meta ? css.linhaMeta : undefined}>
                  <td>{m.competencia}</td>
                  <td>{dinheiro(m.aporte)}</td>
                  <td>{dinheiro(m.rendimento)}</td>
                  <td>{dinheiro(m.renda_fixa)}</td>
                  <td>{dinheiro(m.fii)}</td>
                  <td>{dinheiro(m.acao)}</td>
                  <td><strong>{dinheiro(m.total)}</strong></td>
                  <td>{dinheiro(m.juros)}</td>
                  <td>{numero(m.meses, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </Tabela>
        <p className={css.nota}>
          Dentro de cada mês o saldo rende primeiro e o aporte entra depois — o dinheiro aportado
          só começa a render no mês seguinte. É mais conservador que a conta do rendimento medido,
          que assume aporte no meio do mês, e a diferença é proposital: projeção é aposta.
          Cripto projeta junto com ações.
        </p>
      </Cartao>
    </>
  );
}
