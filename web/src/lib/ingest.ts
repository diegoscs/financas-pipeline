import { supabase } from './supabase';
import { atribuirHashes } from './normalize';
import { carregarRegras, categorizar } from './categorize';
import { detectarInstituicao, instituicaoNoTexto, parseOfx } from './parsers/ofx';
import { rotuloBanco } from './bancos';
import { parseXlsxItau } from './parsers/xlsxItau';
import type {
  Conta, Fatura, FaturaDetectada, ResultadoParse, TipoConta, Transacao,
} from './types';

export interface Preparado {
  arquivo: string;
  fonte: string;
  conta: Conta;
  tipoConta: TipoConta;
  /** Competência detectada no arquivo (ADR-001). Null para conta corrente. */
  fatura: FaturaDetectada | null;
  /** Fatura já existente com a mesma competência, se houver. */
  faturaExistente: Fatura | null;
  transacoes: Transacao[];
  /** hashes que já existem no banco — não serão gravados de novo */
  duplicadas: Set<string>;
  /** mesma data e valor de algo já gravado, mas descrição diferente: conferir */
  suspeitas: Set<string>;
  snapshot: ResultadoParse['snapshot'];
  avisos: string[];
  /** menor e maior data do arquivo, para mostrar o período coberto */
  periodo: { de: string; ate: string } | null;
  /** quantos lançamentos já existiam nessa conta dentro desse mesmo período */
  jaNoPeriodo: number;
  /** conferência contra o total que o próprio arquivo informa */
  conferencia: Conferencia | null;
}

/**
 * Confere os lançamentos contra o número que o arquivo informa.
 *
 * O que dá para conferir depende da fonte, e tratar as duas do mesmo jeito
 * gera alarme falso:
 *
 * - `compras` (Valor (parcial) do Itaú): é a soma das compras do ciclo, então
 *   a soma das saídas tem que bater. Diferença aqui é erro de verdade — foi
 *   assim que um IOF duplicado de R$ 4,00 passou batido.
 *
 * - `saldo` (BALAMT do OFX): é o saldo devedor no instante do extrato. Já
 *   desconta pagamentos e estornos e carrega o resto do ciclo anterior. A
 *   soma das compras NUNCA vai bater com ele, e exigir isso acusa erro onde
 *   não há. O que dá para extrair é o saldo de abertura implícito, que é
 *   informação útil: num extrato real ele deu -1.676,79, exatamente o
 *   'Pagamento recebido' da fatura anterior sendo quitada.
 */
export interface Conferencia {
  tipo: 'compras' | 'saldo';
  /** soma das saídas — o "quanto gastei" */
  compras: number;
  /** pagamentos e estornos */
  entradas: number;
  /** o número que o arquivo informa */
  totalInformado: number;
  /** só para tipo 'saldo': saldo devedor com que o período começou */
  aberturaImplicita?: number;
  /** só para tipo 'compras': quanto a soma diverge do informado */
  diferenca?: number;
  confere: boolean;
}

function conferir(
  transacoes: Transacao[],
  totalInformado: number | null | undefined,
  tipo: 'compras' | 'saldo' | undefined,
): Conferencia | null {
  if (totalInformado == null || !tipo) return null;

  const compras = transacoes.reduce((a, t) => a + (t.valor < 0 ? -t.valor : 0), 0);
  const entradas = transacoes.reduce((a, t) => a + (t.valor > 0 ? t.valor : 0), 0);
  const total = Math.abs(totalInformado);

  if (tipo === 'compras') {
    const diferenca = Number((compras - total).toFixed(2));
    return { tipo, compras, entradas, totalInformado: total, diferenca,
             confere: Math.abs(diferenca) < 0.01 };
  }

  // saldo_final = abertura + entradas − compras  ⇒  abertura = saldo + compras − entradas
  const abertura = Number((-total + compras - entradas).toFixed(2));
  return {
    tipo,
    compras,
    entradas,
    totalInformado: total,
    aberturaImplicita: abertura,
    // Não há o que falhar: a identidade fecha por construção. A conferência
    // real acontece contra a fatura anterior, se ela existir na base.
    confere: true,
  };
}

