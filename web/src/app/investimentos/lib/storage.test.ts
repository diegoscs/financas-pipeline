/**
 * Testes de `storage.ts`.
 *
 *   npx tsx src/app/investimentos/lib/storage.test.ts
 *
 * O que importa aqui não é o localStorage — é o `normalizar`. Ele é o portão
 * por onde entra dado de fora: JSON que esteve no disco de um navegador,
 * editável à mão, escrito por uma versão anterior do código. Um `undefined`
 * que passe daqui vira `NaN` três telas adiante, num gráfico, sem erro.
 */
import assert from 'node:assert/strict';
import { LocalStorageAdapter, PREMISSAS_PADRAO, estadoVazio, normalizar } from './storage';

let passou = 0;
const falhas: string[] = [];
function teste(nome: string, f: () => void | Promise<void>) {
  try {
    const r = f();
    if (r instanceof Promise) throw new Error('use testeAsync');
    passou++;
  } catch (e) { falhas.push(`${nome}\n    ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`); }
}
const pendentes: Promise<void>[] = [];
function testeAsync(nome: string, f: () => Promise<void>) {
  pendentes.push(
    f().then(() => { passou++; })
       .catch((e: Error) => { falhas.push(`${nome}\n    ${e.message.split('\n').slice(0, 3).join(' ')}`); }),
  );
}

// ── estado vazio ───────────────────────────────────────────────────────────

teste('estado vazio começa sem ativo e com as premissas padrão', () => {
  const s = estadoVazio();
  assert.deepEqual(s.ativos, []);
  assert.deepEqual(s.lancamentos, []);
  assert.equal(s.premissas.gasto, PREMISSAS_PADRAO.gasto);
});

teste('estado vazio não compartilha as premissas com o padrão', () => {
  // Se devolvesse a mesma referência, editar o gasto numa sessão mudaria o
  // padrão do módulo inteiro em memória.
  const s = estadoVazio();
  s.premissas.gasto = 99;
  assert.equal(PREMISSAS_PADRAO.gasto, 1700);
});

// ── entrada inválida ───────────────────────────────────────────────────────

teste('lixo no lugar do estado vira estado vazio', () => {
  for (const entrada of [null, undefined, 42, 'texto', [], true]) {
    const s = normalizar(entrada);
    assert.deepEqual(s.ativos, [], `falhou para ${JSON.stringify(entrada)}`);
    assert.equal(s.premissas.gasto, PREMISSAS_PADRAO.gasto);
  }
});

teste('ativo sem id ou sem nome é descartado', () => {
  const s = normalizar({ ativos: [
    { id: '', nome: 'Sem id', classe: 'fii', modo: 'saldo' },
    { id: 'ok', nome: '', classe: 'fii', modo: 'saldo' },
    { id: 'bom', nome: 'Bom', classe: 'fii', modo: 'saldo' },
  ] });
  assert.equal(s.ativos.length, 1);
  assert.equal(s.ativos[0].id, 'bom');
});

teste('id repetido não cria dois ativos disputando a mesma posição', () => {
  const s = normalizar({ ativos: [
    { id: 'x', nome: 'Primeiro', classe: 'fii', modo: 'saldo' },
    { id: 'x', nome: 'Segundo', classe: 'acao', modo: 'cotizado' },
  ] });
  assert.equal(s.ativos.length, 1);
  assert.equal(s.ativos[0].nome, 'Primeiro');
});

teste('classe e modo inválidos caem no padrão em vez de vazar', () => {
  const s = normalizar({ ativos: [
    { id: 'x', nome: 'X', classe: 'imovel', modo: 'chutometro' },
  ] });
  assert.equal(s.ativos[0].classe, 'renda_fixa');
  assert.equal(s.ativos[0].modo, 'saldo');
});

// ── lançamentos ────────────────────────────────────────────────────────────

teste('competência fora do formato YYYY-MM é descartada', () => {
  const s = normalizar({ lancamentos: [
    { competencia: '2026-13', itens: {} },
    { competencia: '26-10', itens: {} },
    { competencia: '2026-00', itens: {} },
    { competencia: 'outubro', itens: {} },
    { competencia: '2026-10', itens: {} },
  ] });
  assert.equal(s.lancamentos.length, 1);
  assert.equal(s.lancamentos[0].competencia, '2026-10');
});

teste('competência repetida: vale a última, um mês é um fechamento só', () => {
  const s = normalizar({ lancamentos: [
    { competencia: '2026-10', itens: { a: { aporte: 100, saldo: 1000 } } },
    { competencia: '2026-10', itens: { a: { aporte: 200, saldo: 2000 } } },
  ] });
  assert.equal(s.lancamentos.length, 1);
  assert.equal(s.lancamentos[0].itens.a.saldo, 2000);
});

teste('lançamentos saem ordenados por competência', () => {
  const s = normalizar({ lancamentos: [
    { competencia: '2027-01', itens: {} },
    { competencia: '2026-10', itens: {} },
    { competencia: '2026-12', itens: {} },
  ] });
  assert.deepEqual(s.lancamentos.map((l) => l.competencia), ['2026-10', '2026-12', '2027-01']);
});

