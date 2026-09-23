'use client';

/**
 * Lançar mês.
 *
 * Um bloco por ativo, campos conforme o modo, e a posição recalculada
 * enquanto se digita — ver o número fechar é o que pega erro de digitação na
 * hora, em vez de três telas depois num gráfico torto.
 *
 * Salvar faz upsert da competência inteira: um mês é um fechamento só.
 */
import { useEffect, useMemo, useState } from 'react';
import { posicaoAtivo } from '../lib/calc';
import { competenciaAtual, dinheiro } from '../lib/formato';
import type { InvestState, ItemLancamento, Lancamento } from '../lib/types';
import css from '../investimentos.module.css';
import { Cartao, Tabela, Vazio } from './ui';

type Rascunho = Record<string, { aporte: string; saldo: string; cotas: string; preco: string }>;

const vazio = () => ({ aporte: '', saldo: '', cotas: '', preco: '' });
const str = (v: number | undefined) => (v === undefined ? '' : String(v));
const nm = (v: string) => (v === '' ? 0 : Number(v));

export function LancarMes({ estado, onMudar }: {
  estado: InvestState;
  onMudar: (novo: InvestState) => void;
}) {
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [rascunho, setRascunho] = useState<Rascunho>({});

  const jaLancado = useMemo(
    () => estado.lancamentos.find((l) => l.competencia === competencia),
    [estado.lancamentos, competencia],
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
  }, [competencia, jaLancado, estado.ativos]);

  function mudar(ativoId: string, campo: keyof ReturnType<typeof vazio>, valor: string) {
    setRascunho((r) => ({ ...r, [ativoId]: { ...(r[ativoId] ?? vazio()), [campo]: valor } }));
  }

  function salvar() {
    const itens: Record<string, ItemLancamento> = {};
    for (const a of estado.ativos) {
      const r = rascunho[a.id] ?? vazio();
      itens[a.id] = a.modo === 'cotizado'
        ? { aporte: nm(r.aporte), cotas: nm(r.cotas), preco: nm(r.preco) }
        : { aporte: nm(r.aporte), saldo: nm(r.saldo) };
    }

    const novo: Lancamento = { competencia, itens };
    const outros = estado.lancamentos.filter((l) => l.competencia !== competencia);
    onMudar({
      ...estado,
      lancamentos: [...outros, novo].sort((a, b) => a.competencia.localeCompare(b.competencia)),
    });
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

  const totalRascunho = estado.ativos.reduce((s, a) => {
    const r = rascunho[a.id] ?? vazio();
    return s + posicaoAtivo(a, { aporte: nm(r.aporte), saldo: nm(r.saldo), cotas: nm(r.cotas), preco: nm(r.preco) });
  }, 0);
  const aporteRascunho = estado.ativos.reduce((s, a) => s + nm((rascunho[a.id] ?? vazio()).aporte), 0);

  return (
    <>
      <Cartao
        titulo="Fechamento do mês"
        sub="Saldo no ÚLTIMO dia do mês. Em cotizado, o total acumulado de cotas — não as compradas no mês."
      >
        <div className={css.campos} style={{ marginBottom: 16 }}>
          <label className={css.campo}>
            <span>Competência</span>
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </label>
        </div>

        {jaLancado && (
          <p className={css.nota} style={{ marginTop: 0, marginBottom: 12 }}>
            Esta competência já tem fechamento. Salvar <strong>substitui</strong> o que está gravado.
          </p>
        )}

        {estado.ativos.map((a) => {
          const r = rascunho[a.id] ?? vazio();
          const posicao = posicaoAtivo(a, {
            aporte: nm(r.aporte), saldo: nm(r.saldo), cotas: nm(r.cotas), preco: nm(r.preco),
          });

          return (
            <div key={a.id} className={css.blocoAtivo}>
              <div className={css.blocoTopo}>
                <span className={css.blocoNome}>
                  {a.nome}
                  <span className={css.etiqueta}>{a.modo === 'cotizado' ? 'cotizado' : 'saldo'}</span>
                </span>
                <span className={css.blocoPosicao}>{dinheiro(posicao)}</span>
              </div>

              <div className={css.campos}>
                <label className={css.campo}>
                  <span>Aportei no mês</span>
                  <input type="number" step={10} inputMode="decimal" value={r.aporte}
                         onChange={(e) => mudar(a.id, 'aporte', e.target.value)} placeholder="0,00" />
                </label>

                {a.modo === 'saldo' ? (
                  <label className={css.campo}>
                    <span>Saldo no fim do mês</span>
                    <input type="number" step={10} inputMode="decimal" value={r.saldo}
                           onChange={(e) => mudar(a.id, 'saldo', e.target.value)} placeholder="0,00" />
                  </label>
                ) : (
                  <>
                    <label className={css.campo}>
                      <span>Total de cotas</span>
                      <input type="number" step="0.00000001" inputMode="decimal" value={r.cotas}
                             onChange={(e) => mudar(a.id, 'cotas', e.target.value)} placeholder="0" />
                    </label>
                    <label className={css.campo}>
                      <span>Preço da cota</span>
                      <input type="number" step="0.01" inputMode="decimal" value={r.preco}
                             onChange={(e) => mudar(a.id, 'preco', e.target.value)} placeholder="0,00" />
                    </label>
                  </>
                )}
              </div>
            </div>
          );
        })}

        <div className={css.acoes}>
          <button type="button" className={`${css.botao} ${css.principal}`} onClick={salvar}>
            {jaLancado ? 'Substituir fechamento' : 'Salvar fechamento'}
          </button>
          <span className={css.status}>
            patrimônio <strong className={css.mono}>{dinheiro(totalRascunho)}</strong>
            {' · '}aportado <strong className={css.mono}>{dinheiro(aporteRascunho)}</strong>
          </span>
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
                  const total = estado.ativos.reduce((s, a) => s + posicaoAtivo(a, l.itens[a.id]), 0);
                  const ap = estado.ativos.reduce((s, a) => s + (l.itens[a.id]?.aporte ?? 0), 0);
                  return (
                    <tr key={l.competencia}>
                      <td>{l.competencia}</td>
                      <td>{dinheiro(ap)}</td>
                      <td>{dinheiro(total)}</td>
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