/**
 * Descobre o banco pelo formato do arquivo — não pelo que o usuário escolheu.
 *
 * Só a extensão não basta: um .xlsx é sempre fatura do Itaú (o Nubank não
 * exporta planilha), enquanto um .ofx pode ser de qualquer banco.
 */
function detectarFormato(nome: string): 'xlsx' | 'ofx' | null {
  const n = nome.toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'xlsx';
  if (n.endsWith('.ofx')) return 'ofx';
  return null;
}

/**
 * Lê o arquivo, resolve a conta, calcula hashes, categoriza e checa duplicatas.
 *
 * Recebe a INSTITUIÇÃO ('nubank', 'itau'), não o id da conta: cartão vs conta
 * corrente sai do conteúdo do arquivo. Deixar essa escolha na mão do usuário
 * já colocou uma fatura do Itaú dentro de "Nubank Conta" duas vezes — e o
 * dedupe não protege contra isso, porque conta_id entra no hash.
 *
 * Nada é gravado aqui de propósito: a tela mostra o resultado e só grava
 * depois que você confirma.
 */
export async function prepararArquivo(file: File, instituicao: string): Promise<Preparado> {
  const formato = detectarFormato(file.name);
  if (!formato) {
    throw new Error(`Formato não reconhecido: ${file.name}. Esperado .xlsx (fatura Itaú) ou .ofx.`);
  }
  if (formato === 'xlsx' && instituicao !== 'itau') {
    throw new Error(
      `Planilha .xlsx é o formato de fatura do Itaú, mas o banco selecionado é "${instituicao}". ` +
      `Se este arquivo é mesmo do Itaú, troque o banco; se não, exporte em .ofx.`,
    );
  }

  const buf = await file.arrayBuffer();

  // O OFX diz de qual banco ele é, em <ORG>/<FID>. Conferir isso é o que
  // impede subir um arquivo do Nubank tendo selecionado Itaú — os dois
  // exportam .ofx e a extensão não distingue. Já aconteceu de a fatura do
  // Nubank ir parar dentro da conta do Itaú por causa disso.
  if (formato === 'ofx') {
    const det = detectarInstituicao(buf);
    if (det.instituicao && det.instituicao !== instituicao) {
      throw new Error(
        `Este arquivo é do ${rotuloBanco(det.instituicao)} (${det.org ?? 'identificado pelo código do banco'}), ` +
        `mas você selecionou ${rotuloBanco(instituicao)}. Troque o banco e tente de novo.`,
      );
    }
  }

  const res = formato === 'xlsx'
    ? parseXlsxItau(buf, -1, 'provisorio')
    : parseOfx(buf, -1, 'provisorio');

  if (res.transacoes.length === 0) {
    throw new Error('Nenhum lançamento encontrado no arquivo.');
  }

  const conta = await resolverConta(instituicao, res.tipoConta);
  const fonte = `${formato}_${instituicao}_${res.tipoConta}`;

  // Extrato de conta corrente por cima de Pix registrado à mão duplica tudo.
  //
  // São o mesmo dinheiro, mas o hash_natural não os reconhece como iguais: a
  // descrição que você digitou ("almoço") não tem nada a ver com a do banco
  // ("PIX ENVIADO JOAO SILVA"). Como não há reconciliação (ADR-002), o único
  // jeito de não somar duas vezes é não deixar entrar.
  if (res.tipoConta === 'corrente') {
    const datas0 = res.transacoes.map((t) => t.data).sort();
    const { count, error } = await supabase
      .from('transacoes')
      .select('*', { count: 'exact', head: true })
      .eq('conta_id', conta.id)
      .eq('fonte', 'telegram')
      .gte('data', datas0[0])
      .lte('data', datas0[datas0.length - 1]);
    if (error) throw error;

    if ((count ?? 0) > 0) {
      throw new Error(
        `Existem ${count} lançamento(s) registrados à mão nesta conta entre ` +
        `${datas0[0]} e ${datas0[datas0.length - 1]}. Importar o extrato por cima ` +
        `contaria o mesmo dinheiro duas vezes — o texto que você digitou não bate ` +
        `com o do banco, então o dedupe não os reconhece. Apague os registros manuais ` +
        `desse período antes de importar, ou importe um extrato de outro intervalo.`,
      );
    }
  }

  for (const t of res.transacoes) {
    t.conta_id = conta.id;
    t.fonte = fonte;
  }
  if (res.snapshot) res.snapshot = { ...res.snapshot, conta_id: conta.id, fonte };

  // Pagamento de fatura feito por Pix, visto do lado da conta corrente.
  //
  // No extrato ele aparece como transferência comum: "Transferência enviada
  // pelo Pix - ITAU UNIBANCO HOLDING S A - 60.872.504/0001-23 - ...". Nenhum
  // padrão de texto sobre "pagamento" casa com isso.
  //
  // É o erro clássico do CLAUDE.md: contado como despesa, os gastos do cartão
  // entram duas vezes — uma na compra, outra no pagamento. A checagem só marca
  // quando a contraparte é um banco onde VOCÊ tem cartão cadastrado, o que
  // evita marcar um Pix legítimo para alguém que por acaso tenha nome de banco.
  if (res.tipoConta === 'corrente') {
    const emissores = await instituicoesComCartao();
    for (const t of res.transacoes) {
      if (t.eh_interna || t.valor >= 0) continue;
      const inst = instituicaoNoTexto(t.contraparte);
      if (inst && emissores.has(inst)) {
        t.eh_interna = true;
        res.avisos.push(
          `${t.data}: ${dinheiroSimples(t.valor)} para ${t.contraparte} marcado como ` +
          `pagamento de fatura (interna). Você tem cartão ${rotuloBanco(inst)} cadastrado — ` +
          `contar isso como gasto somaria os gastos do cartão duas vezes.`,
        );
      }
    }
  }

  // hash só depois de fixar conta_id — ele faz parte da chave
  await atribuirHashes(res.transacoes);

  const cfg = await carregarRegras();
  categorizar(res.transacoes, cfg);

  const duplicadas = await buscarExistentes(res.transacoes.map((t) => t.hash_natural!));

  // Segunda passada: mesma cobrança reexportada com outro texto.
  // O hash não pega, porque a descrição faz parte dele.
  for (const h of await buscarPorIdExterno(conta.id, res.transacoes)) duplicadas.add(h);

  const { suspeitas, duplicadasPorPrefixo } = await buscarSuspeitas(conta.id, res.transacoes, duplicadas);
  for (const h of duplicadasPorPrefixo) duplicadas.add(h);

  const datas = res.transacoes.map((t) => t.data).sort();
  const periodo = { de: datas[0], ate: datas[datas.length - 1] };
  const jaNoPeriodo = await contarNoPeriodo(conta.id, periodo.de, periodo.ate);

  const faturaExistente = res.fatura
    ? await buscarFatura(conta.id, res.fatura.competencia)
    : null;

  return {
    arquivo: file.name,
    fonte,
    conta,
    tipoConta: res.tipoConta,
    fatura: res.fatura,
    faturaExistente,
    transacoes: res.transacoes,
    duplicadas,
    suspeitas,
    snapshot: res.snapshot,
    avisos: res.avisos,
    periodo,
    jaNoPeriodo,
    conferencia: conferir(res.transacoes, res.fatura?.valorTotal, res.fatura?.tipoValor),
  };
}

