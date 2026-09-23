# 🔐 Relatório de Segurança - Finanças Pipeline

**Data**: 2026-09-23  
**Status**: ✅ Críticas corrigidas — desta vez conferidas no banco  
**Próxima Revisão**: 2026-12-23

---

## ⚠️ Leia isto antes de confiar no resto

A revisão de 2026-08-09 deu as críticas como corrigidas porque o **SQL tinha
sido escrito**. Sete semanas depois descobriu-se que a migração 08 só chegou
ao banco pela metade: `contas`, `categorias`, `regras_categoria` e
`transacoes` ficaram com policy de `SELECT` e `INSERT` e nenhuma de `UPDATE`
ou `DELETE`.

O sintoma não foi erro, foi silêncio: `UPDATE` sem policy não é recusado,
apenas não encontra linha. Corrigir a categoria de um lançamento respondia
"salvo" e não gravava nada. Ninguém notou por sete semanas.

**A lição vale mais que o relatório:** arquivo `.sql` commitado não é
controle aplicado. As migrações 14 e 15 fecharam o buraco, e desta vez cada
afirmação abaixo foi verificada com o papel `authenticated` contra o banco de
produção — não contra o código-fonte. O `sql/DIAGNOSTICO_RLS.sql` existe para
refazer essa conferência em um minuto.

---

## 📊 Resumo Executivo

| Severidade | Antes | Depois | Status |
|-----------|-------|--------|--------|
| 🔴 CRÍTICA | 3 | 0 | ✅ CORRIGIDO E CONFERIDO |
| 🟠 ALTA | 5 | 2 | 🟡 PARCIAL |
| 🟡 MÉDIA | 4 | 4 | ⏳ PLANEJADO |
| 🟢 BAIXA | 1 | 1 | ⏳ BACKLOG |

---

## 🔴 Vulnerabilidades Críticas (CORRIGIDAS)

### ✅ 1. Row-Level Security (RLS) Permissivo
**Status**: CORRIGIDO — conferido no banco em 2026-09-23  
**Arquivos**: `sql/08_multi_user_security.sql` (desenho),
`sql/14_rls_escrita_faltante.sql` e `sql/15_fechar_exposicao_publica.sql`
(o que de fato fechou)  

```sql
-- Antes (INSEGURO):
CREATE POLICY logado_transacoes ON transacoes 
  FOR ALL TO authenticated USING (true);

-- Depois (SEGURO):
CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );
```

**Estado conferido** (não deduzido do código): 4 policies por tabela de dados,
`perfil` com dono e RLS, cache de mercado fechado para `anon`, as seis views
em `security_invoker`. Testado com JWT simulado: o dono escreve, o segundo
usuário vê zero em tudo, o anônimo vê zero no cache.

**Como refazer a conferência**: rode `sql/DIAGNOSTICO_RLS.sql` no SQL Editor.
As consultas 2 e 3 têm que voltar vazias.

---

### ✅ 2. Endpoint de API Sem Autenticação
**Status**: CORRIGIDO  
**Arquivo**: `web/src/app/api/mercado/route.ts` (linhas 190-210)

```typescript
// Agora valida:
const authHeader = req.headers.get('authorization');
if (!authHeader?.startsWith('Bearer ')) {
  return Response.json({ erro: 'Não autenticado' }, { status: 401 });
}

// E valida tickers com regex
const TICKER_REGEX = /^[A-Z0-9]{4,6}$/;
if (!tickers.every(t => TICKER_REGEX.test(t))) {
  return Response.json({ erro: 'Tickers com formato inválido' }, { status: 400 });
}
```

---

### ✅ 3. Chave Anon Pública Exposta
**Status**: MITIGADO  
**Arquivo**: `web/src/components/LayoutClient.tsx`

A chave continua pública — ela precisa ir no bundle do browser. O que a torna
inofensiva é o RLS: com ela sozinha, sem um usuário logado, não se lê nem se
escreve nada.

- ✅ RLS no banco valida o usuário em toda tabela (item 1)
- ✅ A rota `/api/mercado` exige token válido e fala com o banco no nome de
  quem chamou, não com a chave crua
