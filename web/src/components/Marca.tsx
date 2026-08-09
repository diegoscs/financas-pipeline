'use client';

import { banco, marcaSvg } from '@/lib/bancos';

/**
 * Marca do banco.
 *
 * Quando existe arquivo em public/logos, usa o logo real. Para banco sem
 * arquivo, cai num quadrado arredondado na cor da marca com a inicial —
 * assim cadastrar um banco novo nunca quebra a tela, só fica menos bonito
 * até o logo chegar.
 *
 * O logo vai dentro de uma caixa branca com borda leve porque os arquivos
 * têm fundo transparente e carregam a própria cor: o laranja do Itaú sobre
 * fundo colorido desaparece.
 */
export function Marca({ instituicao, tamanho = 20 }: { instituicao: string; tamanho?: number }) {
  const m = banco(instituicao);

  if (m.logo) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white"
        style={{
          width: tamanho,
          height: tamanho,
          border: '1px solid var(--borda)',
          padding: Math.max(1, Math.round(tamanho * 0.12)),
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ícone estático
            e minúsculo; passar pelo otimizador do Next não traz ganho */}
        <img
          src={m.logo}
          alt=""
          aria-hidden="true"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </span>
    );
  }

  const { letra, raio } = marcaSvg(instituicao);
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden="true"
         style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx={raio * 2} fill={m.cor} />
      <text
        x="16" y="16"
        textAnchor="middle" dominantBaseline="central"
        fill={m.contraste}
        fontSize={letra.length > 1 ? 13 : 17}
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {letra}
      </text>
    </svg>
  );
}

/** Marca + nome, para usar como selo. */
export function SeloBanco({ instituicao, tamanho = 18 }: { instituicao: string; tamanho?: number }) {
  const m = banco(instituicao);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Marca instituicao={instituicao} tamanho={tamanho} />
      <span className="text-sm font-medium">{m.rotulo}</span>
    </span>
  );
}
