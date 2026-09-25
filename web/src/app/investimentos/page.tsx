'use client';

/**
 * Investimentos — evolução do patrimônio e simulador de metas.
 *
 * A aba não guarda patrimônio: ele vem da Carteira, pelo Supabase. O que
 * mora aqui é o que lá não existe — o carimbo mensal do total (porque
 * `posicoes` não tem histórico) e as metas.
 *
 * O estado desce por props. Os componentes não leem storage, não chamam
 * `fetch` e não fazem conta: recebem números prontos e devolvem intenção.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { competenciaDe, resumoEvolucao, serieEvolucao } from './lib/calc';
import {
  carregarCarteira, historicoDasContas, saldoAtualDasContas, valorDaBolsa,
  type DadosCarteira,
} from './lib/carteiraApi';
import { buscarCdi, buscarCotacoes, cdiDoCache } from './lib/mercado';
import type { CdiGuardado } from './lib/cotacaoCache';
import { comCarimbo, storage } from './lib/storage';
import type { InvestState, Meta } from './lib/types';
import css from './investimentos.module.css';
import { Evolucao } from './components/Evolucao';
import { Metas } from './components/Metas';

type Aba = 'evolucao' | 'metas';

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'evolucao', rotulo: 'Evolução' },
  { id: 'metas', rotulo: 'Metas' },
];

export default function Investimentos() {
  const [estado, setEstado] = useState<InvestState | null>(null);
  const [carteira, setCarteira] = useState<DadosCarteira | null>(null);
  const [precos, setPrecos] = useState<Map<string, number>>(new Map());
  const [cdi, setCdi] = useState<CdiGuardado | null>(null);
  const [aba, setAba] = useState<Aba>('evolucao');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const salvar = useCallback((novo: InvestState) => {
    setEstado(novo);
    storage.save(novo).catch((e: Error) => setErro(e.message));
  }, []);

  // Estado local e dados da Carteira em paralelo: um não depende do outro, e
  // a tela do simulador já abre enquanto o banco responde.
  useEffect(() => {
    let vivo = true;

    storage.load().then((s) => { if (vivo) setEstado(s); });

    carregarCarteira()
      .then((d) => { if (vivo) setCarteira(d); })
      .catch((e: Error) => { if (vivo) setErro(`Não consegui ler a Carteira: ${e.message}`); })
      .finally(() => { if (vivo) setCarregando(false); });

    setCdi(cdiDoCache());
    buscarCdi().then((c) => { if (vivo) setCdi(c); }).catch(() => { /* fica o cache */ });

    return () => { vivo = false; };
  }, []);

  // Cotação só depois de saber quais tickers existem. O cache de 30 minutos
  // é o que torna seguro buscar a cada abertura da tela.
  useEffect(() => {
    if (!carteira) return;
    const tickers = carteira.posicoes.filter((p) => p.quantidade > 0).map((p) => p.ticker);
    if (tickers.length === 0) return;

    let vivo = true;
    buscarCotacoes(tickers)
      .then(({ cotacoes }) => {
        if (vivo) setPrecos(new Map(cotacoes.map((c) => [c.ticker, c.preco])));
      })
      .catch(() => { /* sem cotação, as posições entram pelo custo */ });
    return () => { vivo = false; };
  }, [carteira]);

  const bolsa = useMemo(
    () => valorDaBolsa(carteira?.posicoes ?? [], precos),
    [carteira, precos],
  );

  const contas = useMemo(
    () => (carteira
      ? saldoAtualDasContas(carteira)
      : { total: 0, porConta: [], semSaldo: [] }),
    [carteira],
  );

  const patrimonioHoje = contas.total + bolsa.total;

  /**
   * Carimba o total do mês assim que a foto de hoje está completa.
   *
   * Só depois de ter as cotações — carimbar antes gravaria a bolsa pelo custo
   * e deixaria um ponto errado no histórico para sempre. E só quando há algo
   * a registrar: zero patrimônio não é fato, é tela ainda carregando.
   *
   * Regravar no mesmo mês substitui o ponto, então visitar a tela dez vezes
   * em setembro não gera dez pontos.
   */
  useEffect(() => {
    if (!estado || !carteira || patrimonioHoje <= 0) return;

    const competencia = competenciaDe();
    const atual = estado.historico.find((p) => p.competencia === competencia);
    const igual = atual
      && Math.abs(atual.total - patrimonioHoje) < 0.01
      && Math.abs(atual.bolsa - bolsa.total) < 0.01;
    if (igual) return;

    salvar(comCarimbo(estado, {
      competencia,
      reservas: contas.total,
      bolsa: bolsa.total,
      total: patrimonioHoje,
    }));
  }, [estado, carteira, contas.total, bolsa.total, patrimonioHoje, salvar]);

  const serie = useMemo(() => serieEvolucao(
    carteira ? historicoDasContas(carteira) : [],
    estado?.historico ?? [],
  ), [carteira, estado]);

  const resumo = useMemo(() => resumoEvolucao(serie), [serie]);

  if (!estado || carregando) {
    return (
      <div className={css.raiz}>
        <p className={css.status}>Carregando…</p>
      </div>
    );
  }

  return (
    <div className={css.raiz}>
      <header className={css.cabecalho}>
        <h1>Investimentos</h1>
        <p>Como o patrimônio evoluiu, e quanto falta para onde você quer chegar.</p>
      </header>

      <div className={css.abas} role="tablist" aria-label="Seções de investimentos">
        {ABAS.map((a) => (
          <button
            key={a.id} type="button" role="tab" className={css.aba}
            aria-selected={a.id === aba} onClick={() => setAba(a.id)}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {erro && <p className={css.statusErro} role="alert">{erro}</p>}

      {aba === 'evolucao' && (
        <Evolucao
          serie={serie} resumo={resumo} bolsa={bolsa}
          reservas={contas.porConta}
          contasSemSaldo={contas.semSaldo}
          carimbadoEm={serie.length && serie[serie.length - 1].completo ? competenciaDe() : null}
        />
      )}

      {aba === 'metas' && (
        <Metas
          patrimonio={patrimonioHoje}
          metas={estado.metas}
          rendimentoAnual={estado.rendimentoAnual}
          cdiAnual={cdi?.anual ?? null}
          onMudarMetas={(metas: Meta[]) => salvar({ ...estado, metas })}
          onMudarRendimento={(rendimentoAnual) => salvar({ ...estado, rendimentoAnual })}
        />
      )}

      <p className={css.nota}>
        Patrimônio, reservas e posições vêm da aba <strong>Carteira</strong>.
        Metas e o histórico mensal do total ficam neste navegador.
        {cdi && ` · CDI de ${cdi.data} (Banco Central)`}
      </p>
    </div>
  );
}