- ⚠️ **A proteção de rota é no cliente**, em `LayoutClient`. Existiu um
  middleware que faria isso no servidor, mas nunca foi ligado — o arquivo
  estava como `middleware.ts.disabled` e foi removido, porque arquivo
  desligado no repositório passa a impressão de proteção que não existe.
  Quem souber a URL recebe o HTML da página; o que protege o **dado** é o
  RLS. Refazer o middleware com `@supabase/ssr` continua sendo o caminho
  certo e está anotado como dívida no `CLAUDE.md`.

---

## 🟠 Vulnerabilidades Altas (PENDENTES)

### 1. Rate Limiting Não Implementado
**Prioridade**: SEMANA 1  
**Arquivo**: `web/src/app/api/mercado/route.ts`

**Recomendação**:
```bash
npm install @upstash/ratelimit @upstash/redis
```

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'),
});

export async function GET(req: Request) {
  const { success } = await ratelimit.limit(`api:mercado:${userId}`);
  if (!success) {
    return Response.json({ erro: 'Too Many Requests' }, { status: 429 });
  }
  // ... resto
}
```

**Variáveis de Ambiente** (adicionar no Vercel):
```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

---

### 2. ReDoS via Regexes do Banco
**Prioridade**: SEMANA 1  
**Arquivo**: `web/src/lib/categorize.ts` (linha 50)

**Recomendação**:
```typescript
function validarRegex(padrao: string): boolean {
  // Validar tamanho
  if (padrao.length > 200) return false;
  
  // Validar complexidade
  const quantificadores = padrao.match(/(\*|\+|\{)/g)?.length || 0;
  if (quantificadores > 5) return false;
  
  // Testar timeout
  const start = performance.now();
  try {
    const re = new RegExp(padrao, 'i');
    re.test('a'.repeat(100));
    return performance.now() - start < 10; // 10ms max
  } catch {
    return false;
  }
}
```

---

### 3. Validação de Input Insuficiente
**Prioridade**: SEMANA 2  
**Arquivo**: `web/src/lib/mercado.ts`

Adicionar validação em todas as funções que recebem entrada do usuário.

---

### 4. Exposição de Email
**Prioridade**: SEMANA 2  
**Arquivo**: `web/src/components/Nav.tsx` (linha 54)

```typescript
// Antes:
{usuario.email?.split('@')[0]}

// Depois:
{usuario.user_metadata?.display_name || 
 usuario.email?.split('@')[0] || 'Usuário'}
```

---

### 5. Logs Expõem Informações Internas
**Prioridade**: CONTÍNUO  
**Arquivo**: `web/src/lib/categorize.ts` (linha 53)

```typescript
// Antes:
console.warn(`Regra ${r.id} tem regex inválido: ${r.padrao}`);

// Depois:
if (process.env.NODE_ENV === 'development') {
  console.warn(`Regra ${r.id}: ${r.padrao}`);
} else {
  console.warn('Regra de categorização ignorada por erro de formato');
}
```

---

## 🟡 Vulnerabilidades Médias (BACKLOG)

1. **Validação de Tamanho em Descriptions** → `web/src/lib/aprender.ts`
2. **HTTPS Enforcement** → Via Vercel
3. **Middleware Cobertura** → Revisar matcher regex
4. **Console.warn Cleanup** → Remover logs de produção

---

## ✅ Headers de Segurança (IMPLEMENTADOS)

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: Configurada com whitelist de origins
```

**Arquivo**: `web/next.config.mjs`

---

## 🔐 Checklist de Implementação

### ANTES DO DEPLOY (Hoje)

- [ ] Executar SQL de RLS no Supabase Console
- [ ] Criar usuário de teste e fazer login
- [ ] Testar que dados antigos ficam sem acesso (até migração)
- [ ] Verificar /api/mercado retorna 401 sem token

### SEMANA 1

- [ ] Implementar Rate Limiting (Upstash)
- [ ] Adicionar validação de Regex complexity
- [ ] Testar DoS com regexes complexas

### SEMANA 2

- [ ] Limpar console.warn em produção
- [ ] Validar tamanho de inputs
- [ ] Auditoria de logs

### CONTÍNUO

- [ ] Monitorar logs do Vercel
- [ ] Revisar acessos no Supabase
- [ ] Fazer penetration testing mensal

---

## 📚 Referências

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Next.js Security](https://nextjs.org/docs/going-to-production/security)
- [Postgres Security](https://www.postgresql.org/docs/current/sql-syntax.html)

---

## 📞 Contato

Dúvidas de segurança? Abra issue em `SECURITY.md` (não em issues públicas).

**Última Atualização**: 2026-08-09
