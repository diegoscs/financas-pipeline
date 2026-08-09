import * as XLSX from 'xlsx';
import { competenciaDoBanco, inicioDoMes, lerCabecalhoFatura, semAcento } from '../competencia';
import type { FaturaDetectada, ResultadoParse, Transacao } from '../types';

/** Port de ingestion/parsers/xlsx_itau.py */

const COL = { data: 1, lancamento: 2, parcelamento: 3, valor: 4 } as const;
const PAGAMENTO = ['PAGAMENTO', 'PAGTO'];

type Linha = unknown[];

/**
 * Excel guarda data como serial (dias desde 1899-12-30). Converter via
 * `new Date(serial)` do SheetJS aplica o fuso local e pode deslocar o dia —
 * uma compra do dia 01 vira dia 30 do mês anterior em fuso negativo, e o
 * hash muda. Fazemos a conta em UTC puro e devolvemos string ISO.
 */
function serialParaIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function paraIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000) return serialParaIso(v);
  if (v instanceof Date) {
    // SheetJS já entregou Date: usar os componentes UTC, não os locais.
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
      .toISOString().slice(0, 10);
  }
  return null;
}

/** A planilha começa com metadados do titular; o header real está no meio. */
function acharHeader(rows: Linha[]): number {
  for (let i = 0; i < rows.length; i++) {
    const cels = rows[i].map((c) => (c == null ? '' : String(c).trim()));
    if (cels.includes('Data') && cels.includes('Lançamento')) return i;
  }
  throw new Error('Header de lançamentos não encontrado na planilha');
}

/**
 * Rótulos do campo de total, e o que cada um significa.
 *
 * Procurar só a string literal 'Valor (parcial)' foi um erro: esse rótulo
 * existe na fatura ABERTA. Na fatura fechada ou paga o Itaú usa outro texto,
 * a busca não achava nada, e o painel de conferência simplesmente não
 * aparecia — dando a impressão de que só a fatura de agosto "conferia".
 *
 * O tipo importa e não pode ser chutado: 'Valor (parcial)' é a soma das
 * COMPRAS, enquanto 'Total a pagar' já desconta pagamentos e é um SALDO.
 * Comparar um saldo com a soma das compras acusa erro onde não há.
 */
const ROTULOS_TOTAL: { re: RegExp; tipo: 'compras' | 'saldo'; nome: string }[] = [
  { re: /valor\s*\(?\s*parcial/i,        tipo: 'compras', nome: 'Valor (parcial)' },
  { re: /total\s+d[ae]s?\s+compras/i,    tipo: 'compras', nome: 'Total das compras' },
  { re: /total\s+a\s+pagar/i,            tipo: 'saldo',   nome: 'Total a pagar' },
  { re: /valor\s+total|total\s+d[ae]\s+fatura|valor\s+d[ae]\s+fatura/i,
                                          tipo: 'saldo',   nome: 'Valor total da fatura' },
];

interface TotalAchado { valor: number; tipo: 'compras' | 'saldo'; rotulo: string }

/**
 * O número pode estar na linha de baixo (layout de cabeçalho, caso da fatura
 * aberta) ou na mesma linha, à direita do rótulo.
 */
function acharValorFatura(rows: Linha[]): TotalAchado | null {
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const cel = rows[i][j];
      if (cel == null) continue;
      const texto = semAcento(String(cel));

      const achado = ROTULOS_TOTAL.find((r) => r.re.test(texto));
      if (!achado) continue;

      // mesma coluna, linha de baixo
      const abaixo = rows[i + 1]?.[j];
      if (typeof abaixo === 'number') {
        return { valor: abaixo, tipo: achado.tipo, rotulo: achado.nome };
      }
      // à direita, na mesma linha
      for (let k = j + 1; k < rows[i].length; k++) {
        if (typeof rows[i][k] === 'number') {
          return { valor: rows[i][k] as number, tipo: achado.tipo, rotulo: achado.nome };
        }
      }
      // qualquer número na linha de baixo
      for (const c of rows[i + 1] ?? []) {
        if (typeof c === 'number') {
          return { valor: c, tipo: achado.tipo, rotulo: achado.nome };
        }
      }
    }
  }
  return null;
}

/** Acha o valor logo abaixo de um header, casando pelo nome da coluna. */
function valorAbaixoDoHeader(rows: Linha[], nomeHeader: string): unknown {
  for (let i = 0; i < rows.length - 1; i++) {
    const j = rows[i].findIndex(
      (c) => c != null && semAcento(String(c)).includes(semAcento(nomeHeader)),
    );
    if (j >= 0) return rows[i + 1]?.[j];
  }
  return null;
}

/**
 * Descobre de que fatura é esta planilha (ADR-001).
 *
 * O Itaú escreve "Fatura Aberta - Agosto/2026" no cabeçalho. Quando esse texto
 * aparece, a competência é dele — é a fonte mais confiável possível. Quando
 * não aparece (fatura fechada pode escrever diferente; não temos amostra),
 * caímos no mês seguinte à última compra, que é o comportamento típico de
 * cartão, mas marcamos como 'deduzida' para a tela pedir confirmação.
 */
