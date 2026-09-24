'use client';

/**
 * Lançar mês.
 *
 * Mesmo padrão da aba Carteira: uma linha compacta por ativo, que abre para
 * editar. A versão anterior deixava todos os campos de todos os ativos
 * abertos ao mesmo tempo — com cinco ativos vira uma parede de inputs onde
 * não dá para ver o que já está preenchido e o que falta.
 *
 * A linha fechada responde "quanto tem e quanto entrou"; abrir é para
 * digitar. E, enquanto se digita, a prévia mostra o rendimento que aquele
 * número implica: é o jeito de pegar dígito trocado na hora, e não três
 * telas depois num gráfico torto.
 *
 * Salvar faz upsert da competência inteira: um mês é um fechamento só.
 */
import { useEffect, useMemo, useState } from 'react';
import { posicaoAtivo } from '../lib/calc';
import { competenciaAtual, dinheiro, pctSinal } from '../lib/formato';
import { esquecerCotacoes } from '../lib/cotacaoCache';
import { buscarCotacoes } from '../lib/mercado';
import type { Ativo, InvestState, ItemLancamento, Lancamento } from '../lib/types';
import css from '../investimentos.module.css';
import { Cartao, Tabela, Vazio } from './ui';

interface Campos { aporte: string; saldo: string; cotas: string; preco: string }
type Rascunho = Record<string, Campos>;

const vazio = (): Campos => ({ aporte: '', saldo: '', cotas: '', preco: '' });
const str = (v: number | undefined) => (v === undefined ? '' : String(v));
const nm = (v: string) => (v === '' ? 0 : Number(v));

/** Mesma higiene de input da Carteira: 'e'/'E' viram notação científica. */
const limpar = (v: string) => v.replace(/[eE]/g, '');

const paraItem = (a: Ativo, c: Campos): ItemLancamento =>
  a.modo === 'cotizado'
    ? { aporte: nm(c.aporte), cotas: nm(c.cotas), preco: nm(c.preco) }
    : { aporte: nm(c.aporte), saldo: nm(c.saldo) };

/** Linha preenchida é aquela com algum número digitado. */
const temAlgo = (c: Campos) => c.aporte !== '' || c.saldo !== '' || c.cotas !== '' || c.preco !== '';

