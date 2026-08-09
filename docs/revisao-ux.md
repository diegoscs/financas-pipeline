# Revisão de UX/UI — Finanças

Data: 2026-08-01
Base: uso real de uma sessão, não heurística no vazio.

---

## O que o uso real revelou

Três eventos desta sessão valem mais que qualquer checklist:

1. A fatura foi importada **três vezes** na conta errada.
2. Uma duplicata de R$ 4,00 foi achada **com calculadora**, não pela interface.
3. Para corrigir qualquer um dos dois, a única saída foi **apagar a base inteira**.

Nenhum é erro do usuário. Os três são falhas de desenho.

---

## P1 — Não existe desfazer, só "apagar tudo"

**Dor.** Importou errado? A única recuperação é a zona de perigo: digitar `LIMPAR`
e perder o histórico inteiro, inclusive o que estava certo. Aconteceu duas vezes
nesta sessão.

**Por que é grave.** Sem desfazer barato, cada import vira uma decisão de risco.
O usuário hesita, confere três vezes, ou pior: importa e não confere. Ambos os
comportamentos pioram o dado.

**Solução.** A tabela `ingestion_log` já existe no schema e está vazia — foi
desenhada exatamente para isso. Gravar uma linha por import com `execucao_id`, e
oferecer:

- Um histórico de importações: arquivo, banco, data, quantas linhas.
- Botão **Desfazer esta importação** que apaga só as linhas daquele
  `execucao_id`. Reversível, cirúrgico, sem confirmação dramática.
- Manter a zona de perigo só para recomeçar do zero de verdade.

**Custo.** Baixo. Uma coluna `execucao_id` em `transacoes` e uma tela de lista.

---

## P2 — O app tem o número de conferência e esconde

**Dor.** A planilha do Itaú informa `Valor (parcial) = 772,45`. O OFX do Nubank
informa `BALAMT = -221,04`. Os dois estão gravados em `faturas.valor_total`. E
**nada na interface compara isso com a soma dos lançamentos.**

Foi por isso que a duplicata de R$ 4,00 só apareceu quando o usuário abriu a
calculadora.

**Por que é grave.** É um app de conferência financeira que não confere. A
confiança no número é o produto inteiro; sem ela o usuário refaz a conta por
fora, e aí o app não serve para nada.

**Solução.** Na tela de import, antes de gravar, e na seção de faturas:

```
Fatura de agosto/2026 · Itaú
  soma dos lançamentos    R$ 772,45
  total informado         R$ 772,45
  diferença               R$ 0,00   ✓ confere
```

Com diferença ≠ 0, mostrar em destaque e listar os candidatos (mesma data e
valor, descrição diferente). Isso transforma o achado manual de hoje em
detecção automática.

**Custo.** Baixo — os dois números já existem.

---

## P3 — Acessibilidade: zero

**Dor.** Nenhum `aria-*`, `role` ou `tabIndex` no app. A área de upload é uma
`<div onClick>`: quem navega por teclado não consegue importar nada. As "tabelas"
são `div`s, então leitor de tela não anuncia linha nem coluna.

**Solução, em ordem de impacto:**

1. Dropzone vira `<button type="button">` com o `<input type="file">` associado
   por `<label>`. Resolve teclado e leitor de tela de uma vez.
2. Estado de carregamento e resultado do import em `aria-live="polite"` — hoje o
   "18 novos · 0 já no banco" só existe visualmente.
3. Listas de lançamentos viram `<table>` com `<th scope="col">`. São dados
   tabulares; foram feitos com `div` por conveniência de estilo.
4. Gráficos precisam de alternativa textual. O donut já tem a lista ao lado —
   basta `aria-hidden` no gráfico e a lista como fonte de verdade.
5. Foco visível: hoje é o padrão do navegador, que some sob os estilos
   customizados. Definir `:focus-visible` explícito.

---

## P4 — Avisos que mandam fazer algo e não deixam fazer

**Dor.** "17 lançamentos não têm competência. **Reimportar a fatura de origem
vincula todos eles.**" — e não há botão. O usuário tem que sair da tela, achar o
arquivo, escolher o banco, arrastar.

O mesmo vale para o aviso de "saldo de abertura do ciclo necessário", que
descreve um problema contábil sem oferecer ação.

