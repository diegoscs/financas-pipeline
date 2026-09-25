'use client';

/**
 * Metas e simulador.
 *
 * Você diz três coisas — quanto quer ter, em quanto tempo e quanto pretende
 * aportar — e a tela responde as duas que faltam:
 *
 *   • com esse aporte, quando você chega
 *   • para chegar no prazo, quanto teria que aportar
 *
 * O ponto de partida é o patrimônio real da Carteira, não um número digitado.
 * A conta toda está em `simulador.ts`; aqui não se calcula nada.
 */
import { useState } from 'react';
import {
  analisarMeta, prazoLegivel, serieProjetada, taxaMensalDeAnual,
} from '../lib/simulador';
import { dinheiro, eixoDinheiro, pct } from '../lib/formato';
import type { Meta } from '../lib/types';
import css from '../investimentos.module.css';
import { Linha } from './charts/Linha';
import { CORES } from './charts/base';
import { Cartao, Kpi, Kpis, Seletor, Vazio } from './ui';

/**
 * Duas leituras do mesmo cenário.
 *
 * `total` responde "chego?" — a curva contra a meta. `composicao` responde
 * "de onde vem?" — quanto saiu do bolso e quanto o dinheiro produziu. Juntar
 * as duas num gráfico só daria cinco séries disputando o mesmo eixo.
 */
type Visao = 'total' | 'composicao';

/** Atalhos de prazo: quem pensa em meta pensa em anos, não em 36 meses. */
const PRAZOS = [
  { meses: 12, rotulo: '1 ano' },
  { meses: 24, rotulo: '2 anos' },
  { meses: 36, rotulo: '3 anos' },
  { meses: 60, rotulo: '5 anos' },
  { meses: 120, rotulo: '10 anos' },
];

export function Metas({ patrimonio, metas, rendimentoAnual, cdiAnual, onMudarMetas, onMudarRendimento }: {
  patrimonio: number;
  metas: Meta[];
  rendimentoAnual: number | null;
  cdiAnual: number | null;
  onMudarMetas: (m: Meta[]) => void;
  onMudarRendimento: (v: number | null) => void;
}) {
  // `null` significa "usar o CDI". O fallback de 10% só aparece se o Banco
  // Central não respondeu e nada foi digitado — melhor um número plausível e
  // editável que uma tela sem resposta.
  const taxaAnual = rendimentoAnual ?? cdiAnual ?? 10;
  const taxaMensal = taxaMensalDeAnual(taxaAnual);
  const usandoCdi = rendimentoAnual === null && cdiAnual !== null;

  function adicionar() {
    onMudarMetas([...metas, {
      id: `m${Date.now().toString(36)}`,
      nome: metas.length === 0 ? 'Minha meta' : `Meta ${metas.length + 1}`,
      // Arredonda o patrimônio atual para cima como chute inicial: partir de
      // zero obrigaria a apagar antes de digitar.
      valor: Math.max(10_000, Math.ceil((patrimonio * 2) / 1000) * 1000),
      prazoMeses: 24,
      aporte: 500,
    }]);
  }

  function mudar(id: string, campos: Partial<Meta>) {
    onMudarMetas(metas.map((m) => (m.id === id ? { ...m, ...campos } : m)));
  }

  function remover(id: string) {
    onMudarMetas(metas.filter((m) => m.id !== id));
  }

  return (
    <>
      <Cartao titulo="Quanto o dinheiro rende" sub="A taxa que o simulador usa para projetar.">
        <div className={css.camposLinha}>
          <label className={css.caixaLinha}>
            <input
              type="checkbox" checked={rendimentoAnual === null}
              onChange={(e) => onMudarRendimento(e.target.checked ? null : taxaAnual)}
            />
            Usar o CDI do Banco Central
          </label>

          {rendimentoAnual !== null && (
            <label className={`${css.campo} ${css.campoCurto}`}>
              <span>Rendimento <span className={css.unidade}>% a.a.</span></span>
              <input
                type="number" step="0.5" value={rendimentoAnual}
                onChange={(e) => onMudarRendimento(e.target.value === '' ? 0 : Number(e.target.value))}
              />
            </label>
          )}

          <span className={css.status}>
            usando <strong className={css.mono}>{pct(taxaAnual, 2)}</strong> a.a.
            {usandoCdi && ' (CDI)'} · {pct(taxaMensal * 100, 2)} ao mês
          </span>
        </div>
        {rendimentoAnual === null && cdiAnual === null && (
          <p className={css.previa}>
            Não consegui o CDI agora — simulando a 10% ao ano. Desmarque acima para fixar
            outro valor.
          </p>
        )}
      </Cartao>

      {metas.length === 0 ? (
        <Cartao>
          <Vazio>
            Nenhuma meta ainda.<br />
            Uma meta é um valor e um prazo — a tela responde quanto falta aportar por mês.
            <div style={{ marginTop: 16 }}>
              <button type="button" className={`${css.botao} ${css.principal}`} onClick={adicionar}>
                Criar a primeira meta
              </button>
            </div>
          </Vazio>
        </Cartao>
      ) : (
        <>
          {metas.map((meta) => (
            <CartaoMeta
              key={meta.id} meta={meta} patrimonio={patrimonio} taxaMensal={taxaMensal}
              onMudar={(campos) => mudar(meta.id, campos)}
              onRemover={() => remover(meta.id)}
            />
          ))}
          <div className={css.acoes}>
            <button type="button" className={css.botao} onClick={adicionar}>
              Nova meta
            </button>
          </div>
        </>
      )}
    </>
  );
}