export function LancarMes({ estado, onMudar }: {
  estado: InvestState;
  onMudar: (novo: InvestState) => void;
}) {
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [rascunho, setRascunho] = useState<Rascunho>({});
  const [aberto, setAberto] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);

  const jaLancado = useMemo(
    () => estado.lancamentos.find((l) => l.competencia === competencia),
    [estado.lancamentos, competencia],
  );

  /**
   * Fechamento imediatamente anterior ao mês escolhido.
   *
   * É a referência de tudo: sem o saldo anterior não há rendimento, e é o
   * número que diz se o que você acabou de digitar faz sentido.
   */
  const anterior = useMemo(() => {
    const antes = estado.lancamentos
      .filter((l) => l.competencia < competencia)
      .sort((a, b) => a.competencia.localeCompare(b.competencia));
    return antes.length ? antes[antes.length - 1] : null;
  }, [estado.lancamentos, competencia]);

  const comTicker = useMemo(
    () => estado.ativos.filter((a) => a.modo === 'cotizado' && a.ticker),
    [estado.ativos],
  );

  /**
   * Trocar de competência recarrega o formulário.
   *
   * Sem isto, escolher um mês já lançado mostraria os campos do mês anterior
   * e salvar sobrescreveria o fechamento com dado de outro mês.
   */
  useEffect(() => {
    const base: Rascunho = {};
    for (const a of estado.ativos) {
      const it = jaLancado?.itens[a.id];
      base[a.id] = it
        ? { aporte: str(it.aporte), saldo: str(it.saldo), cotas: str(it.cotas), preco: str(it.preco) }
        : vazio();
    }
    setRascunho(base);
    setAberto(null);
  }, [competencia, jaLancado, estado.ativos]);

  function mudar(ativoId: string, campo: keyof Campos, valor: string) {
    setRascunho((r) => ({ ...r, [ativoId]: { ...(r[ativoId] ?? vazio()), [campo]: limpar(valor) } }));
  }

  /**
   * Preenche o preço da cota a partir da brapi.
   *
   * Só mexe no campo `preco`. A quantidade de cotas continua manual — ela é
   * o que você comprou, não o que o mercado informa, e nenhuma API sabe isso.
   */
  /**
   * Busca sozinho ao abrir a aba.
   *
   * O cache é quem torna isso seguro: preço com menos de 30 minutos não vai à
   * rede, então reabrir a aba dez vezes no mesmo dia não gasta dez
   * requisições. Sem o cache isto seria um jeito rápido de torrar a cota.
   *
   * Roda uma vez por montagem, e não a cada mudança de competência: trocar de
   * mês não muda o preço de hoje.
   */
  useEffect(() => {
    if (comTicker.length > 0) buscarPrecos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buscarPrecos() {
    if (comTicker.length === 0) return;
    setBuscando(true);
    setAvisos([]);
    try {
      const { cotacoes, erros } = await buscarCotacoes(comTicker.map((a) => a.ticker!));
      const porTicker = new Map(cotacoes.map((c) => [c.ticker, c]));

      setRascunho((r) => {
        const novo = { ...r };
        for (const a of comTicker) {
          const c = porTicker.get(a.ticker!);
          if (c) novo[a.id] = { ...(novo[a.id] ?? vazio()), preco: String(c.preco) };
        }
        return novo;
      });

      const naoVieram = comTicker
        .filter((a) => !porTicker.has(a.ticker!))
        .map((a) => `${a.nome} (${a.ticker})`);
      setAvisos([
        ...erros,
        ...(naoVieram.length ? [`Sem preço para: ${naoVieram.join(', ')}.`] : []),
      ]);
    } catch (e) {
      setAvisos([e instanceof Error ? e.message : 'Não consegui consultar as cotações.']);
    } finally {
      setBuscando(false);
    }
  }

  function salvar() {
    const itens: Record<string, ItemLancamento> = {};
    for (const a of estado.ativos) itens[a.id] = paraItem(a, rascunho[a.id] ?? vazio());

    const novo: Lancamento = { competencia, itens };
    const outros = estado.lancamentos.filter((l) => l.competencia !== competencia);
    onMudar({
      ...estado,
      lancamentos: [...outros, novo].sort((a, b) => a.competencia.localeCompare(b.competencia)),
    });
    setAberto(null);
  }

  function remover(comp: string) {
    onMudar({ ...estado, lancamentos: estado.lancamentos.filter((l) => l.competencia !== comp) });
  }

  if (estado.ativos.length === 0) {
    return (
      <Cartao>
        <Vazio>
          Nenhum ativo cadastrado ainda.<br />
          Comece em <strong>Ativos &amp; premissas</strong> — sem ativo não há o que lançar.
        </Vazio>
      </Cartao>
    );
  }

  const total = estado.ativos.reduce((s, a) => s + posicaoAtivo(a, paraItem(a, rascunho[a.id] ?? vazio())), 0);
  const aporte = estado.ativos.reduce((s, a) => s + nm((rascunho[a.id] ?? vazio()).aporte), 0);
  const totalAnterior = anterior
    ? estado.ativos.reduce((s, a) => s + posicaoAtivo(a, anterior.itens[a.id]), 0)
    : 0;
  const faltam = estado.ativos.filter((a) => !temAlgo(rascunho[a.id] ?? vazio())).length;

  return (
    <>
      <Cartao
        titulo="Fechamento do mês"
        sub="Saldo no ÚLTIMO dia do mês. Em cotizado, o total acumulado de cotas — não as compradas no mês."
      >
        <div className={css.camposLinha} style={{ marginBottom: 14 }}>
          <label className={`${css.campo} ${css.campoCurto}`}>
            <span>Competência</span>
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </label>

          {comTicker.length > 0 && (
            <button type="button" className={css.botao} onClick={buscarPrecos} disabled={buscando}>
              {buscando ? 'Consultando…' : `Buscar cotação (${comTicker.length})`}
            </button>
          )}
          {comTicker.length > 0 && (
            <button
              type="button" className={css.linkEditar}
              onClick={() => { esquecerCotacoes(); setAvisos(['Cache de cotação limpo.']); }}
            >
              limpar cache
            </button>
          )}
        </div>

        {jaLancado && (
          <p className={css.nota} style={{ marginTop: 0, marginBottom: 10 }}>
            Esta competência já tem fechamento. Salvar <strong>substitui</strong> o que está gravado.
          </p>
        )}
        {avisos.length > 0 && (
          <p className={css.statusErro} style={{ marginBottom: 10 }}>{avisos.join(' · ')}</p>
        )}

        {estado.ativos.map((a) => (
          <LinhaLancamento
            key={a.id}
            ativo={a}
            campos={rascunho[a.id] ?? vazio()}
            anterior={anterior ? posicaoAtivo(a, anterior.itens[a.id]) : null}
            aberto={aberto === a.id}
            onAbrir={() => setAberto((v) => (v === a.id ? null : a.id))}
            onMudar={(campo, valor) => mudar(a.id, campo, valor)}
          />
        ))}

        <div className={css.acoes}>
          <button type="button" className={`${css.botao} ${css.principal}`} onClick={salvar}>
            {jaLancado ? 'Substituir fechamento' : 'Salvar fechamento'}
          </button>
          <span className={css.status}>
            patrimônio <strong className={css.mono}>{dinheiro(total)}</strong>
            {' · '}aportado <strong className={css.mono}>{dinheiro(aporte)}</strong>
            {anterior && (
              <>
                {' · '}rendimento{' '}
                <strong className={css.mono}>{dinheiro(total - totalAnterior - aporte)}</strong>
              </>
            )}
          </span>
          {faltam > 0 && (
            <span className={css.status}>
              {faltam} ativo(s) sem número — entram como zero.
            </span>
          )}
        </div>
      </Cartao>

      <Cartao titulo="Fechamentos lançados" sub={`${estado.lancamentos.length} mês(es) na base.`}>
        {estado.lancamentos.length === 0
          ? <Vazio>Nada lançado ainda.</Vazio>
          : (
            <Tabela>
              <thead>
                <tr><th>Competência</th><th>Aportado</th><th>Patrimônio</th><th /></tr>
              </thead>
              <tbody>
                {[...estado.lancamentos].reverse().map((l) => {
                  const t = estado.ativos.reduce((s, a) => s + posicaoAtivo(a, l.itens[a.id]), 0);
                  const ap = estado.ativos.reduce((s, a) => s + (l.itens[a.id]?.aporte ?? 0), 0);
                  return (
                    <tr key={l.competencia}>
                      <td>
                        <button type="button" className={css.linkEditar}
                                onClick={() => setCompetencia(l.competencia)}>
                          {l.competencia}
                        </button>
                      </td>
                      <td>{dinheiro(ap)}</td>
                      <td>{dinheiro(t)}</td>
                      <td>
                        <button type="button" className={css.perigo} onClick={() => remover(l.competencia)}>
                          remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          )}
      </Cartao>
    </>
  );
}

/**
 * Uma linha por ativo: fechada mostra o número, aberta deixa digitar.
 *
 * A prévia embaixo dos campos traduz o que foi digitado em rendimento do
 * mês — o número que a aba Rentabilidade vai mostrar depois. Ver isso na
 * hora de lançar é o que faz um saldo digitado errado saltar aos olhos.
 */
function LinhaLancamento({ ativo, campos, anterior, aberto, onAbrir, onMudar }: {
  ativo: Ativo;
  campos: Campos;
  anterior: number | null;
  aberto: boolean;
  onAbrir: () => void;
  onMudar: (campo: keyof Campos, valor: string) => void;
}) {
  const posicao = posicaoAtivo(ativo, paraItem(ativo, campos));
  const preenchido = temAlgo(campos);
  const ap = nm(campos.aporte);

  // Mesma conta de `calc.rendimentos`, feita aqui só para a prévia: a base é
  // o saldo anterior mais metade do aporte, porque o aporte rendeu, em média,
  // metade do mês.
  const rendimento = anterior !== null ? posicao - anterior - ap : null;
  const base = anterior !== null ? anterior + ap / 2 : 0;
  const pctMes = rendimento !== null && base > 0 ? (rendimento / base) * 100 : null;

  return (
    <div className={css.linhaAtivo}>
      <div className={css.linhaTopo}>
        <span className={css.linhaNome}>
          {ativo.nome}
          <span className={css.etiqueta}>{ativo.modo === 'cotizado' ? 'cotizado' : 'saldo'}</span>
          {ativo.ticker && <span className={css.etiqueta}>{ativo.ticker}</span>}
        </span>

        {anterior !== null && (
          <span className={css.linhaSecundario}>antes {dinheiro(anterior)}</span>
        )}
        {ap !== 0 && <span className={css.linhaSecundario}>aporte {dinheiro(ap)}</span>}

        <span className={`${css.linhaValor} ${preenchido ? '' : css.pendente}`}>
          {preenchido ? dinheiro(posicao) : '—'}
        </span>

        <button type="button" className={css.linkEditar} onClick={onAbrir} aria-expanded={aberto}>
          {aberto ? 'fechar' : preenchido ? 'editar' : 'informar'}
        </button>
      </div>

      {aberto && (
        <div className={css.painelEdicao}>
          <div className={css.camposLinha}>
            <label className={`${css.campo} ${css.campoCurto}`}>
              <span>Aportei no mês</span>
              <input type="number" step="0.01" inputMode="decimal" value={campos.aporte}
                     onChange={(e) => onMudar('aporte', e.target.value)} placeholder="0,00" />
            </label>

            {ativo.modo === 'saldo' ? (
              <label className={`${css.campo} ${css.campoCurto}`}>
                <span>Saldo no fim do mês</span>
                <input type="number" step="0.01" inputMode="decimal" value={campos.saldo}
                       onChange={(e) => onMudar('saldo', e.target.value)} placeholder="0,00" />
              </label>
            ) : (
              <>
                <label className={`${css.campo} ${css.campoCurto}`}>
                  <span>Total de cotas</span>
                  <input type="number" step="0.00000001" inputMode="decimal" value={campos.cotas}
                         onChange={(e) => onMudar('cotas', e.target.value)} placeholder="0" />
                </label>
                <label className={`${css.campo} ${css.campoCurto}`}>
                  <span>Preço da cota</span>
                  <input type="number" step="0.01" inputMode="decimal" value={campos.preco}
                         onChange={(e) => onMudar('preco', e.target.value)} placeholder="0,00" />
                </label>
              </>
            )}

            <span className={css.linhaValor} style={{ paddingBottom: 9 }}>= {dinheiro(posicao)}</span>
          </div>

          {rendimento !== null && preenchido && (
            <p className={css.previa}>
              Contra os <strong>{dinheiro(anterior!)}</strong> do mês anterior e{' '}
              <strong>{dinheiro(ap)}</strong> aportados, isso dá um rendimento de{' '}
              <strong className={rendimento >= 0 ? css.pos : css.neg}>{dinheiro(rendimento)}</strong>
              {pctMes !== null && <> ({pctSinal(pctMes)} no mês)</>}.
            </p>
          )}
          {anterior === null && preenchido && (
            <p className={css.previa}>
              Primeiro fechamento deste ativo: vira a base de comparação, sem rendimento medido.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
