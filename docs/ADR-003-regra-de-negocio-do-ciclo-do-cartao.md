# ADR-003 — Regra de negócio do ciclo do cartão

Status: aceito
Data: 2026-08-03
Substitui parte do ADR-001 (competência).

## O vocabulário, que é onde tudo se confunde

Um cartão de crédito tem **três datas distintas** e trocá-las gera bug:

| Data | O que é | Exemplo real (Itaú) |
|------|---------|---------------------|
| **Data da compra** | quando você gastou | 17/07 |
| **Fechamento** | quando o ciclo encerra; compras depois disso caem na fatura seguinte | ~03/08 |
| **Vencimento** | quando você paga | 10/08 |

O fechamento **não aparece no arquivo**. Ele é inferido: a última compra da
fatura que vence em 10/08 é 01/08, então o corte fica por volta de 03/08.

Confundir vencimento com fechamento já custou uma sessão inteira de
diagnóstico errado.

## Como o banco nomeia, e como nomeamos aqui

O Itaú escreve no cabeçalho: `Fatura Aberta - Agosto/2026`, vencimento
`10/08/2026`, contendo compras de **03/07 a 01/08**.

Ou seja: **o banco nomeia a fatura pelo mês do vencimento.**

```
compras de julho ─────────────► fatura que o banco chama de AGOSTO
    03/07 ... 01/08                    vence 10/08
```

**Decisão: aqui a fatura é nomeada pelo mês das COMPRAS.**

`faturas.competencia = 2026-07-01` para essa fatura. O motivo é a pergunta que
o app existe para responder: "quanto gastei em julho". Nomear pelo vencimento
obriga a traduzir mentalmente toda vez.

`faturas.vencimento` continua guardado e é exibido na tela. Sem ele, conferir
contra o app do banco viraria uma tradução constante de "julho aqui = agosto
lá".

Verificado nas 16 faturas reais da base: o deslocamento de um mês é uniforme
nos dois bancos, então a conversão é mecânica e reversível.

## Invariantes

**1. A competência mora na fatura, nunca na transação.**

Existe uma linha em `faturas` por ciclo, e `transacoes.fatura_id` aponta para
ela. Não existe — e não deve voltar a existir — nenhuma coluna de competência,
fechamento ou vencimento em `transacoes`.

Já houve uma coluna `transacoes.data_fechamento_fatura`. Ela guardava o
vencimento (apesar do nome), e um `UPDATE` em massa carimbou o mesmo valor em
todas as 198 linhas da conta — inclusive compras de dezembro/2025 marcadas com
fechamento em agosto/2026. Agrupar por ela jogava o histórico inteiro num mês
só. **Duas fontes para o mesmo fato garantem que uma delas fique errada.**

**2. A competência não pode ser deduzida da data da compra.**

O ciclo não fecha no fim do mês. Uma compra de 01/08 pertence à fatura de
julho; uma de 05/08 pertence à de agosto. Só o arquivo sabe qual compra está em
qual fatura, porque o banco já fez esse corte ao gerar o arquivo.

Corolário: **o app nunca decide o conteúdo de uma fatura.** Ele lê o que veio
no arquivo. `fatura_id` é atribuído no import, não calculado depois.

**3. Trocar a competência na tela não altera o cabeçalho da fatura de destino.**

Importar o arquivo de agosto forçando competência julho sobrescreveu o
vencimento da fatura de julho com 10/08. O desfazer não corrigiu, porque undo
apaga lançamentos e não reverte update de cabeçalho.

Hoje, quando a competência escolhida difere da detectada, os lançamentos são
vinculados mas `vencimento`, `valor_total` e `arquivo_origem` da fatura
existente ficam intactos.

**4. `arquivo_origem` não é confiável como histórico.**

Ele é sobrescrito a cada upsert. O histórico real está em `ingestion_log`, uma
linha por lote, com `execucao_id`. Foi olhando `arquivo_origem` que se concluiu
erradamente que havia fatura duplicada — quando eram dois arquivos diferentes e
legítimos.

## Consequências

Quem olhar o app e o app do banco lado a lado vê nomes diferentes para a mesma
fatura. É intencional, e a data de vencimento na tela é o que liga as duas.

A view "Data da compra" e a view "Fatura" continuam respondendo perguntas
diferentes e continuam ambas corretas. Com a nova nomenclatura elas ficam
próximas — mas não idênticas, porque uma compra de 01/08 aparece em agosto na
primeira e em julho na segunda. Isso não é erro: é o ciclo do cartão.
