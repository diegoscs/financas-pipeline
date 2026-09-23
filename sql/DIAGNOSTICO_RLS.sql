-- ===================================================================
-- DIAGNÓSTICO RLS — o estado das policies, sem lista fixa de tabelas
--
-- A versão anterior conferia seis tabelas escritas à mão e por isso não
-- via as que passaram a existir depois (perfil, cotacoes, indices,
-- faturas, ativos...). Foi assim que a migração 08 pôde ficar meia-boca
-- por um mês sem ninguém notar: o diagnóstico olhava para o lado certo
-- e dizia que estava tudo bem.
--
-- Aqui a lista vem do catálogo. Tabela nova aparece sozinha.
-- ===================================================================

-- 1. Cobertura por tabela: RLS ligado e quais comandos têm policy.
--
-- O que esperar:
--   - dados do usuário (contas, transacoes, perfil...) → SELECT/INSERT/UPDATE/DELETE
--   - cache de mercado (cotacoes, indices)             → SELECT/INSERT/UPDATE
--   - controle_cargas                                  → 0 policies, de propósito:
--     é dos robôs do ambiente_dev, que falam direto com o Postgres
SELECT c.relname                                    AS tabela,
       c.relrowsecurity                             AS rls_ligado,
       coalesce(string_agg(DISTINCT p.cmd, ', '
                ORDER BY p.cmd), '— nenhuma —')     AS comandos_com_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p
       ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relrowsecurity, c.relname;

-- 2. O buraco que a migração 08 abriu: RLS ligado e escrita sem policy.
--
-- É o caso perigoso porque NÃO dá erro. UPDATE e DELETE sem policy não são
-- recusados, apenas não encontram linha — o app responde "salvo" e o banco
-- continua igual.
--
-- Tem que voltar VAZIA. As ausências propositais estão listadas abaixo e
-- ficam de fora: um diagnóstico que sempre acusa alguma coisa é um
-- diagnóstico que ninguém lê, e foi assim que a 08 passou despercebida.
SELECT c.relname AS tabela, cmd.faltando
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS cmd(faltando)
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  -- dos robôs do ambiente_dev: nega tudo via API de propósito
  AND c.relname <> 'controle_cargas'
  -- cache de mercado não se apaga pela API
  AND NOT (c.relname IN ('cotacoes', 'indices') AND cmd.faltando = 'DELETE')
  -- registro de usuário: só nasce e é lido, não se altera nem se apaga
  AND NOT (c.relname = 'usuarios' AND cmd.faltando IN ('UPDATE', 'DELETE'))
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = n.nspname AND p.tablename = c.relname
       AND p.cmd = cmd.faltando
  )
ORDER BY 1, 2;

-- 3. Views que furam o RLS das tabelas de baixo.
--
-- SECURITY DEFINER roda com a permissão de quem criou a view, não de quem
-- consulta. Tem que voltar vazia — a migração 15 passou as seis para invoker.
SELECT c.relname AS view_definer
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
  AND NOT coalesce((SELECT option_value::boolean
                      FROM pg_options_to_table(c.reloptions)
                     WHERE option_name = 'security_invoker'), false)
ORDER BY 1;

-- 4. Isolação de verdade: o que um usuário enxerga.
--
-- Troque o sub pelo id de um usuário de auth.users. Para o dono dos dados os
-- números batem com a base; para qualquer outro, tudo tem que dar zero.
/*
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<uuid-do-usuario>","role":"authenticated"}';
  SELECT (SELECT count(*) FROM perfil)           AS perfil,
         (SELECT count(*) FROM contas)           AS contas,
         (SELECT count(*) FROM transacoes)       AS transacoes,
         (SELECT count(*) FROM regras_categoria) AS regras,
         (SELECT count(*) FROM vw_fluxo_mensal)  AS vw_fluxo;
ROLLBACK;
*/
