import type { Metodo } from '../types';

/**
 * Interpreta a mensagem que chega pelo Telegram.
 *
 * Quem está pagando a conta de um café não vai lembrar de sintaxe. A leitura
 * é tolerante: só o valor é obrigatório, todo o resto tem padrão sensato.
 *
 *   100 almoço                → -100,00 · pix · hoje
 *   19,90 uber                → -19,90 · pix
 *   100 dinheiro feira        → -100,00 · dinheiro
 *   +50 reembolso do joão     → +50,00 · entrada
 *   ontem 80 mercado          → -80,00 · data de ontem
 *   15/07 120 presente        → -120,00 · 15 de julho
 */

export interface Interpretado {
  valor: number;
  /** ISO 'YYYY-MM-DD' */
  data: string;
  descricao: string;
  metodo: Metodo;
}

const METODOS: Record<string, Metodo> = {
  pix: 'pix', dinheiro: 'dinheiro', especie: 'dinheiro', cash: 'dinheiro',
  debito: 'debito', débito: 'debito', ted: 'ted', doc: 'ted', boleto: 'boleto',
  credito: 'credito', crédito: 'credito',
};

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function hojeIso(agora = new Date()): string {
  // Fuso de São Paulo: o servidor da Vercel roda em UTC, e depois das 21h
  // "hoje" em UTC já é amanhã no Brasil. Um gasto registrado às 22h cairia
  // no dia seguinte.
  const brt = new Date(agora.getTime() - 3 * 3600 * 1000);
  return brt.toISOString().slice(0, 10);
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lê data no começo da mensagem, se houver. Devolve o resto do texto. */
function lerData(texto: string, hoje: string): { data: string; resto: string } {
  const t = texto.trimStart();

  const rel = /^(hoje|ontem|anteontem)\b/i.exec(semAcento(t));
  if (rel) {
    const dias = rel[1] === 'ontem' ? -1 : rel[1] === 'anteontem' ? -2 : 0;
    return { data: somarDias(hoje, dias), resto: t.slice(rel[0].length) };
  }

  // dd/mm ou dd/mm/aaaa — sem ano, assume o ano corrente; se cair no futuro,
  // é do ano passado (registro de 02/01 feito em 30/12).
  const abs = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (abs) {
    const dia = Number(abs[1]);
    const mes = Number(abs[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      let ano = abs[3] ? Number(abs[3]) : Number(hoje.slice(0, 4));
      if (ano < 100) ano += 2000;
      let iso = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

      // Data sem ano que cai no futuro: só volta um ano se estiver MUITO à
      // frente. A regra existe para "30/12" digitado em 2 de janeiro, que é
      // obviamente do ano passado.
      //
      // Voltar um ano por qualquer data futura era agressivo demais: "25/08"
      // escrito em 4 de agosto virava 2025 em silêncio — um ano inteiro de
      // diferença por uma diferença de três semanas. Perto do dia de hoje, o
      // muito mais provável é erro de digitação ou lançamento programado.
      if (!abs[3] && iso > hoje) {
        const diasAdiante = (Date.parse(iso) - Date.parse(hoje)) / 86400000;
        if (diasAdiante > 120) iso = `${ano - 1}${iso.slice(4)}`;
      }
      return { data: iso, resto: t.slice(abs[0].length) };
    }
  }

  return { data: hoje, resto: t };
}

export function interpretar(mensagem: string, agora = new Date()): Interpretado | null {
  const hoje = hojeIso(agora);
  const { data, resto } = lerData(mensagem, hoje);

  // Valor: primeiro número. Vírgula e ponto valem como decimal; ponto de
  // milhar é descartado ("1.234,56" e "1234.56" dão o mesmo).
  const mv = /([+-]?)\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+(?:[.,]\d{1,2})?)/i.exec(resto);
  if (!mv) return null;

  const bruto = mv[2].includes(',')
    ? mv[2].replace(/\./g, '').replace(',', '.')
    : mv[2];
  const num = Number(bruto);
  if (!Number.isFinite(num) || num === 0) return null;

  // Sem sinal explícito é saída: gasto é o caso comum.
  const valor = mv[1] === '+' ? num : -Math.abs(num);

  let texto = (resto.slice(0, mv.index) + resto.slice(mv.index + mv[0].length)).trim();

  // Método, se a primeira palavra restante for um dos conhecidos.
  let metodo: Metodo = 'pix';
  const palavras = texto.split(/\s+/).filter(Boolean);
  if (palavras.length > 0) {
    const m = METODOS[semAcento(palavras[0])];
    if (m) { metodo = m; palavras.shift(); }
  }

  const descricao = palavras.join(' ').trim();
  if (descricao === '') return null;

  return { valor, data, descricao, metodo };
}

/** Texto de ajuda, usado no /start e quando a mensagem não é entendida. */
export const AJUDA = [
  'Manda assim:',
  '',
  '`100 almoço` — R$ 100 de Pix hoje',
  '`19,90 uber` — aceita vírgula',
  '`100 dinheiro feira` — outro método',
  '`+50 reembolso do joão` — entrada',
  '`ontem 80 mercado` — outro dia',
  '`15/07 120 presente` — data específica',
  '',
  'Métodos: pix (padrão), dinheiro, debito, ted, boleto',
  '',
  '/desfazer — apaga o último',
  '/gastei — total do mês',
].join('\n');