**Solução.** Todo aviso que descreve uma ação leva um botão para ela. Neste caso,
`[Importar fatura de origem]` que já abre o seletor com o banco certo
pré-selecionado. Se não há ação possível, o texto tem que dizer isso.

---

## P5 — Categorizar em massa custa 3 cliques por item

**Dor.** Com 18 sem categoria: clicar no link minúsculo "categoria", abrir o
`select`, escolher, clicar em Salvar. Cada item recarrega a tela inteira
(`onSalvo → carregar()`), então a lista salta e a posição de leitura se perde.

**Por que é grave.** É a tarefa mais frequente do app e a mais cara. E o rótulo
do link é um substantivo ("categoria"), não uma ação — não se lê como clicável.

**Solução.**

- Modo de revisão em fila: mostra um lançamento por vez, categorias como botões
  grandes (não `select`), avança sozinho. 1 clique por item.
- Agrupar por descrição parecida antes de perguntar: "5 lançamentos começam com
  `ROCKAFFE` — categorizar todos?" Aproveita a regra que já é criada.
- Atualizar só a linha alterada em vez de recarregar tudo.
- Renomear o link para **Definir categoria** / **Alterar**.

---

## P6 — O número grande não responde "isso é muito?"

**Dor.** `R$ 1.067,12` em vermelho, 44px, sem nenhuma âncora. Mil reais é muito
ou pouco? Depende do mês passado, e o app tem esse dado.

**Psicologia.** Número isolado não gera decisão, gera reação. E vermelho grande
comunica alarme: a literatura de finanças pessoais é consistente em que
ansiedade financeira leva a **evitação** — o usuário para de abrir o app. Um app
de controle de gastos que dá aflição é abandonado em duas semanas.

**Solução.**

- Âncora comparativa ao lado do valor: `R$ 1.067 · +12% vs julho` ou
  `−R$ 140 vs a média dos 3 meses`. Transforma número em informação.
- Vermelho só para o **desvio negativo**, não para o valor em si. Gastar é
  normal; o que merece cor é gastar fora do padrão.
- O maior gasto do período já está calculado — mostrar qual foi, não só quanto.
  "Seu maior gasto foi OKONE SUSHI, R$ 394,90 (37% do mês)" é acionável.

---

## P7 — O aviso de segurança virou paisagem

**Dor.** O banner "a base está liberada para leitura e escrita anônima" aparece
em **toda** página, **sempre**, idêntico. Isso é o mecanismo clássico de cegueira
de banner: um alerta que nunca muda para de ser lido, e quando ele realmente
importar — no deploy — vai ser ignorado junto com os outros.

**Solução.** Mostrar só quando for perigoso de fato: checar
`window.location.hostname`. Em `localhost`, uma linha discreta no rodapé ou nada.
Fora de `localhost`, um bloqueio real no topo, impossível de ignorar. O aviso
ganha força justamente por ser raro.

---

## P8 — "Data da compra" vs "Fatura" pressupõe conhecimento

**Dor.** O alternador não explica por que o mesmo dinheiro aparece em julho numa
visão e em agosto na outra. Quem não conhece ciclo de cartão conclui que o app
está errado.

**Solução.** Uma linha de microcopy sob o alternador, mudando com a seleção:

- Data da compra → *"Agrupado por quando você gastou."*
- Fatura → *"Agrupado por quando foi cobrado. A fatura de agosto tem compras de
  julho."*

Custa uma frase e elimina a dúvida na origem.

---

## Prioridade sugerida

| # | Item | Impacto | Custo |
|---|------|---------|-------|
| 1 | Conferência soma × total da fatura (P2) | Alto | Baixo |
| 2 | Desfazer importação (P1) | Alto | Médio |
| 3 | Dropzone acessível + foco visível (P3.1, P3.5) | Alto | Baixo |
| 4 | Microcopy do alternador (P8) | Médio | Trivial |
| 5 | Aviso de segurança condicional (P7) | Médio | Trivial |
| 6 | Botão de ação nos avisos (P4) | Médio | Baixo |
| 7 | Âncora comparativa no número (P6) | Médio | Baixo |
| 8 | Modo de revisão em fila (P5) | Alto | Alto |
| 9 | Tabelas semânticas + aria-live (P3.2, P3.3) | Médio | Médio |

Os quatro primeiros somam menos de um dia e cobrem os dois problemas que já
causaram dano real nesta sessão.
