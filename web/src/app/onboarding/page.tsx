'use client';

/**
 * Onboarding: o que o app precisa saber antes de mostrar qualquer número.
 *
 * Três perguntas, nesta ordem, porque cada uma depende da anterior:
 *   1. Quais contas e cartões — e, do cartão, quando fecha e quando vence.
 *   2. Onde o dinheiro fica guardado e a quantos por cento do CDI.
 *   3. O que tem em bolsa.
 *
 * Perguntar o fechamento e o vencimento é o que evita deduzir a competência a
 * partir do arquivo. Hoje ela sai do período dos lançamentos e às vezes erra;
 * com os dois dias informados, a conta é determinística.
 *
 * Nenhum passo é obrigatório. Quem não investe pula o passo 3 e o app funciona
 * igual — exigir preenchimento para prosseguir é a forma mais rápida de fazer
 * alguém abandonar a instalação.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Marca } from '@/components/Marca';
import { listarBancos, rotuloBanco } from '@/lib/bancos';
import { explicarErro } from '@/lib/erro';
import { dinheiro } from '@/lib/formato';
import {
  carregarPerfil, concluirOnboarding, criarConta, listarContas, marcoZeroNecessario,
  proximoVencimento, removerConta, type ContaConfig,
} from '@/lib/perfil';
import {
  palpitarTipo, removerAtivo, ROTULO_TIPO, salvarPosicao, TICKER_VALIDO,
  type TipoAtivo,
} from '@/lib/carteira';
import { supabase } from '@/lib/supabase';

type Passo = 0 | 1 | 2 | 3 | 4;

const PASSOS = ['Boas-vindas', 'Contas e cartões', 'Onde você guarda', 'Bolsa', 'Marco zero'];

interface AtivoLinha { id: number; ticker: string; tipo: TipoAtivo; quantidade: number; preco_medio: number }

export default function Onboarding() {
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>(0);
  const [nome, setNome] = useState('');
  const [contas, setContas] = useState<ContaConfig[]>([]);
  const [ativos, setAtivos] = useState<AtivoLinha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      const [p, cs, as_] = await Promise.all([
        carregarPerfil(),
        listarContas(),
        supabase.from('ativos').select('id,ticker,tipo,posicoes(quantidade,preco_medio)'),
      ]);
      if (p?.nome) setNome(p.nome);
      setContas(cs);
      setAtivos(((as_.data ?? []) as unknown[]).map((r) => {
        const x = r as { id: number; ticker: string; tipo: TipoAtivo;
                         posicoes: { quantidade: string; preco_medio: string }[] | null };
        const pos = Array.isArray(x.posicoes) ? x.posicoes[0] : undefined;
        return {
          id: x.id, ticker: x.ticker, tipo: x.tipo,
          quantidade: Number(pos?.quantidade ?? 0), preco_medio: Number(pos?.preco_medio ?? 0),
        };
      }));
    } catch (e) { setErro(explicarErro(e)); }
    setCarregando(false);
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  async function finalizar() {
    setSalvando(true); setErro(null);
    try {
      // A data que o passo 4 mostrou, não `hoje`: é dela que o app passa a medir.
      await concluirOnboarding(nome, marcoZeroNecessario(contas).desde);
      router.push('/');
    } catch (e) { setErro(explicarErro(e)); setSalvando(false); }
  }

  if (carregando) return <p style={{ color: 'var(--suave)' }}>Carregando…</p>;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-xs">
        {PASSOS.map((r, i) => (
          <li key={r} className="flex items-center gap-2">
            <span className="rounded-full px-2.5 py-1 font-medium"
                  style={{
                    background: i === passo ? 'var(--acento)' : i < passo ? '#e7f0fb' : '#eef0f4',
                    color: i === passo ? '#fff' : i < passo ? '#1d4ed8' : 'var(--suave)',
                  }}>
              {i < passo ? '✓' : i + 1}
            </span>
            <span style={{ color: i === passo ? undefined : 'var(--suave)' }}>{r}</span>
          </li>
        ))}
      </ol>

      {erro && (
        <p role="alert" className="rounded-lg border px-4 py-3 text-sm"
           style={{ borderColor: 'var(--perigo-borda)', background: 'var(--perigo-fundo)', color: 'var(--perigo-texto)' }}>
          {erro}
        </p>
      )}

      {passo === 0 && <BoasVindas nome={nome} setNome={setNome} onSeguir={() => setPasso(1)} />}

      {passo === 1 && (
        <Contas contas={contas} recarregar={recarregar} setErro={setErro}
                onVoltar={() => setPasso(0)} onSeguir={() => setPasso(2)} />
      )}

      {passo === 2 && (
        <Reservas contas={contas} recarregar={recarregar} setErro={setErro}
                  onVoltar={() => setPasso(1)} onSeguir={() => setPasso(3)} />
      )}

      {passo === 3 && (
        <Bolsa ativos={ativos} recarregar={recarregar} setErro={setErro}
               onVoltar={() => setPasso(2)} onFinalizar={() => setPasso(4)} salvando={false} />
      )}

      {passo === 4 && (
        <MarcoZero contas={contas} onVoltar={() => setPasso(3)}
                   onFinalizar={finalizar} salvando={salvando} />
      )}
    </div>
  );
}

// ── passo 0 ────────────────────────────────────────────────────────────────

function BoasVindas({ nome, setNome, onSeguir }: {
  nome: string; setNome: (v: string) => void; onSeguir: () => void;
}) {
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  return (
    <div className="painel-destaque space-y-5 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vamos começar do zero</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--suave)' }}>
          A partir de hoje, {hoje}, este app passa a medir seu dinheiro. Nada de antes
          entra na conta — a ideia é que todo número na tela tenha vindo do fluxo real,
          não de uma carga manual.
        </p>
      </div>

      <div className="rounded-lg border px-4 py-3 text-sm"
           style={{ borderColor: 'var(--borda)', background: '#fafbfc', color: 'var(--suave)' }}>
        Três perguntas rápidas: quais contas você tem, onde guarda dinheiro e o que tem em
        bolsa. Dá para pular qualquer uma e preencher depois.
      </div>

      <label className="block">
        <span className="rotulo">Como te chamo?</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome"
               className="mt-1 w-full max-w-xs border px-3 py-2 text-sm"
               style={{ borderColor: 'var(--borda-forte)' }} />
      </label>

      <button onClick={onSeguir} className="btn btn-principal">Começar</button>
    </div>
  );
}

// ── passo 1 ────────────────────────────────────────────────────────────────

function Contas({ contas, recarregar, setErro, onVoltar, onSeguir }: {
  contas: ContaConfig[]; recarregar: () => Promise<void>;
  setErro: (v: string | null) => void; onVoltar: () => void; onSeguir: () => void;
}) {
  const [instituicao, setInstituicao] = useState('nubank');
  const [tipo, setTipo] = useState<'corrente' | 'cartao'>('corrente');
  const [fecha, setFecha] = useState('');
  const [vence, setVence] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const relevantes = contas.filter((c) => c.tipo === 'corrente' || c.tipo === 'cartao');

  async function adicionar() {
    setOcupado(true); setErro(null);
    try {
      await criarConta({
        nome: `${rotuloBanco(instituicao)} ${tipo === 'cartao' ? 'Cartão' : 'Conta'}`,
        instituicao, tipo,
        dia_fechamento: tipo === 'cartao' && fecha ? Number(fecha) : null,
        dia_vencimento: tipo === 'cartao' && vence ? Number(vence) : null,
      });
      setFecha(''); setVence('');
      await recarregar();
    } catch (e) { setErro(explicarErro(e)); }
    setOcupado(false);
  }

  const cartaoIncompleto = tipo === 'cartao' && (!fecha || !vence);

  return (
    <div className="space-y-5">
      <Cabecalho titulo="Quais contas e cartões você usa?"
                 texto="Do cartão eu preciso de dois dias: quando a fatura fecha e quando vence. É o que
                        permite dizer com certeza a que mês uma compra pertence, em vez de eu deduzir pelo
                        arquivo e às vezes errar." />

      <div className="painel space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="rotulo">Banco</span>
            <select value={instituicao} onChange={(e) => setInstituicao(e.target.value)}
                    className="mt-1 w-full border bg-white px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--borda-forte)' }}>
              {listarBancos().map((b) => <option key={b} value={b}>{rotuloBanco(b)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="rotulo">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as 'corrente' | 'cartao')}
                    className="mt-1 w-full border bg-white px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--borda-forte)' }}>
              <option value="corrente">Conta corrente</option>
              <option value="cartao">Cartão de crédito</option>
            </select>
          </label>
        </div>

        {tipo === 'cartao' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="rotulo">Dia em que a fatura fecha</span>
              <input type="number" min={1} max={31} value={fecha} onChange={(e) => setFecha(e.target.value)}
                     placeholder="ex: 3" className="mt-1 w-full border px-3 py-2 text-sm"
                     style={{ borderColor: 'var(--borda-forte)' }} />
            </label>
            <label className="block">
              <span className="rotulo">Dia do vencimento</span>
              <input type="number" min={1} max={31} value={vence} onChange={(e) => setVence(e.target.value)}
                     placeholder="ex: 10" className="mt-1 w-full border px-3 py-2 text-sm"
                     style={{ borderColor: 'var(--borda-forte)' }} />
            </label>
          </div>
        )}

        {tipo === 'cartao' && fecha && vence && (
          <PreviaCiclo fecha={Number(fecha)} vence={Number(vence)} />
        )}

        <button onClick={adicionar} disabled={ocupado || cartaoIncompleto}
                className="btn btn-neutro disabled:opacity-40">
          Adicionar
        </button>
      </div>

      {relevantes.length > 0 && (
        <div className="painel overflow-hidden">
          {relevantes.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                 style={{ borderColor: 'var(--borda)' }}>
              <Marca instituicao={c.instituicao} tamanho={22} />
              <span className="flex-1 text-[15px]">{c.nome}</span>
              {c.tipo === 'cartao' && c.dia_fechamento && c.dia_vencimento && (
                <span className="text-xs" style={{ color: 'var(--suave)' }}>
                  fecha dia {c.dia_fechamento} · vence dia {c.dia_vencimento}
                </span>
              )}
              <button onClick={async () => {
                setErro(null);
                try { await removerConta(c.id); await recarregar(); }
                catch (e) { setErro(explicarErro(e)); }
              }} className="text-xs underline" style={{ color: 'var(--suave)' }}>
                remover
              </button>
            </div>
          ))}
        </div>
      )}

      <Navegacao onVoltar={onVoltar} onSeguir={onSeguir}
                 rotulo={relevantes.length === 0 ? 'Pular' : 'Continuar'} />
    </div>
  );
}

/** Mostra o ciclo resolvido: é a checagem mais barata de que os dias fazem sentido. */
function PreviaCiclo({ fecha, vence }: { fecha: number; vence: number }) {
  const { fecha: f, vence: v } = proximoVencimento(new Date(), fecha, vence);
  const br = (iso: string) => iso.split('-').reverse().join('/');
  return (
    <p className="rounded-lg px-3 py-2 text-xs" style={{ background: '#f2f4f7', color: 'var(--suave)' }}>
      A fatura aberta agora fecha em <strong>{br(f)}</strong> e vence em <strong>{br(v)}</strong>.
      Compras feitas depois do fechamento caem na fatura seguinte.
    </p>
  );
}

