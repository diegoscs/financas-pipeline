import { competenciaDoBanco, inicioDoMes } from '../competencia';
import { reconhecerContaPropria } from '../minhasContas';
import type { ResultadoParse, Transacao } from '../types';

/**
 * Port de ingestion/parsers/ofx_nubank.py.
 *
 * Escrito à mão em vez de usar uma lib: OFX 1.x é SGML, não XML — tags sem
 * fechamento, header fora do documento. As libs JS de OFX ou assumem XML
 * (OFX 2.x) ou estão sem manutenção. São ~60 linhas e evitam uma dependência
 * frágil no caminho crítico.
 */

const PIX = /\bPIX\b|TRANSFER[ÊE]NCIA/i;
const BOLETO = /\bBOLETO\b/i;
const PAGAMENTO_FATURA = /PAGAMENTO\s+(RECEBIDO|DE\s+FATURA|EFETUADO)/i;

/**
 * RDB é a "caixinha" do Nubank: dinheiro indo e voltando da sua própria
 * aplicação, dentro da mesma conta.
 *
 * No extrato de julho real, 8 de 23 lançamentos eram RDB, e o padrão é
 * evidente: `Resgate RDB +184,00` seguido de `Pix -74,00` e `boleto -110,00`
 * no mesmo dia. O resgate existe só para bancar o gasto. Contar os dois faz o
 * mês somar R$ 2.027,85 de saída quando o gasto real foi R$ 416,95.
 *
 * `eh_interna` é o mecanismo certo: o CLAUDE.md já classifica aporte em
 * investimento como transferência interna.
 */
const RDB = /\b(APLICA[ÇC][ÃA]O|RESGATE)\s+RDB\b|\bRDB\b/i;

/**
 * Movimentação entre a conta e um investimento próprio, fora do RDB.
 *
 * "Transferência de saldo NuInvest" é dinheiro voltando da corretora para a
 * conta. Sem esta regra ele entrava como receita — R$ 268,61 de "entrada" que
 * nunca foi renda, só o seu próprio dinheiro mudando de lugar.
 *
 * A palavra "Transferência" faz o texto casar com o padrão de Pix, então
 * precisa ser testada ANTES.
 */
const INVESTIMENTO_PROPRIO = /NUINVEST|\bNU\s*INVEST\b|TRANSFER[ÊE]NCIA\s+DE\s+SALDO/i;

/**
 * Imposto retido sobre rendimento.
 *
 * Sai da conta de verdade, então é gasto — mas não é Pix nem boleto. Sem
 * método próprio caía em 'pix' por causa do texto e aparecia como se fosse
 * uma transferência.
 */
const IMPOSTO = /\bIRRF\b|\bIOF\b|IMPOSTO/i;

/**
 * O MEMO da conta corrente do Nubank é estruturado:
 *
 *   Transferência enviada pelo Pix - NOME - CPF/CNPJ - BANCO (0260) Agência: 1 Conta: 123-4
 *   Reembolso recebido pelo Pix - PIX Marketplace - 10.573.521/0001-91 - ...
 *   Pagamento de boleto efetuado - FUNDACAO GETULIO VARGAS
 *
 * O segundo campo é a contraparte. Extrair isso vale muito: "DROGARIA SAO
 * PAULO" e "FUNDACAO GETULIO VARGAS" são infinitamente melhores para regra de
 * categoria que o nome de comércio colado das faturas de cartão.
 *
 * A coluna `contraparte` existe no schema desde o início e nunca foi
 * preenchida por nenhum parser.
 */
function extrairContraparte(memo: string): string | null {
  if (RDB.test(memo)) return null;
  const partes = memo.split(' - ');
  if (partes.length < 2) return null;

  const nome = partes[1].trim();
  // Um CPF/CNPJ na posição do nome significa que o formato veio diferente.
  if (nome === '' || /^[\d.\-/•]+$/.test(nome)) return null;
  return nome;
}

/**
 * O header diz CHARSET:1252. Decodificar como UTF-8 transforma acento em
 * caractere de substituição, e aí "Refeição" vira "Refei??o" — descrição
 * diferente, hash diferente, duplicata na base.
 */