function CartaoMeta({ meta, patrimonio, taxaMensal, onMudar, onRemover }: {
  meta: Meta;
  patrimonio: number;
  taxaMensal: number;
  onMudar: (campos: Partial<Meta>) => void;
  onRemover: () => void;
}) {
  const [editandoNome, setEditandoNome] = useState(false);
  const [visao, setVisao] = useState<Visao>('total');

  const r = analisarMeta({
    inicial: patrimonio,
    meta: meta.valor,
    prazoMeses: meta.prazoMeses,
    aporte: meta.aporte,
    taxaMensal,
  });

  /**
   * O gráfico vai até o maior dos dois prazos.
   *
   * Cortar no prazo desejado esconderia justamente o que interessa quando o
   * aporte é insuficiente: o mês em que a linha finalmente cruza a meta.
   */
  const horizonte = Math.min(
    600,
    Math.max(meta.prazoMeses, (r.mesesComAporteAtual ?? meta.prazoMeses) + 2),
  );

  const comAtual = serieProjetada({ inicial: patrimonio, aporte: meta.aporte, taxaMensal }, horizonte);
  const comNecessario = r.aporteNecessario === null ? null
    : serieProjetada({ inicial: patrimonio, aporte: r.aporteNecessario, taxaMensal }, horizonte);

  const dados = comAtual.map((p, i) => ({
    rotulo: p.mes === 0 ? 'hoje' : `${p.mes}m`,
    atual: p.total,
    necessario: comNecessario ? comNecessario[i]?.total ?? null : null,
    meta: meta.valor,
    // Decomposição do mesmo total: o que saiu do bolso e o que o dinheiro
    // produziu. Empilhadas, a altura somada é a linha `atual`.
    aportado: p.aportado,
    juros: p.juros,
  }));

  const falta = r.ajusteNoAporte !== null && r.ajusteNoAporte > 0.005;
  const sobra = r.ajusteNoAporte !== null && r.ajusteNoAporte < -0.005;

  /** Mês em que o juro acumulado passa o que foi aportado. */
  const viradaJuros = comAtual.find((p) => p.juros > p.aportado);
  const ultimo = comAtual[comAtual.length - 1];

  return (
    <Cartao>
      <div className={css.linhaTopo} style={{ paddingTop: 0 }}>
        {editandoNome ? (
          <input
            className={css.linhaNome} autoFocus value={meta.nome}
            onChange={(e) => onMudar({ nome: e.target.value })}
            onBlur={() => setEditandoNome(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') setEditandoNome(false); }}
          />
        ) : (
          <button type="button" className={css.tituloMeta} onClick={() => setEditandoNome(true)}>
            {meta.nome}
          </button>
        )}
        <button type="button" className={css.perigo} onClick={onRemover}>remover</button>
      </div>

      <div className={css.camposLinha} style={{ marginTop: 6 }}>
        <label className={`${css.campo} ${css.campoCurto}`}>
          <span>Quero chegar a</span>
          <span className={css.entradaComPrefixo}>
            <span className={css.prefixo}>R$</span>
            <input
              type="number" step="1000" value={meta.valor}
              onChange={(e) => onMudar({ valor: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
          </span>
        </label>

        <label className={`${css.campo} ${css.campoCurto}`}>
          <span>Em <span className={css.unidade}>meses</span></span>
          <input
            type="number" step="1" min="1" value={meta.prazoMeses}
            onChange={(e) => onMudar({ prazoMeses: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>

        <label className={`${css.campo} ${css.campoCurto}`}>
          <span>Aportando</span>
          <span className={css.entradaComPrefixo}>
            <span className={css.prefixo}>R$</span>
            <input
              type="number" step="50" value={meta.aporte}
              onChange={(e) => onMudar({ aporte: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
          </span>
        </label>
      </div>

      <div className={css.seg} style={{ marginTop: 8 }}>
        {PRAZOS.map((p) => (
          <button
            key={p.meses} type="button" aria-pressed={meta.prazoMeses === p.meses}
            onClick={() => onMudar({ prazoMeses: p.meses })}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {r.jaChegou ? (
        <p className={css.respostaBoa}>
          Meta batida — você já tem {dinheiro(patrimonio)}.
        </p>
      ) : (
        <Kpis>
          <Kpi
            rotulo="Aportando isso, você chega"
            valor={r.mesesComAporteAtual === null ? 'não chega' : prazoLegivel(r.mesesComAporteAtual)}
            dica={r.mesesComAporteAtual === null
              ? 'com esse aporte o saldo não alcança a meta'
              : `no ritmo de ${dinheiro(meta.aporte)}/mês`}
          />
          <Kpi
            rotulo={`Para chegar em ${prazoLegivel(meta.prazoMeses)}`}
            valor={r.aporteNecessario === null ? '—' : `${dinheiro(r.aporteNecessario)}/mês`}
            dica={falta
              ? `${dinheiro(r.ajusteNoAporte!)} a mais do que hoje`
              : sobra
                ? `${dinheiro(-r.ajusteNoAporte!)} a menos do que hoje`
                : 'é exatamente o que você já aporta'}
          />
          <Kpi
            rotulo={`No prazo você terá`}
            valor={dinheiro(r.totalNoPrazo)}
            dica={r.totalNoPrazo >= meta.valor
              ? `passa da meta em ${dinheiro(r.totalNoPrazo - meta.valor)}`
              : `faltam ${dinheiro(meta.valor - r.totalNoPrazo)}`}
          />
        </Kpis>
      )}

      <Seletor<Visao>
        valor={visao} onEscolher={setVisao}
        opcoes={[
          { id: 'total', rotulo: 'Quanto chega' },
          { id: 'composicao', rotulo: 'De onde vem' },
        ]}
      />

      {visao === 'total' ? (
        <Linha
          dados={dados} formatar={dinheiro} formatarEixo={eixoDinheiro}
          series={[
            { chave: 'atual', nome: `Aportando ${dinheiro(meta.aporte)}`, cor: CORES[0], area: true },
            ...(comNecessario && falta
              ? [{ chave: 'necessario', nome: 'Aporte necessário', cor: CORES[2], tracejada: true }]
              : []),
            { chave: 'meta', nome: 'Meta', cor: CORES[4], tracejada: true, grossura: 1.5 },
          ]}
        />
      ) : (
        <Linha
          dados={dados} formatar={dinheiro} formatarEixo={eixoDinheiro}
          series={[
            // A pilha na ordem em que se lê: o seu dinheiro embaixo, o que
            // ele produziu por cima. A meta fica fora da pilha — ela cruza o
            // total, não faz parte dele.
            { chave: 'aportado', nome: 'Saiu do seu bolso', cor: CORES[3], area: true, empilhar: true },
            { chave: 'juros', nome: 'Rendeu sozinho', cor: CORES[4], area: true, empilhar: true },
            { chave: 'meta', nome: 'Meta', cor: CORES[5], tracejada: true, grossura: 1.5 },
          ]}
        />
      )}

      {visao === 'composicao' && (
        <p className={css.previa}>
          {viradaJuros
            ? <>
                A partir de <strong>{prazoLegivel(viradaJuros.mes)}</strong> o juro acumulado passa
                tudo o que você aportou — daí em diante o dinheiro trabalha mais que você.
              </>
            : <>
                No fim do período, <strong>{dinheiro(ultimo.juros)}</strong> vieram de rendimento
                contra <strong>{dinheiro(ultimo.aportado)}</strong> do seu bolso. Prazos mais
                longos invertem essa proporção.
              </>}
        </p>
      )}

      <p className={css.nota}>
        Parte de <strong>{dinheiro(patrimonio)}</strong>, o patrimônio que a Carteira mostra hoje.
        Juro composto: cada aporte rende a partir do mês seguinte ao que entra, e o rendimento
        rende junto no mês seguinte. O aporte entra no fim de cada mês — dinheiro que cai no dia
        30 não rendeu aquele mês.
      </p>
    </Cartao>
  );
}
