# ADR-002 — Rastreio de Pix via Telegram

Status: aceito (revisado em 2026-08-03)
Substitui a versão anterior, que previa reconciliação com o extrato.

## Contexto

O pedido: "fiz um Pix, gravo na hora e já sobe na base".

Não existe gatilho automático. O projeto descartou API bancária, `pynubank` e
scraping. O Banco Central não expõe Pix de pessoa física para terceiros, e o
Open Finance exige ser instituição autorizada. Ninguém avisa o app quando um
Pix acontece.

**A versão anterior deste ADR previa duas camadas:** registro manual provisório
+ reconciliação quando o OFX da conta fosse importado. Isso foi descartado após
uma definição do usuário: **o extrato de conta corrente raramente ou nunca será
exportado.**

Isso muda tudo. Se o extrato nunca chega, o registro manual não é um provisório
aguardando confirmação — é a única fonte que vai existir. Manter maquinaria de
reconciliação para um evento que não acontece é complexidade sem contrapartida.

## Decisão

**Registro manual pelo Telegram, gravado como lançamento definitivo.**

Sem `provisorio`, sem pareamento heurístico, sem fila de sobras. O lançamento
entra igual a qualquer outro, com `fonte = 'telegram'`.

### Arquitetura

```
celular ──> bot do Telegram ──> webhook ──> /api/telegram ──> Supabase
                                            (route handler)
```

Sem servidor próprio, sem polling, sem infraestrutura nova. O webhook é uma
route handler do Next.js já hospedado na Vercel.

### Consequência de cronograma: o bot exige deploy

Webhook precisa de URL pública. `localhost` não recebe nada do Telegram. A
ordem é obrigatória:

1. Fechar as policies `tmp_anon_*` e configurar Supabase Auth
2. Publicar na Vercel
3. Só então configurar o webhook

Alternativa se houver pressa: `getUpdates` por polling num script local. Não
exige deploy, mas só funciona com a máquina ligada — o que anula o objetivo de
registrar do celular na hora.

### Segurança — três camadas, nenhuma opcional

O endpoint é público na internet. Sem proteção, qualquer um que descobrir a
URL escreve nas suas finanças.

1. **Secret token.** Ao registrar o webhook passa-se `secret_token`; o Telegram
   devolve em `X-Telegram-Bot-Api-Secret-Token` a cada chamada. Comparar antes
   de qualquer processamento.
2. **Whitelist de `chat_id`.** Só o seu. Sem isso, quem achar o bot pelo nome
   escreve na base.
3. **Service role no servidor.** A route handler usa
   `SUPABASE_SERVICE_ROLE_KEY`, que nunca vai para o browser. A chave anon
   embutida no cliente não é usada aqui.

### Gramática das mensagens

Precisa ser tolerante: quem está pagando a conta de um café não vai lembrar
sintaxe.

```
100 almoço                  → -100,00 · pix · "almoço"
100 pix almoço              → idem, método explícito
19,90 uber                  → -19,90 · pix
100 dinheiro feira          → -100,00 · dinheiro
+50 reembolso do joão       → +50,00 · entrada
ontem 80 mercado            → -80,00 · data de ontem
15/07 120 presente          → -120,00 · data específica
```

Regras de leitura, na ordem:

- Data opcional no início: `hoje`, `ontem`, `dd/mm` ou `dd/mm/aaaa`. Sem data,
  é hoje.
- Valor: primeiro número. Aceita vírgula ou ponto. `+` explícito marca entrada;
  qualquer outro caso é saída.
- Método opcional: `pix`, `dinheiro`, `debito`, `ted`, `boleto`. Padrão `pix`.
- O resto é a descrição.

Comando `/desfazer` remove o último lançamento daquele chat — erro de digitação
é o caso mais comum e tem que ter saída barata.

### Deduplicação

O `hash_natural` continua sendo a chave, com uma diferença: no import de
arquivo o índice de `ocorrencia` vem da ordem das linhas do arquivo. No registro
manual não existe arquivo, então o índice precisa ser consultado no banco:

```sql
select coalesce(max(ocorrencia), 0) + 1
from transacoes
where conta_id = ? and data = ? and valor = ? and descricao = ?
```

Sem isso, dois cafés de R$ 10 no mesmo dia gerariam o mesmo hash e o segundo
seria descartado em silêncio — exatamente o bug que o índice de ocorrência
existe para evitar.

**Requer adicionar a coluna `ocorrencia` em `transacoes`.** Hoje ela é usada só
em memória durante o parse e não é persistida.

### Onde o Pix aparece na análise

**Seção separada na mesma tela.** Cartão continua agrupado por fatura; Pix e
dinheiro ganham bloco próprio agrupado por mês da transação.

Isso resolve uma colisão concreta: a tela de análise agrupa por `fatura_id`, e
lançamento sem fatura é filtrado fora. Pix não tem fatura — ele sai da conta no
dia, sem ciclo e sem vencimento. Somar tudo num número só exigiria reintroduzir
o agrupamento por data que foi removido, e misturaria duas grandezas que se
conferem de formas diferentes: cartão fecha contra a fatura, Pix contra o
extrato (que não virá).

## Alternativas consideradas

**Manter a reconciliação "por precaução".** Rejeitado: código que nunca executa
não é testado, e código não testado que roda um dia é pior que código ausente.

**Notificação do celular como gatilho.** App Android lendo notificações do banco
e chamando o webhook. Seria de fato automático. Rejeitado: exige app nativo com
permissão sensível e quebra a cada mudança de layout de notificação — a mesma
fragilidade do parser de PDF que o projeto já descartou.

**Chave E2E do Pix como identificador.** Resolveria dedupe sem heurística.
Rejeitado na prática: ninguém copia esse código ao pagar um café.

## Consequências

**Depende inteiramente da disciplina de registrar.** Sem extrato para conferir,
Pix esquecido é gasto invisível — e nada no sistema vai apontar a ausência. É o
custo aceito ao abrir mão da reconciliação.

**Se um extrato de conta for importado no futuro, tudo duplica.** Os lançamentos
manuais e os do banco são o mesmo dinheiro, e o `hash_natural` não os reconhece
como iguais (descrição digitada ≠ descrição do banco). Mitigação obrigatória: a
tela de import deve **recusar** extrato de conta corrente quando existirem
lançamentos com `fonte = 'telegram'` naquele período, explicando o motivo.

Vale registrar que "nunca" já mudou neste projeto: a definição inicial era
"só tenho as faturas atuais", e oito meses de histórico foram importados dois
dias depois. A trava é barata e evita reconstruir a base.

**O parser de `STMTRS` continua sem amostra.** Não escrever às cegas.
