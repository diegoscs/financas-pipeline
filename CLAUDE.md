# Pipeline de Finanças Pessoais

Pipeline de dados que consolida transações de cartão e conta (Nubank + Itaú),
rastreia Pix e dinheiro, categoriza automaticamente e responde com precisão
**quanto gastei e quanto guardei** por mês.

Também é projeto de portfólio de engenharia de dados. Decisões devem ser
defensáveis em entrevista, não apenas funcionais.

## Stack

Python 3.11+ · Supabase (Postgres + Storage) · dbt-core · Metabase (Docker) · GitHub Actions

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

### 6. Bronze é imutável e append-only

Payload cru sobe pro Storage **antes** de qualquer parse, com timestamp no nome.
Nunca sobrescrever. Se o parse falha, o dado cru está salvo e reprocessa.

---

## Estrutura

```
financas-pipeline/
├── ingestion/
│   ├── schemas.py           # dataclasses Transacao / Snapshot / ResultadoParse
│   ├── normalize.py         # normalização de descrição + hash_natural
│   ├── storage.py           # upload bronze (Supabase Storage)
│   ├── loader.py            # upsert idempotente + ingestion_log
│   ├── categorize.py        # regras -> LLM -> fila manual
│   ├── transfers.py         # pareamento de transferências internas
│   ├── cli.py               # entrypoint
│   └── parsers/
│       ├── ofx_nubank.py    # PRONTO E TESTADO
│       └── xlsx_itau.py     # PRONTO E TESTADO
├── bot/                     # Telegram: recebe arquivos, /saldo, gasto avulso
├── dbt/
├── sql/                     # migrations aplicadas no Supabase
├── samples/                 # arquivos reais (GITIGNORED — nunca commitar)
├── synthetic/               # gerador de dados falsos (commitado)
├── docs/                    # ADRs
└── .github/workflows/
```

**Todo parser retorna `ResultadoParse`** (transações + snapshot + avisos).
É o contrato que permite adicionar um banco novo sem tocar em nada a jusante.

---

## Estado atual

### Pronto
- `sql/schema_financas.sql` — dimensões, fato, snapshots, views de reconciliação
- `sql/02_ingestion_log.sql` — lineage do bronze, log de execução, conferência de cartão
- `ingestion/schemas.py`, `ingestion/normalize.py`
- `ingestion/parsers/ofx_nubank.py` — validado: soma bate com `LEDGERBAL` no centavo
- `ingestion/parsers/xlsx_itau.py` — validado: detecta saldo de abertura necessário
- `docker-compose.yml` — Metabase + Postgres de metadados

### Próximo
1. `storage.py` + `loader.py` (fecha a fase 1)
2. Parser do **extrato da conta Nubank** — ainda não temos amostra. É `STMTRS`,
   não `CCSTMTRS`, e é onde estão os Pix. Não escrever às cegas.
3. `categorize.py` + `transfers.py`

### Fases
| # | Entrega | Checkpoint |
|---|---|---|
| 0 | Fundação + modelo validado | gap de reconciliação = 0 com dados fabricados |
| 1 | Parsers + dedupe + loader | mesmo arquivo 2x → 0 linhas novas na 2ª |
| 2 | Categorização + internas | <15% não classificado, gap < 5% |
| 3 | Bot Telegram (ingestão) | arquivo enviado do celular chega no bronze |
| 4 | dbt + gold + testes | `dbt build` verde com 2 meses reais |
| 5 | Metabase | responde "quanto guardei" em 5 segundos |
| 6 | Orquestração por polling | uma semana sem intervenção manual |
| 7 | Portfólio | terceiro clona e roda sem ajuda |

**Nenhuma fase começa antes do checkpoint da anterior passar.** Automação em
cima de dado errado multiplica o erro.

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

```bash
source .venv/bin/activate

python -m ingestion.cli --fonte ofx_nubank_cartao --arquivo samples/nubank.ofx
python testar.py                     # roda parsers contra samples/

cd dbt && dbt build

docker compose up -d                 # Metabase em localhost:3000
```

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
