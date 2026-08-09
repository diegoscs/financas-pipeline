# Finanças — web

Importar fatura no navegador e ver quanto foi gasto. Next.js + Supabase.

## Rodar

```bash
cd web
npm install
npm run dev
```

Abre em http://localhost:3000. O `.env.local` já está preenchido com a URL e a
chave publicável do projeto Supabase.

## Como funciona

```
fatura (.xlsx / .ofx)
   ↓  lida no browser — nada sobe antes de você confirmar
parse → normaliza descrição → hash_natural → aplica regras → confere duplicatas
   ↓  você confere na tela
Supabase (upsert on conflict hash_natural)
   ↓
/analise  →  quanto gastei
```

Não há backend. O arquivo nunca sai da sua máquina antes de virar linha de
tabela — o que também elimina o limite de 4,5 MB de body das funções da Vercel.

## O que não pode esquecer

**A base está aberta.** Não existe login, e as policies `tmp_anon_*` liberam
leitura e escrita para qualquer um com a URL. Isso é aceitável em localhost e
inaceitável em produção. Antes de publicar:

```bash
psql < ../sql/desfazer_policies_anon.sql   # ou cole no SQL Editor do Supabase
```

e configure Supabase Auth com policies por `auth.uid()`.

## Você escolhe o banco, o arquivo escolhe a conta

Na tela de import você seleciona só **Nubank**, **Itaú** etc. Se é cartão ou
conta corrente sai do conteúdo do arquivo: OFX com `CCSTMTRS` é cartão,
`STMTRS` é conta, e a planilha do Itaú só existe como fatura.

Isso não é cosmético. Enquanto a escolha era manual ("Nubank Cartão" / "Nubank
Conta"), a fatura do Itaú foi parar dentro de conta do Nubank **duas vezes** —
e o dedupe não protege contra isso, porque `conta_id` entra no `hash_natural`:
mesmo arquivo em conta diferente gera hashes diferentes e grava tudo de novo.

## Dedupe

`hash_natural = sha256(conta_id|data|valor|descricao_normalizada|ocorrencia)`.

O índice de ocorrência distingue dois lançamentos idênticos no mesmo dia — dois
cafés de R$ 19,90 são gastos diferentes, e sem ele um sumiria. Como o índice sai
da ordem do arquivo, reprocessar a mesma fatura gera os mesmos hashes e grava
zero linhas.

`scripts/verificar-hashes.mjs` confere que o port TypeScript gera exatamente os
mesmos hashes que o pipeline Python original (`../ingestion/`) gerou. Rode depois
de mexer em `normalize.ts` ou nos parsers:

```bash
npm run verificar-hashes
```

Se ele falhar, o dedupe quebrou: reimportar uma fatura já processada vai
duplicar tudo.

## Categorização

Regras regex ficam na tabela `regras_categoria` e são aplicadas no browser —
ou seja, **são regex JavaScript**. `\m`, `\M` e `\y` (sintaxe do Postgres) viram
literais em JS e fazem a regra casar coisa errada em silêncio. Use `\b`.

Cobertura medida: 4 de 18 na fatura do Itaú, 4 de 5 no OFX do Nubank. A
diferença é a origem da descrição — o Nubank manda o nome do serviço
(`Dm*Spotify`), o Itaú manda o nome do comércio colado com a cidade
(`ROCKAFFESAO PAULOBRA`). Nenhuma lista de palavras-chave resolve o segundo caso.

Isso não afeta o total gasto, que não depende de categoria. Afeta só a quebra
por categoria. A solução planejada (parte 2) é uma tela de revisão onde corrigir
`ROCKAFFE` uma vez cria a regra e conserta as ocorrências futuras.

## Estrutura

```
src/lib/normalize.ts       hash + normalização (port fiel do Python)
src/lib/parsers/           xlsxItau.ts, ofx.ts
src/lib/categorize.ts      regras do banco → categoria
src/lib/ingest.ts          orquestra: parse → hash → categoriza → dedupe → grava
src/app/page.tsx           tela de import
src/app/analise/page.tsx   tela de quanto gastei
scripts/                   verificar-hashes.mjs
```