/**
 * Acha lançamentos já gravados que são a MESMA cobrança deste arquivo, mesmo
 * que a descrição tenha mudado.
 *
 * Caso real: o Nubank reexportou o mesmo IOF de R$ 4,00 como
 * 'IOF DE COMPRA INTERNACIONAL' e depois como 'IOF DE "ANTHROPIC* CLAUDE SUB"'.
 * Hashes diferentes, cobrança única, R$ 4,00 a mais no total.
 *
 * O FITID sozinho não serve — compra internacional e IOF dela compartilham o
 * mesmo. Com o valor junto, separa.
 */
async function buscarPorIdExterno(contaId: number, transacoes: Transacao[]): Promise<string[]> {
  const ids = [...new Set(transacoes.map((t) => t.id_externo).filter(Boolean))] as string[];
  if (ids.length === 0) return [];

  const achados: string[] = [];
  const LOTE = 150;
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase
      .from('transacoes')
      .select('hash_natural,id_externo,valor,descricao')
      .eq('conta_id', contaId)
      .in('id_externo', ids.slice(i, i + LOTE));
    if (error) throw error;

    for (const r of data as { id_externo: string; valor: string; descricao: string }[]) {
      const gravado = Number(r.valor);
      for (const t of transacoes) {
        if (t.id_externo !== r.id_externo) continue;
        if (Math.abs(t.valor - gravado) > 0.005) continue;
        // mesma cobrança; se a descrição também bate, o hash já pegou
        if (t.descricao !== r.descricao) achados.push(t.hash_natural!);
      }
    }
  }
  return achados;
}

