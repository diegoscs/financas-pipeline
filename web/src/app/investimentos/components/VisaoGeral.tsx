'use client';

/**
 * Visão geral.
 *
 * Responde três perguntas, nesta ordem: quanto eu tenho, por quanto tempo
 * isso me sustenta, e de que o montante é feito. A projeção aparece aqui só
 * como continuação tracejada da linha realizada — o detalhe dela é outra aba.
 */
import { useMemo, useState } from 'react';
import { CLASSES, projetar, rotuloCompetencia } from '../lib/calc';
import { dinheiro, dinheiroCurto, eixoDinheiro, meses, pct } from '../lib/formato';
import type { Classe, InvestState, Posicao } from '../lib/types';
import type { ResumoGeral } from '../lib/calc';
import css from '../investimentos.module.css';
import { BarrasEmpilhadas } from './charts/BarrasEmpilhadas';
import { Linha } from './charts/Linha';
import { CORES } from './charts/base';
import { Cartao, Kpi, Kpis, Seletor, Vazio } from './ui';

type ModoComposicao = 'valor' | 'pct';

export function VisaoGeral({ estado, posicoes, geral }: {
  estado: InvestState;
  posicoes: Posicao[];
  geral: ResumoGeral;
}) {
  const [modo, setModo] = useState<ModoComposicao>('valor');

  const projecao = useMemo(
    () => projetar(estado.ativos, posicoes, estado.premissas, 'conservador'),
    [estado.ativos, posicoes, estado.premissas],
  );

  /**
   * Série única com realizado e projeção.
   *
   * O último ponto realizado é repetido como primeiro da projeção; sem isso
   * fica um vão entre a linha cheia e a tracejada, como se o patrimônio
   * tivesse sumido por um mês.
   */
  const serieP = useMemo(() => {
    const ultimo = posicoes.length ? posicoes[posicoes.length - 1] : null;
    const realizado = posicoes.map((p) => ({
      rotulo: rotuloCompetencia(p.competencia),
      realizado: p.total,
      projetado: p === ultimo ? p.total : null,
      meta6: geral.metaSeisMeses,
      meta12: geral.metaDozeMeses,
    }));
    const futuro = projecao.map((m) => ({
      rotulo: rotuloCompetencia(m.competencia),
      realizado: null,
      projetado: m.total,
      meta6: geral.metaSeisMeses,
      meta12: geral.metaDozeMeses,
    }));
    return [...realizado, ...futuro];
  }, [posicoes, projecao, geral.metaSeisMeses, geral.metaDozeMeses]);

  const classesUsadas = useMemo(() => {
    const ids = new Set(estado.ativos.map((a) => a.classe));
    return CLASSES.filter((c) => ids.has(c.id));
  }, [estado.ativos]);

  const composicao = useMemo(() => posicoes.map((p) => {
    const linha: Record<string, unknown> = { rotulo: rotuloCompetencia(p.competencia) };
    for (const c of classesUsadas) {
      const v = p.porClasse[c.id as Classe];
      // Em modo %, mês de patrimônio zero não vira 0% — vira nada. Zero
      // desenharia uma barra achatada sugerindo composição conhecida.
      linha[c.id] = modo === 'pct' ? (p.total > 0 ? (v / p.total) * 100 : null) : v;
    }
    return linha;
  }), [posicoes, classesUsadas, modo]);

  const aportes = useMemo(() => posicoes.slice(1).map((p) => {
    const linha: Record<string, unknown> = { rotulo: rotuloCompetencia(p.competencia) };
    for (const a of estado.ativos) linha[a.id] = p.porAtivo[a.id]?.aporte ?? 0;
    return linha;
  }), [posicoes, estado.ativos]);

  if (posicoes.length === 0) {
    return (
      <Cartao>
        <Vazio>
          Sem fechamento lançado ainda.<br />
          Cadastre os ativos e lance o primeiro mês para os números aparecerem.
        </Vazio>
      </Cartao>
    );
  }

  const progresso = geral.metaSeisMeses > 0
    ? Math.min(100, (geral.patrimonio / geral.metaSeisMeses) * 100)
    : 0;

  return (
    <>
      <Kpis>
        <Kpi rotulo="Patrimônio" valor={dinheiro(geral.patrimonio)}
             dica={`${posicoes.length} mês(es) lançado(s)`} />
        <Kpi rotulo="Custo coberto" valor={meses(geral.mesesCobertos)}
             dica={`a ${dinheiro(estado.premissas.gasto)}/mês`} />
        <Kpi rotulo="Aportado no período" valor={dinheiro(geral.aportadoNoPeriodo)}
             dica="fora o saldo de partida" />
        <Kpi rotulo="Falta p/ 6 meses" valor={dinheiro(geral.faltaSeisMeses)}
             dica={geral.faltaSeisMeses === 0 ? 'meta batida' : `meta ${dinheiroCurto(geral.metaSeisMeses)}`} />
        <Kpi rotulo="Falta p/ 12 meses" valor={dinheiro(geral.faltaDozeMeses)}
             dica={geral.faltaDozeMeses === 0 ? 'meta batida' : `meta ${dinheiroCurto(geral.metaDozeMeses)}`} />
      </Kpis>

      <Cartao titulo="Reserva de 6 meses" sub="A primeira meta: seis meses de custo de vida guardados.">
        <div className={css.barra}>
          <div className={css.barraDentro} style={{ width: `${progresso}%` }} />
        </div>
        <div className={css.barraLegenda}>
          <span className={css.mono}>{pct(progresso, 1)}</span>
          <span className={css.mono}>{dinheiro(geral.patrimonio)} de {dinheiro(geral.metaSeisMeses)}</span>
        </div>
      </Cartao>

      <Cartao titulo="Patrimônio" sub="Linha cheia é medido. Tracejada é projeção conservadora — 100% renda fixa.">
        <Linha
          alto dados={serieP} formatar={dinheiro} formatarEixo={eixoDinheiro}
          series={[
            { chave: 'realizado', nome: 'Realizado', cor: CORES[0], area: true },
            { chave: 'projetado', nome: 'Projeção conservadora', cor: CORES[3], tracejada: true },
            { chave: 'meta6', nome: 'Meta 6 meses', cor: CORES[4], tracejada: true, grossura: 1.5 },
            { chave: 'meta12', nome: 'Meta 12 meses', cor: CORES[1], tracejada: true, grossura: 1.5 },
          ]}
        />
      </Cartao>

      <Cartao titulo="Composição por classe" sub="De que o patrimônio é feito, mês a mês.">
        <Seletor<ModoComposicao>
          valor={modo} onEscolher={setModo}
          opcoes={[{ id: 'valor', rotulo: 'R$' }, { id: 'pct', rotulo: '%' }]}
        />
        <BarrasEmpilhadas
          dados={composicao}
          formatar={modo === 'pct' ? (v) => pct(v, 1) : dinheiro}
          formatarEixo={modo === 'pct' ? (v) => `${v.toFixed(0)}%` : eixoDinheiro}
          dominio={modo === 'pct' ? [0, 100] : undefined}
          series={classesUsadas.map((c, i) => ({ chave: c.id, nome: c.nome, cor: CORES[i % CORES.length] }))}
        />
      </Cartao>

      <Cartao titulo="Aportes por ativo" sub="Quanto saiu do bolso em cada mês. O mês de partida não conta como aporte.">
        {aportes.length === 0
          ? <Vazio>Só há um mês lançado — o aporte aparece a partir do segundo.</Vazio>
          : (
            <BarrasEmpilhadas
              dados={aportes} formatar={dinheiro} formatarEixo={eixoDinheiro}
              series={estado.ativos.map((a, i) => ({ chave: a.id, nome: a.nome, cor: CORES[i % CORES.length] }))}
            />
          )}
      </Cartao>
    </>
  );
}
