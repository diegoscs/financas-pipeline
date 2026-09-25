/**
 * Única porta de saída dos dados LOCAIS do módulo.
 *
 * O patrimônio não passa por aqui — ele vem da Carteira, em `carteiraApi.ts`.
 * Aqui fica só o que a Carteira não guarda: os carimbos mensais do total e
 * as metas.
 *
 * O que entra é dado de fora: JSON que já esteve no disco de um navegador,
 * editável à mão, escrito por uma versão anterior. `load()` não confia no que
 * leu — valida campo a campo e cai no estado vazio em vez de deixar um
 * `undefined` virar `NaN` no meio de um gráfico três telas adiante.
 */
import type { InvestState, Meta, PontoPatrimonio } from './types';

/**
 * v2 porque o formato mudou por inteiro: v1 guardava ativos e lançamentos
 * manuais. A chave nova deixa o estado antigo intacto no navegador em vez de
 * tentar lê-lo errado — quem tinha lançamento manual não perde nada, só
 * deixa de ver por esta tela.
 */
const CHAVE = 'investimentos:v2';

export interface InvestStorage {
  load(): Promise<InvestState>;
  save(state: InvestState): Promise<void>;
}

export function estadoVazio(): InvestState {
  return { historico: [], metas: [], rendimentoAnual: null };
}

// ── validação ──────────────────────────────────────────────────────────────

function num(v: unknown, padrao = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : padrao;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const ehCompetencia = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

function limparHistorico(v: unknown): PontoPatrimonio[] {
  if (!Array.isArray(v)) return [];
  const porMes = new Map<string, PontoPatrimonio>();

  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (!ehCompetencia(o.competencia)) continue;

    const reservas = num(o.reservas);
    const bolsa = num(o.bolsa);
    porMes.set(o.competencia, {
      competencia: o.competencia,
      reservas,
      bolsa,
      // O total gravado manda; sem ele, a soma das partes. Guardar os três
      // permite conferir depois se as partes batem com o todo.
      total: num(o.total, reservas + bolsa),
    });
  }

  return [...porMes.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

function limparMetas(v: unknown): Meta[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();

  return v.flatMap((raw): Meta[] => {
    if (!raw || typeof raw !== 'object') return [];
    const o = raw as Record<string, unknown>;
    const id = texto(o.id);
    if (!id || vistos.has(id)) return [];
    vistos.add(id);

    return [{
      id,
      nome: texto(o.nome) || 'Meta',
      valor: num(o.valor),
      // Prazo zero não simula nada; um mês é o mínimo que responde algo.
      prazoMeses: Math.max(1, Math.round(num(o.prazoMeses, 12))),
      aporte: num(o.aporte),
    }];
  });
}

export function normalizar(bruto: unknown): InvestState {
  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const r = o.rendimentoAnual;
  return {
    historico: limparHistorico(o.historico),
    metas: limparMetas(o.metas),
    // `null` é escolha válida — significa "use o CDI". Só número finito
    // sobrevive como override.
    rendimentoAnual: typeof r === 'number' && Number.isFinite(r) ? r : null,
  };
}

/**
 * Grava o carimbo do mês, substituindo o que já houver da mesma competência.
 *
 * Substituir e não acumular porque um mês tem um patrimônio só: visitar a
 * tela três vezes em setembro não pode gerar três pontos no gráfico. O último
 * valor do mês é o que vale, mesma regra dos snapshots da Carteira.
 */
export function comCarimbo(estado: InvestState, ponto: PontoPatrimonio): InvestState {
  const outros = estado.historico.filter((p) => p.competencia !== ponto.competencia);
  return {
    ...estado,
    historico: [...outros, ponto].sort((a, b) => a.competencia.localeCompare(b.competencia)),
  };
}

// ── adapter local ──────────────────────────────────────────────────────────

export class LocalStorageAdapter implements InvestStorage {
  constructor(private chave: string = CHAVE) {}

  async load(): Promise<InvestState> {
    // Durante a pré-renderização no servidor não existe `window`. Devolver o
    // estado vazio mantém o HTML igual ao do primeiro render do cliente.
    if (typeof window === 'undefined') return estadoVazio();

    try {
      const cru = window.localStorage.getItem(this.chave);
      if (!cru) return estadoVazio();
      return normalizar(JSON.parse(cru));
    } catch {
      return estadoVazio();
    }
  }

  async save(state: InvestState): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(this.chave, JSON.stringify(state));
    } catch (e) {
      // Aqui o erro SOBE, ao contrário do `load`. Falha de leitura tem
      // fallback honesto; falha de escrita silenciosa faria a tela dizer
      // "salvo" sobre dado que some no próximo recarregamento.
      throw new Error(
        'Não consegui salvar no navegador. ' +
        'Em janela privativa ou com armazenamento bloqueado, vale só nesta sessão. ' +
        `(${e instanceof Error ? e.message : 'erro desconhecido'})`,
      );
    }
  }
}

// ── adapter do Supabase (ainda não) ────────────────────────────────────────
//
// O histórico do total poderia morar no banco. NÃO foi para `snapshots_saldo`
// de propósito: a chave de lá é `(conta_id, data_ref)` e a Carteira faz
// upsert nela com a data de hoje toda vez que alguém informa um saldo. As
// duas telas escrevendo a mesma chave com noções diferentes de valor fariam
// a última vencer, em silêncio — a mesma classe de bug que as migrações 14 e
// 15 acabaram de fechar.
//
// O caminho certo é tabela própria:
//
//   create table investimentos_historico (
//     usuario_id  uuid not null default auth.uid()
//                 references auth.users(id) on delete cascade,
//     competencia text not null check (competencia ~ '^\d{4}-\d{2}$'),
//     reservas    numeric(14,2) not null,
//     bolsa       numeric(14,2) not null,
//     total       numeric(14,2) not null,
//     primary key (usuario_id, competencia)
//   );
//   alter table investimentos_historico enable row level security;
//   -- as quatro policies por auth.uid(); ver sql/14
//
// Na escrita, `usuario_id` explícito e checagem de linhas afetadas: UPDATE
// barrado por RLS não dá erro, não acha linha.

/** O adapter em uso. Trocar aqui — e só aqui — muda a persistência. */
export const storage: InvestStorage = new LocalStorageAdapter();
