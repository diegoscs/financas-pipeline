# Pipeline de Finanças Pessoais

Pipeline de dados que consolida transações de cartão e conta (Nubank + Itaú),
rastreia Pix e dinheiro, categoriza automaticamente e responde com precisão
**quanto gastei e quanto guardei** por mês.

Também é projeto de portfólio de engenharia de dados. Decisões devem ser
defensáveis em entrevista, não apenas funcionais.

## Stack

Next.js 15 (App Router, TypeScript) na Vercel · Supabase (Postgres + Auth) · Tailwind 4

O parse roda **no navegador**: o arquivo vira linha de tabela sem passar por
servidor nosso. Foi o que permitiu sair da Vercel Functions, cujo limite de
4,5 MB de payload não cabia fatura grande.

A primeira versão era CLI em Python com dbt e Metabase. Está em `legado/`, não
roda mais, e o README de lá explica o que foi portado e o que se perdeu.

## Restrições do projeto

- **Sem API bancária.** Toda coleta é por arquivo exportado manualmente (OFX/XLSX).
  Não sugerir `pynubank` nem scraping — foi descartado deliberadamente.
- **Sem PDF.** Fatura em PDF foi descartada: layout muda e o parser quebra.
- **Tudo em free tier.** Nenhuma dependência paga.
- O pipeline é **orientado a upload**, não agendado. O gatilho é o arquivo chegar
  no bucket bronze; o GitHub Actions faz polling horário.

---

## Convenções invioláveis

Estas regras já causaram bug ou foram validadas contra dados reais. Não alterar
sem discutir.

### 1. Sinal do valor

```
valor > 0  =>  entrada de dinheiro
valor < 0  =>  saída de dinheiro
```

Nunca criar coluna separada de débito/crédito.

**A planilha do Itaú usa a convenção INVERTIDA** (compras positivas, pagamentos
negativos). O parser multiplica por `-1`. Não "corrigir" isso.

### 2. Cartão de crédito é passivo

Snapshot de saldo de conta tipo `cartao` é lançado **negativo**. O `LEDGERBAL`
do OFX do Nubank já vem negativo — está correto como está.

### 3. Transferência interna não é gasto

`eh_interna = true` para: pagamento de fatura, transferência entre contas do
próprio usuário, aporte em investimento. As views de fluxo filtram por isso.

**Pagamento de fatura é o erro clássico**: se contado como despesa, os gastos
do cartão são contados duas vezes. O gasto real são as compras.

Teste rápido de sanidade: no mês em que a fatura é paga, o **patrimônio não
deve se mover**. Se mover, a marcação de `eh_interna` está errada.

### 4. FITID NÃO é chave de deduplicação

Validado no arquivo real do Nubank: uma compra internacional e o IOF dela
**compartilham o mesmo FITID**. Usar FITID como chave descarta o IOF
silenciosamente.

A chave é o `hash_natural`:
```
sha256(conta_id | data | valor | descricao_normalizada | ocorrencia)
```

O `ocorrencia` é obrigatório: dois cafés de R$ 19,90 no mesmo lugar no mesmo dia
são gastos distintos e legítimos. Sem o índice o hash colide. Como o índice
deriva da ordem estável do arquivo, reprocessar gera os mesmos hashes.

**Mas o FITID é guardado e usado como checagem secundária.** O hash tem um ponto
cego: a descrição faz parte dele, então se o banco reescrever o texto da mesma
cobrança, vira lançamento novo. Aconteceu de verdade — o Nubank reexportou o
mesmo IOF como `IOF de compra internacional` e depois como
`IOF de "Anthropic* Claude Sub"`, e R$ 4,00 foram contados duas vezes.

O par `(conta_id, id_externo, valor)` resolve: separa a compra internacional do
IOF dela (mesmo FITID, valores diferentes) e não depende do texto. Não substitui
o `hash_natural`, roda depois dele.

Para fontes sem FITID (XLSX), sobra o aviso: mesma data + mesmo valor +
descrição diferente é marcado como "conferir" na tela, nunca bloqueado — dois
gastos iguais no mesmo dia são legítimos.

### 5. Regime de caixa, não competência

Só o que efetivamente saiu no período. Parcelas futuras **não** são projetadas.
Isso está fora de escopo na v1.

### 6. Bronze é imutável e append-only — e hoje NÃO existe

A regra: payload cru sobe pro Storage **antes** de qualquer parse, com
timestamp no nome, nunca sobrescrito. Se o parse falha, o dado cru está salvo
e reprocessa.

**A app web não faz isso.** `legado/ingestion/storage.py` fazia e não foi
portado; `bronze_path` está nulo em todas as linhas. Está aqui como alvo, não
como descrição — quem for implementar, é esta a regra a seguir. Não confundir
com convenção cumprida.

---

## Estrutura

```
financas-pipeline/
├── web/
│   ├── src/app/             # rotas (App Router)
│   │   ├── page.tsx         # Importar: recebe o arquivo e grava
│   │   ├── analise/         # Quanto gastei: a tela principal
│   │   ├── carteira/        # investimentos, reservas, proventos
│   │   ├── onboarding/      # contas, cartões e marco zero
│   │   ├── login/
│   │   └── api/mercado/     # cotação e CDI com cache (guarda o token da brapi)
│   ├── src/lib/             # a lógica toda; ver tabela abaixo
│   ├── src/components/      # Nav, Marca, LayoutClient (proteção de rota)
│   └── scripts/             # bot do Telegram, import em lote, verificações
├── sql/                     # migrations, na ordem, aplicadas no Supabase
├── docs/                    # ADRs + estado
├── legado/                  # pipeline Python original; não roda (ver README de lá)
└── samples/                 # arquivos reais (GITIGNORED — nunca commitar)
```

