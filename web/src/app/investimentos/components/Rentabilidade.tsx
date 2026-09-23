'use client';

/**
 * Rentabilidade.
 *
 * Tudo aqui é MEDIDO: diferença entre fechamentos, menos o que foi aportado.
 * Nenhum número desta aba vem de premissa — é a única aba que continua certa
 * mesmo que o CDI da projeção esteja errado.
 */
import { Fragment, useMemo } from 'react';
import { CLASSES, rotuloCompetencia } from '../lib/calc';
import type { ResumoRentabilidade } from '../lib/calc';
import { dinheiro, eixoDinheiro, pct, pctSinal } from '../lib/formato';
import type { Classe, InvestState, Posicao, Rendimento } from '../lib/types';
import css from '../investimentos.module.css';
import { BarrasEmpilhadas } from './charts/BarrasEmpilhadas';
import { Linha } from './charts/Linha';
import { CORES } from './charts/base';
import { Cartao, Kpi, Kpis, Sinal, Tabela, Vazio } from './ui';

export function Rentabilidade({ estado, posicoes, rendimentos, resumo }: {
  estado: InvestState;
  posicoes: Posicao[];
  rendimentos: Rendimento[];
  resumo: ResumoRentabilidade;
}) {
  const classesUsadas = useMemo(() => {
    const ids = new Set(estado.ativos.map((a) => a.classe));
    return CLASSES.filter((c) => ids.has(c.id));
  }, [estado.ativos]);

  /** Aportado e rendimento, ambos acumulados, para empilhar. */
  const acumulado = useMemo(() => {
    if (posicoes.length === 0) return [];
    let aportado = posicoes[0].total;   // o saldo de partida é base, não aporte
    let rendido = 0;

    return posicoes.map((p, i) => {
      if (i > 0) {
        aportado += p.aporte;
        rendido += rendimentos[i - 1]?.rendimento ?? 0;
      }
      return { rotulo: rotuloCompetencia(p.competencia), aportado, rendido };
    });
  }, [posicoes, rendimentos]);

  const porClasse = useMemo(() => rendimentos.map((r) => {
    const linha: Record<string, unknown> = { rotulo: rotuloCompetencia(r.competencia) };
    for (const c of classesUsadas) {
      const v = r.porClasse[c.id as Classe];
      // Classe sem base no mês não rende 0% — não rende nada. Plotar zero
      // puxaria a linha para baixo como se tivesse ficado parada.
      linha[c.id] = v && v.base > 0 ? v.pct : null;
    }
    linha.carteira = r.pct;
    return linha;
  }), [rendimentos, classesUsadas]);

  if (rendimentos.length === 0) {
    return (
      <Cartao>
        <Vazio>
          Rendimento precisa de <strong>dois fechamentos</strong> para existir.<br />
          Com um mês só não há com o que comparar.
        </Vazio>
      </Cartao>
    );
  }

  return (
    <>
      <Kpis>
        <Kpi rotulo="Rendimento acumulado" valor={dinheiro(resumo.acumulado)}
             dica={`${resumo.mesesMedidos} mês(es) medido(s)`} />
        <Kpi rotulo="Média mensal" valor={pct(resumo.mediaMensalPct)} dica="sobre o saldo médio" />
        <Kpi rotulo="Equivalente ao ano" valor={pct(resumo.equivalenteAnualPct, 1)}
             dica="se o ritmo se mantiver" />
        <Kpi rotulo="% do patrimônio" valor={pct(resumo.pctDoPatrimonio, 1)}
             dica="veio de rendimento, não de aporte" />
      </Kpis>

      <Cartao titulo="Aportado × rendimento"
              sub="Quanto do patrimônio saiu do bolso e quanto o próprio dinheiro produziu.">
        <BarrasEmpilhadas
          dados={acumulado} formatar={dinheiro} formatarEixo={eixoDinheiro}
          series={[
            { chave: 'aportado', nome: 'Aportado', cor: CORES[3] },
            { chave: 'rendido', nome: 'Rendimento', cor: CORES[4] },
          ]}
        />
      </Cartao>

      <Cartao titulo="Rentabilidade mensal por classe"
              sub="Percentual sobre o saldo médio do mês. Tracejada é a carteira consolidada.">
        <Linha
          alto dados={porClasse} formatar={(v) => pct(v)} formatarEixo={(v) => `${v.toFixed(1)}%`}
          series={[
            ...classesUsadas.map((c, i) => ({
              chave: c.id, nome: c.nome, cor: CORES[i % CORES.length],
            })),
            { chave: 'carteira', nome: 'Carteira', cor: '#14161a', tracejada: true, grossura: 2.5 },
          ]}
        />
      </Cartao>

      <Cartao titulo="Rendimento por ativo" sub="Em reais e em percentual do saldo médio, mês a mês.">
        <Tabela>
          <thead>
            <tr>
              <th>Competência</th>
              {estado.ativos.map((a) => <th key={a.id} colSpan={2}>{a.nome}</th>)}
              <th colSpan={2}>Carteira</th>
            </tr>
          </thead>
          <tbody>
            {[...rendimentos].reverse().map((r) => (
              <tr key={r.competencia}>
                <td>{r.competencia}</td>
                {estado.ativos.map((a) => {
                  const v = r.porAtivo[a.id];
                  return (
                    <Fragment key={a.id}>
                      <td><Sinal valor={v?.rendimento ?? 0} texto={dinheiro(v?.rendimento ?? 0)} /></td>
                      <td><Sinal valor={v?.pct ?? 0} texto={pctSinal(v?.pct ?? 0)} /></td>
                    </Fragment>
                  );
                })}
                <td><Sinal valor={r.rendimento} texto={dinheiro(r.rendimento)} /></td>
                <td><Sinal valor={r.pct} texto={pctSinal(r.pct)} /></td>
              </tr>
            ))}
          </tbody>
        </Tabela>
        <p className={css.nota}>
          A base do percentual é <code>saldo anterior + aporte/2</code>: o aporte rendeu, em média,
          metade do mês. Dividir pelo saldo inicial infla o número todo mês em que você aporta.
        </p>
      </Cartao>
    </>
  );
}
