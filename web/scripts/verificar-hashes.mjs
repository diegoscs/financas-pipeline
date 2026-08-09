/**
 * Verifica que o port TypeScript gera exatamente os mesmos hash_natural que
 * o pipeline Python gerou. Se este script falhar, o dedupe está quebrado e
 * reimportar uma fatura já processada vai duplicar tudo.
 *
 * Uso:  node scripts/verificar-hashes.mjs
 *
 * Os hashes esperados foram lidos da tabela transacoes do Supabase, gravados
 * pela execução do CLI Python sobre samples/fatura-aberta-final 2394-agosto2026.xlsx
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── cópia da lógica de normalize.ts (o script roda sem build) ────────────────
const EXPANSOES = {
  'ª': 'a', 'º': 'o', '°': 'deg', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE',
  'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D',
  'ł': 'l', 'Ł': 'L', 'þ': 'th', 'Þ': 'TH', 'ð': 'd', 'Ð': 'D',
  '×': 'x', '÷': '/', '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4',
  '“': '"', '”': '"', '‘': "'", '’': "'",
  '–': '-', '—': '--', '…': '...',
};
const translitera = (s) => {
  let out = '';
  for (const ch of s) {
    if (EXPANSOES[ch] !== undefined) { out += EXPANSOES[ch]; continue; }
    out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  return out;
};
const GATEWAY = /^(MP|DM|PAG|PAGSEGURO|IUGU|STONE)\s*\*\s*/i;
const PADDING = /([A-Z])\1{3,}/g;
const normalizarDescricao = (b) =>
  translitera(b ?? '').toUpperCase().trim()
    .replace(GATEWAY, '').replace(PADDING, '$1').replace(/\s+/g, ' ').trim();
const fmt = (v) => { const s = v.toFixed(2); return s === '-0.00' ? '0.00' : s; };
const sha256 = async (t) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))))
  .map((b) => b.toString(16).padStart(2, '0')).join('');

// ── cópia da lógica de parsers/xlsxItau.ts ──────────────────────────────────
const COL = { data: 1, lancamento: 2, valor: 4 };
const serialParaIso = (s) => new Date(Math.round((s - 25569) * 86400000)).toISOString().slice(0, 10);
const paraIso = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000) return serialParaIso(v);
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  return null;
};

function parseXlsx(buf, contaId, fonte) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: true });
  let inicio = -1;
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].map((x) => (x == null ? '' : String(x).trim()));
    if (c.includes('Data') && c.includes('Lançamento')) { inicio = i + 1; break; }
  }
  if (inicio < 0) throw new Error('Header não encontrado');
  const out = [];
  for (let i = inicio; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const iso = paraIso(r[COL.data]);
    if (!iso) { if (r.some((c) => c != null && String(c).includes('Subtotal'))) break; continue; }
    const l = r[COL.lancamento], v = r[COL.valor];
    if (l == null || v == null) continue;
    out.push({ conta_id: contaId, data: iso, valor: Number(v) * -1, descricao: String(l), fonte });
  }
  return out;
}

async function atribuirHashes(ts) {
  const cont = new Map();
  for (const t of ts) {
    t.descricao = normalizarDescricao(t.descricao);
    const k = `${t.conta_id}|${t.data}|${fmt(t.valor)}|${t.descricao}`;
    const n = (cont.get(k) ?? 0) + 1;
    cont.set(k, n);
    t.ocorrencia = n;
    t.hash_natural = await sha256(`${t.conta_id}|${t.data}|${fmt(t.valor)}|${t.descricao}|${n}`);
  }
  return ts;
}

