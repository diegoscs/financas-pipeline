/**
 * Importa em lote todos os arquivos de uma pasta.
 *
 *   npm run importar -- "C:\\caminho\\da\\pasta"
 *
 * Usa `prepararArquivo` e `gravar` — exatamente o mesmo caminho da tela de
 * import. Não é uma implementação paralela: se o resultado aqui divergir do
 * que a tela produz, é bug. Serve tanto para carga inicial quanto como teste
 * de ponta a ponta da ingestão.
 *
 * O banco de cada arquivo sai do nome, seguindo a convenção de exportação:
 *   NU_<conta>_<periodo>.ofx      → extrato de conta corrente Nubank
 *   Nubank_<data>.ofx             → fatura do cartão Nubank
 *   fatura-*.xlsx                 → fatura do cartão Itaú
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function carregarEnv() {
  const arq = join(raiz, '.env.local');
  if (!existsSync(arq)) return;
  for (const linha of readFileSync(arq, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(linha);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
carregarEnv();

const pasta = process.argv[2];
if (!pasta || !existsSync(pasta) || !statSync(pasta).isDirectory()) {
  console.error('Uso: npm run importar -- "C:\\caminho\\da\\pasta"');
  process.exit(1);
}

const { prepararArquivo, gravar } = await import('../src/lib/ingest.ts');
const { dinheiro } = await import('../src/lib/formato.ts');

/** Descobre o banco pelo nome do arquivo. */
function bancoDoArquivo(nome: string): string | null {
  const n = basename(nome);
  if (/^NU_\d+/i.test(n)) return 'nubank';       // extrato conta corrente
  if (/^Nubank[_-]/i.test(n)) return 'nubank';   // fatura do cartão
  if (/^fatura/i.test(n)) return 'itau';         // fatura do cartão Itaú
  return null;
}

/**
 * Ordem cronológica pelo nome.
 *
 * O dedupe não depende da ordem, mas importar do mais antigo para o mais novo
 * faz o relatório ficar legível e permite conferir mês a mês.
 */
const MESES: Record<string, string> = {
  JAN:'01',FEV:'02',MAR:'03',ABR:'04',MAI:'05',JUN:'06',
  JUL:'07',AGO:'08',SET:'09',OUT:'10',NOV:'11',DEZ:'12',
  janeiro:'01',fevereiro:'02',['março']:'03',marco:'03',abril:'04',maio:'05',junho:'06',
  julho:'07',agosto:'08',setembro:'09',outubro:'10',novembro:'11',dezembro:'12',
};

function chaveOrdem(nome: string): string {
  let m = /_(\d{2})([A-Z]{3})(\d{4})_/i.exec(nome);           // NU_..._01JUL2026_...
  if (m) return `${m[3]}-${MESES[m[2].toUpperCase()] ?? '00'}`;
  m = /(\d{4})-(\d{2})-\d{2}/.exec(nome);                     // Nubank_2026-07-08
  if (m) return `${m[1]}-${m[2]}`;
  m = /-([a-zç]+)(\d{4})\./i.exec(nome);                      // ...-julho2026.xlsx
  if (m) return `${m[2]}-${MESES[m[1].toLowerCase()] ?? '00'}`;
  return 'zzzz';
}

const arquivos = readdirSync(pasta)
  .filter((f) => /\.(ofx|xlsx|xls)$/i.test(f) && bancoDoArquivo(f))
  .sort((a, b) => chaveOrdem(a).localeCompare(chaveOrdem(b)) || a.localeCompare(b));

if (arquivos.length === 0) {
  console.error('Nenhum arquivo reconhecido na pasta.');
  process.exit(1);
}

console.log(`${arquivos.length} arquivo(s) para importar de ${pasta}\n`);

let totalNovas = 0, totalDup = 0, falhas = 0;
const avisos: string[] = [];

for (const nome of arquivos) {
  const banco = bancoDoArquivo(nome)!;
  const buf = readFileSync(join(pasta, nome));
  // File global existe no Node 20+; prepararArquivo só usa .name e .arrayBuffer()
  const file = new File([buf], nome);

  try {
    const p = await prepararArquivo(file as never, banco);
    const novas = p.transacoes.filter((t) => !p.duplicadas.has(t.hash_natural!)).length;
    const r = await gravar(p);

    const gasto = p.transacoes
      .filter((t) => !p.duplicadas.has(t.hash_natural!) && !t.eh_interna && t.valor < 0)
      .reduce((a, t) => a - t.valor, 0);

    console.log(
      `✓ ${nome.slice(0, 44).padEnd(44)} ${p.conta.nome.padEnd(14)} ` +
      `${String(r.gravadas).padStart(4)} novas ${String(r.ignoradas).padStart(4)} dup  ${dinheiro(gasto).padStart(12)}`,
    );
    totalNovas += r.gravadas; totalDup += r.ignoradas;
    for (const a of p.avisos) avisos.push(`  ${nome}: ${a}`);
    if (novas !== r.gravadas) {
      avisos.push(`  ${nome}: preview dizia ${novas} novas mas gravou ${r.gravadas} — conferir`);
    }
  } catch (e) {
    falhas++;
    console.log(`✗ ${nome.slice(0, 44).padEnd(44)} ${(e as Error).message}`);
  }
}

console.log(`\n${totalNovas} gravadas · ${totalDup} já existiam · ${falhas} falha(s)`);

if (avisos.length > 0) {
  console.log('\n── avisos ──');
  for (const a of avisos) console.log(a);
}
