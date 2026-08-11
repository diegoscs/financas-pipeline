'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { explicarErro } from '@/lib/erro';
import {
  desfazerImportacao, gravar, limparBase, listarBancos, listarImportacoes, prepararArquivo,
  type BancoDisponivel, type Conferencia as ConferenciaTipo, type Importacao, type Preparado,
} from '@/lib/ingest';
import { banco as marcaBanco } from '@/lib/bancos';
import { Marca, SeloBanco } from '@/components/Marca';
import { dinheiro, dataCurta } from '@/lib/formato';
import { competenciaRotulo, opcoesCompetencia } from '@/lib/competencia';
import type { Categoria } from '@/lib/types';

export default function Importar() {
  const [bancos, setBancos] = useState<BancoDisponivel[]>([]);
  const [banco, setBanco] = useState<string>('');
  const [cats, setCats] = useState<Map<number, Categoria>>(new Map());
  const [prep, setPrep] = useState<Preparado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<{ gravadas: number; ignoradas: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  /** competência confirmada; começa com a detectada no arquivo */
  const [competencia, setCompetencia] = useState('');
  const [recarregarHistorico, setRecarregarHistorico] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [bs, k] = await Promise.all([
          listarBancos(),
          supabase.from('categorias').select('*'),
        ]);
        setBancos(bs);
        setBanco((b) => b || bs[0]?.instituicao || '');
        if (k.data) setCats(new Map((k.data as Categoria[]).map((x) => [x.id, x])));
      } catch (e) {
        setErro(explicarErro(e));
      }
    })();
  }, []);

  async function receber(file: File) {
    if (!banco) { setErro('Escolha o banco antes.'); return; }
    setErro(null); setFeito(null); setOcupado(true);
    try {
      const p = await prepararArquivo(file, banco);
      setPrep(p);
      setCompetencia(p.fatura?.competencia ?? '');
    } catch (e) {
      setPrep(null);
      setErro(explicarErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!prep) return;
    setOcupado(true); setErro(null);
    try {
      setFeito(await gravar(prep, competencia || undefined));
      setPrep(null);
      setRecarregarHistorico((n) => n + 1);
    } catch (e) {
      setErro(explicarErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const novas = prep ? prep.transacoes.filter((t) => !prep.duplicadas.has(t.hash_natural!)) : [];
  const gastoNovo = novas
    .filter((t) => !t.eh_interna && t.valor < 0)
    .reduce((a, t) => a + t.valor, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar fatura</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--suave)' }}>
          O arquivo é lido aqui no navegador. Nada vai para o banco antes de você conferir.
        </p>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium">Banco</span>
        <div className="flex flex-wrap gap-2 xs:gap-2">
          {bancos.map((b) => {
            const on = b.instituicao === banco;
            const m = marcaBanco(b.instituicao);
            return (
              <button
                key={b.instituicao}
                onClick={() => setBanco(b.instituicao)}
                aria-pressed={on}
                className="flex min-h-11 items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition xs:px-3 xs:text-xs"
                style={{
                  borderColor: on ? m.cor : 'var(--borda-forte)',
                  background: on ? `${m.cor}12` : 'var(--painel)',
                  color: on ? 'var(--texto)' : 'var(--suave)',
                }}
              >
                <Marca instituicao={b.instituicao} tamanho={22} />
                {b.rotulo}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>
          Cartão ou conta corrente é deduzido do próprio arquivo — você não precisa escolher.
        </p>
      </div>

      {/* <button>, não <div onClick>: como div, a área de upload era
          inalcançável por teclado — quem não usa mouse não conseguia importar
          nada. O input de arquivo fica associado por ref e escondido. */}
      <button
        type="button"
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault(); setArrastando(false);
          const f = e.dataTransfer.files?.[0];
          if (f) receber(f);
        }}
        onClick={() => inputRef.current?.click()}
        disabled={ocupado}
        aria-describedby="formatos-aceitos"
        className="w-full cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition"
        style={{
          borderColor: arrastando ? 'var(--acento)' : 'var(--borda-forte)',
          background: arrastando ? '#eff4ff' : 'var(--painel)',
        }}
      >
        <span className="block text-sm font-medium">
          {ocupado ? 'Lendo…' : 'Arraste a fatura aqui, ou clique para escolher'}
        </span>
        <span id="formatos-aceitos" className="mt-1 block text-xs" style={{ color: 'var(--suave)' }}>
          .xlsx (fatura Itaú) ou .ofx (extrato ou fatura)
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.ofx"
        className="apenas-leitor"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) receber(f); e.target.value = ''; }}
      />

      {/* O resultado do import só existia visualmente; leitor de tela não
          anunciava nada depois de gravar. */}
      <div aria-live="polite" className="apenas-leitor">
        {ocupado ? 'Lendo o arquivo' : prep
          ? `${prep.transacoes.length} lançamentos lidos, ${novas.length} novos`
          : feito ? `${feito.gravadas} gravados, ${feito.ignoradas} já existiam` : ''}
      </div>

      {erro && (
        <p className="rounded-lg border px-4 py-3 text-sm"
           style={{ borderColor: 'var(--perigo-borda)', background: 'var(--perigo-fundo)', color: 'var(--perigo-texto)' }}>
          {erro}
        </p>
      )}

      {feito && (
        <div className="rounded-lg border px-4 py-3 text-sm"
             style={{ borderColor: '#b7e0c6', background: '#f0faf4', color: '#1a6b3c' }}>
          {feito.gravadas} gravada(s), {feito.ignoradas} já existia(m).{' '}
          <Link href="/analise" className="font-medium underline">Ver quanto gastei</Link>
        </div>
      )}

      {prep && (
        <section className="space-y-4">
          <div className="painel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{prep.arquivo}</h2>
              <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--suave)' }}>
                <SeloBanco instituicao={prep.conta.instituicao} />
                {prep.tipoConta === 'cartao' ? 'cartão de crédito' : 'conta corrente'}
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Numero rotulo="No arquivo" valor={prep.transacoes.length} />
              <Numero rotulo="Novos" valor={novas.length} destaque={novas.length > 0} />
              <Numero rotulo="Já no banco" valor={prep.duplicadas.size} />
            </div>

            {prep.periodo && (
              <p className="mt-3 text-sm" style={{ color: 'var(--suave)' }}>
                Período do arquivo: {dataCurta(prep.periodo.de)} a {dataCurta(prep.periodo.ate)}
                {prep.jaNoPeriodo > 0 && ` · ${prep.jaNoPeriodo} lançamento(s) já existem nessa conta nesse período`}
              </p>
            )}

            <p className="mt-2 text-sm">
              Gasto novo a somar:{' '}
              <strong className="tabular">
                {dinheiro(Math.abs(gastoNovo))}
              </strong>
            </p>
          </div>

          {prep.conferencia && <Conferencia c={prep.conferencia} />}

          {prep.fatura && (
            <div className="painel p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Fatura de</p>
                  <p className="text-xs" style={{ color: 'var(--suave)' }}>
                    {prep.fatura.confianca === 'arquivo'
                      ? 'Lido do cabeçalho do arquivo.'
                      : 'Deduzido do período — confira antes de gravar.'}
                    {prep.fatura.vencimento && ` Vence ${dataCurta(prep.fatura.vencimento)}.`}
                  </p>
                </div>
                <select
                  value={competencia}
                  onChange={(e) => setCompetencia(e.target.value)}
                  className="border bg-white text-sm capitalize xs:text-xs"
                  style={{
                    borderColor: prep.fatura.confianca === 'arquivo'
                      ? 'var(--borda-forte)' : 'var(--aviso-borda)',
                  }}
                >
                  {opcoesCompetencia(prep.fatura.competencia).map((c) => (
                    <option key={c} value={c}>{competenciaRotulo(c)}</option>
                  ))}
                </select>
              </div>

              {prep.faturaExistente && prep.faturaExistente.competencia === competencia && (
                <p className="mt-3 rounded-md border px-3 py-2 text-xs"
                   style={{ borderColor: 'var(--aviso-borda)', background: 'var(--aviso-fundo)', color: 'var(--aviso-texto)' }}>
                  Já existe uma fatura dessa competência para {prep.conta.nome}
                  {prep.faturaExistente.valor_total != null &&
                    ` (${dinheiro(prep.faturaExistente.valor_total)})`}.
                  Ela será atualizada, e só os lançamentos novos entram.
                </p>
              )}
            </div>
          )}

          {prep.suspeitas.size > 0 && (
            <p className="rounded-lg border px-4 py-3 text-xs"
               style={{ borderColor: 'var(--aviso-borda)', background: 'var(--aviso-fundo)', color: 'var(--aviso-texto)' }}>
              {prep.suspeitas.size} lançamento(s) marcados como <strong>conferir</strong>: têm a mesma
              data e o mesmo valor de algo já gravado, mas descrição diferente. Pode ser a mesma
              cobrança reexportada com outro texto — foi assim que um IOF de R$ 4,00 entrou duas
              vezes — ou dois gastos iguais de verdade no mesmo dia. Confira antes de gravar.
            </p>
          )}

          {prep.avisos.map((a, i) => (
            <p key={i} className="rounded-lg border px-4 py-3 text-xs"
               style={{ borderColor: 'var(--aviso-borda)', background: 'var(--aviso-fundo)', color: 'var(--aviso-texto)' }}>
              {a}
            </p>
          ))}

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--borda)' }}>
            <table className="min-w-full text-sm xs:text-xs">
              <thead>
                <tr className="border-b" style={{ background: '#fafbfc', borderColor: 'var(--borda)', color: 'var(--suave)' }}>
                  <th className="px-3 py-2 text-left font-medium">Data</th>
                  <th className="px-3 py-2 text-left font-medium">Descrição</th>
                  <th className="px-3 py-2 text-left font-medium">Categoria</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {prep.transacoes.map((t) => {
                  const dup = prep.duplicadas.has(t.hash_natural!);
                  const cat = t.categoria_id != null ? cats.get(t.categoria_id) : undefined;
                  const semCat = cat?.nome === 'Não classificado';
                  return (
                    <tr key={t.hash_natural} className="border-t"
                        style={{ borderColor: 'var(--borda)', color: dup ? 'var(--suave-claro)' : undefined }}>
                      <td className="whitespace-nowrap px-3 py-2 tabular">{dataCurta(t.data)}</td>
                      <td className="px-3 py-2">{t.descricao}</td>
                      <td className="px-3 py-2 text-xs"
                          style={{ color: dup ? undefined : semCat ? 'var(--suave-claro)' : 'var(--suave)' }}>
                        {cat?.nome ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular"
                          style={{ color: dup ? undefined : t.valor > 0 ? 'var(--entrada)' : undefined }}>
                        {dinheiro(t.valor)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs"
                          style={{ color: prep.suspeitas.has(t.hash_natural!) ? 'var(--aviso-texto)' : 'var(--suave-claro)' }}>
                        {dup ? 'já existe'
                          : prep.suspeitas.has(t.hash_natural!) ? 'conferir'
                          : t.eh_interna ? 'interna' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3 xs:gap-2">
            <button
              onClick={confirmar}
              disabled={ocupado || novas.length === 0}
              className="min-h-11 rounded-lg px-4 font-medium text-white disabled:opacity-40 xs:px-3 xs:text-sm"
              style={{ background: 'var(--acento)' }}
            >
              {novas.length === 0 ? 'Nada novo' : `Gravar ${novas.length}`}
            </button>
            <button
              onClick={() => setPrep(null)}
              className="min-h-11 rounded-lg border px-4 xs:px-3 xs:text-sm"
              style={{ borderColor: 'var(--borda-forte)', color: 'var(--suave)' }}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      <Historico recarregar={recarregarHistorico} />

      <ZonaPerigo onLimpou={() => { setPrep(null); setFeito(null); setRecarregarHistorico((n) => n + 1); }} />
    </div>
  );
}

/**
 * Soma dos lançamentos contra o total que o arquivo informa.
 *
 * Existia no banco e não era mostrado. É o que teria pego, sozinho, a
 * duplicata de R$ 4,00 que só apareceu na calculadora.
 */
function Conferencia({ c }: { c: ConferenciaTipo }) {
  const alerta = c.tipo === 'compras' && !c.confere;

  return (
    <div className="rounded-lg border p-4"
         style={{
           borderColor: alerta ? 'var(--perigo-borda)' : c.tipo === 'compras' ? '#b7e0c6' : 'var(--borda)',
           background: alerta ? 'var(--perigo-fundo)' : c.tipo === 'compras' ? '#f4fbf7' : '#fafbfc',
         }}>
      <p className="text-sm font-medium"
         style={{ color: alerta ? 'var(--perigo-texto)' : c.tipo === 'compras' ? '#1a6b3c' : 'var(--texto)' }}>
        {c.tipo === 'compras'
          ? (c.confere ? 'Confere com o total da fatura' : 'Não confere com o total da fatura')
          : 'Como o saldo do cartão fecha'}
      </p>

      <dl className="mt-2 space-y-1 text-sm">
        {c.tipo === 'saldo' && c.aberturaImplicita != null && (
          <Linha rotulo="Saldo que veio do ciclo anterior" valor={c.aberturaImplicita} />
        )}
        <Linha rotulo="Compras do período" valor={-c.compras} />
        {c.entradas > 0 && <Linha rotulo="Pagamentos e estornos" valor={c.entradas} />}

        <div className="flex justify-between border-t pt-1 font-medium" style={{ borderColor: 'var(--borda)' }}>
          <dt>{c.tipo === 'saldo' ? 'Saldo devedor no fim' : 'Total informado no arquivo'}</dt>
          <dd className="tabular">{dinheiro(c.totalInformado)}</dd>
        </div>

        {c.tipo === 'compras' && c.diferenca != null && (
          <div className="flex justify-between font-medium">
            <dt>Diferença</dt>
            <dd className="tabular" style={{ color: c.confere ? 'var(--entrada)' : 'var(--negativo)' }}>
              {dinheiro(c.diferenca)}
            </dd>
          </div>
        )}
      </dl>

      {c.tipo === 'saldo' && (
        <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>
          O OFX informa o <strong>saldo</strong> do cartão, não o total das compras. São
          números diferentes e os dois estão certos: você gastou {dinheiro(c.compras)} no
          período, e restou {dinheiro(c.totalInformado)} a pagar depois dos pagamentos e
          estornos. O saldo de abertura é o que sobrou da fatura anterior.
        </p>
      )}

      {alerta && (
        <p className="mt-2 text-xs" style={{ color: 'var(--perigo-texto)' }}>
          Diferença positiva costuma ser lançamento repetido (a mesma cobrança reexportada
          com outro texto). Negativa costuma ser saldo de ciclo anterior ainda não lançado.
          Confira as linhas marcadas como <strong>conferir</strong> abaixo antes de gravar.
        </p>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <dt style={{ color: 'var(--suave)' }}>{rotulo}</dt>
      <dd className="tabular" style={{ color: valor > 0 ? 'var(--entrada)' : undefined }}>
        {dinheiro(valor)}
      </dd>
    </div>
  );
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--borda)', background: '#fafbfc' }}>
      <p className="text-xs" style={{ color: 'var(--suave)' }}>{rotulo}</p>
      <p className="tabular text-xl font-semibold" style={{ color: destaque ? 'var(--acento)' : undefined }}>
        {valor}
      </p>
    </div>
  );
}

/**
 * Histórico de importações com desfazer.
 *
 * Antes disto, a única forma de corrigir um import errado era apagar a base
 * inteira — perdendo junto tudo que estava certo. Aconteceu duas vezes numa
 * sessão só. Desfazer barato é o que permite importar sem medo.
 */
function Historico({ recarregar }: { recarregar: number }) {
  const [itens, setItens] = useState<Importacao[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setItens(await listarImportacoes()); } catch { /* tabela pode não existir ainda */ }
  }, []);

  useEffect(() => { carregar(); }, [carregar, recarregar]);

  async function desfazer(id: string) {
    setOcupado(id); setMsg(null);
    try {
      const r = await desfazerImportacao(id);
      setMsg(`${r.apagadas} lançamento(s) removido(s).`);
      await carregar();
    } catch (e) {
      setMsg(explicarErro(e));
    } finally {
      setOcupado(null);
    }
  }

  const ativos = itens.filter((i) => !i.desfeita_em);
  if (ativos.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="rotulo mb-2">Importações recentes</h2>
      <div className="painel overflow-hidden">
        {ativos.map((i) => (
          <div key={i.execucao_id}
               className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-3 first:border-t-0"
               style={{ borderColor: 'var(--borda)' }}>
            <span className="text-sm font-medium">{i.arquivo ?? i.fonte}</span>
            <span className="text-xs" style={{ color: 'var(--suave)' }}>
              {new Date(i.iniciado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              {' · '}{i.linhas_novas} novo(s){i.linhas_dup > 0 && `, ${i.linhas_dup} já existia(m)`}
            </span>
            <button
              onClick={() => desfazer(i.execucao_id)}
              disabled={ocupado === i.execucao_id || i.linhas_novas === 0}
              className="nao-imprimir ml-auto text-xs underline disabled:opacity-40"
              style={{ color: 'var(--negativo)' }}
            >
              {ocupado === i.execucao_id ? 'desfazendo…'
                : i.linhas_novas === 0 ? 'nada a desfazer' : 'desfazer'}
            </button>
          </div>
        ))}
      </div>
      {msg && <p className="mt-2 text-xs" style={{ color: 'var(--suave)' }}>{msg}</p>}
    </section>
  );
}

/**
 * Apagar tudo fica atrás de uma confirmação digitada de propósito.
 * Um clique acidental aqui apaga o histórico inteiro e não há backup.
 */
function ZonaPerigo({ onLimpou }: { onLimpou: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function limpar() {
    setOcupado(true);
    try {
      const r = await limparBase();
      setMsg(`${r.apagadas} lançamento(s) apagado(s). Contas, categorias e regras foram mantidas.`);
      setTexto(''); setAberto(false); onLimpou();
    } catch (e) {
      setMsg(explicarErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border p-4"
             style={{ borderColor: 'var(--perigo-borda)', background: 'var(--perigo-fundo)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--perigo-texto)' }}>Limpar a base</p>
          <p className="text-xs" style={{ color: 'var(--perigo-texto)' }}>
            Apaga todos os lançamentos e saldos. Contas, categorias e regras continuam.
            Não há backup.
          </p>
        </div>
        {!aberto && (
          <button onClick={() => { setAberto(true); setMsg(null); }}
                  className="rounded-lg border bg-white px-3 py-1.5 text-sm"
                  style={{ borderColor: 'var(--perigo-borda)', color: 'var(--perigo-texto)' }}>
            Limpar…
          </button>
        )}
      </div>

      {aberto && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs" style={{ color: 'var(--perigo-texto)' }}>
            Digite <strong>LIMPAR</strong> para confirmar:
          </label>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="rounded-md border bg-white px-2 py-1 text-sm"
            style={{ borderColor: 'var(--perigo-borda)' }}
          />
          <button
            onClick={limpar}
            disabled={texto !== 'LIMPAR' || ocupado}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: 'var(--negativo)' }}
          >
            {ocupado ? 'Apagando…' : 'Apagar tudo'}
          </button>
          <button onClick={() => { setAberto(false); setTexto(''); }}
                  className="text-sm underline" style={{ color: 'var(--perigo-texto)' }}>
            cancelar
          </button>
        </div>
      )}

      {msg && <p className="mt-2 text-xs" style={{ color: 'var(--perigo-texto)' }}>{msg}</p>}
    </section>
  );
}
