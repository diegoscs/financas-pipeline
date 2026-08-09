import type { StatusFatura } from './types';

/**
 * Competência de fatura — o mês em que ela é cobrada (ADR-001).
 *
 * A fatura de agosto contém compras de julho. Guardar só a data da compra
 * responde "quanto gastei em julho" mas nunca "quanto veio na fatura de
 * agosto". A competência é sempre o primeiro dia do mês: '2026-08-01'.
 */

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

export const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** 'Fatura Aberta - Agosto/2026' → { competencia: '2026-08-01', status: 'aberta' } */
const RE_FATURA = /fatura\s+(\w+)\s*[-–—]\s*([a-z]+)\s*\/\s*(\d{4})/i;

export function lerCabecalhoFatura(
  texto: string,
): { competencia: string; status: StatusFatura } | null {
  const m = RE_FATURA.exec(semAcento(texto));
  if (!m) return null;

  const mes = MESES[m[2]];
  if (!mes) return null;

  return {
    competencia: `${m[3]}-${String(mes).padStart(2, '0')}-01`,
    status: normalizarStatus(m[1]),
  };
}

/**
 * O texto do Itaú observado foi 'Fatura Aberta'. Fatura fechada ou paga
 * provavelmente escreve outra palavra, mas não temos amostra — qualquer coisa
 * não reconhecida cai em 'fechada', que é o caso comum de fatura antiga, e a
 * tela permite corrigir.
 */
function normalizarStatus(palavra: string): StatusFatura {
  const p = semAcento(palavra);
  if (p.startsWith('abert')) return 'aberta';
  if (p.startsWith('pag')) return 'paga';
  return 'fechada';
}

/** '2026-08-01' → 'agosto/2026' */
export function competenciaRotulo(iso: string): string {
  const nomes = Object.keys(MESES);
  const [ano, mes] = iso.split('-');
  return `${nomes[Number(mes) - 1]}/${ano}`;
}

/** Primeiro dia do mês de uma data ISO. */
export function inicioDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Mês seguinte ao de uma data ISO, como competência. */
export function mesSeguinte(iso: string): string {
  const ano = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
}

/** Mês anterior ao de uma data ISO, como competência. */
export function mesAnterior(iso: string): string {
  const ano = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  return mes === 1 ? `${ano - 1}-12-01` : `${ano}-${String(mes - 1).padStart(2, '0')}-01`;
}

/**
 * Converte o mês com que o BANCO nomeia a fatura para o mês das COMPRAS.
 *
 * O Itaú chama de "Fatura Aberta - Agosto/2026" a fatura que vence em 10/08 e
 * contém compras de 03/07 a 01/08. O banco nomeia pelo vencimento; aqui a
 * fatura é nomeada pelo período gasto, que é como se pensa em "quanto gastei
 * em julho".
 *
 * O `vencimento` continua guardado para conferir contra o app do banco — sem
 * ele, "julho" aqui e "agosto" lá viram uma tradução mental a cada consulta.
 *
 * Vale para os dois bancos: no OFX do Nubank o DTEND de 01/08 fecha o ciclo
 * de compras de julho, mesmo deslocamento.
 */
export const competenciaDoBanco = (mesDoBanco: string) => mesAnterior(mesDoBanco);

/** Lista de competências para o usuário escolher ao corrigir a detecção. */
export function opcoesCompetencia(centro: string, raio = 8): string[] {
  const out: string[] = [];
  let ano = Number(centro.slice(0, 4));
  let mes = Number(centro.slice(5, 7)) - raio;
  while (mes <= 0) { mes += 12; ano -= 1; }
  for (let i = 0; i <= raio * 2; i++) {
    out.push(`${ano}-${String(mes).padStart(2, '0')}-01`);
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return out;
}
