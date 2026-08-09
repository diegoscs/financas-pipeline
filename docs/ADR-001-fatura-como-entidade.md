# ADR-001 — Fatura vira entidade própria; competência separada da data da compra

Status: proposto
Data: 2026-08-01

## Contexto

O modelo atual guarda uma data por lançamento: a data da compra. Isso responde
"quanto gastei em julho", mas não responde "quanto veio na fatura de agosto".

O arquivo real mostra o problema. A planilha `fatura-aberta-final 2394-agosto2026.xlsx`
traz, na linha 7, `Fatura Aberta - Agosto/2026` e vencimento `2026-08-10`. As 18
compras dentro dela são de **03/07 a 28/07**.

```
fatura de AGOSTO  ──contém──>  compras de JULHO
     ↑                              ↑
  competência                  data da compra
  (quando pago)                (quando gastei)
```

Sem separar as duas, três coisas ficam impossíveis:

1. **Histórico de faturas.** Não há entidade "fatura" para listar, comparar ou
   marcar como paga.
2. **Subir fatura antiga.** Nada distingue a fatura de junho da de agosto além
   das datas das compras — que podem se sobrepor (uma compra de 30/06 pode cair
   na fatura de julho ou na de agosto, dependendo do fechamento).
3. **Conferência.** O `Valor (parcial)` da planilha (R$ 772,45) não tem onde ser
   guardado como total da fatura. Hoje ele vira um `snapshots_saldo`, que é uma
   tabela de saldo de conta — uso errado.

## Decisão

Criar a tabela `faturas` e ligar cada transação a ela.

```sql
create table faturas (
  id            bigserial primary key,
  conta_id      smallint not null references contas(id),
  -- primeiro dia do mês de referência: 2026-08-01 = fatura de agosto/2026
  competencia   date     not null,
  vencimento    date,
  valor_total   numeric,          -- o "Valor (parcial)" / total informado
  status        text not null default 'aberta'
                check (status in ('aberta','fechada','paga')),
  arquivo_origem text,
  criada_em     timestamptz not null default now(),
  unique (conta_id, competencia)
);

alter table transacoes
  add column fatura_id bigint references faturas(id);

create index on transacoes (fatura_id);
```

**A competência é lida do arquivo, não perguntada ao usuário.** A planilha do
Itaú diz `Fatura Aberta - Agosto/2026`; o OFX de cartão traz `DTEND`, e o mês do
`DTEND` é a competência. A tela mostra o que foi detectado e permite corrigir
antes de gravar — detectar errado em silêncio é pior que perguntar.

O regime continua sendo caixa (ADR do `CLAUDE.md`, regra 5): `transacoes.data`
segue sendo a data da compra e nada é projetado. A competência é uma dimensão a
mais, não uma troca de regime. A tela de análise ganha um seletor:

- **por data da compra** — "quanto gastei em julho"
- **por competência** — "quanto veio na fatura de agosto"

## Alternativas consideradas

**Perguntar o mês ao usuário no import.** Rejeitado como mecanismo *primário*:
a informação está dentro do arquivo, e pedir de novo é convidar erro — foi
exatamente assim que a fatura do Itaú caiu em "Nubank Conta" duas vezes. Fica
como *correção* de um valor pré-preenchido.

**Derivar a competência da data da compra (mês + 1).** Rejeitado: o dia de
fechamento varia por cartão e o usuário não o informa. Uma compra de 30/06 pode
cair em julho ou agosto. Chutar produz histórico errado que parece certo.

**Usar `snapshots_saldo` como está.** Rejeitado: a chave é `(conta_id, data_ref)`
e a semântica é "saldo da conta naquele instante", não "fatura daquele mês".
Sobrecarregar a tabela impede consultar fatura por competência.

## Consequência

**Ganho de proteção.** `unique (conta_id, competencia)` é uma segunda camada de
defesa, independente do `hash_natural`. O hash impede o mesmo *lançamento* entrar
duas vezes; a constraint impede a mesma *fatura* entrar duas vezes, mesmo que o
banco reemita o arquivo com descrições ligeiramente diferentes (o que geraria
hashes novos e passaria batido hoje).

**Custo.** Reimportar tudo que já existe para preencher `fatura_id`, ou aceitar
lançamentos órfãos. Como a base está vazia agora, o custo é zero se feito antes
de subir o histórico — e cresce a cada fatura importada depois.

**Limite conhecido.** O texto `Fatura Aberta - Agosto/2026` foi observado em UMA
planilha. Fatura fechada ou paga provavelmente escreve outra coisa
(`Fatura Fechada - …`). O parser precisa casar o **mês/ano** com regex tolerante
e cair no override manual quando não achar — nunca inventar. Não temos amostra
de fatura fechada; não escrever esse parser às cegas (regra de trabalho do
`CLAUDE.md`).
