/**
 * Lê o patrimônio da aba Carteira.
 *
 * Esta aba deixou de ter dados próprios: o que ela mostra sai do mesmo banco
 * que a Carteira preenche. Importa o cliente do Supabase e nada mais — as
 * consultas são escritas aqui, e não importadas de `@/lib/carteira`, para que
 * uma mudança de tela lá não quebre um gráfico aqui.
 *
 * ── O que existe e o que não existe ──
 *
 * `snapshots_saldo` é `(conta_id, data_ref, saldo)`: um retrato datado, e a
 * única série histórica de verdade da base. A Carteira grava um a cada vez
 * que você informa o saldo de uma reserva.
 *
 * `posicoes` é `(ativo_id, quantidade, preco_medio)` — estado de HOJE. Não há
 * registro de quantas cotas você tinha em março, então o valor da bolsa no
 * passado não é recuperável. Por isso a evolução tem duas origens: o passado
 * vem dos snapshots, e o total de hoje (reservas + bolsa a mercado) é
 * carimbado mês a mês pelo próprio módulo — ver `storage.ts`.
 */
import { supabase } from '@/lib/supabase';

export interface ContaPatrimonio {
  id: number;
  nome: string;
  instituicao: string;
  tipo: string;
  entra_no_patrimonio: boolean;
}

export interface SnapshotSaldo {
  conta_id: number;
  /** ISO 'YYYY-MM-DD' */
  data_ref: string;
  saldo: number;
}

export interface PosicaoAberta {
  ativoId: number;
  ticker: string;
  tipo: string;
  quantidade: number;
  precoMedio: number;
  /** conta a que o ativo pertence; pode não ter */
  contaId: number | null;
}

export interface DadosCarteira {
  contas: ContaPatrimonio[];
  snapshots: SnapshotSaldo[];
  posicoes: PosicaoAberta[];
}

/** Numérico do PostgREST vem como string; NaN aqui viraria gráfico vazio. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Tudo de uma vez.
 *
 * As quatro consultas são independentes, então vão juntas. O RLS já reduz
 * cada uma ao que é do usuário logado — não há filtro por dono aqui, e
 * escrever um daria a falsa impressão de que é ele quem protege.
 */
export async function carregarCarteira(): Promise<DadosCarteira> {
  const [c, s, a, p] = await Promise.all([
    supabase.from('contas').select('id,nome,instituicao,tipo,entra_no_patrimonio').eq('ativa', true),
    supabase.from('snapshots_saldo').select('conta_id,data_ref,saldo').order('data_ref'),
    supabase.from('ativos').select('id,ticker,tipo,conta_id').eq('ativo', true),
    supabase.from('posicoes').select('ativo_id,quantidade,preco_medio'),
  ]);

  for (const r of [c, s, a, p]) if (r.error) throw r.error;

  const porAtivo = new Map(
    (p.data ?? []).map((x) => [x.ativo_id as number, x]),
  );

  const posicoes: PosicaoAberta[] = (a.data ?? []).map((ativo) => {
    const pos = porAtivo.get(ativo.id as number);
    return {
      ativoId: ativo.id as number,
      ticker: ativo.ticker as string,
      tipo: ativo.tipo as string,
      quantidade: num(pos?.quantidade),
      precoMedio: num(pos?.preco_medio),
      contaId: (ativo.conta_id as number | null) ?? null,
    };
  });

  return {
    contas: (c.data ?? []) as ContaPatrimonio[],
    snapshots: (s.data ?? []).map((x) => ({
      conta_id: x.conta_id as number,
      data_ref: x.data_ref as string,
      saldo: num(x.saldo),
    })),
    posicoes,
  };
}

export interface ValorBolsa {
  total: number;
  /** custo pelo preço médio; a diferença para o total é ganho não realizado */
  custo: number;
  /** quantos ativos ficaram sem cotação e entraram pelo custo */
  semCotacao: number;
  porAtivo: {
    ticker: string; quantidade: number; precoMedio: number;
    preco: number | null; valor: number;
  }[];
}

