/**
 * Única porta de saída de dados do módulo.
 *
 * Nenhum componente fala com `localStorage`, com `fetch` ou com o Supabase —
 * todos recebem `InvestState` e devolvem `InvestState`. Migrar para o banco
 * depois é trocar a linha do `storage` no `page.tsx`, e só ela.
 *
 * O que entra aqui é dado de fora: JSON que já esteve no disco de um
 * navegador, editável à mão, escrito por uma versão anterior deste código.
 * Por isso `load()` não confia no que leu — valida campo a campo e cai no
 * estado vazio em vez de deixar um `undefined` virar `NaN` no meio de um
 * gráfico três telas adiante.
 */
import type { Ativo, Classe, InvestState, Lancamento, Modo, Premissas } from './types';

/**
 * A versão faz parte da chave.
 *
 * Mudança incompatível de formato vira `investimentos:v2` e o estado antigo
 * fica intacto no navegador, em vez de ser lido errado ou sobrescrito.
 */
const CHAVE = 'investimentos:v1';

export interface InvestStorage {
  load(): Promise<InvestState>;
  save(state: InvestState): Promise<void>;
}

// ── estado inicial ─────────────────────────────────────────────────────────

/**
 * Premissas de partida.
 *
 * Números são chute editável na aba de configuração, não verdade: CDI muda,
 * salário muda. Ficam aqui só para a tela abrir com algo plausível em vez de
 * zeros que fariam toda projeção dar zero.
 */
export const PREMISSAS_PADRAO: Premissas = {
  gasto: 1700,
  liquido2026: 2750,
  liquido2027: 3360,
  cdi2026: 13.65,
  cdi2027: 12.30,
  ir: 20,
  dividendoFii: 1.0,
  valorizacaoCota: 0.3,
  retornoAcoes: 1.1,
  decimoTerceiro: {
    '2026-11': 1625,
    '2026-12': 1346,
    '2027-11': 2000,
    '2027-12': 1631,
  },
};

/**
 * Começa sem ativo nenhum, de propósito.
 *
 * Semear exemplos obrigaria a apagar o que não é seu antes de usar, e um
 * ativo de exemplo esquecido entra nos totais como se fosse dinheiro de
 * verdade. A aba de configuração é a primeira do fluxo justamente por isso.
 */
export function estadoVazio(): InvestState {
  return { ativos: [], lancamentos: [], premissas: { ...PREMISSAS_PADRAO } };
}

// ── validação ──────────────────────────────────────────────────────────────

const CLASSES_VALIDAS: Classe[] = ['renda_fixa', 'fii', 'acao', 'cripto'];
const MODOS_VALIDOS: Modo[] = ['saldo', 'cotizado'];

/** Número utilizável, ou o padrão. Rejeita NaN, Infinity, string e null. */
function num(v: unknown, padrao = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : padrao;
}