/**
 * Possíveis duplicatas que nenhuma chave pega: mesma conta, mesma data, mesmo
 * valor, descrição diferente, e sem FITID para confirmar (caso do XLSX).
 *
 * Não bloqueia — dois cafés de R$ 19,90 no mesmo dia são gastos legítimos e
 * distintos, e é justamente por isso que o hash tem índice de ocorrência.
 * Só sinaliza para conferência antes de gravar.
 */
async function buscarSuspeitas(
  contaId: number,
  transacoes: Transacao[],
  jaDuplicadas: Set<string>,
): Promise<{ suspeitas: Set<string>; duplicadasPorPrefixo: Set<string> }> {
  const novas = transacoes.filter((t) => !jaDuplicadas.has(t.hash_natural!));
  if (novas.length === 0) return { suspeitas: new Set(), duplicadasPorPrefixo: new Set() };

  const datas = novas.map((t) => t.data).sort();
  const { data, error } = await supabase
    .from('transacoes')
    .select('data,valor,descricao')
    .eq('conta_id', contaId)
    .gte('data', datas[0])
    .lte('data', datas[datas.length - 1])
    .range(0, 4999); // o PostgREST corta em 1000 sem avisar
  if (error) throw error;

  const gravadas = (data as { data: string; valor: string; descricao: string }[])
    .map((r) => ({ ...r, valor: Number(r.valor) }));

  const out = new Set<string>();
  const certas = new Set<string>();

  for (const t of novas) {
    for (const g of gravadas) {
      if (g.data !== t.data || Math.abs(g.valor - t.valor) >= 0.005) continue;
      if (g.descricao === t.descricao) continue; // o hash já pegou

      // Uma descrição sendo PREFIXO da outra não é coincidência: é o mesmo
      // estabelecimento com o texto truncado em pontos diferentes. O Itaú
      // reemitiu "JIM.COM* 914 DETAISAO PAULO BRA" como "JIM.COM* 914 DETAI"
      // entre a fatura aberta e a paga, e R$ 450,04 entraram duas vezes.
      const a = t.descricao, b = g.descricao;
      if (a.startsWith(b) || b.startsWith(a)) certas.add(t.hash_natural!);
      else out.add(t.hash_natural!);
    }
  }

  // prefixo é duplicata, não suspeita: bloqueia em vez de só avisar
  for (const h of certas) out.delete(h);
  return { suspeitas: out, duplicadasPorPrefixo: certas };
}

async function buscarFatura(contaId: number, competencia: string): Promise<Fatura | null> {
  const { data, error } = await supabase
    .from('faturas')
    .select('*')
    .eq('conta_id', contaId)
    .eq('competencia', competencia)
    .limit(1);
  if (error) throw error;
  return ((data as Fatura[])[0] ?? null);
}