// ── hashes gravados pelo Python (fonte: tabela transacoes) ───────────────────
const ESPERADOS = new Map(Object.entries({
  b45a68761276156a758a7fb4034174ade36c7d96a6f8bb36804532a93c6b0b16: 'JOSEGERALDOANTAOSAO PAULOBRA',
  '9090ccd2e6798da266b9f74a6aaeffe5ae54242a5fb8018813b9ae620452b1d7': 'AV ZACHI NARCHISAO PAULOBRA',
  '793c30d971aece8b62f8f64c06827ea505f48553538ab76edb287560ae869c63': 'PAGAMENTO PIX',
  becf0918bf8b426293c85376c849cf9127d6da94191ec2c28773c9c634b0db7d: 'FRUTVERAOSORVOSASCOBRA',
  '6ffd2392a430c45f83f29bb2e467e1ef24990dcef39ae063cb92d62507f8025c': 'ELESSANDRABATISTAUBATUBABRA',
  '746a397f4e887f56549399008148145b5355f6e6243607eec7c1f16ed6731e4e': 'OKONE SUSHIUBATUBABRA',
  '949e2a2b179d7038d1f3b481671ee5e9bf1e75e88e4065b61e152cf603195f6f': 'LOJA PARAFINAUBATUBABRA',
  ffb5e5f05f1139052456939952734a5ef54a10fd84a5ad0e1c92421cec2b5c93: 'EDSON ROBERTO DE CARVUBATUBABRA',
  '9342ed1c569c1a21a691b204d5b58d4e49e56f44507481f41a34ea561112172a': 'DENILOPESDONASO PAULOBRA',
  '7d42b4ecfc6b6fe4021cb9ed9afe01118e238b64bf015354b4e56478cc198a1f': '41833-PAROQUIA SAO JOAOLIMPIABRA',
  '4b82509f6461ed2f5d31d83eccf22c98fa8e389cfb44a1e20a7f612feac357d8': 'DOUTORGRANOLASORVOLMPIABRA',
  ab5a5595b80041a38a139fd7ec4ec8aea68b505d01d9a66c9cd3089c562c233c: 'MERCADO EXTRA 1877SAO PAULOBRA',
  '1855b802c50f702c3b28ebaf869ad6042e6fc6140f29309267d7122294c3b6a1': 'ROCKAFFESAO PAULOBRA',
  '7b0c6b1fb8da90ecd652e6fa1bb4d43a7f7d9d87a863e3ec8895d4c4f9012186': 'MINUTO PA 1518AGUARUJABRA',
  '0af475a8a95b1dfa01684a8dd2a3ae0e0d3466a0f37aee9c7b295839c577f251': 'PADARIA E CONFEITARIASAO PAULOBRA',
  '15bddea3daf3442e6d052c7feb76d4db487eab20fdd9da546a4df6681af646f6': 'ROCKAFFESAO PAULOBRA',
  b6ef05dd65ec3982933370a4f79bc5f4821827aa59b24b92499e0a306d8347c6: 'LAMCOMERCIOESAO PAULOBRA',
  e7ad57f28654dbb14200ebe7fb805498576b69d214a89d608507ae06886605fa: 'ROCKAFFESAO PAULOBRA',
}));

const buf = readFileSync(join(raiz, '..', 'samples', 'fatura-aberta-final 2394-agosto2026.xlsx'));
const ts = await atribuirHashes(parseXlsx(buf, 4, 'xlsx_itau_cartao'));

let ok = 0;
const faltando = [];
for (const t of ts) {
  if (ESPERADOS.has(t.hash_natural)) ok++;
  else faltando.push(t);
}

console.log(`Transações lidas pelo TS : ${ts.length}`);
console.log(`Hashes esperados (Python): ${ESPERADOS.size}`);
console.log(`Bateram                  : ${ok}`);

if (faltando.length) {
  console.log('\nDivergências:');
  for (const t of faltando) {
    console.log(`  ${t.data} ${fmt(t.valor).padStart(9)} oc=${t.ocorrencia} "${t.descricao}"`);
    console.log(`     gerado: ${t.hash_natural}`);
  }
}

const sucesso = ok === ESPERADOS.size && faltando.length === 0;
console.log(sucesso ? '\nOK — port fiel, dedupe preservado.' : '\nFALHOU — o port diverge do Python.');
process.exit(sucesso ? 0 : 1);
