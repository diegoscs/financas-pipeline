'use client';

/**
 * Peças comuns dos gráficos do módulo.
 *
 * Os wrappers existem para que nenhum componente de aba precise saber o nome
 * das props do Recharts. Se um dia a biblioteca trocar, troca aqui.
 */
import type { ReactNode } from 'react';
import css from '../../investimentos.module.css';

/** Cores de série, na ordem. Casam com os tokens --inv-c1..c6 do módulo. */
export const CORES = ['#4f46e5', '#c07a2b', '#8a4fbf', '#3f7fb4', '#059669', '#e11d48'];

export const COR_GRADE = '#eef0f3';
export const COR_EIXO = '#9ca3af';

export const EIXO = {
  stroke: COR_EIXO,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export interface Serie {
  /** chave do dado em cada linha */
  chave: string;
  nome: string;
  cor: string;
  /** linha tracejada: tudo que é projeção ou meta, nunca o realizado */
  tracejada?: boolean;
  /** o cenário selecionado fica mais grosso que os outros */
  grossura?: number;
  /** área sob a linha; só o realizado usa */
  area?: boolean;
  /**
   * Empilha esta área sobre as outras empilhadas.
   *
   * Só faz sentido com `area`. Serve para decompor um total em partes — o
   * aporte embaixo, o juro em cima — em que a altura somada é o total e cada
   * faixa é uma parcela dele. Séries de referência, como a linha da meta,
   * ficam de fora da pilha ou seriam somadas ao que deveriam apenas cruzar.
   */
  empilhar?: boolean;
}

interface ItemTooltip {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/**
 * Tooltip própria em vez da padrão do Recharts.
 *
 * A padrão formata número cru ("2058.5758"). Aqui cada valor passa pelo
 * `Intl`, e valor nulo — mês que ainda não foi lançado — some da lista em vez
 * de aparecer como zero, que seria um patrimônio que nunca existiu.
 */
export function Tooltip({ active, payload, label, formatar }: {
  active?: boolean;
  payload?: ItemTooltip[];
  label?: string | number;
  formatar: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;

  const linhas = payload.filter((p) => typeof p.value === 'number' && Number.isFinite(p.value));
  if (!linhas.length) return null;

  return (
    <div className={css.tooltip}>
      <div className={css.tooltipTitulo}>{label}</div>
      {linhas.map((p, i) => (
        <div key={`${p.dataKey}-${i}`} className={css.tooltipLinha}>
          <span>
            <span className={css.tooltipPonto} style={{ background: p.color }} />
            {p.name}
          </span>
          <strong>{formatar(p.value as number)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Moldura de altura fixa; o ResponsiveContainer precisa de pai com altura. */
export function Moldura({ alto, children }: { alto?: boolean; children: ReactNode }) {
  return <div className={alto ? css.graficoAlto : css.grafico}>{children}</div>;
}
