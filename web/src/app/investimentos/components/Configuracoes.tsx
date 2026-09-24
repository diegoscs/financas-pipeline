'use client';

/**
 * Ativos & premissas.
 *
 * Primeira aba do fluxo porque sem ativo cadastrado nada mais funciona: não
 * há o que lançar, logo não há posição, logo não há rendimento nem projeção.
 */
import { useState } from 'react';
import {
  CLASSES, PERCENTUAL_CDI_PADRAO, percentualCdiCarteira, posicoes, slug, taxaRendaFixaMes,
} from '../lib/calc';
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

  const temRendaFixa = estado.ativos.some((a) => a.classe === 'renda_fixa');
  const cdiVigente = auto && cdi ? cdi.anual : p.cdi2026;
  // Traduz as três premissas de renda fixa no único número que a pessoa
  // consegue conferir contra o extrato: quanto rende por mês.
  const rfAoMes = taxaRendaFixaMes(cdiVigente, p.ir, pctCarteira) * 100;
  const sobra = p.liquido2026 - p.gasto;

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

      <Cartao
        titulo="Quanto sobra por mês"
        sub="É daqui que sai o aporte da projeção. O que já rendeu é medido — isto não mexe nele."
      >
        <div className={css.camposLinha}>
          <CampoNumero rotulo="Custo de vida" prefixo="R$" valor={p.gasto} passo={50}
                       onMudar={(v) => mudarPremissa('gasto', v)} />
          <span className={css.operador}>−</span>
          <CampoNumero rotulo="Entra por mês" prefixo="R$" valor={p.liquido2026} passo={50}
                       onMudar={(v) => mudarPremissa('liquido2026', v)} />
          <span className={css.operador}>=</span>
          <span className={css.resultado}>
            <span className={css.resultadoValor}>{dinheiro(sobra)}</span>
            <span className={css.resultadoRotulo}>por mês</span>
          </span>
        </div>

        {/*
          A conta é `entra − custo`, nessa ordem de leitura. Os campos aparecem
          invertidos de propósito: custo de vida vem primeiro porque é o número
          que manda em três coisas — o aporte, as metas de reserva e os "meses
          cobertos" —, e é o único que a pessoa revisa de verdade.
        */}
        <p className={css.previa}>
          {sobra > 0
            ? <>Com esse custo, a reserva de 6 meses é <strong>{dinheiro(p.gasto * 6)}</strong> e
               a de 12, <strong>{dinheiro(p.gasto * 12)}</strong>.</>
            : <>Sem sobra não há aporte: a projeção só cresce pelo rendimento.</>}
        </p>

        <details className={css.detalhes}>
          <summary>
            A partir de 2027 entra outro valor
            <span className={css.resumoFechado}>{dinheiro(p.liquido2027)}/mês</span>
          </summary>
          <div className={css.camposLinha} style={{ marginTop: 10 }}>
            <CampoNumero rotulo="Entra por mês em 2027" prefixo="R$" valor={p.liquido2027} passo={50}
                         onMudar={(v) => mudarPremissa('liquido2027', v)} />
            <span className={css.previa} style={{ margin: 0, alignSelf: 'center' }}>
              sobram {dinheiro(p.liquido2027 - p.gasto)}/mês
            </span>
          </div>
        </details>
      </Cartao>

      <Cartao titulo="Quanto o dinheiro rende" sub="Usado só para projetar o futuro.">
        <div className={css.camposLinha}>
          <label className={css.caixaLinha}>
            <input type="checkbox" checked={auto} onChange={(e) => mudarAuto(e.target.checked)} />
            Pegar o CDI do Banco Central
          </label>

          {auto && cdi && (
            <span className={css.status}>
              hoje <strong className={css.mono}>{pct(cdi.anual, 2)}</strong> a.a. · série de {cdi.data}
            </span>
          )}
          {auto && !cdi && (
            <span className={css.status}>
              não consegui a taxa — usando {pct(p.cdi2026, 2)} guardado
            </span>
          )}
          <button type="button" className={css.linkEditar} onClick={onAtualizarCdi}>
            atualizar
          </button>
        </div>

        {!auto && (
          <div className={css.camposLinha} style={{ marginTop: 10 }}>
            <CampoNumero rotulo="CDI em 2026" sufixo="% a.a." valor={p.cdi2026} passo={0.05}
                         onMudar={(v) => mudarPremissa('cdi2026', v)} />
            <CampoNumero rotulo="CDI em 2027" sufixo="% a.a." valor={p.cdi2027} passo={0.05}
                         onMudar={(v) => mudarPremissa('cdi2027', v)} />
          </div>
        )}

        {temRendaFixa && (
          <p className={css.previa}>
            Sua renda fixa rende <strong>{pct(pctCarteira, 0)} do CDI</strong> na média ponderada
            pelo saldo, o que dá <strong>{pct(rfAoMes, 2)} ao mês</strong>, já descontado o IR.
          </p>
        )}

        {/*
          Os quatro parâmetros abaixo saem da frente por padrão.
          Não é esconder: é que são os únicos que quase nunca mudam, e
          deixá-los ao lado do custo de vida dava sete campos iguais em que
          nada indicava qual importa. O resumo fechado mostra o que valem.
        */}
        <details className={css.detalhes}>
          <summary>
            Ajustar o rendimento estimado
            <span className={css.resumoFechado}>
              FII {pct(p.dividendoFii + p.valorizacaoCota, 1)}/mês ·
              {' '}ações {pct(p.retornoAcoes, 1)}/mês · IR {pct(p.ir, 0)}
            </span>
          </summary>

          <div className={css.campos} style={{ marginTop: 12 }}>
            <CampoNumero rotulo="IR sobre a renda fixa" sufixo="%" valor={p.ir} passo={1}
                         ajuda="20% é a alíquota de quem deixa aplicado mais de 2 anos"
                         onMudar={(v) => mudarPremissa('ir', v)} />
            <CampoNumero rotulo="Dividendo de FII" sufixo="% ao mês" valor={p.dividendoFii} passo={0.05}
                         ajuda="o que o fundo paga em rendimento"
                         onMudar={(v) => mudarPremissa('dividendoFii', v)} />
            <CampoNumero rotulo="Valorização da cota" sufixo="% ao mês" valor={p.valorizacaoCota} passo={0.05}
                         ajuda="quanto o preço da cota sobe além do dividendo"
                         onMudar={(v) => mudarPremissa('valorizacaoCota', v)} />
            <CampoNumero rotulo="Retorno de ações" sufixo="% ao mês" valor={p.retornoAcoes} passo={0.05}
                         ajuda="vale também para cripto"
                         onMudar={(v) => mudarPremissa('retornoAcoes', v)} />
          </div>

          <p className={css.nota}>
            Renda fixa: <code>((1 + CDI)^(1/12) − 1) × % do CDI × (1 − IR)</code>.
            FII soma dividendo e valorização. Ações e cripto usam o retorno de ações.
          </p>
        </details>
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

/**
 * Campo numérico com unidade grudada no rótulo.
 *
 * `R$` e `% ao mês` ficam fora do nome porque os rótulos em caixa alta
 * quebravam linha no meio da unidade — "VALORIZAÇÃO DA COTA (% AO / MÊS)" —
 * e desalinhavam a grade inteira.
 */
function CampoNumero({ rotulo, valor, passo, prefixo, sufixo, ajuda, onMudar }: {
  rotulo: string; valor: number; passo: number;
  prefixo?: string; sufixo?: string; ajuda?: string;
  onMudar: (v: number) => void;
}) {
  return (
    <label className={`${css.campo} ${css.campoCurto}`}>
      <span>
        {rotulo}
        {sufixo && <span className={css.unidade}> {sufixo}</span>}
      </span>
      <span className={css.entradaComPrefixo}>
        {prefixo && <span className={css.prefixo}>{prefixo}</span>}
        <input
          type="number" step={passo} value={valor}
          // Campo vazio vira 0 e não NaN: NaN contaminaria a projeção inteira
          // sem levantar uma exceção sequer.
          onChange={(e) => onMudar(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      </span>
      {ajuda && <span className={css.ajuda}>{ajuda}</span>}
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
