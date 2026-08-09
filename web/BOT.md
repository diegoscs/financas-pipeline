# Bot do Telegram

Registra Pix e dinheiro pelo celular. Roda local por polling — sem deploy.

## 1. Criar o bot (no Telegram, 2 minutos)

1. Procure **@BotFather** e mande `/newbot`
2. Escolha um nome (ex: `Minhas Finanças`)
3. Escolha um username terminado em `bot` (ex: `diego_financas_bot`)
4. Ele responde com o token:

```
8123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Guarde. Quem tem esse token controla o bot.

## 2. Descobrir seu chat_id

1. Procure **@userinfobot** e mande `/start`
2. Ele responde com `Id: 123456789` — esse número é o seu `chat_id`

Sem isso o bot não sobe. É o que impede outra pessoa de escrever nas suas
finanças: o token protege a API do Telegram, não os seus dados.

## 3. Configurar

Acrescente ao final de `web/.env.local`:

```
TELEGRAM_TOKEN=8123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=123456789
```

Opcional — por padrão o Pix entra na primeira conta corrente ativa
(`Nubank Conta`). Para mudar:

```
CONTA_PIX=Itau Conta
```

## 4. Rodar

```powershell
cd "D:\VsCode Projetos\financas-pipeline\web"
npm install
npm run bot
```

Deve aparecer:

```
Bot no ar. Ctrl+C para parar.
Só respondo ao chat 123456789.
```

Deixe essa janela aberta. Em outra, `npm run dev` para o app.

## 5. Testar

Abra a conversa com o seu bot e mande, nesta ordem:

| Mande | Esperado |
|---|---|
| `/start` | lista de comandos |
| `100 almoço` | `Anotado: R$ 100,00 · almoço · pix · hoje` |
| `19,90 uber` | aceita vírgula |
| `100 dinheiro feira` | método `dinheiro` |
| `+50 reembolso do joão` | entrada, valor positivo |
| `ontem 80 mercado` | data de ontem |
| `15/07 120 presente` | 15 de julho |
| `/gastei` | total do mês |
| `/desfazer` | remove o último |
| `xyz` | não entende, devolve a ajuda |

Depois abra `localhost:3000/analise` e confirme que os lançamentos aparecem.

## Como funciona

- **Sinal:** sem `+` explícito é saída. Gasto é o caso comum.
- **Data:** sem data é hoje, no fuso de São Paulo. `hoje`, `ontem`,
  `anteontem`, `dd/mm` e `dd/mm/aaaa` funcionam. `30/12` sem ano em agosto
  vira o ano passado, porque a data futura não faria sentido.
- **Método:** `pix` é o padrão. Também aceita `dinheiro`, `debito`, `ted`,
  `boleto`, `credito`.
- **Categoria:** aplicada pelas suas regras. Funciona melhor aqui que no
  cartão — você escreve "almoço", não `ROCKAFFESAO PAULOBRA`.
- **Duplicata:** dois lançamentos iguais no mesmo dia são aceitos como gastos
  distintos (é o índice de ocorrência). Reenviar a mesma mensagem duas vezes
  em sequência também grava duas vezes — use `/desfazer` se foi engano.

## Limitações

**Só recebe com o processo de pé.** Mensagens enviadas com o bot desligado não
se perdem: o Telegram guarda por 24h e elas chegam quando ele voltar. O arquivo
`.bot-offset` marca onde parou.

**Para funcionar 24h** seria preciso webhook, que exige URL pública, que exige
deploy, que exige fechar a base atrás de login (`sql/06_auth.sql`). O miolo
(`src/lib/telegram/gramatica.ts` e `src/lib/manual.ts`) é o mesmo nos dois
casos — migrar é trocar o laço de polling por uma route handler.

**Não importe extrato de conta corrente** por cima do período em que houver
registros do bot. São o mesmo dinheiro com textos diferentes, e o dedupe não
os reconhece. O app já recusa e explica, mas vale saber o porquê.
