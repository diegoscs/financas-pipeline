/**
 * Port fiel de ingestion/normalize.py.
 *
 * "Fiel" aqui é requisito duro, não elegância: o hash_natural é a chave de
 * dedupe que já existe no banco. Se este arquivo divergir do Python por um
 * único byte, toda transação já gravada volta a ser vista como nova e a base
 * duplica silenciosamente. Há um teste em scripts/verificar-hashes.mjs que
 * confere os hashes gerados aqui contra as linhas gravadas pelo Python.
 */

/**
 * Equivalente ao unidecode() do Python para o que aparece em extrato brasileiro.
 *
 * NFD + remoção de diacríticos resolve o caso geral (á→a, ç→c, ã→a). Não
 * resolve caracteres que o unidecode expande em vez de simplificar — 'ª' vira
 * 'a', '°' vira 'deg' — e esses o NFD deixaria passar intactos, gerando hash
 * diferente do Python. A tabela cobre os que de fato aparecem em nome de
 * estabelecimento.
 */
const EXPANSOES: Record<string, string> = {
  'ª': 'a', 'º': 'o', '°': 'deg', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE',
  'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D',
  'ł': 'l', 'Ł': 'L', 'þ': 'th', 'Þ': 'TH', 'ð': 'd', 'Ð': 'D',
  '×': 'x', '÷': '/', '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4',
  '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '--', '…': '...',
};

function translitera(s: string): string {
  let out = '';
  for (const ch of s) {
    const exp = EXPANSOES[ch];
    if (exp !== undefined) { out += exp; continue; }
    // NFD separa a letra do acento; a faixa U+0300–U+036F são os acentos.
    out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  return out;
}

// Prefixos de gateway: "Mp *Doutorgranola", "Dm*Spotify", "Anthropic* Claude"
const GATEWAY = /^(MP|DM|PAG|PAGSEGURO|IUGU|STONE)\s*\*\s*/i;
// Padding de caractere repetido que o Itaú insere: "1518aaaaaaaaguaruja"
const PADDING = /([A-Z])\1{3,}/g;
const ESPACOS = /\s+/g;

/**
 * Normaliza para hash e para casamento de regras.
 *
 * NÃO tenta separar cidade/país do estabelecimento. O Itaú concatena sem
 * separador ("Rockaffesao Paulobra") e qualquer heurística para desgrudar
 * isso erra mais do que acerta. As regras de categoria casam no prefixo,
 * que é a parte estável e informativa.
 */
export function normalizarDescricao(bruta: string | null | undefined): string {
  let s = translitera(bruta ?? '').toUpperCase().trim();
  s = s.replace(GATEWAY, '');
  s = s.replace(PADDING, '$1');
  s = s.replace(ESPACOS, ' ');
  return s.trim();
}

/**
 * Formata o valor como o Python formata Decimal com :.2f.
 *
 * Planilha guarda 394.90 como 394.90000000000003; toFixed(2) reduz isso a
 * "394.90", que é o que o Decimal do Python produz. Os valores de origem
 * sempre têm 2 casas, então nunca há arredondamento real — só truncamento
 * de ruído de ponto flutuante.
 */
export function formatarValor(v: number): string {
  const s = v.toFixed(2);
  return s === '-0.00' ? '0.00' : s; // Python nunca produz "-0.00" aqui
}

async function sha256Hex(texto: string): Promise<string> {
  const dados = new TextEncoder().encode(texto);
  // crypto.subtle existe no browser e no Node >= 20 via globalThis.crypto
  const buf = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** data em ISO 'YYYY-MM-DD' — nunca Date, para não haver fuso no meio. */
export function calcularHash(
  contaId: number,
  dataIso: string,
  valor: number,
  descNorm: string,
  ocorrencia: number,
): Promise<string> {
  const chave = `${contaId}|${dataIso}|${formatarValor(valor)}|${descNorm}|${ocorrencia}`;
  return sha256Hex(chave);
}

export interface ComHash {
  conta_id: number;
  data: string;
  valor: number;
  descricao: string;
  ocorrencia?: number;
  hash_natural?: string;
}

/**
 * Numera transações idênticas dentro do arquivo e calcula o hash.
 *
 * Dois cafés de R$ 19,90 no mesmo lugar no mesmo dia são gastos distintos e
 * legítimos. Sem o índice de ocorrência o hash colide e o dedupe descarta um
 * deles silenciosamente. Como o índice deriva da ordem estável do arquivo,
 * reprocessar o mesmo arquivo gera exatamente os mesmos hashes.
 */
export async function atribuirHashes<T extends ComHash>(transacoes: T[]): Promise<T[]> {
  const contador = new Map<string, number>();
  for (const t of transacoes) {
    t.descricao = normalizarDescricao(t.descricao);
    const chave = `${t.conta_id}|${t.data}|${formatarValor(t.valor)}|${t.descricao}`;
    const n = (contador.get(chave) ?? 0) + 1;
    contador.set(chave, n);
    t.ocorrencia = n;
    t.hash_natural = await calcularHash(t.conta_id, t.data, t.valor, t.descricao, n);
  }
  return transacoes;
}
