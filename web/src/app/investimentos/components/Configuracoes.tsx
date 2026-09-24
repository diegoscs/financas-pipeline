'use client';

/**
 * Ativos & premissas.
 *
 * Primeira aba do fluxo porque sem ativo cadastrado nada mais funciona: não
 * há o que lançar, logo não há posição, logo não há rendimento nem projeção.
 */
import { useState } from 'react';
import { CLASSES, PERCENTUAL_CDI_PADRAO, percentualCdiCarteira, posicoes, slug } from '../lib/calc';
import { dinheiro, pct } from '../lib/formato';
import { TICKER_VALIDO, type CdiGuardado } from '../lib/cotacaoCache';
import type { Ativo, Classe, InvestState, Modo, Premissas } from '../lib/types';
import css from '../investimentos.module.css';
import { Cartao, Tabela } from './ui';

const MODOS: { id: Modo; rotulo: string; ajuda: string }[] = [
  { id: 'saldo', rotulo: 'Saldo', ajuda: 'o app do banco mostra um número' },
  { id: 'cotizado', rotulo: 'Cotizado', ajuda: 'você sabe as cotas e a cotação' },
];

const nomeClasse = (c: Classe) => CLASSES.find((x) => x.id === c)?.nome ?? c;

export function Configuracoes({ estado, onMudar, cdi, onAtualizarCdi }: {
  estado: InvestState;
  onMudar: (novo: InvestState) => void;
  cdi: CdiGuardado | null;
  onAtualizarCdi: () => void;
}) {
  const [nome, setNome] = useState('');
  const [classe, setClasse] = useState<Classe>('renda_fixa');
  const [modo, setModo] = useState<Modo>('saldo');
  const [ticker, setTicker] = useState('');
  const [percentualCdi, setPercentualCdi] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function adicionar() {
    const limpo = nome.trim();
    if (!limpo) { setErro('Dê um nome ao ativo.'); return; }

    const id = slug(limpo);
    if (!id) { setErro('Esse nome não gera um identificador válido.'); return; }
    if (estado.ativos.some((a) => a.id === id)) {
      setErro(`Já existe um ativo com o identificador "${id}".`);
      return;
    }

    const t = ticker.trim().toUpperCase();
    if (t && !TICKER_VALIDO.test(t)) {
      setErro(`"${t}" não parece um código da B3 — são 4 a 6 letras ou números.`);
      return;
    }

    const p = percentualCdi === '' ? undefined : Number(percentualCdi);
    if (p !== undefined && !(p > 0)) {
      setErro('O percentual do CDI tem que ser maior que zero.');
      return;
    }

    setErro(null);
    setNome('');
    setTicker('');
    setPercentualCdi('');
    onMudar({
      ...estado,
      ativos: [...estado.ativos, {
        id, nome: limpo, classe, modo,
        ...(t ? { ticker: t } : {}),
        ...(p !== undefined ? { percentualCdi: p } : {}),
      }],
    });
  }

  /** Muda o percentual do CDI de um ativo já cadastrado, direto na tabela. */
  function mudarPercentual(id: string, valor: string) {
    const p = valor === '' ? undefined : Number(valor);
    onMudar({
      ...estado,
      ativos: estado.ativos.map((a) => {
        if (a.id !== id) return a;
        const { percentualCdi: _, ...resto } = a;
        void _;
        return p !== undefined && p > 0 ? { ...resto, percentualCdi: p } : resto;
      }),
    });
  }

  /**
   * Remover o ativo NÃO apaga os lançamentos dele.
   *
   * Os itens ficam guardados chaveados pelo id; como `posicoes()` percorre a
   * lista de ativos, some da conta sem sumir do disco. Recadastrar com o
   * mesmo nome traz o histórico de volta — e evita que um clique errado
   * destrua meses de digitação.
   */
  function remover(id: string) {
    onMudar({ ...estado, ativos: estado.ativos.filter((a) => a.id !== id) });
  }

  function mudarPremissa(campo: keyof Premissas, valor: number) {
    onMudar({ ...estado, premissas: { ...estado.premissas, [campo]: valor } });
  }

  function mudarDecimo(comp: string, valor: number) {
    onMudar({
      ...estado,
      premissas: {
        ...estado.premissas,
        decimoTerceiro: { ...estado.premissas.decimoTerceiro, [comp]: valor },
      },
    });
  }

  function removerDecimo(comp: string) {
    const { [comp]: _, ...resto } = estado.premissas.decimoTerceiro;
    void _;
    onMudar({ ...estado, premissas: { ...estado.premissas, decimoTerceiro: resto } });
  }

  function mudarAuto(valor: boolean) {
    onMudar({ ...estado, premissas: { ...estado.premissas, cdiAutomatico: valor } });
  }

  const p = estado.premissas;
  // Ausente conta como ligado: é o padrão, e um estado gravado antes deste
  // campo existir não deve cair no modo manual sem ninguém ter pedido.
  const auto = p.cdiAutomatico !== false;
  const decimos = Object.entries(p.decimoTerceiro).sort(([a], [b]) => a.localeCompare(b));

  /** O que a projeção realmente vai usar na renda fixa, já ponderado. */
  const pctCarteira = percentualCdiCarteira(
    estado.ativos,
    posicoes(estado.ativos, estado.lancamentos).slice(-1)[0],
  );

  return (
    <>
      <Cartao titulo="Ativos" sub="O identificador vem do nome e é o que liga os lançamentos ao ativo.">
        <div className={css.campos}>
          <label className={css.campo}>
            <span>Nome</span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') adicionar(); }}
              placeholder="Caixinha Nubank"
            />
          </label>
          <label className={css.campo}>
            <span>Classe</span>
            <select value={classe} onChange={(e) => setClasse(e.target.value as Classe)}>
              {CLASSES.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label className={css.campo}>
            <span>Como você sabe o saldo</span>
            <select value={modo} onChange={(e) => setModo(e.target.value as Modo)}>
              {MODOS.map((m) => <option key={m.id} value={m.id}>{m.rotulo} — {m.ajuda}</option>)}
            </select>
          </label>
          <label className={css.campo}>
            <span>Código na B3 (opcional)</span>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="MXRF11"
              maxLength={6}
            />
          </label>
          {classe === 'renda_fixa' && (
            <label className={css.campo}>
              <span>Rende quantos % do CDI</span>
              <input
                type="number" step="1" min="1" value={percentualCdi}
                onChange={(e) => setPercentualCdi(e.target.value.replace(/[eE]/g, ''))}
                placeholder="100"
              />
            </label>
          )}
        </div>

        <div className={css.acoes}>
          <button type="button" className={`${css.botao} ${css.principal}`} onClick={adicionar}>
            Adicionar ativo
          </button>
          {nome.trim() && <span className={css.status}>id: <code>{slug(nome)}</code></span>}
          {erro && <span className={css.statusErro}>{erro}</span>}
        </div>

        {estado.ativos.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Tabela>
              <thead>
                <tr><th>Ativo</th><th>Classe</th><th>Modo</th><th>B3</th><th>% do CDI</th><th /></tr>
              </thead>
              <tbody>
                {estado.ativos.map((a: Ativo) => (
                  <tr key={a.id}>
                    <td>{a.nome}</td>
                    <td>{nomeClasse(a.classe)}</td>
                    <td>{a.modo === 'cotizado' ? 'Cotizado' : 'Saldo'}</td>
                    <td>{a.ticker ?? '—'}</td>
                    <td>
                      {a.classe === 'renda_fixa' ? (
                        <input
                          type="number" step="1" min="1" style={{ width: 72 }}
                          value={a.percentualCdi ?? ''}
                          placeholder={String(PERCENTUAL_CDI_PADRAO)}
                          onChange={(e) => mudarPercentual(a.id, e.target.value.replace(/[eE]/g, ''))}
                        />
                      ) : '—'}
                    </td>
                    <td>
                      <button type="button" className={css.perigo} onClick={() => remover(a.id)}>
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
            <p className={css.nota}>
              Remover tira o ativo das contas, mas <strong>não apaga os lançamentos</strong>.
              Recadastrar com o mesmo nome traz o histórico de volta.
            </p>
          </div>
        )}
      </Cartao>

      <Cartao titulo="Premissas" sub="Valem só para a projeção. O rendimento já realizado é medido, nunca estimado.">
        <div className={css.camposLinha} style={{ marginBottom: 14 }}>
          <label className={css.campo} style={{ flex: '1 1 auto' }}>
            <span>CDI</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', paddingTop: 6 }}>
              <input
                type="checkbox" checked={auto} style={{ width: 'auto', minHeight: 0 }}
                onChange={(e) => mudarAuto(e.target.checked)}
              />
              Usar a taxa do Banco Central automaticamente
            </label>
          </label>

          {auto && cdi && (
            <span className={css.status}>
              <strong className={css.mono}>{pct(cdi.anual, 2)}</strong> a.a. · série de {cdi.data}
            </span>
          )}
          {auto && !cdi && (
            <span className={css.status}>
              ainda não consegui a taxa — a projeção está usando {pct(p.cdi2026, 2)} guardado
            </span>
          )}
          <button type="button" className={css.linkEditar} onClick={onAtualizarCdi}>
            atualizar agora
          </button>
        </div>

        <div className={css.campos}>
          <CampoNumero rotulo="Custo de vida (R$/mês)" valor={p.gasto} passo={50}
                       onMudar={(v) => mudarPremissa('gasto', v)} />
          <CampoNumero rotulo="Líquido 2026 (R$/mês)" valor={p.liquido2026} passo={50}
                       onMudar={(v) => mudarPremissa('liquido2026', v)} />
          <CampoNumero rotulo="Líquido 2027 (R$/mês)" valor={p.liquido2027} passo={50}
                       onMudar={(v) => mudarPremissa('liquido2027', v)} />
          {!auto && (
            <>
              <CampoNumero rotulo="CDI 2026 (% a.a.)" valor={p.cdi2026} passo={0.05}
                           onMudar={(v) => mudarPremissa('cdi2026', v)} />
              <CampoNumero rotulo="CDI 2027 (% a.a.)" valor={p.cdi2027} passo={0.05}
                           onMudar={(v) => mudarPremissa('cdi2027', v)} />
            </>
          )}
          <CampoNumero rotulo="IR na renda fixa (%)" valor={p.ir} passo={1}
                       onMudar={(v) => mudarPremissa('ir', v)} />
          <CampoNumero rotulo="Dividendo FII (% ao mês)" valor={p.dividendoFii} passo={0.05}
                       onMudar={(v) => mudarPremissa('dividendoFii', v)} />
          <CampoNumero rotulo="Valorização da cota (% ao mês)" valor={p.valorizacaoCota} passo={0.05}
                       onMudar={(v) => mudarPremissa('valorizacaoCota', v)} />
          <CampoNumero rotulo="Retorno ações (% ao mês)" valor={p.retornoAcoes} passo={0.05}
                       onMudar={(v) => mudarPremissa('retornoAcoes', v)} />
        </div>

        <p className={css.nota}>
          A projeção da renda fixa usa{' '}
          <code>((1 + CDI)^(1/12) − 1) × % do CDI × (1 − IR)</code>; FII soma dividendo e
          valorização; ações e cripto usam o retorno de ações. Tudo recalcula na hora.
          {estado.ativos.some((a) => a.classe === 'renda_fixa') && (
            <>
              {' '}Sua renda fixa hoje rende, na média ponderada pelo saldo,{' '}
              <strong>{pct(pctCarteira, 0)} do CDI</strong>.
            </>
          )}
        </p>
      </Cartao>

      <Cartao titulo="13º e entradas extras"
              sub="Somadas ao aporte só na competência indicada. Férias e o terço entram aqui se você quiser.">
        {decimos.length === 0
          ? <p className={css.nota}>Nenhuma entrada extra cadastrada.</p>
          : (
            <Tabela>
              <thead><tr><th>Competência</th><th>Valor</th><th /></tr></thead>
              <tbody>
                {decimos.map(([comp, valor]) => (
                  <tr key={comp}>
                    <td>{comp}</td>
                    <td>{dinheiro(valor)}</td>
                    <td>
                      <button type="button" className={css.perigo} onClick={() => removerDecimo(comp)}>
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        <NovoDecimo onAdicionar={mudarDecimo} />
      </Cartao>
    </>
  );
}

/**
 * Traz o CDI de hoje do Banco Central (série 12, pela rota `/api/mercado`).
 *
 * Preenche os dois anos com a taxa atual, mas NÃO aplica sozinho: projetar
 * 2027 com o CDI de hoje é uma escolha, não um fato. O botão mostra o número
 * e espera a confirmação.
 */

function CampoNumero({ rotulo, valor, passo, onMudar }: {
  rotulo: string; valor: number; passo: number; onMudar: (v: number) => void;
}) {
  return (
    <label className={css.campo}>
      <span>{rotulo}</span>
      <input
        type="number" step={passo} value={valor}
        // Campo vazio vira 0 e não NaN: NaN contaminaria a projeção inteira
        // sem levantar uma exceção sequer.
        onChange={(e) => onMudar(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </label>
  );
}

function NovoDecimo({ onAdicionar }: { onAdicionar: (comp: string, valor: number) => void }) {
  const [comp, setComp] = useState('');
  const [valor, setValor] = useState('');

  return (
    <div className={css.acoes}>
      <label className={css.campo} style={{ flex: '1 1 150px' }}>
        <span>Competência</span>
        <input type="month" value={comp} onChange={(e) => setComp(e.target.value)} />
      </label>
      <label className={css.campo} style={{ flex: '1 1 150px' }}>
        <span>Valor (R$)</span>
        <input type="number" step={50} value={valor} onChange={(e) => setValor(e.target.value)} />
      </label>
      <button
        type="button" className={css.botao}
        disabled={!comp || valor === ''}
        onClick={() => { onAdicionar(comp, Number(valor)); setComp(''); setValor(''); }}
      >
        Adicionar
      </button>
    </div>
  );
}
