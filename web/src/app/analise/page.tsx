'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { explicarErro } from '@/lib/erro';
import { dinheiro, dataCurta, mesRotulo } from '@/lib/formato';
import { competenciaRotulo } from '@/lib/competencia';
import { corrigirCategoria, excluirLancamento, renomear, sugerirPadrao } from '@/lib/aprender';
import { Marca } from '@/components/Marca';
import { rotuloBanco } from '@/lib/bancos';
import type { Categoria, Conta, Fatura } from '@/lib/types';

interface Linha {
  hash_natural: string;
  data: string;
  valor: number;
  /** texto cru do banco — imutável, entra no hash e no casamento de regras */
  descricao: string;
  /** nome dado pelo usuário, só exibição */
  apelido: string | null;
  /** extraída do MEMO do extrato: "DROGARIA SAO PAULO" */
  contraparte: string | null;
  conta_id: number;
  categoria_id: number | null;
  origem_categoria: string | null;
  eh_interna: boolean;
  fatura_id: number | null;
  metodo: string | null;
  /** natureza quando envolve conta própria fora da base; ver minhasContas.ts */
  tratamento: 'receita' | 'pagamento_fatura' | 'investimento' | 'interna' | null;
}

/** A descrição do extrato tem 120 caracteres com agência e conta; a contraparte é o nome. */
const exibir = (l: Linha) => l.apelido ?? l.contraparte ?? l.descricao;

/** Guardar dinheiro: caixinha RDB, NuInvest e aportes no C6. */
const ehInvestimento = (l: Linha) => l.tratamento === 'investimento';

/**
 * Caixinha do próprio Nubank (RDB, NuInvest).
 *
 * Só ISTO fica fora da aba Pix. São 117 movimentações que nunca saíram do
 * banco — não têm contraparte, não são Pix, e listá-las junto afogaria as
 * saídas reais.
 *
 * O aporte no C6 é outra coisa: é um Pix que de fato saiu da conta, e por isso
 * aparece na lista de Pix marcado, fora do total. Tratar os dois como iguais
 * fez R$ 3.500 sumirem da tela.
 */
const ehCaixinha = (l: Linha) => ehInvestimento(l) && l.metodo !== 'pix';

/** Entra no "quanto gastei": nem transferência interna, nem dinheiro guardado. */
const ehGasto = (l: Linha) => !l.eh_interna && !ehInvestimento(l);

const PALETA = ['#4f46e5', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#0d9488', '#be123c'];
const CINZA = '#cbd0d8';
const NOME_SEM_CATEGORIA = 'Não classificado';
const LIMITE_LINHAS = 5000; // o PostgREST trunca em 1000 sem avisar
const TOP_CATEGORIAS = 6;

/**
 * Três abas, não quatro.
 *
 * "Investimentos" saiu: a tela de Carteira responde a mesma pergunta com mais
 * profundidade (cotação, rendimento pelo CDI, proventos) e ter as duas fazia o
 * usuário procurar "quanto guardei" em dois lugares. O card Guardei continua
 * no Geral e leva para lá.
 */
type Aba = 'cartao' | 'pix' | 'geral';

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'geral',  rotulo: 'Geral' },
  { id: 'cartao', rotulo: 'Cartão' },
  { id: 'pix',    rotulo: 'Pix' },
];

