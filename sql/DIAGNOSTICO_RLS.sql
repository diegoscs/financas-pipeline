-- ===================================================================
-- DIAGNÓSTICO RLS — Execute para checar o status das policies
-- ===================================================================

-- 1. Verificar quais tabelas têm RLS habilitado
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN (
  'ativos', 'posicoes', 'proventos', 'contas', 'transacoes', 'categorias'
)
ORDER BY tablename;

-- 2. Listar policies por tabela
SELECT tablename, policyname, cmd, (qual is not null) as tem_qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN (
  'ativos', 'posicoes', 'proventos', 'contas', 'transacoes', 'categorias'
)
ORDER BY tablename, policyname;

-- 3. Contar policies por tabela
SELECT tablename, COUNT(*) as num_policies
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN (
  'ativos', 'posicoes', 'proventos', 'contas', 'transacoes', 'categorias'
)
GROUP BY tablename
ORDER BY tablename;

-- ===================================================================
-- Se RLS está OFF em alguma tabela, rodar:
-- ALTER TABLE [tabela] ENABLE ROW LEVEL SECURITY;
-- ===================================================================

-- ===================================================================
-- Se não há policies em ativos/posicoes/proventos, rodar:
-- (Copie tudo do arquivo 10_rls_carteira.sql)
-- ===================================================================
