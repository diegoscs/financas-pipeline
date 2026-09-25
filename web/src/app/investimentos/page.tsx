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
import {
  MigracaoPendente, listarFechamentos, removerFechamento, salvarFechamento,
  type FechamentoMes,
} from './lib/historicoApi';
import { buscarCdi, buscarCotacoes, cdiDoCache } from './lib/mercado';
import type { CdiGuardado } from './lib/cotacaoCache';
import { storage } from './lib/storage';
import type { InvestState, Meta } from './lib/types';
import css from './investimentos.module.css';
import { Evolucao } from './components/Evolucao';
import { FecharMes } from './components/FecharMes';
import { Metas } from './components/Metas';

type Aba = 'evolucao' | 'fechar' | 'metas';

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'evolucao', rotulo: 'Evolução' },
  { id: 'fechar', rotulo: 'Fechar o mês' },
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
  const [fechamentos, setFechamentos] = useState<FechamentoMes[]>([]);
  const [gravando, setGravando] = useState(false);
  /** A migração 16 ainda não rodou: cai no histórico local e avisa. */
  const [semTabela, setSemTabela] = useState(false);

  const recarregarFechamentos = useCallback(async () => {
    try {
      setFechamentos(await listarFechamentos());
      setSemTabela(false);
    } catch (e) {
      if (e instanceof MigracaoPendente) setSemTabela(true);
      else setErro((e as Error).message);
    }
  }, []);

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

    recarregarFechamentos();

    setCdi(cdiDoCache());
    buscarCdi().then((c) => { if (vivo) setCdi(c); }).catch(() => { /* fica o cache */ });

    return () => { vivo = false; };
  }, [recarregarFechamentos]);

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
   * Fechar o mês é ação deliberada, não efeito colateral de abrir a tela.
   *
   * A versão anterior carimbava sozinha o total de hoje a cada visita, o que
   * grava "o patrimônio do dia 12" com o rótulo do mês inteiro. Agora quem
   * decide é o botão em `FecharMes`.
   */
  const gravarFechamento = useCallback(async (f: FechamentoMes) => {
    setGravando(true);
    setErro(null);
    try {
      await salvarFechamento(f);
      await recarregarFechamentos();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGravando(false);
    }
  }, [recarregarFechamentos]);

  const apagarFechamento = useCallback(async (competencia: string) => {
    setGravando(true);
    setErro(null);
    try {
      await removerFechamento(competencia);
      await recarregarFechamentos();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGravando(false);
    }
  }, [recarregarFechamentos]);

  /**
   * Enquanto a migração 16 não roda, vale o histórico que ficou no navegador.
   *
   * Sem isso a aba perderia a série inteira entre o deploy e o SQL rodar — e
   * "sumiu tudo" é pior que "ainda não está no banco".
   */
  const historicoEmUso = useMemo(
    () => (semTabela ? (estado?.historico ?? []) : fechamentos),
    [semTabela, estado?.historico, fechamentos],
  );

  const serie = useMemo(() => serieEvolucao(
    carteira ? historicoDasContas(carteira) : [],
    historicoEmUso,
  ), [carteira, historicoEmUso]);

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

      {semTabela && (
        <p className={css.avisoMigracao}>
          O histórico ainda está só neste navegador. Para guardá-lo no banco e abrir de
          qualquer aparelho, rode <code>sql/16_investimentos_historico.sql</code> no SQL
          Editor do Supabase. Até lá, gravar um fechamento vai dar erro.
        </p>
      )}

      {aba === 'evolucao' && (
        <Evolucao
          serie={serie} resumo={resumo} bolsa={bolsa}
          reservas={contas.porConta}
          contasSemSaldo={contas.semSaldo}
          carimbadoEm={serie.length && serie[serie.length - 1].completo ? competenciaDe() : null}
        />
      )}

      {aba === 'fechar' && (
        <FecharMes
          fechamentos={fechamentos}
          sugestaoReservas={contas.total}
          sugestaoBolsa={bolsa.total}
          ocupado={gravando}
          onSalvar={gravarFechamento}
          onRemover={apagarFechamento}
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