function decodificar(buf: ArrayBuffer): string {
  const cabecalho = new TextDecoder('ascii').decode(buf.slice(0, 512));
  const ehLatin = /CHARSET:\s*(1252|8859-1)/i.test(cabecalho)
    || /ENCODING:\s*USASCII/i.test(cabecalho);
  try {
    return new TextDecoder(ehLatin ? 'windows-1252' : 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function desescapar(s: string): string {
  return s
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Lê o valor de uma tag SGML sem fechamento: <TAG>valor(\n ou <) */
function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? desescapar(m[1].trim()) : null;
}

/**
 * DTPOSTED vem como 20260725000000[-3:BRT]. Só os 8 primeiros dígitos
 * interessam: aplicar o offset de fuso pode empurrar a compra para o dia
 * anterior e mudar o hash de uma transação que já está no banco.
 */
function dataOfx(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Descobre o banco pelo próprio arquivo.
 *
 * O OFX se identifica em <ORG> (nome) e <FID> (código Febraban). Sem isso,
 * nada impede subir um OFX do Nubank tendo selecionado Itaú — os dois
 * exportam OFX e a extensão é a mesma. Isso já aconteceu: a fatura do Nubank
 * foi parar dentro da conta do Itaú.
 */
const BANCOS_OFX: { instituicao: string; org: RegExp; fid?: string }[] = [
  { instituicao: 'nubank',    org: /\bNU\s*PAGAMENTOS|\bNUBANK\b/i, fid: '260' },
  { instituicao: 'itau',      org: /\bITA[UÚ]\b/i,                  fid: '341' },
  { instituicao: 'bradesco',  org: /\bBRADESCO\b/i,                 fid: '237' },
  { instituicao: 'santander', org: /\bSANTANDER\b/i,                fid: '033' },
  { instituicao: 'bb',        org: /BANCO\s+DO\s+BRASIL/i,          fid: '001' },
  { instituicao: 'caixa',     org: /\bCAIXA\b/i,                    fid: '104' },
  { instituicao: 'inter',     org: /\bINTER\b/i,                    fid: '077' },
  { instituicao: 'c6',        org: /\bC6\b/i,                       fid: '336' },
];

/**
 * Reconhece o nome de um banco num texto qualquer.
 *
 * Usado na contraparte do extrato: "ITAU UNIBANCO HOLDING S A" devolve 'itau'.
 * Serve para identificar pagamento de fatura feito por Pix, que no extrato da
 * conta aparece como transferência comum para o CNPJ do banco.
 */
export function instituicaoNoTexto(texto: string | null | undefined): string | null {
  if (!texto) return null;
  for (const b of BANCOS_OFX) if (b.org.test(texto)) return b.instituicao;
  return null;
}

export function detectarInstituicao(buf: ArrayBuffer): { instituicao: string | null; org: string | null } {
  const texto = decodificar(buf);
  const org = tag(texto, 'ORG');
  const fid = tag(texto, 'FID');

  for (const b of BANCOS_OFX) {
    if ((org && b.org.test(org)) || (fid && b.fid === fid.trim())) {
      return { instituicao: b.instituicao, org };
    }
  }
  return { instituicao: null, org };
}

/** Lê OFX do Nubank (cartão ou conta). Sinais já vêm na convenção correta. */
export function parseOfx(
  buf: ArrayBuffer,
  contaId: number,
  fonte: string,
): ResultadoParse {
  const texto = decodificar(buf);

  // CCSTMTRS = cartão de crédito, STMTRS = conta corrente. É o próprio
  // arquivo dizendo onde ele pertence, e é mais confiável que o usuário
  // escolhendo numa lista.
  const ehCartao = /<CCSTMTRS>|<CCACCTFROM>/i.test(texto);

  const res: ResultadoParse = {
    transacoes: [], snapshot: null, avisos: [],
    tipoConta: ehCartao ? 'cartao' : 'corrente',
    fatura: null,
  };

  let rdb = 0;
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  for (const b of blocos) {
    const data = dataOfx(tag(b, 'DTPOSTED'));
    const bruto = tag(b, 'TRNAMT');
    if (!data || bruto == null) continue;

    const valor = Number(bruto.replace(',', '.'));
    if (!Number.isFinite(valor) || valor === 0) continue;

    const desc = tag(b, 'MEMO') || tag(b, 'NAME') || '';
    const ehRdb = RDB.test(desc);
    const ehInvestProprio = !ehRdb && INVESTIMENTO_PROPRIO.test(desc);
    const ehImposto = IMPOSTO.test(desc);

    // Transferência entre contas próprias, reconhecida pelo CPF no extrato.
    // O tratamento depende do destino: fatura do Itaú é interna, C6 é
    // investimento, Santander entrando é salário.
    const propria = ehCartao ? null : reconhecerContaPropria(desc, valor);
    const ehPropriaInterna = propria !== null
      && (propria.tratamento === 'pagamento_fatura' || propria.tratamento === 'interna');
    const ehPropriaInvest = propria?.tratamento === 'investimento';

    res.transacoes.push({
      conta_id: contaId,
      data,
      valor,
      descricao: desc,
      contraparte: extrairContraparte(desc),
      fonte,
      // A ordem importa: imposto e RDB contêm palavras que casariam com Pix.
      metodo: ehCartao ? 'credito'
        : ehImposto ? 'outro'
        : BOLETO.test(desc) ? 'boleto'
        : ehRdb || ehInvestProprio ? 'outro'
        : /\bPIX\b/i.test(desc) ? 'pix'
        : PIX.test(desc) ? 'ted'
        : 'debito',
      // Dinheiro entre a conta e um investimento seu não é gasto nem receita.
      // 'investimento' NÃO é interna: aparece na aba Investimentos como
      // quanto foi guardado, igual às aplicações de RDB.
      eh_interna: ehRdb || ehInvestProprio || ehPropriaInterna || PAGAMENTO_FATURA.test(desc),
      // marcador para a tela separar investimento de gasto
      tratamento: ehRdb || ehInvestProprio ? 'investimento'
        : ehPropriaInvest ? 'investimento'
        : propria?.tratamento ?? null,
      id_externo: tag(b, 'FITID'),
    } satisfies Transacao);

    if (ehRdb || ehInvestProprio || propria) rdb++;
  }

  // O OFX carrega o saldo — é o que dispensa registro manual.
  // Em cartão o BALAMT já vem negativo, que é exatamente a convenção de passivo.
  const bal = tag(texto, 'BALAMT');
  const dtasof = dataOfx(tag(texto, 'DTASOF'));
  if (bal != null && dtasof) {
    const saldo = Number(bal.replace(',', '.'));
    if (Number.isFinite(saldo)) {
      res.snapshot = { conta_id: contaId, data_ref: dtasof, saldo, fonte };
    }
  }

  // FITID não é chave única no Nubank: uma compra internacional e o IOF dela
  // compartilham o mesmo FITID. Registrado como aviso, não como erro — o
  // hash_natural é que garante a unicidade.
  const ids = res.transacoes.map((t) => t.id_externo).filter(Boolean) as string[];
  const unicos = new Set(ids);
  if (unicos.size !== ids.length) {
    res.avisos.push(`FITID repetido: ${unicos.size} únicos em ${ids.length} lançamentos`);
  }

  if (res.transacoes.length === 0) {
    res.avisos.push('Nenhum lançamento encontrado — o arquivo é mesmo um OFX de extrato?');
  }

  if (rdb > 0) {
    res.avisos.push(
      `${rdb} movimentação(ões) de RDB marcadas como internas. É a caixinha do ` +
      `Nubank: dinheiro entre a sua conta e a sua própria aplicação, não gasto ` +
      `nem receita. Contá-las inflaria o mês.`,
    );
  }

  // Competência da fatura (ADR-001). O OFX de cartão não diz "fatura de
  // agosto" em lugar nenhum: DTEND fecha o ciclo, então o mês do DTEND é a
  // melhor aproximação. Marcado como 'deduzida' — a tela pede confirmação.
  if (ehCartao && res.transacoes.length > 0) {
    const fim = dataOfx(tag(texto, 'DTEND')) ?? dataOfx(tag(texto, 'DTASOF'));
    const ultimaCompra = res.transacoes.reduce(
      (a, t) => (t.data > a ? t.data : a), res.transacoes[0].data,
    );
    res.fatura = {
      // DTEND fecha o ciclo no mês do banco; a competência é o mês das compras
      competencia: fim ? competenciaDoBanco(inicioDoMes(fim)) : inicioDoMes(ultimaCompra),
      vencimento: null,
      // BALAMT é o SALDO do cartão no instante do extrato: já desconta
      // pagamentos e estornos e carrega o que sobrou do ciclo anterior.
      // Não é a soma das compras — tratar como se fosse acusa erro onde
      // não há.
      valorTotal: res.snapshot ? Math.abs(res.snapshot.saldo) : null,
      tipoValor: 'saldo',
      status: 'fechada',
      confianca: 'deduzida',
    };
  }

  return res;
}