O que mora em `web/src/lib/`:

| arquivo          | responsabilidade                                          |
|------------------|-----------------------------------------------------------|
| `ingest.ts`      | orquestra: prepara, confere, grava, desfaz importação      |
| `parsers/`       | `ofx.ts` (Nubank) e `xlsxItau.ts`; cada um devolve o mesmo formato |
| `normalize.ts`   | descrição normalizada + `hash_natural` — a chave de dedupe |
| `categorize.ts`  | aplica as regras por prioridade                            |
| `aprender.ts`    | correção manual vira regra nova                            |
| `ciclo.ts`       | aritmética de calendário do cartão, sem dependência de runtime |
| `minhasContas.ts`| decide o que é transferência interna, aporte ou receita    |
| `dono.ts`        | `usuario_id` das escritas e detecção de escrita barrada por RLS |
| `ocultar.ts`     | estado global do botão de ocultar valores                  |

**Todo parser devolve o mesmo contrato** (transações + snapshot + avisos). É o
que permite adicionar um banco novo sem tocar em nada a jusante.
É o contrato que permite adicionar um banco novo sem tocar em nada a jusante.

---

## Estado atual

Em produção em `financas-pipeline.vercel.app`, com dados reais de dois cartões.
O detalhe do que está feito vive em `docs/ESTADO.md` — aqui fica só o que muda
a decisão de quem for mexer.

### Dívidas conhecidas

Nenhuma destas é bug: são escolhas com consequência, anotadas para não serem
redescobertas do zero.

- **Sem bronze.** O payload cru não sobe para lugar nenhum antes do parse (ver
  convenção 6). `bronze_path` está nulo em todas as linhas. Se um parser tiver
  bug, o arquivo original é a única cópia — e ele está na máquina do usuário.
- **Transferência entre contas próprias não é pareada.** `legado/transfers.py`
  fazia e não foi portado. Não pesa enquanto a tela é só de cartão; passa a
  pesar no dia em que entrar conta corrente.
- **Proteção de rota é só no cliente** (`LayoutClient`). Quem souber a URL
  recebe o HTML; o que protege o *dado* é o RLS, não a tela. Um middleware
  chegou a existir e foi desligado — o caminho certo seria refazê-lo com
  `@supabase/ssr` e cookies.
- **Sem teste automatizado de verdade.** Há três verificações rodáveis à mão
  (`verificar-hashes`, `verificar-calculos`, `sql/DIAGNOSTICO_RLS.sql`) e
  nenhuma roda em CI.

### Próximo, quando houver amostra

Parser do **extrato da conta Nubank**: é `STMTRS`, não `CCSTMTRS`, e é onde
estão os Pix. Não escrever às cegas — ver a regra de trabalho no fim deste
arquivo.

---

## Particularidades já descobertas nos arquivos reais

### Nubank — OFX de cartão (`CCSTMTRS`)
- `ofxparse` lê direto, sem workaround
- `LEDGERBAL` presente e já negativo → snapshot sai de graça
- `payee` vem vazio; usar `memo`
- Datas com sufixo de timezone `[-3:BRT]` — `ofxparse` resolve
- `MEMO` traz prefixo de gateway: `Anthropic*`, `Dm*Spotify`

### Itaú — XLSX de fatura
- Header na linha 13 (0-indexed), não na 1 → localizar dinamicamente
- Colunas: idx 1=Data, 2=Lançamento, 3=Parcelamento, 4=Valor
- `openpyxl` já entrega `datetime` (não serial)
- Parar leitura na linha de `Subtotal`
- **Descrições concatenadas sem separador**: `Rockaffesao Paulobra` =
  "Rock Caffe" + "sao paulo" + "bra", com padding aleatório de caracteres.
  **Não tentar separar cidade/estabelecimento** — não há separador e heurística
  erra mais que acerta. Regras de categoria casam no prefixo, que é estável.
- `Valor (parcial)` é a soma das **compras**, não o saldo líquido. Fechar a
  conferência exige um lançamento de saldo de abertura do ciclo, uma vez por conta.

---

## Comandos

Tudo a partir de `web/`:

```bash
npm run dev                  # localhost:3000
npm run build                # o que a Vercel roda; quebra em erro de tipo
npm run lint

npm run verificar-hashes     # prova que o hash do TS bate com o do Python legado
npm run verificar-calculos   # ciclo do cartão, CDI e projeção de proventos
npm run importar -- <pasta>  # importa OFX/XLSX em lote, sem a tela
npm run bot                  # bot do Telegram (polling)
```

Banco: as migrations em `sql/` rodam no SQL Editor do Supabase, na ordem do
nome. Depois de mexer em RLS, rodar `sql/DIAGNOSTICO_RLS.sql` — as consultas 2
e 3 têm que voltar vazias.

---

## Regras de trabalho

- **Nunca commitar dados financeiros reais.** `samples/`, `*.ofx`, `*.xlsx`, `.env`
  e `*.p12` estão no `.gitignore`. Conferir antes de qualquer commit.
- **Nunca escrever parser sem ver o arquivo cru primeiro.** Pedir amostra.
- Toda decisão de arquitetura vira um ADR curto em `docs/`: decisão,
  alternativas consideradas, consequência.
- Não adicionar dependência sem necessidade clara. O projeto é pequeno de propósito.
- Preferir função pura + teste a script monolítico.
- Mensagens de commit em português, imperativo, escopo no prefixo:
  `parser: extrai contraparte de Pix no extrato Nubank`
