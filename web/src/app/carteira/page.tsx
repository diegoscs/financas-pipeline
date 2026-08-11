'use client';

/**
 * Carteira: quanto rende o que está guardado e quando cai o próximo provento.
 *
 * Três blocos, do mais certo para o mais incerto:
 *   1. Posições com cotação real — número de fora, confiável.
 *   2. Reservas em CDI — projeção com taxa oficial do Banco Central.
 *   3. Proventos — histórico digitado e previsão ESTIMADA pela média.
 *
 * A ordem importa: o usuário lê de cima para baixo e encontra o dado firme
 * antes do palpite. E o palpite é rotulado como tal em todo lugar onde
 * aparece — número previsto com cara de anunciado é pior que nenhum número.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { explicarErro } from '@/lib/erro';
import { dinheiro, dataCurta } from '@/lib/formato';
import { competenciaRotulo } from '@/lib/competencia';
import { Marca } from '@/components/Marca';
import {
  buscarCdi, buscarCotacoes, CDI_PADRAO, DIAS_UTEIS_MES, renderNoPeriodo,
  type Cdi, type Cotacao,
} from '@/lib/mercado';
import {
  carregarCarteira, estimarProximo, mesSeguinte, registrarProvento, removerAtivo,
  ROTULO_TIPO, salvarPosicao, TICKER_VALIDO, palpitarTipo,
  type Ativo, type Posicao, type Provento, type TipoProvento,
} from '@/lib/carteira';
import { atualizarConta, type ContaConfig } from '@/lib/perfil';

/** Acima disto a média dos últimos pagamentos não descreve mais a série. */
const VARIACAO_ALTA = 0.25;

/** Aplicação ou resgate lido do extrato. Sinal do extrato: aplicar é saída. */
interface Movimento {
  hash_natural: string;
  data: string;
  valor: number;
  descricao: string;
  metodo: string | null;
}

