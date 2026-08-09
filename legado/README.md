# Legado — pipeline Python

Primeira implementação do projeto: CLI em Python que lia OFX/XLSX e gravava no
Supabase via conexão Postgres direta. Foi substituída pela app web em `../web`,
que faz o mesmo parse no navegador.

**Não roda mais.** O `.venv` e o `.env` com as credenciais foram removidos.

## Por que ficou aqui

`ingestion/normalize.py` é a origem do `web/src/lib/normalize.ts`. O
`hash_natural` que ele definiu é a chave de deduplicação de toda a base, e a
regra do índice de ocorrência — dois cafés de R$ 19,90 no mesmo dia são gastos
distintos — veio daqui.

`web/scripts/verificar-hashes.mjs` existe para provar que o port TypeScript
reproduz este comportamento byte a byte: compara os hashes gerados pelo TS com
os 18 que este código gravou a partir de uma fatura real. Sem esta pasta como
referência, aquele teste perde o significado.

## O que foi portado

| Python                        | TypeScript                          |
|-------------------------------|-------------------------------------|
| `normalize.py`                | `web/src/lib/normalize.ts`          |
| `parsers/xlsx_itau.py`        | `web/src/lib/parsers/xlsxItau.ts`   |
| `parsers/ofx_nubank.py`       | `web/src/lib/parsers/ofx.ts`        |
| `categorize.py`               | `web/src/lib/categorize.ts`         |
| `loader.py`                   | `web/src/lib/ingest.ts`             |
| `schemas.py`                  | `web/src/lib/types.ts`              |

## O que NÃO foi portado

`transfers.py` — pareamento de transferências internas entre contas próprias.
Não pesa hoje porque a tela mostra só cartão de crédito, mas quando entrar
conta corrente, transferência entre suas contas vai contar como gasto.

`storage.py` — upload do payload cru para o bucket bronze antes do parse. O
`CLAUDE.md` trata isso como convenção inviolável (regra 6) e a app web não
faz: `bronze_path` está nulo em todas as linhas. Foi a maior perda da migração.
