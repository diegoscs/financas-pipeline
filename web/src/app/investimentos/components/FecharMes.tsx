'use client';

/**
 * Fechar o mês.
 *
 * O valor vem somado da Carteira, mas o registro é uma ação deliberada — a
 * versão anterior carimbava sozinha o total de hoje toda vez que a aba abria,
 * e isso grava "o patrimônio do dia 12" com o rótulo do mês inteiro.
 *
 * O número fica editável: quem fecha um mês antigo não tem a Carteira daquela
 * época, e digitar o valor do extrato é mais honesto que não ter ponto.
 */
import { useEffect, useState } from 'react';
import {
  competenciaDe, competenciaSugerida, hojeISO, mesEncerrado, mesesEmAberto,
  rotuloCompetencia, ultimoDiaDoMes,
} from '../lib/calc';
import type { FechamentoMes } from '../lib/historicoApi';
import { dinheiro } from '../lib/formato';
import css from '../investimentos.module.css';
import { Cartao, Tabela, Vazio } from './ui';

const nm = (v: string) => (v === '' ? 0 : Number(v));
const limpar = (v: string) => v.replace(/[eE]/g, '');

export function FecharMes({ fechamentos, sugestaoReservas, sugestaoBolsa, ocupado, onSalvar, onRemover }: {
  fechamentos: FechamentoMes[];
  sugestaoReservas: number;
  sugestaoBolsa: number;
  ocupado: boolean;
  onSalvar: (f: FechamentoMes) => void;
  onRemover: (competencia: string) => void;
}) {
  const sugerida = competenciaSugerida(fechamentos) ?? competenciaDe();
  const [competencia, setCompetencia] = useState(sugerida);
  const [reservas, setReservas] = useState('');
  const [bolsa, setBolsa] = useState('');
  const [tocado, setTocado] = useState(false);

  const jaExiste = fechamentos.find((f) => f.competencia === competencia);

  /**
   * Recarrega os campos ao trocar de mês.
   *
   * Mês já fechado traz o que está gravado; mês novo traz o valor da Carteira
   * de hoje. `tocado` protege a digitação: sem ele, a soma da Carteira
   * chegando um segundo depois apagaria o que a pessoa acabou de escrever.
   */
  useEffect(() => {
    setTocado(false);
    if (jaExiste) {
      setReservas(String(jaExiste.reservas));
      setBolsa(String(jaExiste.bolsa));
    } else {
      setReservas(sugestaoReservas > 0 ? String(Math.round(sugestaoReservas * 100) / 100) : '');
      setBolsa(sugestaoBolsa > 0 ? String(Math.round(sugestaoBolsa * 100) / 100) : '');
    }
  }, [competencia, jaExiste, sugestaoReservas, sugestaoBolsa]);

  const total = nm(reservas) + nm(bolsa);
  const encerrado = mesEncerrado(competencia);
  const emAberto = mesesEmAberto(fechamentos);

  // Fechar um mês que já acabou registra o último dia dele. Fechar o mês
  // corrente registra hoje — e a tela diz isso, em vez de carimbar o dia 30
  // de um mês que ainda não chegou lá.
  const dataRef = encerrado ? ultimoDiaDoMes(competencia) : hojeISO();

  const bateComCarteira =
    Math.abs(nm(reservas) - sugestaoReservas) < 0.01 &&
    Math.abs(nm(bolsa) - sugestaoBolsa) < 0.01;

  function salvar() {
    onSalvar({
      competencia,
      dataRef,
      reservas: nm(reservas),
      bolsa: nm(bolsa),
      total,
      origem: bateComCarteira ? 'carteira' : 'manual',
    });
    setTocado(false);
  }

  return (
    <>
      <Cartao
        titulo="Fechar o mês"
        sub="Um registro por mês. O valor vem somado da Carteira e pode ser corrigido antes de gravar."
      >
        <div className={css.camposLinha}>
          <label className={`${css.campo} ${css.campoCurto}`}>
            <span>Mês</span>
            <input
              type="month" value={competencia}
              onChange={(e) => setCompetencia(e.target.value || competenciaDe())}
            />
          </label>

          <label className={`${css.campo} ${css.campoCurto}`}>
            <span>Reservas</span>
            <span className={css.entradaComPrefixo}>
              <span className={css.prefixo}>R$</span>
              <input
                type="number" step="0.01" inputMode="decimal" value={reservas}
                onChange={(e) => { setReservas(limpar(e.target.value)); setTocado(true); }}
              />
            </span>
          </label>

          <label className={`${css.campo} ${css.campoCurto}`}>
            <span>Bolsa</span>
            <span className={css.entradaComPrefixo}>
              <span className={css.prefixo}>R$</span>
              <input
                type="number" step="0.01" inputMode="decimal" value={bolsa}
                onChange={(e) => { setBolsa(limpar(e.target.value)); setTocado(true); }}
              />
            </span>
          </label>

          <span className={css.operador}>=</span>
          <span className={css.resultado}>
            <span className={css.resultadoValor}>{dinheiro(total)}</span>
            <span className={css.resultadoRotulo}>em {rotuloCompetencia(competencia)}</span>
          </span>
        </div>

        <p className={css.previa}>
          {encerrado
            ? <>Grava com data de <strong>{dataRef}</strong>, o último dia do mês.</>
            : <>
                {rotuloCompetencia(competencia)} ainda não acabou — grava com a data de{' '}
                <strong>hoje ({dataRef})</strong>. Dá para refazer no fim do mês; regravar
                substitui.
              </>}
          {tocado && !bateComCarteira && ' O valor foi editado, então fica marcado como manual.'}
        </p>

        <div className={css.acoes}>
          <button
            type="button" className={`${css.botao} ${css.principal}`}
            onClick={salvar} disabled={ocupado || total <= 0}
          >
            {ocupado ? 'Gravando…' : jaExiste ? 'Substituir fechamento' : 'Gravar fechamento'}
          </button>

          {(sugestaoReservas > 0 || sugestaoBolsa > 0) && !bateComCarteira && (
            <button
              type="button" className={css.linkEditar}
              onClick={() => {
                setReservas(String(Math.round(sugestaoReservas * 100) / 100));
                setBolsa(String(Math.round(sugestaoBolsa * 100) / 100));
                setTocado(false);
              }}
            >
              usar o valor da Carteira ({dinheiro(sugestaoReservas + sugestaoBolsa)})
            </button>
          )}

          {jaExiste && (
            <span className={css.status}>
              já fechado em {jaExiste.dataRef} · {dinheiro(jaExiste.total)}
            </span>
          )}
        </div>

        {emAberto.length > 0 && (
          <p className={css.previa}>
            Sem fechamento: <strong>{emAberto.map(rotuloCompetencia).join(', ')}</strong>.
            Buraco no meio da série vira degrau no gráfico, e degrau se lê como queda de
            patrimônio — vale preencher, nem que seja com o valor do extrato.
          </p>
        )}
      </Cartao>

      <Cartao titulo="Fechamentos" sub={`${fechamentos.length} mês(es) registrado(s).`}>
        {fechamentos.length === 0 ? (
          <Vazio>Nenhum mês fechado ainda.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <th>Mês</th><th>Reservas</th><th>Bolsa</th><th>Total</th>
                <th>Medido em</th><th />
              </tr>
            </thead>
            <tbody>
              {[...fechamentos].reverse().map((f) => (
                <tr key={f.competencia}>
                  <td>
                    <button type="button" className={css.linkEditar}
                            onClick={() => setCompetencia(f.competencia)}>
                      {f.competencia}
                    </button>
                  </td>
                  <td>{dinheiro(f.reservas)}</td>
                  <td>{dinheiro(f.bolsa)}</td>
                  <td><strong>{dinheiro(f.total)}</strong></td>
                  <td>
                    {f.dataRef}
                    {f.origem === 'manual' && <span className={css.etiqueta}>manual</span>}
                  </td>
                  <td>
                    <button type="button" className={css.perigo} disabled={ocupado}
                            onClick={() => onRemover(f.competencia)}>
                      remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>
    </>
  );
}