export default function Carteira() {
  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [posicoes, setPosicoes] = useState<Posicao[]>([]);
  const [proventos, setProventos] = useState<Provento[]>([]);
  const [reservas, setReservas] = useState<ContaConfig[]>([]);
  const [saldos, setSaldos] = useState<Map<number, number>>(new Map());
  const [cotacoes, setCotacoes] = useState<Map<string, Cotacao>>(new Map());
  const [cdi, setCdi] = useState<Cdi | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);

  const carregar = useCallback(async () => {
    try {
      const [c, contas, snaps, movs] = await Promise.all([
        carregarCarteira(),
        supabase.from('contas').select('*').eq('tipo', 'investimento').order('id'),
        supabase.from('snapshots_saldo').select('conta_id,data_ref,saldo')
          .order('data_ref', { ascending: false }),
        // Aplicações e resgates saíram da tela de gastos: não são consumo.
        // O lugar delas é aqui, ao lado do saldo que elas movem.
        supabase.from('transacoes').select('hash_natural,data,valor,descricao,metodo')
          .eq('tratamento', 'investimento')
          .order('data', { ascending: false }).limit(200),
      ]);
      setAtivos(c.ativos); setPosicoes(c.posicoes); setProventos(c.proventos);
      setReservas((contas.data ?? []) as ContaConfig[]);

      // Só o snapshot mais recente de cada conta interessa.
      const m = new Map<number, number>();
      for (const s of (snaps.data ?? []) as { conta_id: number; saldo: string }[]) {
        if (!m.has(s.conta_id)) m.set(s.conta_id, Number(s.saldo));
      }
      setSaldos(m);
      setMovimentos(((movs.data ?? []) as unknown[]).map((r) => {
        const x = r as Record<string, unknown>;
        return { ...x, valor: Number(x.valor) } as Movimento;
      }));
    } catch (e) { setErro(explicarErro(e)); }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const atualizarMercado = useCallback(async (tickers: string[]) => {
    setBuscando(true);
    const problemas: string[] = [];
    try {
      const [q, k] = await Promise.allSettled([
        tickers.length > 0 ? buscarCotacoes(tickers) : Promise.resolve({ cotacoes: [], erros: [] }),
        buscarCdi(),
      ]);
      if (q.status === 'fulfilled') {
        setCotacoes(new Map(q.value.cotacoes.map((c) => [c.ticker, c])));
        problemas.push(...q.value.erros);
      } else problemas.push(`Cotações: ${(q.reason as Error).message}`);

      if (k.status === 'fulfilled') setCdi(k.value);
      else problemas.push(`CDI: ${(k.reason as Error).message}`);
    } finally {
      setAvisos(problemas);
      setBuscando(false);
    }
  }, []);

  // Busca uma vez quando a lista de tickers muda — não a cada render.
  const chaveTickers = ativos.map((a) => a.ticker).sort().join(',');
  useEffect(() => {
    if (carregando) return;
    atualizarMercado(chaveTickers ? chaveTickers.split(',') : []);
  }, [chaveTickers, carregando, atualizarMercado]);

  const posPorAtivo = useMemo(() => new Map(posicoes.map((p) => [p.ativo_id, p])), [posicoes]);

  const linhas = useMemo(() => ativos.map((a) => {
    const p = posPorAtivo.get(a.id);
    const qtd = p?.quantidade ?? 0;
    const pm = p?.preco_medio ?? 0;
    const cot = cotacoes.get(a.ticker);
    const custo = qtd * pm;
    const atual = cot ? qtd * cot.preco : null;
    return {
      ativo: a, qtd, pm, cotacao: cot ?? null, custo, atual,
      ganho: atual === null ? null : atual - custo,
      historico: proventos.filter((x) => x.ativo_id === a.id),
    };
  }), [ativos, posPorAtivo, cotacoes, proventos]);

  const custoTotal = linhas.reduce((a, l) => a + l.custo, 0);
  // Sem cotação, a posição entra pelo custo: assim o total não encolhe quando
  // um ticker falha, o que pareceria perda.
  const valorTotal = linhas.reduce((a, l) => a + (l.atual ?? l.custo), 0);
  const semCotacao = linhas.filter((l) => l.atual === null).length;

  const rendaPrevista = useMemo(() => linhas.reduce((a, l) => {
    const e = estimarProximo(l.historico);
    return e ? a + e.valorPorCota * l.qtd : a;
  }, 0), [linhas]);

  /**
   * O que está guardado em reserva. Entra no patrimônio junto com a bolsa.
   *
   * Antes o número grande somava só as posições — o que fazia a caixinha, que
   * costuma ser a maior parte, sumir do total. "Quanto eu tenho" é uma
   * pergunta só; separar por onde está guardado é detalhe.
   */
  const saldoReservas = useMemo(
    () => reservas.reduce((a, r) => a + (saldos.get(r.id) ?? 0), 0), [reservas, saldos],
  );
  const reservasSemSaldo = reservas.filter((r) => !saldos.has(r.id)).length;

  const rendimentoReservas = useMemo(() => {
    if (!cdi) return null;
    return reservas.reduce((a, r) => {
      const saldo = saldos.get(r.id) ?? 0;
      return a + renderNoPeriodo(saldo, cdi.diario, r.percentual_cdi ?? CDI_PADRAO, DIAS_UTEIS_MES);
    }, 0);
  }, [reservas, saldos, cdi]);

  if (carregando) return <p style={{ color: 'var(--suave)' }}>Carregando…</p>;
  if (erro) return <p style={{ color: 'var(--negativo)' }}>Erro: {erro}</p>;

  const vazio = ativos.length === 0 && reservas.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Carteira</h1>
        <button onClick={() => atualizarMercado(ativos.map((a) => a.ticker))}
                disabled={buscando} className="btn btn-neutro disabled:opacity-40">
          {buscando ? 'Buscando…' : 'Atualizar cotações'}
        </button>
      </div>

      {avisos.length > 0 && (
        <div role="alert" className="rounded-lg border px-4 py-3 text-sm"
             style={{ borderColor: 'var(--perigo-borda)', background: 'var(--perigo-fundo)', color: 'var(--perigo-texto)' }}>
          {avisos.map((a) => <p key={a}>{a}</p>)}
        </div>
      )}

      {vazio ? (
        <div className="painel p-10 text-center">
          <p className="font-medium">Nada cadastrado ainda.</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--suave)' }}>
            <Link href="/onboarding" className="underline" style={{ color: 'var(--acento)' }}>
              Cadastre suas posições
            </Link>{' '}para acompanhar cotação e proventos.
          </p>
        </div>
      ) : (
        <>
          <Resumo valorBolsa={valorTotal} custoTotal={custoTotal} semCotacao={semCotacao}
                  saldoReservas={saldoReservas} reservasSemSaldo={reservasSemSaldo}
                  rendaPrevista={rendaPrevista} rendimentoReservas={rendimentoReservas} cdi={cdi} />

          {reservas.length > 0 && (
            <Reservas reservas={reservas} saldos={saldos} cdi={cdi} onSalvo={carregar} setErro={setErro} />
          )}

          {movimentos.length > 0 && <Movimentos movimentos={movimentos} />}

          {linhas.length > 0 && (
            <section>
              <h2 className="rotulo mb-2">Posições</h2>
              <div className="painel overflow-hidden">
                {linhas.map((l) => (
                  <LinhaAtivo key={l.ativo.id} {...l} onSalvo={carregar} setErro={setErro} />
                ))}
              </div>
            </section>
          )}

          <NovoAtivo onSalvo={carregar} setErro={setErro} />
        </>
      )}
    </div>
  );
}