/** Número opcional: ausente continua ausente, lixo vira ausente. */
function numOpcional(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const ehCompetencia = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

function limparAtivos(v: unknown): Ativo[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();

  return v.flatMap((raw): Ativo[] => {
    if (!raw || typeof raw !== 'object') return [];
    const o = raw as Record<string, unknown>;
    const id = texto(o.id);
    const nome = texto(o.nome);
    // Sem id não dá para casar com os itens de lançamento; id repetido faria
    // dois ativos disputarem a mesma posição.
    if (!id || !nome || vistos.has(id)) return [];
    vistos.add(id);

    const classe = CLASSES_VALIDAS.includes(o.classe as Classe) ? (o.classe as Classe) : 'renda_fixa';
    const modo = MODOS_VALIDOS.includes(o.modo as Modo) ? (o.modo as Modo) : 'saldo';

    // Ticker é opcional e sempre maiúsculo: a brapi é sensível a caixa e um
    // 'mxrf11' gravado em minúscula voltaria "não encontrado" para sempre.
    const t = texto(o.ticker).trim().toUpperCase();
    const ticker = t ? t : undefined;

    return [{ id, nome, classe, modo, ...(ticker ? { ticker } : {}) }];
  });
}

function limparLancamentos(v: unknown): Lancamento[] {
  if (!Array.isArray(v)) return [];
  const porCompetencia = new Map<string, Lancamento>();

  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (!ehCompetencia(o.competencia)) continue;

    const itens: Lancamento['itens'] = {};
    if (o.itens && typeof o.itens === 'object') {
      for (const [ativoId, it] of Object.entries(o.itens as Record<string, unknown>)) {
        if (!it || typeof it !== 'object') continue;
        const i = it as Record<string, unknown>;
        itens[ativoId] = {
          aporte: num(i.aporte),
          saldo: numOpcional(i.saldo),
          cotas: numOpcional(i.cotas),
          preco: numOpcional(i.preco),
        };
      }
    }

    // Competência repetida: vale a última. Um mês é um fechamento só.
    porCompetencia.set(o.competencia, { competencia: o.competencia, itens });
  }

  return [...porCompetencia.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

/**
 * Premissas sempre por cima do padrão.
 *
 * É o que faz um estado gravado antes de um campo novo existir continuar
 * carregando: o campo que falta vem do padrão em vez de vir `undefined` e
 * contaminar toda a projeção com `NaN`.
 */
function limparPremissas(v: unknown): Premissas {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const p = PREMISSAS_PADRAO;

  const decimoTerceiro: Record<string, number> = {};
  if (o.decimoTerceiro && typeof o.decimoTerceiro === 'object') {
    for (const [comp, valor] of Object.entries(o.decimoTerceiro as Record<string, unknown>)) {
      if (ehCompetencia(comp)) decimoTerceiro[comp] = num(valor);
    }
  }

  return {
    gasto: num(o.gasto, p.gasto),
    liquido2026: num(o.liquido2026, p.liquido2026),
    liquido2027: num(o.liquido2027, p.liquido2027),
    cdi2026: num(o.cdi2026, p.cdi2026),
    cdi2027: num(o.cdi2027, p.cdi2027),
    ir: num(o.ir, p.ir),
    dividendoFii: num(o.dividendoFii, p.dividendoFii),
    valorizacaoCota: num(o.valorizacaoCota, p.valorizacaoCota),
    retornoAcoes: num(o.retornoAcoes, p.retornoAcoes),
    // Objeto vazio é escolha válida (quem não tem 13º), então não cai no
    // padrão: só a ausência da chave cai.
    decimoTerceiro: o.decimoTerceiro !== undefined ? decimoTerceiro : { ...p.decimoTerceiro },
  };
}

export function normalizar(bruto: unknown): InvestState {
  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  return {
    ativos: limparAtivos(o.ativos),
    lancamentos: limparLancamentos(o.lancamentos),
    premissas: limparPremissas(o.premissas),
  };
}

// ── adapter local ──────────────────────────────────────────────────────────

export class LocalStorageAdapter implements InvestStorage {
  constructor(private chave: string = CHAVE) {}

  async load(): Promise<InvestState> {
    // Durante a pré-renderização no servidor não existe `window`. Devolver o
    // estado vazio mantém o HTML igual ao do primeiro render do cliente; o
    // conteúdo real aparece no efeito que roda depois da hidratação.
    if (typeof window === 'undefined') return estadoVazio();

    try {
      const cru = window.localStorage.getItem(this.chave);
      if (!cru) return estadoVazio();
      return normalizar(JSON.parse(cru));
    } catch {
      // Janela privativa, storage bloqueado ou JSON corrompido. Abrir vazio é
      // melhor que travar a tela — e `save` por cima conserta.
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
      // "salvo" sobre dado que o usuário digitou e vai perder ao recarregar.
      throw new Error(
        'Não consegui salvar no navegador. ' +
        'Em janela privativa ou com armazenamento bloqueado, os dados valem só nesta sessão. ' +
        `(${e instanceof Error ? e.message : 'erro desconhecido'})`,
      );
    }
  }
}

// ── adapter do Supabase (ainda não) ────────────────────────────────────────
//
// O dia em que isto deixar de ser manual, é só implementar a mesma interface
// e trocar a linha do `page.tsx`. Nenhum componente muda, porque nenhum
// componente sabe de onde o estado vem.
//
// Precisa de uma tabela nova — o que esta fase proíbe de propósito:
//
//   create table investimentos_estado (
//     usuario_id uuid primary key default auth.uid()
//                references auth.users(id) on delete cascade,
//     estado     jsonb not null,
//     atualizado timestamptz not null default now()
//   );
//   alter table investimentos_estado enable row level security;
//   -- as quatro policies por auth.uid(), como nas outras tabelas; ver sql/14
//
// export class SupabaseAdapter implements InvestStorage {
//   async load(): Promise<InvestState> {
//     const { data, error } = await supabase
//       .from('investimentos_estado').select('estado').maybeSingle();
//     if (error) throw error;
//     return normalizar(data?.estado);   // a validação continua valendo
//   }
//
//   async save(state: InvestState): Promise<void> {
//     // usuario_id explícito: a policy de INSERT exige `= auth.uid()`.
//     const { data, error } = await supabase
//       .from('investimentos_estado')
//       .upsert({ usuario_id: await usuarioAtual(), estado: state, atualizado: new Date().toISOString() },
//               { onConflict: 'usuario_id' })
//       .select('usuario_id');
//     if (error) throw error;
//     // UPDATE barrado por RLS não dá erro, não acha linha: checar é obrigatório.
//     if (!data?.length) throw new Error('A base não gravou (RLS).');
//   }
// }

/** O adapter em uso. Trocar aqui — e só aqui — muda a persistência do módulo. */
export const storage: InvestStorage = new LocalStorageAdapter();
