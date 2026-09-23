'use client';

/** Peças visuais repetidas nas cinco abas. Sem lógica de negócio. */
import type { ReactNode } from 'react';
import css from '../investimentos.module.css';

export function Cartao({ titulo, sub, children }: {
  titulo?: string; sub?: string; children: ReactNode;
}) {
  return (
    <section className={css.cartao}>
      {titulo && <h2>{titulo}</h2>}
      {sub && <p className={css.sub}>{sub}</p>}
      {children}
    </section>
  );
}

export function Kpi({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className={css.kpi}>
      <div className={css.kpiRotulo}>{rotulo}</div>
      <div className={css.kpiValor}>{valor}</div>
      {dica && <div className={css.kpiDica}>{dica}</div>}
    </div>
  );
}

export function Kpis({ children }: { children: ReactNode }) {
  return <div className={css.kpis}>{children}</div>;
}

/** Tabela sempre embrulhada: o scroll horizontal é dela, nunca do body. */
export function Tabela({ children }: { children: ReactNode }) {
  return (
    <div className={css.tabelaWrap}>
      <table className={css.tabela}>{children}</table>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className={css.vazio}>{children}</div>;
}

/** Grupo de botões que se comportam como um seletor único. */
export function Seletor<T extends string>({ valor, opcoes, onEscolher }: {
  valor: T;
  opcoes: { id: T; rotulo: string }[];
  onEscolher: (id: T) => void;
}) {
  return (
    <div className={css.seg}>
      {opcoes.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === valor} onClick={() => onEscolher(o.id)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Número que muda de cor conforme o sinal. Zero fica neutro, não verde. */
export function Sinal({ valor, texto }: { valor: number; texto: string }) {
  const classe = valor > 0 ? css.pos : valor < 0 ? css.neg : undefined;
  return <span className={classe}>{texto}</span>;
}