// ── passo 2 ────────────────────────────────────────────────────────────────

function Reservas({ contas, recarregar, setErro, onVoltar, onSeguir }: {
  contas: ContaConfig[]; recarregar: () => Promise<void>;
  setErro: (v: string | null) => void; onVoltar: () => void; onSeguir: () => void;
}) {
  const [instituicao, setInstituicao] = useState('nubank');
  const [nome, setNome] = useState('Caixinha');
  const [cdi, setCdi] = useState('100');
  const [ocupado, setOcupado] = useState(false);

  const reservas = contas.filter((c) => c.tipo === 'investimento');

  async function adicionar() {
    setOcupado(true); setErro(null);
    try {
      await criarConta({
        nome: nome.trim() || 'Reserva', instituicao, tipo: 'investimento',
        percentual_cdi: cdi ? Number(cdi) / 100 : null,
      });
      await recarregar();
    } catch (e) { setErro(explicarErro(e)); }
    setOcupado(false);
  }

  return (
    <div className="space-y-5">
      <Cabecalho titulo="Onde você guarda dinheiro?"
                 texto="Caixinha do Nubank, reserva do Santander, conta de corretora — qualquer lugar que
                        renda. Com o percentual do CDI eu projeto quanto aquele saldo rende por mês, usando a
                        taxa oficial do Banco Central." />

      <div className="painel space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="rotulo">Banco</span>
            <select value={instituicao} onChange={(e) => setInstituicao(e.target.value)}
                    className="mt-1 w-full border bg-white px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--borda-forte)' }}>
              {listarBancos().map((b) => <option key={b} value={b}>{rotuloBanco(b)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="rotulo">Como você chama</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)}
                   className="mt-1 w-full border px-3 py-2 text-sm"
                   style={{ borderColor: 'var(--borda-forte)' }} />
          </label>
          <label className="block">
            <span className="rotulo">Rende quantos % do CDI</span>
            <input type="number" min={1} value={cdi} onChange={(e) => setCdi(e.target.value)}
                   className="mt-1 w-full border px-3 py-2 text-sm"
                   style={{ borderColor: 'var(--borda-forte)' }} />
          </label>
        </div>
        <p className="text-xs" style={{ color: 'var(--suave)' }}>
          A caixinha do Nubank rende 100% do CDI. Se não souber, deixe 100 — dá para corrigir depois.
        </p>
        <button onClick={adicionar} disabled={ocupado} className="btn btn-neutro disabled:opacity-40">
          Adicionar
        </button>
      </div>

      {reservas.length > 0 && (
        <div className="painel overflow-hidden">
          {reservas.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                 style={{ borderColor: 'var(--borda)' }}>
              <Marca instituicao={c.instituicao} tamanho={22} />
              <span className="flex-1 text-[15px]">{c.nome}</span>
              <span className="text-xs" style={{ color: 'var(--suave)' }}>
                {c.percentual_cdi ? `${(c.percentual_cdi * 100).toFixed(0)}% do CDI` : 'sem taxa'}
              </span>
              <button onClick={async () => {
                setErro(null);
                try { await removerConta(c.id); await recarregar(); }
                catch (e) { setErro(explicarErro(e)); }
              }} className="text-xs underline" style={{ color: 'var(--suave)' }}>
                remover
              </button>
            </div>
          ))}
        </div>
      )}

      <Navegacao onVoltar={onVoltar} onSeguir={onSeguir}
                 rotulo={reservas.length === 0 ? 'Pular' : 'Continuar'} />
    </div>
  );
}