/** Cria ou atualiza a fatura da competência e devolve o id (ADR-001). */
async function garantirFatura(
  p: Preparado,
  competencia: string,
): Promise<number> {
  const f = p.fatura!;

  // Se a competência foi trocada na tela, os dados de cabeçalho deste arquivo
  // pertencem a OUTRA fatura e não podem sobrescrever a de destino.
  //
  // Aconteceu: importar a fatura de agosto forçando competência julho
  // sobrescreveu o vencimento da fatura de julho com 10/08, e o desfazer não
  // restaurou — o undo apaga lançamentos, não desfaz update de cabeçalho.
  const competenciaTrocada = competencia !== f.competencia;
  if (competenciaTrocada) {
    const existente = await buscarFatura(p.conta.id, competencia);
    if (existente) return existente.id; // vincula, sem tocar no cabeçalho
  }

  const { data, error } = await supabase
    .from('faturas')
    .upsert(
      {
        conta_id: p.conta.id,
        competencia,
        vencimento: f.vencimento,
        // valor_total guarda o que o arquivo informou, seja compras ou saldo.
        // As duas colunas abaixo separam as grandezas para o dado ser
        // comparável entre bancos.
        valor_total: f.valorTotal,
        total_compras: p.conferencia?.compras ?? null,
        saldo_final: f.tipoValor === 'saldo' ? f.valorTotal : null,
        status: f.status,
        arquivo_origem: p.arquivo,
        atualizada_em: new Date().toISOString(),
      },
      { onConflict: 'conta_id,competencia' },
    )
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: number }).id;
}

/** Bancos onde existe cartão cadastrado — quem recebe pagamento de fatura. */
async function instituicoesComCartao(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('contas').select('instituicao').eq('tipo', 'cartao').eq('ativa', true);
  if (error) throw error;
  return new Set((data as { instituicao: string }[]).map((c) => c.instituicao));
}

/** Formata sem depender do Intl aqui — o aviso é texto simples. */
const dinheiroSimples = (v: number) => `R$ ${Math.abs(v).toFixed(2).replace('.', ',')}`;

/** Acha a conta do banco escolhido com o tipo que o arquivo indicou. */
async function resolverConta(instituicao: string, tipo: TipoConta): Promise<Conta> {
  const { data, error } = await supabase
    .from('contas')
    .select('*')
    .eq('instituicao', instituicao)
    .eq('tipo', tipo)
    .eq('ativa', true)
    .limit(1);
  if (error) throw error;

  const conta = (data as Conta[])[0];
  if (!conta) {
    const rotulo = tipo === 'cartao' ? 'cartão de crédito' : 'conta corrente';
    throw new Error(
      `O arquivo é de ${rotulo}, mas não existe conta desse tipo cadastrada para "${instituicao}". ` +
      `Cadastre em Configurar antes de importar — é lá que você informa o dia de fechamento e o de ` +
      `vencimento, que definem a que mês cada compra pertence.`,
    );
  }
  return conta;
}

/** Consulta em lotes: a lista de hashes vai na URL e estoura acima de ~200. */
async function buscarExistentes(hashes: string[]): Promise<Set<string>> {
  const achados = new Set<string>();
  const LOTE = 150;
  for (let i = 0; i < hashes.length; i += LOTE) {
    const { data, error } = await supabase
      .from('transacoes')
      .select('hash_natural')
      .in('hash_natural', hashes.slice(i, i + LOTE));
    if (error) throw error;
    for (const r of data as { hash_natural: string }[]) achados.add(r.hash_natural);
  }
  return achados;
}

async function contarNoPeriodo(contaId: number, de: string, ate: string): Promise<number> {
  const { count, error } = await supabase
    .from('transacoes')
    .select('*', { count: 'exact', head: true })
    .eq('conta_id', contaId)
    .gte('data', de)
    .lte('data', ate);
  if (error) throw error;
  return count ?? 0;
}

export interface ResultadoGravacao {
  gravadas: number;
  ignoradas: number;
  execucaoId: string;
}

/**
 * Grava só o que é novo.
 *
 * Usa upsert com ignoreDuplicates em cima do índice único de hash_natural.
 * A checagem prévia serve para MOSTRAR o número antes de confirmar; esta
 * cláusula é a que de fato garante idempotência se dois uploads correrem
 * juntos ou se a fatura vier com o mesmo lançamento duas vezes.
 */