function detectarFatura(rows: Linha[], transacoes: Transacao[], total: TotalAchado | null): FaturaDetectada | null {
  if (transacoes.length === 0) return null;

  const venc = paraIso(valorAbaixoDoHeader(rows, 'vencimento'));

  for (const r of rows) {
    for (const c of r) {
      if (c == null) continue;
      const lido = lerCabecalhoFatura(String(c));
      if (lido) {
        return {
          ...lido,
          // o cabeçalho traz o mês do VENCIMENTO; a competência é o mês das compras
          competencia: competenciaDoBanco(lido.competencia),
          vencimento: venc,
          valorTotal: total?.valor ?? null,
          // o tipo vem do RÓTULO encontrado, não de suposição
          tipoValor: total?.tipo ?? 'compras',
          confianca: 'arquivo',
        };
      }
    }
  }

  // Sem cabeçalho: o vencimento, se existir, é o melhor indício da competência.
  const ultimaCompra = transacoes.reduce((a, t) => (t.data > a ? t.data : a), transacoes[0].data);
  return {
    // sem cabeçalho: o vencimento indica o mês do banco, então volta um mês.
    // Sem vencimento, o próprio mês da última compra já é a competência.
    competencia: venc ? competenciaDoBanco(inicioDoMes(venc)) : inicioDoMes(ultimaCompra),
    vencimento: venc,
    valorTotal: total?.valor ?? null,
    tipoValor: total?.tipo ?? 'compras',
    status: 'fechada',
    confianca: 'deduzida',
  };
}

/**
 * Lê a fatura do Itaú em XLSX.
 *
 * ATENÇÃO AO SINAL: na planilha do Itaú compras são POSITIVAS (quanto você
 * deve) e pagamentos são NEGATIVOS. Isso é o inverso da convenção do projeto,
 * então todo valor é multiplicado por -1.
 */
export function parseXlsxItau(
  buf: ArrayBuffer,
  contaId: number,
  fonte: string,
): ResultadoParse {
  // A planilha do Itaú só existe como fatura de cartão; não há versão de
  // extrato de conta nesse formato.
  const res: ResultadoParse = {
    transacoes: [], snapshot: null, avisos: [], tipoConta: 'cartao', fatura: null,
  };

  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Linha>(ws, { header: 1, raw: true, blankrows: true });

  const inicio = acharHeader(rows) + 1;
  const zerados: string[] = [];

  for (let i = inicio; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const iso = paraIso(r[COL.data]);

    // Linhas de "Subtotal" e o rodapé de avisos param a leitura.
    if (!iso) {
      if (r.some((c) => c != null && String(c).includes('Subtotal'))) break;
      continue;
    }

    const lancamento = r[COL.lancamento];
    const brutoValor = r[COL.valor];
    if (lancamento == null || brutoValor == null) continue;

    const num = typeof brutoValor === 'number' ? brutoValor : Number(String(brutoValor).replace(',', '.'));
    if (!Number.isFinite(num)) continue;

    // Linha de valor zero não é lançamento: a fatura do Itaú inclui
    // "CONTROLE DE SALDO" e afins com 0,00, que são marcadores internos do
    // banco. A tabela tem check (valor <> 0), então deixar passar derruba o
    // insert do lote inteiro — 19 compras válidas foram rejeitadas por causa
    // de uma linha dessas.
    if (Math.abs(num) < 0.005) {
      zerados.push(String(lancamento));
      continue;
    }

    const desc = String(lancamento);
    res.transacoes.push({
      conta_id: contaId,
      data: iso,
      valor: num * -1, // inversão de sinal
      descricao: desc,
      fonte,
      metodo: 'credito',
      eh_interna: PAGAMENTO.some((p) => desc.toUpperCase().includes(p)),
    } satisfies Transacao);
  }

  // "Valor (parcial)" é a soma das COMPRAS do ciclo, e não o saldo líquido:
  // ele ignora pagamentos lançados no período. Emitimos como snapshot (negativo,
  // passivo) mas avisamos, porque fechar a conferência exige um lançamento de
  // saldo de abertura do ciclo.
  if (zerados.length > 0) {
    res.avisos.push(
      `${zerados.length} linha(s) de valor zero ignorada(s): ${zerados.slice(0, 3).join(', ')}` +
      `${zerados.length > 3 ? '…' : ''}. São marcadores da fatura, não lançamentos.`,
    );
  }

  const total = acharValorFatura(rows);
  res.fatura = detectarFatura(rows, res.transacoes, total);

  if (total == null && res.transacoes.length > 0) {
    res.avisos.push(
      'Não achei o campo de total nesta planilha, então não dá para conferir a soma ' +
      'contra o que o banco informa. Os lançamentos entram normalmente.',
    );
  }

  if (total != null && res.transacoes.length > 0) {
    const dataRef = res.transacoes.reduce((a, t) => (t.data > a ? t.data : a), res.transacoes[0].data);
    res.snapshot = {
      conta_id: contaId,
      data_ref: dataRef,
      saldo: total.valor * -1,
      fonte,
      observacao: `${total.rotulo} da fatura (${total.tipo})`,
    };
  }

  // Havia aqui um aviso de "saldo de abertura do ciclo necessário" que
  // comparava o valor da fatura com a soma LÍQUIDA dos lançamentos e chamava
  // a diferença de saldo de abertura. Não era: numa fatura aberta a diferença
  // é simplesmente o pagamento lançado no período. O painel de conferência
  // mostra compras, pagamentos e total separados, que é a informação correta
  // e sem o rótulo errado.

  return res;
}