// ── passo 3 ────────────────────────────────────────────────────────────────

function Bolsa({ ativos, recarregar, setErro, onVoltar, onFinalizar, salvando }: {
  ativos: AtivoLinha[]; recarregar: () => Promise<void>; setErro: (v: string | null) => void;
  onVoltar: () => void; onFinalizar: () => void; salvando: boolean;
}) {
  const [ticker, setTicker] = useState('');
  const [qtd, setQtd] = useState('');
  const [pm, setPm] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const t = ticker.trim().toUpperCase();
  const valido = TICKER_VALIDO.test(t) && Number(qtd) > 0 && Number(pm) > 0;

  async function adicionar() {
    setOcupado(true); setErro(null);
    try {
      await salvarPosicao(t, palpitarTipo(t), Number(qtd), Number(pm), null);
      setTicker(''); setQtd(''); setPm('');
      await recarregar();
    } catch (e) { setErro(explicarErro(e)); }
    setOcupado(false);
  }

  const investido = ativos.reduce((a, x) => a + x.quantidade * x.preco_medio, 0);

  return (
    <div className="space-y-5">
      <Cabecalho titulo="O que você tem em bolsa?"
                 texto="Ticker, quantidade e preço médio. A cotação eu busco sozinho — o resto precisa ser
                        digitado, porque não existe forma gratuita de ler a sua carteira na corretora." />

      <div className="painel space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="rotulo">Ticker</span>
            <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())}
                   placeholder="MXRF11" className="mt-1 w-full border px-3 py-2 text-sm uppercase"
                   style={{ borderColor: 'var(--borda-forte)' }} />
            {t && !TICKER_VALIDO.test(t) && (
              <span className="mt-1 block text-xs" style={{ color: 'var(--negativo)' }}>
                Formato da B3: quatro letras e um ou dois números, como PETR4 ou MXRF11.
              </span>
            )}
            {t && TICKER_VALIDO.test(t) && (
              <span className="mt-1 block text-xs" style={{ color: 'var(--suave)' }}>
                Reconhecido como {ROTULO_TIPO[palpitarTipo(t)]}
              </span>
            )}
          </label>
          <label className="block">
            <span className="rotulo">Quantidade</span>
            <input type="number" min={0} step="any" value={qtd} onChange={(e) => setQtd(e.target.value)}
                   placeholder="400" className="mt-1 w-full border px-3 py-2 text-sm"
                   style={{ borderColor: 'var(--borda-forte)' }} />
          </label>
          <label className="block">
            <span className="rotulo">Preço médio</span>
            <input type="number" min={0} step="any" value={pm} onChange={(e) => setPm(e.target.value)}
                   placeholder="9,80" className="mt-1 w-full border px-3 py-2 text-sm"
                   style={{ borderColor: 'var(--borda-forte)' }} />
          </label>
        </div>
        <button onClick={adicionar} disabled={ocupado || !valido}
                className="btn btn-neutro disabled:opacity-40">
          Adicionar
        </button>
      </div>

      {ativos.length > 0 && (
        <>
          <div className="painel overflow-hidden">
            {ativos.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                   style={{ borderColor: 'var(--borda)' }}>
                <span className="font-medium">{a.ticker}</span>
                <span className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{ background: '#eef0f4', color: 'var(--suave)' }}>
                  {ROTULO_TIPO[a.tipo]}
                </span>
                <span className="flex-1 text-sm" style={{ color: 'var(--suave)' }}>
                  {a.quantidade} × {dinheiro(a.preco_medio)}
                </span>
                <span className="tabular text-[15px] font-semibold">
                  {dinheiro(a.quantidade * a.preco_medio)}
                </span>
                <button onClick={async () => {
                  setErro(null);
                  try { await removerAtivo(a.id); await recarregar(); }
                  catch (e) { setErro(explicarErro(e)); }
                }} className="text-xs underline" style={{ color: 'var(--suave)' }}>
                  remover
                </button>
              </div>
            ))}
          </div>
          <p className="text-sm" style={{ color: 'var(--suave)' }}>
            Investido pelo preço médio: <strong>{dinheiro(investido)}</strong>
          </p>
        </>
      )}

      <div className="flex items-center gap-3">
        <button onClick={onVoltar} className="btn btn-neutro">Voltar</button>
        <button onClick={onFinalizar} disabled={salvando} className="btn btn-principal disabled:opacity-40">
          Continuar
        </button>
      </div>
    </div>
  );
}