/**
 * Marca as posições a mercado.
 *
 * Ativo sem cotação entra pelo CUSTO, não por zero: um ticker que a brapi não
 * respondeu não significa posição que sumiu, e zerá-la faria o patrimônio
 * despencar num gráfico por motivo de API fora do ar. `semCotacao` diz
 * quantos estão nessa situação para a tela poder avisar.
 */
export function valorDaBolsa(
  posicoes: PosicaoAberta[], precos: Map<string, number>,
): ValorBolsa {
  let total = 0;
  let custo = 0;
  let semCotacao = 0;

  const porAtivo = posicoes.map((p) => {
    const preco = precos.get(p.ticker) ?? null;
    const c = p.quantidade * p.precoMedio;
    const valor = preco !== null ? p.quantidade * preco : c;
    if (preco === null && p.quantidade > 0) semCotacao++;
    total += valor;
    custo += c;
    return { ticker: p.ticker, quantidade: p.quantidade, precoMedio: p.precoMedio, preco, valor };
  });

  return { total, custo, semCotacao, porAtivo };
}

/**
 * Saldo mais recente de cada conta que entra no patrimônio.
 *
 * Mesma regra da `vw_patrimonio_mensal`: vale o último retrato de cada conta.
 * Conta sem snapshot nenhum fica de fora em vez de entrar como zero — nunca
 * ter informado o saldo não é o mesmo que ter zero.
 */
export function saldoAtualDasContas(dados: DadosCarteira): {
  total: number; porConta: { conta: ContaPatrimonio; saldo: number; data: string }[];
  semSaldo: ContaPatrimonio[];
} {
  const ultimo = new Map<number, SnapshotSaldo>();
  for (const s of dados.snapshots) {
    const atual = ultimo.get(s.conta_id);
    if (!atual || s.data_ref > atual.data_ref) ultimo.set(s.conta_id, s);
  }

  const elegiveis = dados.contas.filter((c) => c.entra_no_patrimonio);
  const porConta: { conta: ContaPatrimonio; saldo: number; data: string }[] = [];
  const semSaldo: ContaPatrimonio[] = [];

  for (const conta of elegiveis) {
    const s = ultimo.get(conta.id);
    if (s) porConta.push({ conta, saldo: s.saldo, data: s.data_ref });
    else semSaldo.push(conta);
  }

  return { total: porConta.reduce((acc, x) => acc + x.saldo, 0), porConta, semSaldo };
}

/**
 * Série mensal de saldo das contas, a partir dos snapshots.
 *
 * Mesma lógica da `vw_patrimonio_mensal`, feita no cliente: o último retrato
 * de cada conta dentro de cada mês, somado. A conta entra no mês em que foi
 * informada e permanece com esse valor nos meses seguintes até haver retrato
 * novo — sem isso, um mês em que você só informou uma das contas faria o
 * patrimônio despencar e voltar.
 */
export function historicoDasContas(dados: DadosCarteira): { competencia: string; total: number }[] {
  const elegiveis = new Set(dados.contas.filter((c) => c.entra_no_patrimonio).map((c) => c.id));
  const relevantes = dados.snapshots
    .filter((s) => elegiveis.has(s.conta_id))
    .sort((a, b) => a.data_ref.localeCompare(b.data_ref));

  if (relevantes.length === 0) return [];

  // Último retrato de cada conta em cada competência.
  const porMes = new Map<string, Map<number, number>>();
  for (const s of relevantes) {
    const comp = s.data_ref.slice(0, 7);
    const m = porMes.get(comp) ?? new Map<number, number>();
    m.set(s.conta_id, s.saldo);   // ordenado por data: o último sobrescreve
    porMes.set(comp, m);
  }

  const meses = [...porMes.keys()].sort();
  const arrastado = new Map<number, number>();
  const out: { competencia: string; total: number }[] = [];

  for (const comp of meses) {
    for (const [contaId, saldo] of porMes.get(comp)!) arrastado.set(contaId, saldo);
    out.push({
      competencia: comp,
      total: [...arrastado.values()].reduce((a, v) => a + v, 0),
    });
  }

  return out;
}
