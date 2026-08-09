# Estado do projeto

Atualizado: 2026-08-03

---

## O que existe hoje

App Next.js em `web/` que lê fatura de cartão no navegador, deduplica, grava no
Supabase e responde quanto foi gasto. Sem backend: o arquivo nunca sai da sua
máquina antes de virar linha de tabela.

**Na base:** 290 lançamentos · 16 faturas · 2 cartões (Itaú, Nubank) ·
dez/25 a jul/26 · **R$ 12.427,60** de gasto líquido.

---

## Feito

### Arquitetura
- Migração de CLI Python + Docker + Metabase + dbt → monolito Next.js na Vercel
- Parse no navegador (elimina o limite de 4,5 MB das funções da Vercel)
- Python arquivado em `legado/` com README explicando o que foi e o que não foi portado

### Ingestão
- Parsers XLSX (Itaú) e OFX (Nubank/genérico) portados do Python
- **18/18 hashes idênticos aos do Python** — `npm run verificar-hashes` prova
- Banco detectado pelo `<ORG>`/`<FID>` do OFX; bloqueia arquivo do banco errado
- Cartão vs conta corrente deduzido do arquivo (`CCSTMTRS` vs `STMTRS`)
- Competência lida do cabeçalho, com override na tela
- Linhas de valor R$ 0,00 ignoradas (`CONTROLE DE SALDO` do Itaú)
- Conferência soma × total informado, ciente de compras vs saldo

### Deduplicação (quatro camadas)
1. `hash_natural` — chave primária de dedupe
2. `(conta_id, id_externo, valor)` — pega reexportação com texto alterado (FITID)
3. **Prefixo de descrição** — pega truncamento diferente do mesmo comércio
4. Mesma data + valor + descrição diferente → marcado "conferir", nunca bloqueado

### Análise
- Tela única por fatura, filtro por banco, donut + evolução empilhada, exportar PDF
- Edição de categoria com lápis: categoria, apelido e excluir
- Correção manual vira regra (prioridade 7, vence as genéricas) e aplica retroativo
- Agrupamento dos sem categoria + indicador de cobertura 80%

### Segurança do dado
- Desfazer importação por `execucao_id`
- `ingestion_log` como histórico real de importações
- Limpar base atrás de confirmação digitada

### Bugs corrigidos (todos encontrados em dado real)
| Bug | Impacto |
|---|---|
| `regras_categoria` com `categoria_id` trocado | despesa classificada como receita |
| Regex `\m`/`\M` do Postgres em regra avaliada por JS | regra casaria errado em silêncio |
| Correção de categoria criava regra nova em vez de trocar | correção nova ignorada |
| Regra aprendida em prioridade 90 | correção manual perdia para palpite genérico |
| Fatura importada na conta errada (3×) | dados no cartão errado |
| IOF reexportado com outro texto | R$ 4,00 contados duas vezes |
| `JIM.COM` truncado diferente | R$ 450,04 contados duas vezes |
| Estorno não abatia do gasto | R$ 53,99 inflando o total |
| `data_fechamento_fatura` constante em todas as linhas | histórico inteiro num mês só |
| Upsert sobrescrevia cabeçalho de outra fatura | vencimento corrompido |
| `String(e)` em erro do Supabase | `[object Object]` escondendo a causa |
| Dropzone era `<div onClick>` | inacessível por teclado |
| Cor de categoria vinda do ranking | "Lazer" mudava de cor a cada mês |
| Total vs gráfico divergindo na visão por fatura | dois números discordando na mesma tela |
| Teto de 1.000 linhas do PostgREST em 5 consultas | truncaria em silêncio a partir de ~2 anos |

### Documentação
- `ADR-001` fatura como entidade · `ADR-002` rastreio de Pix · `ADR-003` regra do ciclo do cartão
- `docs/revisao-ux.md` — revisão de UX com 8 problemas priorizados
- `sql/05_faturas_e_lineage.sql` — schema reproduzível do zero

---

## A fazer

### Bloqueia o deploy
**Autenticação.** As policies `tmp_anon_*` liberam leitura e escrita da base
para qualquer um. Aceitável em localhost, inaceitável em URL pública. Rodar
`sql/desfazer_policies_anon.sql` e configurar Supabase Auth com policies por
`auth.uid()`. Exige coluna `user_id` nas tabelas de dado.

### Perda irreversível enquanto não for feito
**Bronze.** `CLAUDE.md` regra 6: payload cru sobe pro Storage antes de qualquer
parse. A app web não faz — `bronze_path` está nulo em 100% das linhas. Se um
parse sair errado hoje, o arquivo só existe na sua máquina. ~30 linhas.

### Vai doer quando entrar conta corrente
**`transfers.ts` nunca portado.** O pareamento de transferências internas existe
só no Python. Hoje não pesa porque a tela é só cartão; depois, transferência
entre suas contas conta como gasto.

**Parser de extrato de conta.** Nunca vi um `STMTRS` real. O código trata o
caso, mas os campos de contraparte de Pix (`MEMO` vs `NAME` vs `PAYEE`) são
desconhecidos. Não escrever às cegas — pedir amostra.

### Qualidade
**Página de diagnóstico.** Os três bugs de hoje foram achados com SQL, não com
teste. Os invariantes dão para automatizar e rodar a cada carregamento:
soma da fatura = soma dos lançamentos · zero lançamento órfão · zero
prefixo-duplicata · nenhuma categoria de grupo `receita` com valor negativo.

**Testes.** Só existe `verificar-hashes`. Sem cobertura: categorização,
competência, `sugerirPadrao`, conferência.

**Backup.** Não existe. `LIMPAR` é irreversível e o desfazer só cobre um lote.

### Produto
**Pix (ADR-002).** Bot do Telegram para registro rápido + reconciliação quando
o OFX chegar. As duas camadas entram juntas: registro manual sozinho duplica
tudo quando o extrato subir.

**Categorização em massa.** 98 comerciantes distintos sem categoria. Um modo de
revisão em fila (um por vez, categorias como botões grandes) reduz de 3 cliques
para 1 por item.

**Vencimento do Nubank.** O OFX não informa. Todas as faturas do Nubank estão
com `vencimento` nulo, então a referência cruzada com o app do banco só funciona
no Itaú.

**Fatura de junho sem vencimento.** Foi corrompida pelo bug de upsert e zerada.
Reimportar `fatura-paga-final 2394-julho2026.xlsx` restaura.