teste('aporte inválido vira 0; saldo inválido vira ausente', () => {
  // A diferença importa: aporte é obrigatório na conta do rendimento, então
  // 0 é a resposta certa. Saldo ausente é diferente de saldo zero — zero
  // significaria "sacou tudo".
  const s = normalizar({ lancamentos: [
    { competencia: '2026-10', itens: { a: { aporte: 'muito', saldo: NaN, cotas: null, preco: Infinity } } },
  ] });
  const it = s.lancamentos[0].itens.a;
  assert.equal(it.aporte, 0);
  assert.equal(it.saldo, undefined);
  assert.equal(it.cotas, undefined);
  assert.equal(it.preco, undefined);
});

teste('valor negativo passa: saque e prejuízo existem', () => {
  const s = normalizar({ lancamentos: [
    { competencia: '2026-10', itens: { a: { aporte: -500, saldo: 1000 } } },
  ] });
  assert.equal(s.lancamentos[0].itens.a.aporte, -500);
});

// ── premissas ──────────────────────────────────────────────────────────────

teste('premissa que falta vem do padrão, não vem undefined', () => {
  // É o caso de um estado gravado antes de o campo existir. Sem o merge, a
  // projeção inteira sairia NaN sem uma única exceção no caminho.
  const s = normalizar({ premissas: { gasto: 2000 } });
  assert.equal(s.premissas.gasto, 2000);
  assert.equal(s.premissas.cdi2026, PREMISSAS_PADRAO.cdi2026);
  assert.equal(s.premissas.retornoAcoes, PREMISSAS_PADRAO.retornoAcoes);
  for (const v of Object.values(s.premissas)) {
    assert.ok(typeof v === 'object' || Number.isFinite(v), 'nenhuma premissa pode ser NaN');
  }
});

teste('premissa com lixo cai no padrão', () => {
  const s = normalizar({ premissas: { gasto: 'mil e setecentos', ir: null, cdi2026: NaN } });
  assert.equal(s.premissas.gasto, PREMISSAS_PADRAO.gasto);
  assert.equal(s.premissas.ir, PREMISSAS_PADRAO.ir);
  assert.equal(s.premissas.cdi2026, PREMISSAS_PADRAO.cdi2026);
});

teste('gasto zero é escolha válida e não cai no padrão', () => {
  assert.equal(normalizar({ premissas: { gasto: 0 } }).premissas.gasto, 0);
});

teste('13º vazio é "não tenho 13º", não "use o padrão"', () => {
  const s = normalizar({ premissas: { decimoTerceiro: {} } });
  assert.deepEqual(s.premissas.decimoTerceiro, {});
});

teste('13º ausente traz o padrão', () => {
  const s = normalizar({ premissas: { gasto: 1 } });
  assert.deepEqual(s.premissas.decimoTerceiro, PREMISSAS_PADRAO.decimoTerceiro);
});

teste('13º com competência inválida é descartado', () => {
  const s = normalizar({ premissas: { decimoTerceiro: { 'nov/26': 1625, '2026-12': 1346 } } });
  assert.deepEqual(s.premissas.decimoTerceiro, { '2026-12': 1346 });
});

// ── adapter local ──────────────────────────────────────────────────────────

/** localStorage de mentira, para rodar o adapter fora do navegador. */
function janelaFalsa(inicial: Record<string, string> = {}, falharAoGravar = false) {
  const dados = new Map(Object.entries(inicial));
  return {
    localStorage: {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (falharAoGravar) throw new Error('QuotaExceededError');
        dados.set(k, v);
      },
    },
    dados,
  };
}

function comJanela<T>(janela: unknown, f: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const antes = g.window;
  g.window = janela;
  try { return f(); } finally { g.window = antes; }
}

testeAsync('sem window (render no servidor) devolve estado vazio', async () => {
  const s = await new LocalStorageAdapter('t').load();
  assert.deepEqual(s.ativos, []);
});

testeAsync('grava e lê de volta', async () => {
  const j = janelaFalsa();
  const adapter = new LocalStorageAdapter('t');
  const estado = { ...estadoVazio(), ativos: [{ id: 'a', nome: 'A', classe: 'fii' as const, modo: 'saldo' as const }] };

  await comJanela(j, () => adapter.save(estado));
  const lido = await comJanela(j, () => adapter.load());
  assert.equal(lido.ativos.length, 1);
  assert.equal(lido.ativos[0].nome, 'A');
});

testeAsync('JSON corrompido abre vazio em vez de travar a tela', async () => {
  const j = janelaFalsa({ t: '{isso não é json' });
  const s = await comJanela(j, () => new LocalStorageAdapter('t').load());
  assert.deepEqual(s.ativos, []);
  assert.equal(s.premissas.gasto, PREMISSAS_PADRAO.gasto);
});

testeAsync('chave ausente abre vazio', async () => {
  const j = janelaFalsa();
  const s = await comJanela(j, () => new LocalStorageAdapter('t').load());
  assert.deepEqual(s.lancamentos, []);
});

testeAsync('falha de escrita SOBE, não fica silenciosa', async () => {
  // Leitura tem fallback honesto; escrita não pode ter. Dizer "salvo" sobre
  // dado que o usuário vai perder ao recarregar é pior que dar erro.
  const j = janelaFalsa({}, true);
  await assert.rejects(
    () => comJanela(j, () => new LocalStorageAdapter('t').save(estadoVazio())),
    /Não consegui salvar/,
  );
});

// ── saída ──────────────────────────────────────────────────────────────────

Promise.all(pendentes).then(() => {
  console.log(`${passou} passou · ${falhas.length} falhou`);
  if (falhas.length) {
    console.log('── falhas ──');
    for (const f of falhas) console.log('  ✗ ' + f);
    process.exit(1);
  }
});