export async function gravar(
  p: Preparado,
  /** competência confirmada na tela; sobrepõe a detectada no arquivo */
  competencia?: string,
): Promise<ResultadoGravacao> {
  // A fatura é criada mesmo que não haja lançamento novo: o arquivo pode ser
  // a versão fechada de uma fatura que já foi importada aberta, e o status
  // e o valor total precisam ser atualizados.
  const faturaId = p.fatura
    ? await garantirFatura(p, competencia ?? p.fatura.competencia)
    : null;

  // Identifica este lote. É o que permite desfazer só esta importação depois,
  // em vez de apagar a base inteira.
  const execucaoId = crypto.randomUUID();
  const inicio = Date.now();

  // Vincula à fatura os lançamentos que JÁ existem no banco.
  //
  // Sem isto, reimportar um arquivo para preencher fatura_id não faz nada: o
  // dedupe descarta as duplicatas antes de gravar e elas ficam órfãs para
  // sempre. O arquivo é quem sabe a que fatura cada compra pertence, então
  // reimportar tem que ser o caminho de conserto — e agora é.
  if (faturaId != null && p.duplicadas.size > 0) {
    const jaExistem = p.transacoes
      .filter((t) => p.duplicadas.has(t.hash_natural!))
      .map((t) => t.hash_natural!);

    const LOTE = 150;
    for (let i = 0; i < jaExistem.length; i += LOTE) {
      const { error } = await supabase
        .from('transacoes')
        .update({ fatura_id: faturaId })
        .in('hash_natural', jaExistem.slice(i, i + LOTE))
        .is('fatura_id', null); // não remexe no que já está vinculado
      if (error) throw error;
    }
  }

  const novas = p.transacoes.filter((t) => !p.duplicadas.has(t.hash_natural!));
  if (novas.length === 0) {
    await registrarLog(p, execucaoId, competencia, 0, p.transacoes.length, inicio, 'vazio');
    return { gravadas: 0, ignoradas: p.transacoes.length, execucaoId };
  }

  const linhas = novas.map((t) => ({
    execucao_id: execucaoId,
    fatura_id: faturaId,
    hash_natural: t.hash_natural,
    conta_id: t.conta_id,
    data: t.data,
    valor: t.valor,
    descricao: t.descricao,
    contraparte: t.contraparte ?? null,
    metodo: t.metodo ?? null,
    categoria_id: t.categoria_id ?? null,
    origem_categoria: t.origem_categoria ?? null,
    confianca: t.confianca ?? null,
    eh_interna: t.eh_interna ?? false,
    fonte: t.fonte,
    id_externo: t.id_externo ?? null, // era lido e descartado; é o que pega reexportação
    // sem isto, R$ 3.500 de aportes no C6 entravam como gasto comum
    tratamento: t.tratamento ?? null,
  }));

  const { data, error } = await supabase
    .from('transacoes')
    .upsert(linhas, { onConflict: 'hash_natural', ignoreDuplicates: true })
    .select('hash_natural');
  if (error) throw error;

  if (p.snapshot) {
    const { error: e2 } = await supabase.from('snapshots_saldo').upsert(
      {
        conta_id: p.snapshot.conta_id,
        data_ref: p.snapshot.data_ref,
        saldo: p.snapshot.saldo,
        fonte: p.snapshot.fonte,
      },
      { onConflict: 'conta_id,data_ref' },
    );
    if (e2) throw e2;
  }

  const gravadas = data?.length ?? 0;
  const ignoradas = p.transacoes.length - gravadas;
  await registrarLog(p, execucaoId, competencia, gravadas, ignoradas, inicio, 'ok');
  return { gravadas, ignoradas, execucaoId };
}

async function registrarLog(
  p: Preparado, execucaoId: string, competencia: string | undefined,
  gravadas: number, ignoradas: number, inicio: number, status: 'ok' | 'vazio',
) {
  // A ingestion_log já existia no schema e nunca era escrita pela app web —
  // o lineage estava sendo perdido. É ela que vira o histórico na tela.
  const { error } = await supabase.from('ingestion_log').insert({
    execucao_id: execucaoId,
    fonte: p.fonte,
    conta_id: p.conta.id,
    arquivo: p.arquivo,
    competencia: competencia ?? p.fatura?.competencia ?? null,
    status,
    linhas_lidas: p.transacoes.length,
    linhas_novas: gravadas,
    linhas_dup: ignoradas,
    duracao_ms: Date.now() - inicio,
  });
  // Falhar o log não pode derrubar a importação: o dado já está gravado.
  if (error) console.warn('não consegui registrar o log de importação:', error.message);
}