// ── resumo ─────────────────────────────────────────────────────────────────

function Resumo({ valorBolsa, custoTotal, semCotacao, saldoReservas, reservasSemSaldo,
                 rendaPrevista, rendimentoReservas, cdi }: {
  valorBolsa: number; custoTotal: number; semCotacao: number;
  saldoReservas: number; reservasSemSaldo: number;
  rendaPrevista: number; rendimentoReservas: number | null; cdi: Cdi | null;
}) {
  const total = valorBolsa + saldoReservas;
  const ganho = valorBolsa - custoTotal;
  const pct = custoTotal > 0 ? (ganho / custoTotal) * 100 : 0;
  const fatiaBolsa = total > 0 ? (valorBolsa / total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="painel-destaque p-6">
        <p className="rotulo">Você tem guardado</p>
        <p className="tabular mt-1 text-[3rem] font-semibold leading-none tracking-tight">
          {dinheiro(total)}
        </p>

        {/* Onde está o dinheiro, antes de o usuário precisar rolar a tela. */}
        {total > 0 && (
          <>
            <div className="mt-5 flex h-2.5 overflow-hidden rounded-full" style={{ background: '#eef0f4' }}>
              <div style={{ width: `${fatiaBolsa}%`, background: 'var(--acento)' }} />
              <div style={{ width: `${100 - fatiaBolsa}%`, background: 'var(--entrada)' }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <span>
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ background: 'var(--acento)' }} />
                <span style={{ color: 'var(--suave)' }}>Bolsa</span>
                <span className="tabular ml-2 font-semibold">{dinheiro(valorBolsa)}</span>
                {custoTotal > 0 && (
                  <span className="tabular ml-2" style={{ color: ganho >= 0 ? 'var(--entrada)' : 'var(--negativo)' }}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                  </span>
                )}
              </span>
              <span>
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ background: 'var(--entrada)' }} />
                <span style={{ color: 'var(--suave)' }}>Reserva</span>
                <span className="tabular ml-2 font-semibold">{dinheiro(saldoReservas)}</span>
              </span>
            </div>
          </>
        )}

        {(semCotacao > 0 || reservasSemSaldo > 0) && (
          <p className="mt-4 text-xs" style={{ color: 'var(--suave)' }}>
            {semCotacao > 0 && `${semCotacao} posição(ões) sem cotação entraram pelo preço médio. `}
            {reservasSemSaldo > 0 && `${reservasSemSaldo} reserva(s) sem saldo informado ficaram de fora do total — informe abaixo.`}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="painel p-5">
          <p className="rotulo">Rendimento da reserva no mês</p>
          <p className="tabular mt-1 text-2xl font-semibold" style={{ color: 'var(--acento)' }}>
            {rendimentoReservas === null ? '—' : dinheiro(rendimentoReservas)}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>
            {cdi
              ? `projeção com o CDI de ${dataCurta(cdi.data)}, ${cdi.anual.toFixed(2)}% a.a.`
              : 'CDI indisponível'}
          </p>
        </div>
        <div className="painel p-5">
          <p className="rotulo">Provento previsto no próximo mês</p>
          <p className="tabular mt-1 text-2xl font-semibold" style={{ color: 'var(--acento)' }}>
            {rendaPrevista > 0 ? dinheiro(rendaPrevista) : '—'}
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>
            {rendaPrevista > 0
              ? 'estimativa pela média dos últimos pagamentos, não valor anunciado'
              : 'clique num ativo em Posições e registre dois proventos para eu começar a estimar'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── reservas em CDI ────────────────────────────────────────────────────────

function Reservas({ reservas, saldos, cdi, onSalvo, setErro }: {
  reservas: ContaConfig[]; saldos: Map<number, number>; cdi: Cdi | null;
  onSalvo: () => Promise<void>; setErro: (v: string | null) => void;
}) {
  return (
    <section>
      <h2 className="rotulo mb-2">Onde você guarda</h2>
      <div className="painel overflow-hidden">
        {reservas.map((r) => (
          <LinhaReserva key={r.id} reserva={r} saldo={saldos.get(r.id) ?? null} cdi={cdi}
                        onSalvo={onSalvo} setErro={setErro} />
        ))}
      </div>
    </section>
  );
}

function LinhaReserva({ reserva, saldo, cdi, onSalvo, setErro }: {
  reserva: ContaConfig; saldo: number | null; cdi: Cdi | null;
  onSalvo: () => Promise<void>; setErro: (v: string | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(saldo != null ? String(saldo) : '');
  const [ocupado, setOcupado] = useState(false);

  const pct = reserva.percentual_cdi ?? CDI_PADRAO;
  // Guardado como fração (1.15), editado em percentual (115) — é como o banco
  // anuncia e como a pessoa pensa.
  const [taxa, setTaxa] = useState(String(Math.round(pct * 10000) / 100));

  const rende = cdi && saldo != null
    ? renderNoPeriodo(saldo, cdi.diario, pct, DIAS_UTEIS_MES) : null;

  /** Prévia ao vivo enquanto o campo é digitado: mostra o efeito antes de salvar. */
  const rendePrevia = cdi && saldo != null && Number(taxa) > 0
    ? renderNoPeriodo(saldo, cdi.diario, Number(taxa) / 100, DIAS_UTEIS_MES) : null;

  async function salvar() {
    setOcupado(true); setErro(null);
    try {
      // O saldo é um retrato datado, não um campo mutável: guardar o histórico
      // permite calcular depois quanto rendeu de verdade contra a projeção.
      if (valor !== '') {
        const { error } = await supabase.from('snapshots_saldo').upsert({
          conta_id: reserva.id, data_ref: new Date().toISOString().slice(0, 10),
          saldo: Number(valor), fonte: 'manual',
        }, { onConflict: 'conta_id,data_ref' });
        if (error) throw error;
      }
      // A taxa, ao contrário, é configuração da conta: sobrescreve.
      if (Number(taxa) > 0 && Number(taxa) / 100 !== pct) {
        await atualizarConta(reserva.id, { percentual_cdi: Number(taxa) / 100 });
      }
      setEditando(false);
      await onSalvo();
    } catch (e) { setErro(explicarErro(e)); }
    setOcupado(false);
  }

  return (
    <div className="border-t first:border-t-0" style={{ borderColor: 'var(--borda)' }}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Marca instituicao={reserva.instituicao} tamanho={22} />
        <span className="flex-1 text-[15px]">{reserva.nome}</span>
        <span className="text-xs" style={{ color: 'var(--suave)' }}>{(pct * 100).toFixed(0)}% do CDI</span>
        <span className="tabular text-[15px] font-semibold">
          {saldo != null ? dinheiro(saldo) : '—'}
        </span>
        {rende != null && (
          <span className="tabular whitespace-nowrap text-sm" style={{ color: 'var(--acento)' }}>
            +{dinheiro(rende)}/mês
          </span>
        )}
        <button onClick={() => setEditando((v) => !v)} className="text-xs underline"
                style={{ color: 'var(--suave)' }}>
          {saldo != null ? 'editar' : 'informar saldo'}
        </button>
      </div>
      {editando && (
        <div className="border-t px-4 py-3"
             style={{ borderColor: 'var(--borda)', background: '#fafbfc' }}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="rotulo">Saldo hoje</span>
              <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value.replace(/[e,E]/g, ''))}
                     className="mt-1 w-40 border text-sm xs:text-xs"
                     style={{ borderColor: 'var(--borda-forte)' }} />
            </label>
            <label className="block">
              <span className="rotulo">Rende quantos % do CDI</span>
              <input type="number" step="0.01" min={1} value={taxa} onChange={(e) => setTaxa(e.target.value.replace(/[e,E]/g, ''))}
                     className="mt-1 w-28 border text-sm xs:text-xs"
                     style={{ borderColor: 'var(--borda-forte)' }} />
            </label>
            <button onClick={salvar} disabled={ocupado || !(Number(taxa) > 0)}
                    className="btn btn-principal disabled:opacity-40">Salvar</button>
            <button onClick={() => setEditando(false)} className="btn btn-neutro">Cancelar</button>
          </div>
          {rendePrevia != null && (
            <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>
              A {Number(taxa).toFixed(0)}% do CDI, esse saldo rende{' '}
              <strong>{dinheiro(rendePrevia)}</strong> por mês
              {cdi && ` — CDI de ${cdi.anual.toFixed(2)}% a.a.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Aplicações e resgates, com o sinal do EXTRATO.
 *
 * Aplicar aparece como saída, igual ao banco. Inverter para o "ponto de vista
 * da aplicação" é tecnicamente correto e ilegível: a mesma linha ficaria
 * +1.000 aqui e −1.000 no extrato.
 */
function Movimentos({ movimentos }: { movimentos: Movimento[] }) {
  const [aberto, setAberto] = useState(false);
  const aplicado = movimentos.filter((m) => m.valor < 0).reduce((a, m) => a - m.valor, 0);
  const resgatado = movimentos.filter((m) => m.valor > 0).reduce((a, m) => a + m.valor, 0);

  return (
    <section>
      <button onClick={() => setAberto((v) => !v)} className="rotulo mb-2 flex items-center gap-2">
        Aplicações e resgates ({movimentos.length})
        <span aria-hidden style={{ color: 'var(--suave-claro)' }}>{aberto ? '▲' : '▼'}</span>
      </button>
      <div className="painel overflow-hidden">
        <div className="flex flex-wrap gap-8 border-b px-4 py-3" style={{ borderColor: 'var(--borda)' }}>
          <span className="text-sm">
            <span style={{ color: 'var(--suave)' }}>Apliquei</span>
            <span className="tabular ml-2 font-semibold">{dinheiro(aplicado)}</span>
          </span>
          <span className="text-sm">
            <span style={{ color: 'var(--suave)' }}>Resgatei</span>
            <span className="tabular ml-2 font-semibold">{dinheiro(resgatado)}</span>
          </span>
          <span className="text-sm">
            <span style={{ color: 'var(--suave)' }}>Sobrou guardado</span>
            <span className="tabular ml-2 font-semibold"
                  style={{ color: aplicado - resgatado >= 0 ? 'var(--acento)' : 'var(--negativo)' }}>
              {dinheiro(aplicado - resgatado)}
            </span>
          </span>
        </div>
        {aberto && movimentos.map((m) => (
          <div key={m.hash_natural} className="flex items-center gap-3 border-t px-4 py-2.5 text-sm"
               style={{ borderColor: 'var(--borda)' }}>
            <span className="whitespace-nowrap tabular text-xs" style={{ color: 'var(--suave-claro)' }}>
              {dataCurta(m.data)}
            </span>
            <span className="flex-1 truncate">
              {m.valor < 0 ? 'Apliquei' : 'Resgatei'}
              <span className="ml-2 text-xs" style={{ color: 'var(--suave-claro)' }}>
                {m.metodo === 'pix' ? 'Pix para conta de investimento' : 'caixinha'}
              </span>
            </span>
            <span className="tabular font-semibold"
                  style={{ color: m.valor > 0 ? 'var(--entrada)' : undefined }}>
              {m.valor > 0 ? '+' : '−'}{dinheiro(Math.abs(m.valor))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── posição ────────────────────────────────────────────────────────────────

function LinhaAtivo({ ativo, qtd, pm, cotacao, custo, atual, ganho, historico, onSalvo, setErro }: {
  ativo: Ativo; qtd: number; pm: number; cotacao: Cotacao | null;
  custo: number; atual: number | null; ganho: number | null; historico: Provento[];
  onSalvo: () => Promise<void>; setErro: (v: string | null) => void;
}) {
  const estimativa = estimarProximo(historico);
  const registrados = historico.filter((h) => h.origem === 'manual').length;
  // Abre sozinho quando falta dado: o formulário estava escondido atrás de um
  // clique sem nenhuma affordance, e ninguém achava.
  const [aberto, setAberto] = useState(registrados < 2);
  const pct = custo > 0 && ganho !== null ? (ganho / custo) * 100 : null;
  const faltam = 2 - registrados;

  return (
    <div className="border-t first:border-t-0" style={{ borderColor: 'var(--borda)' }}>
      <button onClick={() => setAberto((v) => !v)}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
        <span className="font-medium">{ativo.ticker}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px]"
              style={{ background: '#eef0f4', color: 'var(--suave)' }}>
          {ROTULO_TIPO[ativo.tipo]}
        </span>
        <span className="flex-1 text-sm" style={{ color: 'var(--suave)' }}>
          {qtd} × {dinheiro(pm)}
          {cotacao && <> · hoje {dinheiro(cotacao.preco)}{cotacao.cache && ' (cache)'}</>}
        </span>
        {faltam > 0 && (
          <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={{ background: '#fef3c7', color: '#92400e' }}>
            faltam {faltam} provento(s) para eu prever
          </span>
        )}
        <span className="tabular text-[15px] font-semibold">{dinheiro(atual ?? custo)}</span>
        {pct !== null && (
          <span className="tabular w-20 text-right text-sm"
                style={{ color: pct >= 0 ? 'var(--entrada)' : 'var(--negativo)' }}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
          </span>
        )}
        <span aria-hidden className="text-xs" style={{ color: 'var(--suave-claro)' }}>
          {aberto ? '▲' : '▼'}
        </span>
      </button>

      {aberto && (
        <div className="border-t px-4 py-4" style={{ borderColor: 'var(--borda)', background: '#fafbfc' }}>
          {estimativa && (
            <p className="mb-3 rounded-lg px-3 py-2 text-sm"
               style={{ background: '#e7f0fb', color: '#1d4ed8' }}>
              Estimativa para {competenciaRotulo(estimativa.competencia)}:{' '}
              <strong>{dinheiro(estimativa.valorPorCota * qtd)}</strong>{' '}
              ({dinheiro(estimativa.valorPorCota)}/cota) — média dos últimos {estimativa.base} pagamentos.
              {estimativa.variacao > VARIACAO_ALTA && (
                <> Os valores variam muito entre si, então trate como ordem de grandeza, não como previsão.</>
              )}
            </p>
          )}

          <Proventos ativoId={ativo.id} qtd={qtd} historico={historico}
                     onSalvo={onSalvo} setErro={setErro} />

          <EditarPosicao ativo={ativo} qtd={qtd} pm={pm} onSalvo={onSalvo} setErro={setErro} />
        </div>
      )}
    </div>
  );
}

function Proventos({ ativoId, qtd, historico, onSalvo, setErro }: {
  ativoId: number; qtd: number; historico: Provento[];
  onSalvo: () => Promise<void>; setErro: (v: string | null) => void;
}) {
  // Com histórico, o próximo a registrar é o mês seguinte ao último. Sem
  // histórico, é o mês corrente — abrir em setembro para quem nunca registrou
  // nada faz a pessoa lançar no mês errado sem perceber.
  const ultimo = historico[0]?.competencia;
  const [competencia, setCompetencia] = useState(
    ultimo ? mesSeguinte(ultimo).slice(0, 7) : new Date().toISOString().slice(0, 7),
  );
  const [valor, setValor] = useState('');
  const [tipo, setTipo] = useState<TipoProvento>('rendimento');
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true); setErro(null);
    try {
      await registrarProvento(ativoId, `${competencia}-01`, Number(valor), tipo, null);
      setValor('');
      await onSalvo();
    } catch (e) { setErro(explicarErro(e)); }
    setOcupado(false);
  }

  const reais = historico.filter((p) => p.origem === 'manual');

  return (
    <div className="mb-4">
      <p className="rotulo mb-2">Proventos recebidos</p>
      {reais.length === 0 ? (
        <p className="mb-3 rounded-lg px-3 py-2 text-sm"
           style={{ background: '#fffbeb', color: '#92400e' }}>
          Nenhum provento registrado ainda. Preencha abaixo o valor <strong>por cota</strong> de
          cada mês — MXRF11 e outros FIIs anunciam mensalmente, e o valor está no
          extrato da corretora ou no site do fundo. Com dois meses eu começo a prever
          o próximo; com três a estimativa fica melhor.
        </p>
      ) : reais.length === 1 ? (
        <p className="mb-3 rounded-lg px-3 py-2 text-sm"
           style={{ background: '#fffbeb', color: '#92400e' }}>
          Falta um. Com um pagamento só não há média — mostrar o último valor como
          previsão seria dar cara de certeza a um palpite.
        </p>
      ) : (
        <div className="mb-3 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--borda)' }}>
          {reais.slice(0, 6).map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-t bg-white px-3 py-2 text-sm first:border-t-0"
                 style={{ borderColor: 'var(--borda)' }}>
              <span className="capitalize" style={{ color: 'var(--suave)' }}>
                {competenciaRotulo(p.competencia)}
              </span>
              <span className="flex-1 tabular" style={{ color: 'var(--suave)' }}>
                {dinheiro(p.valor_por_cota)}/cota
              </span>
              <span className="tabular font-medium">{dinheiro(p.valor_por_cota * qtd)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="rotulo">Mês</span>
          <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                 className="mt-1 border text-sm xs:text-xs" style={{ borderColor: 'var(--borda-forte)' }} />
        </label>
        <label className="block">
          <span className="rotulo">Valor por cota</span>
          <input type="number" step="0.01" min={0} value={valor} onChange={(e) => setValor(e.target.value.replace(/[e,E]/g, ''))}
                 placeholder="0,10" className="mt-1 w-28 border text-sm xs:text-xs"
                 style={{ borderColor: 'var(--borda-forte)' }} />
        </label>
        <label className="block">
          <span className="rotulo">Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoProvento)}
                  className="mt-1 border bg-white text-sm xs:text-xs" style={{ borderColor: 'var(--borda-forte)' }}>
            <option value="rendimento">Rendimento</option>
            <option value="dividendo">Dividendo</option>
            <option value="jcp">JCP</option>
            <option value="amortizacao">Amortização</option>
          </select>
        </label>
        <button onClick={salvar} disabled={ocupado || !(Number(valor) > 0)}
                className="btn btn-neutro disabled:opacity-40">Registrar</button>
        {Number(valor) > 0 && (
          <span className="pb-2 text-sm" style={{ color: 'var(--suave)' }}>
            = {dinheiro(Number(valor) * qtd)}
          </span>
        )}
      </div>
    </div>
  );
}

function EditarPosicao({ ativo, qtd, pm, onSalvo, setErro }: {
  ativo: Ativo; qtd: number; pm: number;
  onSalvo: () => Promise<void>; setErro: (v: string | null) => void;
}) {
  const [q, setQ] = useState(String(qtd));
  const [p, setP] = useState(String(pm));
  const [ocupado, setOcupado] = useState(false);

  const mudou = Number(q) !== qtd || Number(p) !== pm;

  return (
    <div className="flex flex-wrap items-end gap-3 border-t pt-4" style={{ borderColor: 'var(--borda)' }}>
      <label className="block">
        <span className="rotulo">Quantidade</span>
        <input type="number" step="0.01" min={0} value={q} onChange={(e) => setQ(e.target.value.replace(/[e,E]/g, ''))}
               className="mt-1 w-28 border text-sm xs:text-xs" style={{ borderColor: 'var(--borda-forte)' }} />
      </label>
      <label className="block">
        <span className="rotulo">Preço médio</span>
        <input type="number" step="0.01" min={0} value={p} onChange={(e) => setP(e.target.value.replace(/[e,E]/g, ''))}
               className="mt-1 w-28 border text-sm xs:text-xs" style={{ borderColor: 'var(--borda-forte)' }} />
      </label>
      <button onClick={async () => {
        setOcupado(true); setErro(null);
        try { await salvarPosicao(ativo.ticker, ativo.tipo, Number(q), Number(p), ativo.conta_id); await onSalvo(); }
        catch (e) { setErro(explicarErro(e)); }
        setOcupado(false);
      }} disabled={ocupado || !mudou} className="btn btn-neutro disabled:opacity-40">
        Salvar posição
      </button>
      <button onClick={async () => {
        setErro(null);
        try { await removerAtivo(ativo.id); await onSalvo(); }
        catch (e) { setErro(explicarErro(e)); }
      }} className="pb-2 text-xs underline" style={{ color: 'var(--suave)' }}>
        remover {ativo.ticker}
      </button>
    </div>
  );
}

function NovoAtivo({ onSalvo, setErro }: {
  onSalvo: () => Promise<void>; setErro: (v: string | null) => void;
}) {
  const [ticker, setTicker] = useState('');
  const [qtd, setQtd] = useState('');
  const [pm, setPm] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const t = ticker.trim().toUpperCase();
  const valido = TICKER_VALIDO.test(t) && Number(qtd) > 0 && Number(pm) > 0;

  return (
    <section className="painel p-5">
      <h2 className="rotulo mb-3">Adicionar posição</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="rotulo">Ticker</span>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                 placeholder="MXRF11" className="mt-1 w-32 border text-sm uppercase xs:text-xs"
                 style={{ borderColor: 'var(--borda-forte)' }} maxLength={6} />
        </label>
        <label className="block">
          <span className="rotulo">Quantidade</span>
          <input type="number" step="0.01" min={0} value={qtd} onChange={(e) => setQtd(e.target.value.replace(/[e,E]/g, ''))}
                 className="mt-1 w-28 border text-sm xs:text-xs" style={{ borderColor: 'var(--borda-forte)' }} />
        </label>
        <label className="block">
          <span className="rotulo">Preço médio</span>
          <input type="number" step="0.01" min={0} value={pm} onChange={(e) => setPm(e.target.value.replace(/[e,E]/g, ''))}
                 className="mt-1 w-28 border text-sm xs:text-xs" style={{ borderColor: 'var(--borda-forte)' }} />
        </label>
        <button onClick={async () => {
          setOcupado(true); setErro(null);
          try {
            await salvarPosicao(t, palpitarTipo(t), Number(qtd), Number(pm), null);
            setTicker(''); setQtd(''); setPm('');
            await onSalvo();
          } catch (e) { setErro(explicarErro(e)); }
          setOcupado(false);
        }} disabled={ocupado || !valido} className="btn btn-principal disabled:opacity-40">
          Adicionar
        </button>
      </div>
    </section>
  );
}
