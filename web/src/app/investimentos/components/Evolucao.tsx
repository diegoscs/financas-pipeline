'use client';

/**
 * Evolução do patrimônio.
 *
 * Os dados vêm da Carteira, não daqui: reservas pelos snapshots datados,
 * bolsa pelas posições marcadas a mercado. Esta tela não pede que você digite
 * nada — só mostra, e carimba o total do mês para a série existir no futuro.
 */
import { rotuloCompetencia } from '../lib/calc';
import type { PontoEvolucao, ResumoEvolucao } from '../lib/calc';
import type { ValorBolsa } from '../lib/carteiraApi';
import { dinheiro, dinheiroCurto, eixoDinheiro, pct, pctSinal } from '../lib/formato';
import css from '../investimentos.module.css';
import { BarrasEmpilhadas } from './charts/BarrasEmpilhadas';
import { Linha } from './charts/Linha';
import { CORES } from './charts/base';
import { Cartao, Kpi, Kpis, Sinal, Tabela, Vazio } from './ui';

export function Evolucao({ serie, resumo, bolsa, reservas, contasSemSaldo, carimbadoEm }: {
  serie: PontoEvolucao[];
  resumo: ResumoEvolucao;
  bolsa: ValorBolsa;
  reservas: { conta: { id: number; nome: string; instituicao: string }; saldo: number; data: string }[];
  contasSemSaldo: { id: number; nome: string }[];
  carimbadoEm: string | null;
}) {
  const dados = serie.map((p) => ({
    rotulo: rotuloCompetencia(p.competencia),
    reservas: p.reservas,
    bolsa: p.bolsa,
    total: p.total,
  }));

  const temBolsa = serie.some((p) => p.bolsa > 0);
  const parciais = serie.filter((p) => !p.completo).length;

  if (serie.length === 0) {
    return (
      <Cartao>
        <Vazio>
          Sem histórico de patrimônio ainda.<br />
          Informe o saldo das suas reservas na aba <strong>Carteira</strong> — é dali que esta
          tela lê. O primeiro saldo informado vira o primeiro ponto do gráfico.
        </Vazio>
      </Cartao>
    );
  }

  return (
    <>
      <Kpis>
        <Kpi rotulo="Patrimônio hoje" valor={dinheiro(resumo.atual)}
             dica={carimbadoEm ? `carimbado em ${carimbadoEm}` : `${resumo.meses} mês(es) de série`} />
        <Kpi rotulo="No mês" valor={resumo.variacao === null ? '—' : dinheiro(resumo.variacao)}
             dica={resumo.variacaoPct === null
               ? 'sem mês comparável'
               : `${pctSinal(resumo.variacaoPct, 1)} contra o mês anterior`} />
        <Kpi rotulo="Reservas" valor={dinheiro(reservas.reduce((s, r) => s + r.saldo, 0))}
             dica={`${reservas.length} conta(s) com saldo informado`} />
        <Kpi rotulo="Bolsa" valor={dinheiro(bolsa.total)}
             dica={bolsa.total > 0
               ? `custo ${dinheiroCurto(bolsa.custo)} · ${pctSinal(((bolsa.total / bolsa.custo) - 1) * 100, 1)}`
               : 'nenhuma posição'} />
      </Kpis>

      {bolsa.semCotacao > 0 && (
        <p className={css.statusErro}>
          {bolsa.semCotacao} ativo(s) sem cotação — entraram pelo preço médio para o patrimônio
          não despencar por causa de API fora do ar.
        </p>
      )}

      <Cartao
        titulo="Patrimônio mês a mês"
        sub={parciais > 0
          ? `${parciais} mês(es) do começo só têm as reservas — a bolsa não tem histórico no banco.`
          : 'Reservas e bolsa, empilhadas.'}
      >
        {temBolsa ? (
          <BarrasEmpilhadas
            alto dados={dados} formatar={dinheiro} formatarEixo={eixoDinheiro}
            series={[
              { chave: 'reservas', nome: 'Reservas', cor: CORES[0] },
              { chave: 'bolsa', nome: 'Bolsa', cor: CORES[1] },
            ]}
          />
        ) : (
          <Linha
            alto dados={dados} formatar={dinheiro} formatarEixo={eixoDinheiro}
            series={[{ chave: 'total', nome: 'Patrimônio', cor: CORES[0], area: true }]}
          />
        )}
      </Cartao>

      <Cartao titulo="Onde o dinheiro está" sub="Fotografia de hoje, direto da Carteira.">
        <Tabela>
          <thead>
            <tr><th>Onde</th><th>Tipo</th><th>Valor</th><th>Informado em</th></tr>
          </thead>
          <tbody>
            {reservas.map((r) => (
              <tr key={r.conta.id}>
                <td>{r.conta.nome}</td>
                <td>Reserva</td>
                <td>{dinheiro(r.saldo)}</td>
                <td>{r.data}</td>
              </tr>
            ))}
            {bolsa.porAtivo.filter((a) => a.quantidade > 0).map((a) => (
              <tr key={a.ticker}>
                <td>{a.ticker}</td>
                <td>Bolsa</td>
                <td>{dinheiro(a.valor)}</td>
                <td>
                  {a.preco === null
                    ? <span className={css.pendente}>sem cotação</span>
                    : <Sinal
                        valor={a.preco - a.precoMedio}
                        texto={pctSinal(((a.preco / a.precoMedio) - 1) * 100, 1)}
                      />}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabela>

        {contasSemSaldo.length > 0 && (
          <p className={css.nota}>
            Sem saldo informado: <strong>{contasSemSaldo.map((c) => c.nome).join(', ')}</strong>.
            Ficam de fora do total — nunca ter informado não é o mesmo que ter zero.
          </p>
        )}
      </Cartao>

      {resumo.crescimento !== null && resumo.meses > 1 && (
        <Cartao titulo="Desde o começo da série" sub={`${resumo.meses} meses medidos.`}>
          <p className={css.previa} style={{ margin: 0, fontSize: '0.86rem' }}>
            Saiu de <strong>{dinheiro(resumo.inicial ?? 0)}</strong> para{' '}
            <strong>{dinheiro(resumo.atual)}</strong> —{' '}
            <Sinal valor={resumo.crescimento} texto={dinheiro(resumo.crescimento)} />
            {resumo.inicial ? <> ({pct(((resumo.atual / resumo.inicial) - 1) * 100, 1)})</> : null}.
          </p>
        </Cartao>
      )}
    </>
  );
}
