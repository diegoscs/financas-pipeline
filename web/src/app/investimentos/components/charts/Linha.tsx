'use client';

/**
 * Gráfico de linhas com várias séries.
 *
 * Usado para patrimônio (realizado + projeção + metas), rentabilidade % por
 * classe e meses de custo cobertos. O que muda entre os três é o formatador
 * do eixo — daí ele ser prop.
 */
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { COR_GRADE, EIXO, Moldura, Tooltip, type Serie } from './base';

export function Linha({ dados, series, formatar, formatarEixo, alto, dominio }: {
  dados: Record<string, unknown>[];
  series: Serie[];
  formatar: (v: number) => string;
  formatarEixo: (v: number) => string;
  alto?: boolean;
  dominio?: [number | 'auto', number | 'auto'];
}) {
  return (
    <Moldura alto={alto}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dados} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COR_GRADE} vertical={false} />
          <XAxis dataKey="rotulo" {...EIXO} minTickGap={16} />
          <YAxis {...EIXO} width={58} tickFormatter={formatarEixo} domain={dominio} />
          <RTooltip content={<Tooltip formatar={formatar} />} />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }}
          />
          {series.map((s) =>
            s.area ? (
              <Area
                key={s.chave} type="monotone" dataKey={s.chave} name={s.nome}
                stroke={s.cor} fill={s.cor}
                // Área empilhada é uma fatia do total e precisa de preenchimento
                // sólido o bastante para se distinguir da vizinha; área solta é
                // só sombra sob uma linha.
                fillOpacity={s.empilhar ? 0.55 : 0.12}
                stackId={s.empilhar ? 'pilha' : undefined}
                strokeWidth={s.grossura ?? 2.5} dot={false}
                // `connectNulls` fica falso: buraco na série é mês sem
                // lançamento, e ligar os pontos inventaria patrimônio.
                connectNulls={false}
              />
            ) : (
              <Line
                key={s.chave} type="monotone" dataKey={s.chave} name={s.nome}
                stroke={s.cor} strokeWidth={s.grossura ?? 2}
                strokeDasharray={s.tracejada ? '5 4' : undefined}
                dot={false} connectNulls={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Moldura>
  );
}
