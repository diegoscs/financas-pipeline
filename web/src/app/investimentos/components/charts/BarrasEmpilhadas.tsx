'use client';

/**
 * Barras empilhadas: composição por classe, aportes por ativo, aportado
 * versus rendimento.
 *
 * Empilhado porque a pergunta nos três casos é "de que o total é feito", e
 * não "qual é maior" — barras lado a lado responderiam a outra pergunta.
 */
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { COR_GRADE, EIXO, Moldura, Tooltip, type Serie } from './base';

export function BarrasEmpilhadas({ dados, series, formatar, formatarEixo, alto, dominio }: {
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
        <BarChart data={dados} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COR_GRADE} vertical={false} />
          <XAxis dataKey="rotulo" {...EIXO} minTickGap={12} />
          <YAxis {...EIXO} width={58} tickFormatter={formatarEixo} domain={dominio} />
          <RTooltip cursor={{ fill: '#f4f5f8' }} content={<Tooltip formatar={formatar} />} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} />
          {series.map((s, i) => (
            <Bar
              key={s.chave} dataKey={s.chave} name={s.nome} stackId="pilha"
              fill={s.cor} maxBarSize={54}
              // Só a última série arredonda o topo; arredondar todas faria
              // cada fatia parecer uma barra solta.
              radius={i === series.length - 1 ? [5, 5, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Moldura>
  );
}
