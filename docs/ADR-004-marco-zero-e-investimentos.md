# ADR-004 — Marco zero, investimentos digitados e fontes de dados de mercado

**Data:** 2026-08-04
**Status:** aceito
**Substitui parcialmente:** ADR-002 (escopo do produto)

## Contexto

O aplicativo nasceu como pipeline de reconciliação: importar extratos antigos e
responder quanto foi gasto. Isso funciona, mas produz um produto que só olha
para trás e que exige do usuário entender ciclo de fatura antes de ver
qualquer número.

A nova intenção é outra: o app começa a medir **a partir do momento em que a
pessoa entra**, pergunta o que precisa saber no início (vencimento das faturas,
onde ela guarda dinheiro, o que ela tem em bolsa) e passa a acompanhar quatro
coisas para frente — quanto rende o dinheiro guardado, quando cai o próximo
provento, quanto tem de fatura para pagar e quanto se movimentou no Pix.

Isso levanta três decisões que não são reversíveis de graça.

---

## Decisão 1 — O app mede do presente para frente; o schema continua sabendo o passado

O `perfil.marco_zero` grava a data em que o usuário concluiu o onboarding.
Nenhuma tela de abertura mostra dado anterior a ela.

**O schema não muda por causa disso.** `transacoes.data` continua sendo uma data
qualquer e nada impede carregar 2024. A restrição é de produto, não de modelo:
o dia em que quisermos abrir o passado, é uma tela nova, não uma migração.

### Alternativas consideradas

- **Manter os 9 meses já importados como semente.** Dava gráfico com 9 pontos
  desde o primeiro dia e uma base real para testar. Recusada: o usuário quer o
  marco zero de verdade, e dado de teste misturado com dado de produção é
  exatamente o que torna difícil confiar no número depois.
- **Apagar e travar o schema em "só futuro".** Recusada: fecharia a porta para
  o histórico que ele mesmo disse que vai querer mais tarde.

### O marco zero não é "hoje" — é o início do ciclo em aberto

Começar exatamente na data da instalação produz um buraco. Em 04/08, a fatura
do Itaú que vence dia 10 fechou em 03/08 e cobre compras desde 04/07. Medindo a
partir de hoje, no dia 10 sai um pagamento da conta **sem nenhuma compra que o
explique** — dinheiro sumindo sem motivo visível, e o consumo de julho invisível.

A regra é:

> O marco zero é o início do ciclo da fatura mais antiga **ainda não paga**.

Fatura já quitada não entra: a compra e o pagamento aconteceram os dois antes
da janela, então o par está completo fora dela e nada fica pendurado.

Isso é calculado, não perguntado — `marcoZeroNecessario()` em `lib/ciclo.ts`
deriva a data do dia de fechamento e do dia de vencimento que o usuário
informou no onboarding. É o retorno de ter perguntado esses dois números.

Para dois cartões (Itaú fecha 3 / vence 10; Nubank fecha no fim do mês / vence
8), em 04/08/2026 a data resultante é **01/07/2026** — vale o ciclo mais antigo.

### Consequência

Os gráficos de comparação nascem quase vazios e só ficam úteis depois de alguns
meses. É o preço aceito. Em compensação, tudo que aparecer na tela dali em
diante foi produzido pelo fluxo real do app, não por uma carga manual.

O primeiro import não é o do mês corrente: é o da fatura em aberto de cada
cartão mais o extrato da conta desde a data calculada.

---

## Decisão 2 — Posições e proventos são digitados; a previsão sai do histórico

Não existe API pública gratuita que entregue a carteira de alguém. A B3 tem a
Área do Investidor, mas sem API aberta, e integração com corretora não existe
em free tier. Portanto **quantidade e preço médio são digitados e editáveis**.

Os proventos seguem o mesmo caminho: o usuário registra o valor por cota
quando o fundo anuncia. O app guarda o histórico, calcula o yield sobre o
preço médio e **estima** o próximo pagamento pela média dos últimos três, com
a data provável tirada do dia do mês em que os anteriores caíram.

### Alternativas consideradas

- **brapi Pro — R$ 116,66/mês no anual (R$ 1.399,90/ano).** É a única faixa que
  inclui dividendos de FII, e MXRF11 é FII. Traria data-com e data de pagamento
  oficiais em vez de estimativa. Recusada: R$ 1.400/ano para um app de uso
  pessoal com ~10 posições é desproporcional, e viola a regra de free tier do
  projeto. O plano Startup (R$ 99,99/mês) não resolve — ele cobre dividendo de
  ação, mas FII detalhado só no Pro.
- **Raspar StatusInvest/Fundamentus.** Recusada pelo mesmo motivo que a fatura
  em PDF foi descartada: layout muda, o parser quebra em silêncio, e o dado
  fica errado sem avisar.

### Consequência

A previsão de provento é **estimativa e precisa ser rotulada como tal na tela**.
Um número previsto com cara de anunciado é pior que nenhum número. Para FII a
estimativa costuma errar pouco (pagamento mensal e razoavelmente estável);
para ação erra muito, porque provento de ação é irregular. A tela deve tratar
os dois casos com o mesmo aviso.

Se um dia o custo deixar de ser problema, trocar a fonte é local: a estimativa
vive numa função só, alimentada pela tabela `proventos`.

---

## Decisão 3 — Cotação pela brapi, CDI pelo Banco Central, ambos por route handler

| Dado | Fonte | Custo | Limite |
|---|---|---|---|
| Preço de ação, FII e ETF | brapi.dev, plano Gratuito | R$ 0 | 15.000 req/mês · 1 ticker por chamada · delay ~30 min |
| CDI e Selic | BCB, série SGS 12 | R$ 0 | sem chave, sem limite publicado |

Com ~10 posições atualizadas de hora em hora em pregão, o consumo fica perto de
1.800 requisições por mês — bem dentro do limite gratuito. O delay de 30
minutos é irrelevante para acompanhamento de carteira; seria um problema para
quem opera intradiário, que não é o caso.

**As duas chamadas passam por um route handler do Next.** Motivos:

1. O token da brapi não pode ir para o browser. É a chave da conta.
2. A API do BCB não manda cabeçalho de CORS — chamada direta do browser falha.
3. O handler é onde mora o cache. Sem ele, cada montagem do componente
   queimaria requisição; o limite mensal acabaria em dias.

Cotação e CDI são gravados em `cotacoes` e `indices`, e a tela lê do banco.
A API externa só é chamada quando o dado em cache está velho.

### Consequência

Aparece backend no projeto pela primeira vez. Era browser-only de propósito
(ADR-002), e essa propriedade se perde. A troca é consciente: o motivo original
era não passar arquivo financeiro por servidor nenhum, e isso continua valendo
— **o extrato continua sendo parseado no browser**. O que vai ao servidor é
ticker e data, que não são dado sensível.

---

## O que este ADR não decide

- **Movimentação de ativo** (compra e venda com data e preço). A v1 guarda só o
  estado atual: quantidade e preço médio, editáveis. Isso impede calcular
  rentabilidade real no tempo e imposto. É dívida assumida, não esquecimento.
- **Múltiplos usuários.** `perfil` é singleton. Auth continua em aberto.
- **Reinvestimento automático de provento** no preço médio.