export interface Importacao {
  execucao_id: string;
  arquivo: string | null;
  fonte: string;
  conta_id: number | null;
  competencia: string | null;
  linhas_novas: number;
  linhas_dup: number;
  iniciado_em: string;
  desfeita_em: string | null;
}

export async function listarImportacoes(): Promise<Importacao[]> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .select('execucao_id,arquivo,fonte,conta_id,competencia,linhas_novas,linhas_dup,iniciado_em,desfeita_em')
    .order('iniciado_em', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data as Importacao[];
}

/**
 * Desfaz uma importação: apaga só os lançamentos daquele lote.
 *
 * Não mexe em lançamentos de outras importações nem nas regras aprendidas.
 * A fatura fica — ela pode ter lançamentos de outros lotes; se ficar vazia,
 * é removida.
 */
export async function desfazerImportacao(execucaoId: string): Promise<{ apagadas: number }> {
  const { count } = await supabase
    .from('transacoes')
    .select('*', { count: 'exact', head: true })
    .eq('execucao_id', execucaoId);

  const d = await supabase.from('transacoes').delete().eq('execucao_id', execucaoId);
  if (d.error) throw d.error;

  const u = await supabase
    .from('ingestion_log')
    .update({ desfeita_em: new Date().toISOString() })
    .eq('execucao_id', execucaoId);
  if (u.error) throw u.error;

  await limparFaturasVazias();
  return { apagadas: count ?? 0 };
}

async function limparFaturasVazias() {
  const { data: fs } = await supabase.from('faturas').select('id').range(0, 4999);
  const { data: usadas } = await supabase
    .from('transacoes').select('fatura_id').not('fatura_id', 'is', null).range(0, 49999);
  if (!fs) return;
  const emUso = new Set((usadas ?? []).map((r) => (r as { fatura_id: number }).fatura_id));
  const orfas = (fs as { id: number }[]).map((f) => f.id).filter((id) => !emUso.has(id));
  if (orfas.length > 0) await supabase.from('faturas').delete().in('id', orfas);
}

/** Bancos disponíveis, derivados das contas cadastradas. */
export interface BancoDisponivel {
  instituicao: string;
  rotulo: string;
  tipos: TipoConta[];
}

export async function listarBancos(): Promise<BancoDisponivel[]> {
  const { data, error } = await supabase
    .from('contas')
    .select('instituicao,tipo')
    .eq('ativa', true)
    .neq('instituicao', 'manual')
    .order('instituicao');
  if (error) throw error;

  const m = new Map<string, TipoConta[]>();
  for (const r of data as { instituicao: string; tipo: TipoConta }[]) {
    m.set(r.instituicao, [...(m.get(r.instituicao) ?? []), r.tipo]);
  }
  return [...m.entries()].map(([instituicao, tipos]) => ({
    instituicao,
    rotulo: rotuloBanco(instituicao),
    tipos,
  }));
}

/**
 * Apaga todos os lançamentos. Não mexe em contas, categorias nem regras —
 * essas são configuração, não dado de movimento.
 */
export async function limparBase(): Promise<{ apagadas: number }> {
  const { count } = await supabase.from('transacoes').select('*', { count: 'exact', head: true });

  // .neq em coluna sempre preenchida = "todas as linhas"; o supabase-js exige
  // um filtro explícito em delete para não apagar por acidente.
  const t = await supabase.from('transacoes').delete().not('hash_natural', 'is', null);
  if (t.error) throw t.error;

  const s = await supabase.from('snapshots_saldo').delete().gt('conta_id', 0);
  if (s.error) throw s.error;

  const f = await supabase.from('faturas').delete().gt('id', 0);
  if (f.error) throw f.error;

  const l = await supabase.from('ingestion_log').delete().gt('id', 0);
  if (l.error) throw l.error;

  return { apagadas: count ?? 0 };
}
