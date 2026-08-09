/**
 * Bot do Telegram por polling — roda na sua máquina, sem deploy.
 *
 *   npm run bot
 *
 * Extensão .mts, não .ts, de propósito: o package.json não declara
 * "type": "module", então o tsx compilaria um .ts como CommonJS — e este
 * arquivo usa `await` no topo, que só existe em ESM. O .mts força ESM sem
 * precisar mexer no módulo do projeto inteiro, que afetaria o Next.
 *
 * Usa `getUpdates` em long polling em vez de webhook. Não precisa de URL
 * pública nem de autenticação, então funciona hoje. A troca: só recebe
 * enquanto o processo estiver de pé. Mensagens enviadas com o bot desligado
 * não se perdem — o Telegram guarda por 24h e elas chegam quando ele voltar.
 *
 * A lógica de interpretar e gravar é a mesma que o webhook vai usar
 * (src/lib/telegram/gramatica.ts e src/lib/manual.ts). Migrar para webhook é
 * trocar o laço abaixo por uma route handler; nada do miolo muda.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── .env.local ──────────────────────────────────────────────────────────────
// O Next carrega sozinho; um script avulso não. Leitura mínima, sem dependência.
function carregarEnv() {
  const arq = join(raiz, '.env.local');
  if (!existsSync(arq)) return;
  for (const linha of readFileSync(arq, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(linha);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
carregarEnv();

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_PERMITIDO = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN) {
  console.error('Falta TELEGRAM_TOKEN no .env.local. Pegue com o @BotFather.');
  process.exit(1);
}
if (!CHAT_PERMITIDO) {
  console.error(
    'Falta TELEGRAM_CHAT_ID no .env.local.\n' +
    'Sem ele, QUALQUER pessoa que achar o bot escreve nas suas finanças.\n' +
    'Descubra o seu falando com o @userinfobot.',
  );
  process.exit(1);
}

const { interpretar, AJUDA } = await import('../src/lib/telegram/gramatica.ts');
const { registrarManual, desfazerUltimoManual } = await import('../src/lib/manual.ts');
const { supabase } = await import('../src/lib/supabase.ts');
const { dinheiro, dataCurta } = await import('../src/lib/formato.ts');

const FONTE = 'telegram';
const ARQ_OFFSET = join(raiz, '.bot-offset');

const api = (metodo: string) => `https://api.telegram.org/bot${TOKEN}/${metodo}`;

async function responder(chatId: number, texto: string) {
  await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'Markdown' }),
  });
}

/**
 * Conta onde o Pix é lançado.
 *
 * Configurável por CONTA_PIX no .env.local (nome exato da conta). Sem isso,
 * usa a primeira conta corrente ativa — decidir sozinho entre duas seria
 * chutar em qual banco o dinheiro saiu.
 */
async function resolverConta(): Promise<{ id: number; nome: string }> {
  const desejada = process.env.CONTA_PIX;
  const { data, error } = await supabase
    .from('contas').select('id,nome,tipo').eq('ativa', true).order('id');
  if (error) throw error;

  const contas = data as { id: number; nome: string; tipo: string }[];
  if (desejada) {
    const c = contas.find((x) => x.nome === desejada);
    if (!c) throw new Error(`CONTA_PIX="${desejada}" não existe. Opções: ${contas.map((x) => x.nome).join(', ')}`);
    return c;
  }
  const c = contas.find((x) => x.tipo === 'corrente');
  if (!c) throw new Error('Nenhuma conta corrente cadastrada.');
  return c;
}

async function totalDoMes(): Promise<string> {
  const mes = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7);
  const { data, error } = await supabase
    .from('transacoes')
    .select('valor,eh_interna,fonte')
    .gte('data', `${mes}-01`)
    .lte('data', `${mes}-31`)
    .range(0, 4999);
  if (error) throw error;

  const linhas = data as { valor: string; eh_interna: boolean; fonte: string }[];
  const validas = linhas.filter((l) => !l.eh_interna);
  const total = validas.reduce((a, l) => a - Number(l.valor), 0);
  const manuais = validas.filter((l) => l.fonte === FONTE).length;

  return `*${dinheiro(total)}* no mês\n${validas.length} lançamento(s), ${manuais} registrado(s) por aqui`;
}

async function processar(chatId: number, texto: string) {
  const t = texto.trim();

  if (/^\/(start|ajuda|help)/i.test(t)) return responder(chatId, AJUDA);

  if (/^\/gastei/i.test(t)) {
    try { return responder(chatId, await totalDoMes()); }
    catch (e) { return responder(chatId, `Não consegui somar: ${(e as Error).message}`); }
  }

  if (/^\/desfazer/i.test(t)) {
    try {
      const r = await desfazerUltimoManual(FONTE);
      return responder(chatId, r
        ? `Removido: ${r.descricao} · ${dinheiro(r.valor)}`
        : 'Não há nada registrado por aqui para desfazer.');
    } catch (e) {
      return responder(chatId, `Falhou: ${(e as Error).message}`);
    }
  }

  const lido = interpretar(t);
  if (!lido) return responder(chatId, `Não entendi.\n\n${AJUDA}`);

  try {
    const conta = await resolverConta();
    const r = await registrarManual({
      contaId: conta.id,
      data: lido.data,
      valor: lido.valor,
      descricao: lido.descricao,
      metodo: lido.metodo,
      fonte: FONTE,
    });

    if (r.duplicado) {
      return responder(chatId, 'Esse lançamento já existia, não gravei de novo.');
    }

    const sinal = lido.valor < 0 ? '' : 'entrada de ';
    await responder(chatId,
      `Anotado: ${sinal}*${dinheiro(Math.abs(lido.valor))}*\n` +
      `${lido.descricao} · ${lido.metodo} · ${dataCurta(lido.data)}\n` +
      `${conta.nome}`);
  } catch (e) {
    await responder(chatId, `Não consegui gravar: ${(e as Error).message}`);
  }
}

// ── laço de polling ─────────────────────────────────────────────────────────
let offset = existsSync(ARQ_OFFSET) ? Number(readFileSync(ARQ_OFFSET, 'utf-8')) || 0 : 0;

console.log('Bot no ar. Ctrl+C para parar.');
console.log(`Só respondo ao chat ${CHAT_PERMITIDO}.`);

for (;;) {
  try {
    const r = await fetch(api('getUpdates') + `?offset=${offset}&timeout=30`);
    const j = await r.json() as {
      ok: boolean;
      result?: { update_id: number; message?: { chat: { id: number }; text?: string } }[];
    };
    if (!j.ok) { await new Promise((s) => setTimeout(s, 5000)); continue; }

    for (const up of j.result ?? []) {
      offset = up.update_id + 1;
      writeFileSync(ARQ_OFFSET, String(offset));

      const msg = up.message;
      if (!msg?.text) continue;

      // Whitelist. Sem isto, qualquer um que achar o bot pelo nome escreve
      // na base — o token é o que protege a API, não os seus dados.
      if (String(msg.chat.id) !== CHAT_PERMITIDO) {
        console.warn(`ignorado: chat ${msg.chat.id} não autorizado`);
        continue;
      }

      console.log(`> ${msg.text}`);
      await processar(msg.chat.id, msg.text);
    }
  } catch (e) {
    console.error('erro no laço:', (e as Error).message);
    await new Promise((s) => setTimeout(s, 5000));
  }
}
