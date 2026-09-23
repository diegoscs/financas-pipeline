'use client';

/**
 * Investimentos — shell das cinco abas.
 *
 * Módulo isolado: não importa nada do código de faturas e ninguém de fora
 * importa daqui. A única ligação com o resto do app é a linha do menu em
 * `components/Nav.tsx`.
 *
 * O estado mora aqui e desce por props. Os componentes de aba não leem nem
 * escrevem storage, não chamam `fetch` e não fazem conta: recebem o estado
 * já derivado por `calc.ts` e devolvem um estado novo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { derivar } from './lib/calc';
import { storage } from './lib/storage';
import type { InvestState } from './lib/types';
import css from './investimentos.module.css';
import { Configuracoes } from './components/Configuracoes';
import { LancarMes } from './components/LancarMes';
import { Projecao } from './components/Projecao';
import { Rentabilidade } from './components/Rentabilidade';
import { VisaoGeral } from './components/VisaoGeral';

type Aba = 'visao' | 'lancar' | 'rentabilidade' | 'projecao' | 'config';

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'visao', rotulo: 'Visão geral' },
  { id: 'lancar', rotulo: 'Lançar mês' },
  { id: 'rentabilidade', rotulo: 'Rentabilidade' },
  { id: 'projecao', rotulo: 'Projeção' },
  { id: 'config', rotulo: 'Ativos & premissas' },
];

export default function Investimentos() {
  const [estado, setEstado] = useState<InvestState | null>(null);
  const [aba, setAba] = useState<Aba>('visao');
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);

  // Carrega depois da montagem, nunca durante o render: no servidor não
  // existe `localStorage`, e ler no render faria o HTML do servidor divergir
  // do primeiro render do cliente.
  useEffect(() => {
    let vivo = true;
    storage.load().then((s) => { if (vivo) setEstado(s); });
    return () => { vivo = false; };
  }, []);

  /**
   * Toda mudança passa por aqui.
   *
   * O estado da tela muda primeiro e a gravação vem depois: digitar não pode
   * esperar disco. Se a gravação falhar, o erro aparece — silêncio faria a
   * tela mostrar dado que some no próximo recarregamento.
   */
  const mudar = useCallback((novo: InvestState) => {
    setEstado(novo);
    setErro(null);
    storage.save(novo)
      .then(() => setSalvoEm(new Date().toLocaleTimeString('pt-BR')))
      .catch((e: Error) => setErro(e.message));
  }, []);

  const derivado = useMemo(() => (estado ? derivar(estado) : null), [estado]);

  if (!estado || !derivado) {
    return (
      <div className={css.raiz}>
        <p className={css.status}>Carregando…</p>
      </div>
    );
  }

  return (
    <div className={css.raiz}>
      <header className={css.cabecalho}>
        <h1>Investimentos</h1>
        <p>Lançamento manual, uma vez por mês. Rendimento medido, projeção separada.</p>
      </header>

      <div className={css.abas} role="tablist" aria-label="Seções de investimentos">
        {ABAS.map((a) => (
          <button
            key={a.id} type="button" role="tab" className={css.aba}
            aria-selected={a.id === aba} onClick={() => setAba(a.id)}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {erro && <p className={css.statusErro} role="alert">{erro}</p>}

      {aba === 'visao' && (
        <VisaoGeral estado={estado} posicoes={derivado.posicoes} geral={derivado.geral} />
      )}
      {aba === 'lancar' && <LancarMes estado={estado} onMudar={mudar} />}
      {aba === 'rentabilidade' && (
        <Rentabilidade
          estado={estado} posicoes={derivado.posicoes}
          rendimentos={derivado.rendimentos} resumo={derivado.rentabilidade}
        />
      )}
      {aba === 'projecao' && (
        <Projecao estado={estado} posicoes={derivado.posicoes} geral={derivado.geral} />
      )}
      {aba === 'config' && <Configuracoes estado={estado} onMudar={mudar} />}

      <p className={css.nota}>
        Os dados ficam <strong>neste navegador</strong> (localStorage), não no banco do app.
        Limpar os dados do site apaga tudo.
        {salvoEm && ` · salvo às ${salvoEm}`}
      </p>
    </div>
  );
}