export default function Analise() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [contas, setContas] = useState<Map<number, Conta>>(new Map());
  const [cats, setCats] = useState<Categoria[]>([]);
  const [faturas, setFaturas] = useState<Map<number, Fatura>>(new Map());
  const [mes, setMes] = useState<string | null>(null);
  /**
   * `mes === null` significa "todo o período" — é escolha válida, não estado
   * inicial. Sem esta flag o efeito que escolhe o mês mais recente disparava
   * de novo a cada vez que o usuário escolhia "Todo o período" e desfazia a
   * escolha no mesmo render: o botão parecia não funcionar.
   */
  const [mesIniciado, setMesIniciado] = useState(false);
  const [aba, setAba] = useState<Aba>('geral');
  /** 'fatura' = quanto vou pagar; 'compra' = quando gastei. Eixos diferentes. */
  const [eixoCartao, setEixoCartao] = useState<'fatura' | 'compra'>('fatura');
  /** null = os dois cartões juntos. Os ciclos do Itaú e do Nubank não coincidem. */
  const [bancoCartao, setBancoCartao] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [truncado, setTruncado] = useState(false);

  const catPorId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const carregar = useCallback(async () => {
    const [t, c, k, f] = await Promise.all([
      supabase.from('transacoes')
        .select('hash_natural,data,valor,descricao,apelido,contraparte,conta_id,categoria_id,origem_categoria,eh_interna,fatura_id,metodo,tratamento')
        .order('data', { ascending: false })
        .range(0, LIMITE_LINHAS - 1),
      supabase.from('contas').select('*'),
      supabase.from('categorias').select('*').order('nome'),
      supabase.from('faturas').select('*'),
    ]);
    if (t.error) { setErro(explicarErro(t.error)); setCarregando(false); return; }
    const dados = (t.data as unknown[]).map((r) => {
      const x = r as Record<string, unknown>;
      return { ...x, valor: Number(x.valor) } as Linha;
    });
    setTruncado(dados.length >= LIMITE_LINHAS);
    setLinhas(dados);
    if (c.data) setContas(new Map((c.data as Conta[]).map((x) => [x.id, x])));
    if (k.data) setCats(k.data as Categoria[]);
    if (f.data) setFaturas(new Map((f.data as Fatura[]).map((x) => [x.id, x])));
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const tipoDaConta = useCallback(
    (l: Linha) => contas.get(l.conta_id)?.tipo, [contas],
  );

  /**
   * Mês de um lançamento: o mês em que ele ACONTECEU. Uma regra só.
   *
   * Antes o cartão era agrupado pela competência da fatura e a conta pela data,
   * e o mesmo seletor de mês significava duas coisas ao mesmo tempo. Isso
   * impedia qualquer total consolidado e obrigava a saber de cor qual régua
   * cada bloco usava.
   *
   * A competência não some: continua sendo a régua da aba Cartão, que responde
   * "quanto vou pagar". Mas "quanto gastei em maio" agora é uma pergunta só.
   */
  const chaveMes = useCallback((l: Linha) => l.data.slice(0, 7), []);

  /**
   * Período que cada fatia realmente cobre — os ciclos NÃO coincidem.
   *
   * Itaú fecha por volta do dia 3 (compras 03/07 a 01/08 na fatura que vence
   * 10/08). Nubank fecha no fim do mês. Pix não tem ciclo: o dinheiro sai no
   * dia. Mostrar o intervalo real de cada bloco é o que impede o usuário de
   * somar mentalmente coisas medidas em réguas diferentes.
   */
  const intervalo = useCallback((ls: Linha[]): string | null => {
    if (ls.length === 0) return null;
    const datas = ls.map((l) => l.data).sort();
    return `${dataCurta(datas[0])} a ${dataCurta(datas[datas.length - 1])}`;
  }, []);

  const meses = useMemo(() => {
    const s = new Set<string>();
    for (const l of linhas) { const k = chaveMes(l); if (k) s.add(k); }
    return [...s].sort().reverse();
  }, [linhas, chaveMes]);

  useEffect(() => {
    if (!mesIniciado && meses.length > 0) { setMes(meses[0]); setMesIniciado(true); }
  }, [meses, mesIniciado]);

  const doPeriodo = useMemo(
    () => linhas.filter((l) => l.valor !== 0 && (!mes || chaveMes(l) === mes)),
    [linhas, mes, chaveMes],
  );

  // ── as quatro fatias ──────────────────────────────────────────────────────

  const bancosCartao = useMemo(
    () => [...new Set([...contas.values()].filter((c) => c.tipo === 'cartao').map((c) => c.instituicao))].sort(),
    [contas],
  );

  /**
   * Cartão: TUDO que passou nos cartões do período, incluindo pagamento de
   * fatura e estorno.
   *
   * Antes esta lista filtrava `!eh_interna` e `fatura_id != null`, e os
   * lançamentos excluídos não apareciam em aba nenhuma — sumiam da tela sem
   * aviso. Agora entram na lista com selo e ficam de fora só do TOTAL, que é
   * o comportamento já usado na aba Pix.
   */
  const cartaoTudo = useMemo(
    () => doPeriodo.filter((l) => tipoDaConta(l) === 'cartao'
      && (bancoCartao === null || contas.get(l.conta_id)?.instituicao === bancoCartao))
      .sort((a, b) => b.data.localeCompare(a.data)),
    [doPeriodo, tipoDaConta, bancoCartao, contas],
  );
  const cartao = useMemo(() => cartaoTudo.filter((l) => !l.eh_interna), [cartaoTudo]);
  const totalCartao = cartao.reduce((a, l) => a - l.valor, 0);

  /**
   * Saídas: tudo que saiu da conta corrente, exceto RDB.
   *
   * Inclui o boleto: ele não é Pix, mas deixar R$ 110 de fora da única tela de
   * saídas seria pior que o rótulo da aba ficar um pouco mais largo. O selo
   * `boleto` distingue na lista.
   *
   * Pagamento de fatura fica visível mas marcado como interno — é um Pix que
   * você de fato enviou, só que não é consumo novo.
   */
  const saidas = useMemo(
    () => doPeriodo.filter((l) => tipoDaConta(l) === 'corrente' && l.valor < 0 && !ehCaixinha(l))
      .sort((a, b) => a.valor - b.valor),
    [doPeriodo, tipoDaConta],
  );
  const saidasGasto = useMemo(() => saidas.filter(ehGasto), [saidas]);
  const totalSaidas = saidasGasto.reduce((a, l) => a - l.valor, 0);
  const saidasInternas = saidas.filter((l) => l.eh_interna).reduce((a, l) => a - l.valor, 0);
  /** Pix de aporte: sai da conta mas não é gasto. Visível, fora do total. */
  const saidasGuardadas = saidas.filter(ehInvestimento).reduce((a, l) => a - l.valor, 0);

  /** Entradas: tudo que entrou na conta, exceto RDB. Interno ou não. */
  const entradas = useMemo(
    () => doPeriodo.filter((l) => tipoDaConta(l) === 'corrente' && l.valor > 0 && !ehCaixinha(l))
      .sort((a, b) => b.valor - a.valor),
    [doPeriodo, tipoDaConta],
  );
  const totalEntradas = entradas.filter((l) => !l.eh_interna).reduce((a, l) => a + l.valor, 0);

  /**
   * Tudo que passou pela conta, exceto RDB, numa lista só por data.
   *
   * Saída e entrada de Pix são o mesmo fluxo visto de dois lados; separá-las
   * em abas obrigava a alternar para entender um mês. O sinal na linha já
   * distingue, e o líquido embaixo dos dois totais responde "sobrou quanto".
   */
  const pix = useMemo(
    () => [...saidas, ...entradas].sort((a, b) =>
      (a.data === b.data ? a.valor - b.valor : b.data.localeCompare(a.data))),
    [saidas, entradas],
  );

  /**
   * Investimentos: RDB, com o sinal visto da APLICAÇÃO, não da conta.
   *
   * `Aplicação RDB` sai da conta (−1.000) mas entra na aplicação (+1.000).
   * `Resgate RDB` entra na conta (+184) mas sai da aplicação (−184).
   * O saldo é aplicações − resgates: quanto foi efetivamente guardado.
   */
  const investimentos = useMemo(
    () => doPeriodo.filter(ehInvestimento).sort((a, b) => b.data.localeCompare(a.data)),
    [doPeriodo],
  );
  const aplicado = investimentos.filter((l) => l.valor < 0).reduce((a, l) => a - l.valor, 0);
  const resgatado = investimentos.filter((l) => l.valor > 0).reduce((a, l) => a + l.valor, 0);
  const guardado = aplicado - resgatado;


  // ── os quatro números da tela ─────────────────────────────────────────────
  //
  // Definidos uma vez, aqui, e usados em todo lugar. Cada um responde uma
  // pergunta em português e nenhum depende de saber o ciclo de fatura.

  /** Consumo: compras no cartão + Pix/boleto. Nem interna, nem guardado. */
  const gastei = totalCartao + totalSaidas;

  /**
   * Dinheiro que ENTROU no Nubank vindo de fora.
   *
   * Resgate da caixinha não conta: é dinheiro que já era seu voltando de um
   * bolso para o outro. Se contasse, os R$ 17 mil de resgate do período
   * apareceriam como se você tivesse recebido isso.
   */
  const entrou = totalEntradas;

  /** Tudo que DEIXOU a conta: gasto, pagamento de fatura e aporte. Sem caixinha. */
  const saiu = useMemo(
    () => saidas.reduce((a, l) => a - l.valor, 0), [saidas],
  );

  const sobrou = entrou - saiu;

  /**
   * A fatura que vence por causa deste mês — a ponte entre "gastei" e "vou pagar".
   *
   * O bloco de cima conta a compra no dia em que ela aconteceu; o boleto que
   * chega cobre um ciclo deslocado. Os dois números são certos e diferentes, e
   * mostrar um sem o outro é o que gerava a dúvida de "então quanto eu pago?".
   */
  const faturasDoMes = useMemo(() => {
    if (!mes) return [];
    return [...faturas.values()]
      .filter((f) => f.competencia.slice(0, 7) === mes)
      .map((f) => ({
        ...f,
        instituicao: contas.get(f.conta_id)?.instituicao ?? '',
        total: linhas
          .filter((l) => l.fatura_id === f.id && !l.eh_interna)
          .reduce((a, l) => a - l.valor, 0),
      }))
      .filter((f) => f.total > 0)
      .sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? ''));
  }, [faturas, mes, linhas, contas]);

  /** Lançamentos do cartão pela COMPETÊNCIA — o que o boleto do mês cobra. */
  const cartaoPorFatura = useMemo(() => {
    const ids = new Set(faturasDoMes.map((f) => f.id));
    return linhas
      .filter((l) => l.fatura_id != null && ids.has(l.fatura_id)
        && (bancoCartao === null || contas.get(l.conta_id)?.instituicao === bancoCartao))
      .sort((a, b) => b.data.localeCompare(a.data));
  }, [linhas, faturasDoMes, bancoCartao, contas]);

  /** O que a aba Cartão lista, conforme o botão escolhido. */
  const listaCartao = eixoCartao === 'fatura' ? cartaoPorFatura : cartaoTudo;
  const totalFatura = cartaoPorFatura.filter((l) => !l.eh_interna).reduce((a, l) => a - l.valor, 0);

  // ── apoio ─────────────────────────────────────────────────────────────────

  const nomeCat = useCallback(
    (id: number | null) => (id != null ? catPorId.get(id)?.nome ?? '—' : '—'),
    [catPorId],
  );

  const corPorCategoria = useMemo(() => {
    const m = new Map<string, string>();
    [...cats].sort((a, b) => a.id - b.id).forEach((c, i) => {
      m.set(c.nome, c.nome === NOME_SEM_CATEGORIA ? CINZA : PALETA[i % PALETA.length]);
    });
    return m;
  }, [cats]);

  const corDe = useCallback(
    (nome: string) => (nome === 'Outros' ? CINZA : corPorCategoria.get(nome) ?? CINZA),
    [corPorCategoria],
  );

  const multiBanco = useMemo(
    () => new Set([...contas.values()].map((c) => c.instituicao)).size > 1, [contas],
  );

  const porCategoria = useCallback((ls: Linha[]) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(nomeCat(l.categoria_id), (m.get(nomeCat(l.categoria_id)) ?? 0) - l.valor);
    return [...m.entries()]
      .map(([nome, valor]) => ({ nome, valor: Number(valor.toFixed(2)) }))
      .sort((a, b) => b.valor - a.valor);
  }, [nomeCat]);

  /**
   * Quanto gastei em cada mês, separado por origem. Independe do filtro de mês.
   *
   * Empilhar cartão e Pix na mesma barra é o que torna a comparação entre meses
   * legível: a altura é o gasto do mês e a divisão mostra de onde veio.
   */
  const historico = useMemo(() => {
    const m = new Map<string, { cartao: number; pix: number }>();
    const zero = () => ({ cartao: 0, pix: 0 });
    for (const l of linhas) {
      if (l.valor >= 0) continue;
      const t = tipoDaConta(l);
      const k = chaveMes(l);
      if (!k) continue;
      if (t === 'cartao' && !l.eh_interna) {
        const c = m.get(k) ?? zero(); c.cartao -= l.valor; m.set(k, c);
      } else if (t === 'corrente' && !l.eh_interna && !ehInvestimento(l) && !ehCaixinha(l)) {
        const c = m.get(k) ?? zero(); c.pix -= l.valor; m.set(k, c);
      }
    }
    return [...m.entries()].sort().map(([k, v]) => ({
      chave: k, mes: mesRotulo(k),
      cartao: Number(v.cartao.toFixed(2)), pix: Number(v.pix.toFixed(2)),
      total: Number((v.cartao + v.pix).toFixed(2)),
    }));
  }, [linhas, chaveMes, tipoDaConta]);

  const item = (l: Linha) => (
    <ItemEditavel key={l.hash_natural} linha={l} cats={cats} onSalvo={carregar}
                  corCategoria={corDe(nomeCat(l.categoria_id))}
                  instituicao={multiBanco ? contas.get(l.conta_id)?.instituicao ?? null : null} />
  );

  const rotuloMes = mes ? competenciaRotulo(`${mes}-01`) : 'todo o período';

  /**
   * Quantos lançamentos do período não aparecem em aba nenhuma.
   *
   * As abas são recortes; se um recorte esquecer uma linha ela some da tela
   * sem deixar rastro. Foi o que aconteceu com R$ 3.500 de aporte no C6. Esta
   * conta tem que dar zero — se não der, é bug, e o aviso aparece.
   */
  const orfaos = useMemo(() => {
    const vistos = new Set<string>();
    for (const l of doPeriodo) {
      const t = tipoDaConta(l);
      if (t === 'cartao' || t === 'corrente') vistos.add(l.hash_natural);
    }
    return doPeriodo.filter((l) => !vistos.has(l.hash_natural) && !ehCaixinha(l));
  }, [doPeriodo, tipoDaConta]);

  /** Movimentações da caixinha, que agora moram na tela de Carteira. */
  const naCarteira = useMemo(() => doPeriodo.filter(ehCaixinha).length, [doPeriodo]);

  if (carregando) return <p style={{ color: 'var(--suave)' }}>Carregando…</p>;
  if (erro) return <p style={{ color: 'var(--negativo)' }}>Erro: {erro}</p>;
  if (linhas.length === 0) {
    return (
      <div className="painel p-10 text-center">
        <p className="font-medium">Nada importado ainda.</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--suave)' }}>
          <Link href="/" className="underline" style={{ color: 'var(--acento)' }}>Importe uma fatura</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Quanto gastei</h1>
        <div className="nao-imprimir flex items-center gap-2">
          <select value={mes ?? 'todos'}
                  onChange={(e) => setMes(e.target.value === 'todos' ? null : e.target.value)}
                  className="border bg-white px-3 py-1.5 text-sm capitalize"
                  style={{ borderColor: 'var(--borda-forte)' }}>
            <option value="todos">Todo o período</option>
            {meses.map((m) => <option key={m} value={m}>{competenciaRotulo(`${m}-01`)}</option>)}
          </select>
          <button onClick={() => window.print()} className="btn btn-neutro">Exportar PDF</button>
        </div>
      </div>

      {/* Cinco fatias com regras de sinal diferentes; misturá-las numa rolagem
          só foi o que deixou a tela confusa. */}
      <nav className="nao-imprimir flex flex-wrap gap-1 rounded-xl border bg-white p-1"
           style={{ borderColor: 'var(--borda-forte)' }}>
        {ABAS.map((a) => (
          <button key={a.id} onClick={() => setAba(a.id)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition"
                  style={{
                    background: aba === a.id ? 'var(--acento)' : 'transparent',
                    color: aba === a.id ? '#fff' : 'var(--suave)',
                  }}>
            {a.rotulo}
          </button>
        ))}
      </nav>

      {truncado && (
        <p role="alert" className="rounded-lg border px-4 py-3 text-sm"
           style={{ borderColor: 'var(--perigo-borda)', background: 'var(--perigo-fundo)', color: 'var(--perigo-texto)' }}>
          Mais de {LIMITE_LINHAS.toLocaleString('pt-BR')} lançamentos: os totais estão incompletos.
        </p>
      )}

      {orfaos.length > 0 && (
        <p role="alert" className="rounded-lg border px-4 py-3 text-sm"
           style={{ borderColor: 'var(--perigo-borda)', background: 'var(--perigo-fundo)', color: 'var(--perigo-texto)' }}>
          {orfaos.length} lançamento(s) do período não aparecem em nenhuma aba
          ({[...new Set(orfaos.map((l) => contas.get(l.conta_id)?.nome ?? '?'))].join(', ')}).
          Isso é bug — nenhuma linha deveria ficar fora.
        </p>
      )}

      {aba === 'geral' && (
        <Geral
          rotuloMes={rotuloMes} gastei={gastei}
          totalCartao={totalCartao} nCartao={cartao.length}
          totalSaidas={totalSaidas} nSaidas={saidasGasto.length}
          entrou={entrou} saiu={saiu} sobrou={sobrou}
          guardado={guardado} aplicado={aplicado} resgatado={resgatado} naCarteira={naCarteira}
          saidasInternas={saidasInternas} saidasGuardadas={saidasGuardadas}
          faturas={faturasDoMes} historico={historico} mes={mes} onIr={setAba}
        />
      )}

      {aba === 'cartao' && (
        <Fatia titulo={eixoCartao === 'fatura' ? 'Fatura — o que vou pagar' : 'Compras — o que gastei'}
               subtitulo={`${rotuloMes} · ${
                 bancoCartao ? rotuloBanco(bancoCartao) : bancosCartao.map(rotuloBanco).join(' e ')}`}
               total={eixoCartao === 'fatura' ? totalFatura : totalCartao}
               n={listaCartao.length} cor="var(--gasto)"
               nota={intervalo(listaCartao)
                 ? (eixoCartao === 'fatura'
                     ? `Compras de ${intervalo(listaCartao)} — o ciclo fecha antes do fim do mês, por isso o intervalo não é o mês cheio.`
                     : `Compras de ${intervalo(listaCartao)}, agrupadas pelo dia em que você comprou.`)
                 : undefined}
               acao={
                 <div className="flex flex-wrap gap-2">
                   {bancosCartao.length > 1 && (
                     <div className="flex rounded-lg border bg-white p-0.5" style={{ borderColor: 'var(--borda-forte)' }}>
                       {[null, ...bancosCartao].map((b) => (
                         <button key={b ?? 'todos'} onClick={() => setBancoCartao(b)}
                                 aria-pressed={bancoCartao === b}
                                 className="rounded-md px-3 py-1 text-xs font-medium transition"
                                 style={{
                                   background: bancoCartao === b ? 'var(--acento)' : 'transparent',
                                   color: bancoCartao === b ? '#fff' : 'var(--suave)',
                                 }}>
                           {b === null ? 'Os dois' : rotuloBanco(b)}
                         </button>
                       ))}
                     </div>
                   )}
                   <div className="flex rounded-lg border bg-white p-0.5" style={{ borderColor: 'var(--borda-forte)' }}>
                     {([['compra', 'O que gastei'], ['fatura', 'O que vou pagar']] as const).map(([v, r]) => (
                       <button key={v} onClick={() => setEixoCartao(v)} aria-pressed={eixoCartao === v}
                               className="rounded-md px-3 py-1 text-xs font-medium transition"
                               style={{
                                 background: eixoCartao === v ? 'var(--acento)' : 'transparent',
                                 color: eixoCartao === v ? '#fff' : 'var(--suave)',
                               }}>
                         {r}
                       </button>
                     ))}
                   </div>
                 </div>
               }>
          {listaCartao.length > 0 && (
            <Composicao dados={porCategoria(listaCartao.filter((l) => !l.eh_interna))}
                        total={eixoCartao === 'fatura' ? totalFatura : totalCartao} corDe={corDe} />
          )}
          {historico.length > 1 && eixoCartao === 'compra' && (
            <section>
              <h2 className="rotulo mb-2">Compras no cartão, mês a mês</h2>
              <div className="painel p-4">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={historico} margin={{ top: 22, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--borda)" vertical={false} />
                    <XAxis dataKey="mes" stroke="var(--suave)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--suave)" fontSize={12} tickLine={false} axisLine={false} width={54}
                           tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} />
                    <Tooltip cursor={{ fill: '#f4f5f8' }} formatter={(v: number) => [dinheiro(v), 'Cartão']}
                             contentStyle={caixaTooltip} />
                    <Bar dataKey="cartao" radius={[6, 6, 0, 0]} maxBarSize={56}>
                      <LabelList dataKey="cartao" position="top" fontSize={11} fill="var(--suave)"
                                 formatter={(v: number) => dinheiro(v)} />
                      {historico.map((m) => (
                        <Cell key={m.chave} fill={!mes || mes === m.chave ? 'var(--gasto)' : 'var(--gasto-clara)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
          <Lista titulo={`${listaCartao.length} lançamento(s)`} linhas={listaCartao} render={item} />
        </Fatia>
      )}

      {aba === 'pix' && (
        <section className="space-y-5">
          <div className="painel-destaque p-6">
            <p className="rotulo">Gastei por Pix e boleto · {rotuloMes}</p>
            <p className="mt-1 tabular text-[2.75rem] font-semibold leading-none tracking-tight"
               style={{ color: 'var(--gasto)' }}>
              {dinheiro(totalSaidas)}
            </p>
            <p className="mt-2 text-sm" style={{ color: 'var(--suave)' }}>
              {saidasGasto.length} saída(s) · {rotuloMes}
            </p>
            <div className="mt-5 grid gap-x-8 gap-y-3 border-t pt-4 sm:grid-cols-3"
                 style={{ borderColor: 'var(--borda)' }}>
              <Mini rotulo="Entrou na conta" valor={entrou} sinal="+" cor="var(--entrada)" />
              <Mini rotulo="Saiu da conta" valor={saiu} sinal="−" cor="var(--gasto)" />
              <Mini rotulo="Sobrou" valor={sobrou} sinal={sobrou >= 0 ? '+' : '−'}
                    cor={sobrou >= 0 ? 'var(--entrada)' : 'var(--negativo)'} />
            </div>
          </div>

          {saidasGasto.length > 0 && (
            <Composicao dados={porCategoria(saidasGasto)}
                        total={totalSaidas} corDe={corDe} />
          )}

          <Lista titulo={`${pix.length} lançamento(s)`} linhas={pix} render={item} />
        </section>
      )}

    </div>
  );
}

const caixaTooltip = {
  background: '#fff', border: '1px solid var(--borda-forte)', borderRadius: 10,
  fontSize: 13, boxShadow: '0 4px 12px rgb(16 24 40 / 0.08)',
} as const;

// ── blocos reutilizados ─────────────────────────────────────────────────────

function Fatia({ titulo, subtitulo, total, n, cor, nota, acao, children }: {
  titulo: string; subtitulo: string; total: number; n: number; cor: string;
  nota?: string; acao?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="painel-destaque p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="rotulo">{titulo}</p>
          {acao && <div className="nao-imprimir">{acao}</div>}
        </div>
        <p className="mt-1 tabular text-[2.75rem] font-semibold leading-none tracking-tight" style={{ color: cor }}>
          {dinheiro(total)}
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--suave)' }}>
          {n} lançamento(s) · {subtitulo}
        </p>
        {nota && <p className="mt-3 text-xs" style={{ color: 'var(--suave)' }}>{nota}</p>}
      </div>
      {children}
    </section>
  );
}

function Composicao({ dados, total, corDe }: {
  dados: { nome: string; valor: number }[]; total: number; corDe: (n: string) => string;
}) {
  if (dados.length === 0) return null;
  const principais = dados.slice(0, TOP_CATEGORIAS);
  return (
    <section className="grid gap-5 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <h2 className="rotulo mb-2">Composição</h2>
        <div className="painel p-4">
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={dados} dataKey="valor" nameKey="nome" cx="50%" cy="50%"
                   innerRadius={54} outerRadius={88} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                {dados.map((c) => <Cell key={c.nome} fill={corDe(c.nome)} />)}
              </Pie>
              <Tooltip formatter={(v: number, n) => [`${dinheiro(v)} · ${((v / total) * 100).toFixed(0)}%`, n]}
                       contentStyle={caixaTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="lg:col-span-3">
        <h2 className="rotulo mb-2">Por categoria</h2>
        <div className="painel divide-y" style={{ borderColor: 'var(--borda)' }}>
          {principais.map((c) => (
            <div key={c.nome} className="flex items-center gap-3 px-4 py-3" style={{ borderColor: 'var(--borda)' }}>
              <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: corDe(c.nome) }} />
              <span className="flex-1 truncate text-[15px] font-medium"
                    style={{ color: c.nome === NOME_SEM_CATEGORIA ? 'var(--suave)' : undefined }}>
                {c.nome}
              </span>
              <span className="tabular text-sm" style={{ color: 'var(--suave)' }}>
                {((c.valor / total) * 100).toFixed(0)}%
              </span>
              <span className="tabular text-[15px] font-semibold">{dinheiro(c.valor)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Lista({ titulo, linhas, render }: {
  titulo: string; linhas: Linha[]; render: (l: Linha) => React.ReactNode;
}) {
  if (linhas.length === 0) {
    return <p className="painel p-6 text-center text-sm" style={{ color: 'var(--suave)' }}>
      Nada neste período.
    </p>;
  }
  return (
    <section>
      <h2 className="rotulo mb-2">{titulo}</h2>
      <div className="painel overflow-hidden">{linhas.map(render)}</div>
    </section>
  );
}

/** Número secundário: rótulo em cima, valor embaixo. */
function Mini({ rotulo, valor, sinal, cor }: {
  rotulo: string; valor: number; sinal: string; cor: string;
}) {
  return (
    <div>
      <p className="rotulo">{rotulo}</p>
      <p className="tabular mt-0.5 text-lg font-semibold" style={{ color: cor }}>
        {sinal}{dinheiro(Math.abs(valor))}
      </p>
    </div>
  );
}

/**
 * Dias até uma data, contando só o dia do calendário.
 *
 * Comparar timestamps faria "vence hoje às 23h" virar 0,04 dia e arredondar
 * para zero ou um conforme a hora em que a tela fosse aberta.
 */
function diasAte(iso: string, hoje = new Date()): number {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = Date.UTC(a, m - 1, d);
  const agora = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo - agora) / 86_400_000);
}

interface FaturaDoMes {
  id: number; instituicao: string; vencimento: string | null; total: number;
}

/**
 * A visão de abertura: quatro números em português e nada mais.
 *
 * A versão anterior mostrava três blocos que não podiam ser somados e um
 * parágrafo explicando por quê. Estava correta e não respondia à pergunta.
 * Agora tudo é agrupado pela data em que aconteceu, então "gastei em maio" é
 * um número só — e a fatura, que corre em outro ciclo, aparece como ponte
 * logo abaixo em vez de contaminar o total.
 */
function Geral({ rotuloMes, gastei, totalCartao, nCartao, totalSaidas, nSaidas,
                 entrou, saiu, sobrou, guardado, aplicado, resgatado,
                 saidasInternas, saidasGuardadas, naCarteira, faturas, historico, mes, onIr }: {
  rotuloMes: string; gastei: number;
  totalCartao: number; nCartao: number;
  totalSaidas: number; nSaidas: number;
  entrou: number; saiu: number; sobrou: number;
  guardado: number; aplicado: number; resgatado: number; naCarteira: number;
  saidasInternas: number; saidasGuardadas: number;
  faturas: FaturaDoMes[];
  historico: { chave: string; mes: string; cartao: number; pix: number; total: number }[];
  mes: string | null;
  onIr: (a: Aba) => void;
}) {
  const fatiaCartao = gastei > 0 ? (totalCartao / gastei) * 100 : 0;
  return (
    <div className="space-y-5">
      <div className="painel-destaque p-6">
        <p className="rotulo">Gastei · {rotuloMes}</p>
        <p className="tabular mt-1 text-[3rem] font-semibold leading-none tracking-tight">
          {dinheiro(gastei)}
        </p>

        {/* A barra responde "de onde veio" antes de o usuário precisar clicar. */}
        {gastei > 0 && (
          <div className="mt-5 flex h-2.5 overflow-hidden rounded-full" style={{ background: '#eef0f4' }}>
            <div style={{ width: `${fatiaCartao}%`, background: 'var(--gasto)' }} />
            <div style={{ width: `${100 - fatiaCartao}%`, background: 'var(--acento)' }} />
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          <button onClick={() => onIr('cartao')} className="text-left">
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ background: 'var(--gasto)' }} />
            <span className="text-sm" style={{ color: 'var(--suave)' }}>Cartão</span>
            <span className="tabular ml-2 text-sm font-semibold">{dinheiro(totalCartao)}</span>
            <span className="ml-1 text-xs" style={{ color: 'var(--suave-claro)' }}>
              · {nCartao} compra(s)
            </span>
          </button>
          <button onClick={() => onIr('pix')} className="text-left">
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ background: 'var(--acento)' }} />
            <span className="text-sm" style={{ color: 'var(--suave)' }}>Pix e boleto</span>
            <span className="tabular ml-2 text-sm font-semibold">{dinheiro(totalSaidas)}</span>
            <span className="ml-1 text-xs" style={{ color: 'var(--suave-claro)' }}>
              · {nSaidas} saída(s)
            </span>
          </button>
        </div>

        {/* A ponte entre "gastei" e "vou pagar" — ciclos diferentes, sem somar. */}
        {faturas.length > 0 && (
          <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--borda)' }}>
            <p className="text-xs" style={{ color: 'var(--suave)' }}>
              O boleto do cartão cobre um ciclo deslocado, então não é o mesmo número:
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
              {faturas.map((f) => {
                const dias = f.vencimento ? diasAte(f.vencimento) : null;
                // Vencer é prazo, não erro — só vira alerta quando aperta.
                const urgente = dias !== null && dias >= 0 && dias <= 3;
                const vencida = dias !== null && dias < 0;
                return (
                  <span key={f.id} className="flex items-center gap-1.5 text-sm">
                    <Marca instituicao={f.instituicao} tamanho={16} />
                    <span style={{ color: 'var(--suave)' }}>
                      {f.vencimento ? `vence ${dataCurta(f.vencimento)}` : 'fatura'}
                    </span>
                    <span className="tabular font-semibold">{dinheiro(f.total)}</span>
                    {dias !== null && (
                      <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium"
                            style={
                              vencida ? { background: 'var(--perigo-fundo)', color: 'var(--perigo-texto)' }
                              : urgente ? { background: '#fef3c7', color: '#92400e' }
                              : { background: '#eef0f4', color: 'var(--suave)' }
                            }>
                        {vencida ? `venceu há ${-dias} dia(s)`
                          : dias === 0 ? 'vence hoje'
                          : `em ${dias} dia(s)`}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo="Guardei" valor={guardado} cor="var(--acento)"
                detalhe={`${dinheiro(aplicado)} aplicado · ${dinheiro(resgatado)} resgatado`}
                href="/carteira" />
        <Cartao rotulo="Entrou na conta" valor={entrou} cor="var(--entrada)"
                detalhe="salário e recebimentos" />
        <Cartao rotulo="Saiu da conta" valor={saiu} cor="var(--gasto)"
                detalhe={[
                  `${dinheiro(totalSaidas)} gasto`,
                  saidasInternas > 0 ? `${dinheiro(saidasInternas)} fatura` : null,
                  saidasGuardadas > 0 ? `${dinheiro(saidasGuardadas)} aporte` : null,
                ].filter(Boolean).join(' · ')} />
        <Cartao rotulo="Sobrou" valor={sobrou} cor={sobrou >= 0 ? 'var(--entrada)' : 'var(--negativo)'}
                detalhe="entrou menos saiu" />
      </div>

      {historico.length > 1 && (
        <section>
          <h2 className="rotulo mb-2">Gastei, mês a mês</h2>
          <div className="painel p-4">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={historico} margin={{ top: 22, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--borda)" vertical={false} />
                <XAxis dataKey="mes" stroke="var(--suave)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--suave)" fontSize={12} tickLine={false} axisLine={false} width={54}
                       tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} />
                <Tooltip cursor={{ fill: '#f4f5f8' }} contentStyle={caixaTooltip}
                         formatter={(v: number, n) => [dinheiro(v), n === 'cartao' ? 'Cartão' : 'Pix e boleto']} />
                <Bar dataKey="cartao" stackId="g" maxBarSize={56}>
                  {historico.map((m) => (
                    <Cell key={m.chave} fill={!mes || mes === m.chave ? 'var(--gasto)' : 'var(--gasto-clara)'} />
                  ))}
                </Bar>
                <Bar dataKey="pix" stackId="g" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  <LabelList dataKey="total" position="top" fontSize={11} fill="var(--suave)"
                             formatter={(v: number) => dinheiro(v)} />
                  {historico.map((m) => (
                    <Cell key={m.chave} fill={!mes || mes === m.chave ? 'var(--acento)' : '#c9cff2'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* As regras existem, mas ficam fora do caminho de quem só quer o número. */}
      <details className="painel px-5 py-4 text-sm">
        <summary className="cursor-pointer font-medium" style={{ color: 'var(--suave)' }}>
          Como estes números são calculados
        </summary>
        <ul className="mt-3 space-y-2 text-[13px]" style={{ color: 'var(--suave)' }}>
          <li>
            <strong>Gastei</strong> é consumo: compras no cartão mais Pix e boleto, tudo pelo
            dia em que aconteceu. Pagar a fatura não entra — o gasto foram as compras, e contar
            os dois somaria o cartão duas vezes.
          </li>
          <li>
            <strong>Guardei</strong> é o que você aplicou menos o que resgatou, somando a
            caixinha do Nubank e os aportes enviados por Pix.
            {naCarteira > 0 && (
              <> As {naCarteira} movimentações da caixinha não aparecem aqui porque não são
              Pix nem compra — estão listadas em <Link href="/carteira" className="underline"
              style={{ color: 'var(--acento)' }}>Carteira</Link>, junto do saldo e do rendimento.</>
            )}
          </li>
          <li>
            <strong>Entrou</strong> e <strong>saiu</strong> medem a conta corrente. Resgate da
            caixinha não conta como entrada: é dinheiro seu voltando de um bolso para o outro.
          </li>
          <li>
            <strong>Sobrou</strong> negativo significa que o mês gastou mais do que entrou —
            a diferença veio da caixinha. É o seu fluxo normal: o salário chega, você guarda,
            e no fim do mês resgata para pagar as faturas.
          </li>
          <li>
            A <strong>fatura</strong> acima corre em outro ciclo: fecha antes do fim do mês e
            mistura compras de dois meses. Por isso aparece separada, nunca somada.
          </li>
        </ul>
      </details>
    </div>
  );
}

function Cartao({ rotulo, valor, cor, detalhe, onClick, href }: {
  rotulo: string; valor: number; cor: string; detalhe: string;
  onClick?: () => void; href?: string;
}) {
  const conteudo = (
    <>
      <p className="rotulo">{rotulo}</p>
      <p className="tabular mt-1 text-2xl font-semibold" style={{ color: cor }}>
        {valor < 0 ? '−' : ''}{dinheiro(Math.abs(valor))}
      </p>
      <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>{detalhe}</p>
    </>
  );
  const classe = 'painel block p-5 text-left';
  if (href) {
    return <Link href={href} className={`${classe} transition hover:shadow-md`}>{conteudo}</Link>;
  }
  if (onClick) {
    return <button onClick={onClick} className={`${classe} transition hover:shadow-md`}>{conteudo}</button>;
  }
  return <div className={classe}>{conteudo}</div>;
}

function Etiqueta({ nome, cor }: { nome: string; cor: string }) {
  return (
    <span className="whitespace-nowrap rounded-md px-2 py-1 text-[13px] font-medium"
          style={{ background: `${cor}1f`, color: cor, border: `1px solid ${cor}40` }}>
      {nome}
    </span>
  );
}

function IconeLapis() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/**
 * Linha com edição embutida: categoria, apelido e excluir.
 *
 * A correção de categoria pode virar regra, mas não vira sozinha: um Pix
 * pontual não se repete, uma padaria se repete toda semana.
 */
function ItemEditavel({ linha, cats, onSalvo, instituicao, corCategoria }: {
  linha: Linha; cats: Categoria[]; onSalvo: () => void;
  instituicao?: string | null; corCategoria?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [catId, setCatId] = useState<number>(linha.categoria_id ?? 0);
  const [apelido, setApelido] = useState(linha.apelido ?? '');
  const [criarRegra, setCriarRegra] = useState(true);
  const [retroativo, setRetroativo] = useState(true);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const catAtual = cats.find((c) => c.id === linha.categoria_id);
  const base = linha.contraparte ?? linha.descricao;
  const padrao = sugerirPadrao(base);
  const mudouCategoria = catId !== 0 && catId !== linha.categoria_id;
  const mudouApelido = (apelido.trim() || null) !== (linha.apelido ?? null);

  async function salvar() {
    setOcupado(true); setMsg(null);
    try {
      const partes: string[] = [];
      if (mudouApelido) { await renomear(linha.hash_natural, apelido); partes.push('nome alterado'); }
      if (mudouCategoria) {
        const r = await corrigirCategoria({
          hashNatural: linha.hash_natural, descricao: base,
          categoriaId: catId, criarRegra, aplicarRetroativo: retroativo,
        });
        partes.push(`${r.atualizadas} lançamento(s) recategorizado(s)`);
        if (r.regraCriada) partes.push(`regra ${r.padrao} criada`);
      }
      setMsg(partes.join(' · ') || 'nada mudou');
      setAberto(false);
      onSalvo();
    } catch (e) {
      setMsg(explicarErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    setOcupado(true); setMsg(null);
    try { await excluirLancamento(linha.hash_natural); onSalvo(); }
    catch (e) { setMsg(explicarErro(e)); setOcupado(false); }
  }

  // Aparece na lista, mas esmaecido: o dinheiro se moveu sem virar gasto.
  const foraDoTotal = linha.eh_interna || ehInvestimento(linha);

  return (
    <div className="border-t first:border-t-0"
         style={{ borderColor: 'var(--borda)', background: foraDoTotal ? '#fafbfc' : undefined }}>
      <div className="flex items-center gap-3 px-4 py-3" style={{ opacity: foraDoTotal ? 0.55 : 1 }}>
        <span className="whitespace-nowrap tabular text-xs" style={{ color: 'var(--suave-claro)' }}>
          {dataCurta(linha.data)}
        </span>
        <span className="flex-1 truncate text-[15px]" title={linha.descricao}>{exibir(linha)}</span>

        {instituicao && <span className="hidden sm:inline"><Marca instituicao={instituicao} tamanho={20} /></span>}
        {linha.eh_interna && (
          <span className="hidden whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium sm:inline"
                style={{ background: '#eef0f4', color: 'var(--suave)' }}
                title="Fora dos totais: dinheiro entre suas próprias contas">
            interna
          </span>
        )}
        {ehInvestimento(linha) && (
          <span className="hidden whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium sm:inline"
                style={{ background: '#e7f0fb', color: '#1d4ed8' }}
                title="Fora do total de gastos: é dinheiro guardado, não consumido. Detalhe na aba Investimentos.">
            guardado
          </span>
        )}
        {linha.metodo === 'boleto' && (
          <span className="hidden whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] sm:inline"
                style={{ background: '#f2f4f7', color: 'var(--suave)' }}>
            boleto
          </span>
        )}
        {catAtual && (
          <span className="hidden sm:inline"><Etiqueta nome={catAtual.nome} cor={corCategoria ?? CINZA} /></span>
        )}

        <span className="whitespace-nowrap tabular text-[15px] font-semibold"
              style={{ color: linha.valor > 0 ? 'var(--entrada)' : undefined }}>
          {linha.valor > 0 ? '+' : '−'}{dinheiro(Math.abs(linha.valor))}
        </span>

        <button onClick={() => setAberto((v) => !v)}
                aria-label={`Editar ${exibir(linha)}`} aria-expanded={aberto}
                className="nao-imprimir rounded-md p-1.5 transition"
                style={{ color: aberto ? 'var(--acento)' : 'var(--suave-claro)',
                         background: aberto ? 'var(--acento-fraco)' : 'transparent' }}>
          <IconeLapis />
        </button>
      </div>

      {aberto && (
        <div className="nao-imprimir border-t px-4 py-4"
             style={{ borderColor: 'var(--borda)', background: '#fafbfc' }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="rotulo">Categoria</span>
              <select value={catId || ''} onChange={(e) => setCatId(Number(e.target.value))}
                      className="mt-1 w-full border bg-white px-2 py-2 text-sm"
                      style={{ borderColor: 'var(--borda-forte)' }}>
                <option value="">escolha…</option>
                {cats.filter((c) => c.nome !== NOME_SEM_CATEGORIA).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="rotulo">Nome exibido</span>
              <input value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder={base}
                     className="mt-1 w-full border bg-white px-2 py-2 text-sm"
                     style={{ borderColor: 'var(--borda-forte)' }} />
            </label>
          </div>

          {mudouCategoria && (
            <>
              <label className="mt-3 flex items-center gap-2 text-xs" style={{ color: 'var(--suave)' }}>
                <input type="checkbox" checked={criarRegra} onChange={(e) => setCriarRegra(e.target.checked)} />
                Criar regra <code className="rounded bg-white px-1">{padrao}</code> para os próximos
              </label>
              <label className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--suave)' }}>
                <input type="checkbox" checked={retroativo} onChange={(e) => setRetroativo(e.target.checked)} />
                Aplicar nos que já estão sem categoria
              </label>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={salvar} disabled={ocupado || (!mudouCategoria && !mudouApelido)}
                    className="btn btn-principal">
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
            <button onClick={() => { setAberto(false); setConfirmaExcluir(false); }} className="btn btn-neutro">
              Cancelar
            </button>
            {!confirmaExcluir ? (
              <button onClick={() => setConfirmaExcluir(true)}
                      className="ml-auto text-xs underline" style={{ color: 'var(--negativo)' }}>
                Excluir
              </button>
            ) : (
              <span className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--perigo-texto)' }}>
                Excluir mesmo?
                <button onClick={excluir} disabled={ocupado}
                        className="rounded-md px-2 py-1 font-medium text-white" style={{ background: 'var(--negativo)' }}>
                  Sim
                </button>
                <button onClick={() => setConfirmaExcluir(false)} className="underline">não</button>
              </span>
            )}
          </div>

          {msg && <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