// ── passo 4 ────────────────────────────────────────────────────────────────

/**
 * O passo que responde "de quando eu preciso de dado?".
 *
 * Sem ele o usuário começa hoje, e no dia do vencimento sai um pagamento de
 * fatura da conta sem nenhuma compra que o explique — dinheiro sumindo sem
 * motivo visível. A conta é feita a partir do fechamento e do vencimento que
 * ele acabou de informar; é o retorno de ter perguntado.
 */
function MarcoZero({ contas, onVoltar, onFinalizar, salvando }: {
  contas: ContaConfig[]; onVoltar: () => void; onFinalizar: () => void; salvando: boolean;
}) {
  const marco = marcoZeroNecessario(contas);
  const br = (i: string) => i.split('-').reverse().join('/');
  const mes = new Date(`${marco.desde}T12:00:00`)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-5">
      <Cabecalho titulo="De quando eu preciso de dado"
                 texto="A fatura que você ainda vai pagar cobre compras que já aconteceram. Se eu começar
                        exatamente hoje, o pagamento dela sai da sua conta sem nenhuma compra que o
                        explique — e o gasto que gerou aquela fatura fica invisível." />

      <div className="painel-destaque p-6">
        <p className="rotulo">Importe a partir de</p>
        <p className="mt-1 text-[2.5rem] font-semibold capitalize leading-none tracking-tight">{mes}</p>
        <p className="mt-2 text-sm" style={{ color: 'var(--suave)' }}>
          Mais precisamente, desde <strong>{br(marco.desde)}</strong>.
        </p>
      </div>

      {marco.ciclos.length > 0 ? (
        <>
          <div className="painel overflow-hidden">
            {marco.ciclos.map((c) => (
              <div key={c.contaId} className="flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0"
                   style={{ borderColor: 'var(--borda)' }}>
                <Marca instituicao={c.instituicao} tamanho={22} />
                <span className="flex-1 text-[15px]">{c.nome}</span>
                <span className="text-sm" style={{ color: 'var(--suave)' }}>
                  compras desde {br(c.desde)}
                </span>
                <span className="text-sm font-medium">vence {br(c.vence)}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg border px-4 py-3 text-sm"
               style={{ borderColor: 'var(--borda)', background: '#fafbfc', color: 'var(--suave)' }}>
            <p className="mb-2 font-medium" style={{ color: 'var(--texto)' }}>O que baixar:</p>
            <ul className="space-y-1">
              <li>· A fatura em aberto de cada cartão acima — é ela que você vai pagar.</li>
              <li>· O extrato da conta corrente desde {br(marco.desde)}, onde estão os Pix.</li>
            </ul>
            <p className="mt-2">
              Fatura já paga antes de {br(marco.desde)} não precisa: a compra e o pagamento
              aconteceram os dois fora da janela, então nada fica pendurado.
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm" style={{ color: 'var(--suave)' }}>
          Sem cartão cadastrado, não há ciclo deslocado para acomodar — comece pelo extrato
          do mês corrente.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button onClick={onVoltar} className="btn btn-neutro">Voltar</button>
        <button onClick={onFinalizar} disabled={salvando} className="btn btn-principal disabled:opacity-40">
          {salvando ? 'Salvando…' : 'Concluir e importar'}
        </button>
      </div>
    </div>
  );
}

// ── comuns ─────────────────────────────────────────────────────────────────

function Cabecalho({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
      <p className="mt-1.5 max-w-2xl text-sm" style={{ color: 'var(--suave)' }}>{texto}</p>
    </div>
  );
}

function Navegacao({ onVoltar, onSeguir, rotulo }: {
  onVoltar: () => void; onSeguir: () => void; rotulo: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onVoltar} className="btn btn-neutro">Voltar</button>
      <button onClick={onSeguir} className="btn btn-principal">{rotulo}</button>
    </div>
  );
}
