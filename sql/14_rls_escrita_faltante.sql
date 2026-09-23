-- =============================================================
-- MIGRATION 14 — Completar a escrita que a 08 deixou pela metade
--
-- A 08 desenhou SELECT/INSERT/UPDATE/DELETE para contas, categorias,
-- regras_categoria e transacoes, mas só SELECT e INSERT chegaram no banco
-- (conferido em pg_policies: 2 policies por tabela, contra 4 em ativos,
-- faturas e ingestion_log, que foram corrigidas pelas migrações 10 a 13).
--
-- O buraco não dá erro na tela, o que o torna pior: UPDATE e DELETE sem
-- policy não são recusados, apenas não encontram linha nenhuma. Corrigir a
-- categoria de um lançamento respondia "sucesso" e não gravava nada.
--
-- O INSERT em regras_categoria dava erro, esse sim visível:
-- "new row violates row-level security policy" (42501). A policy exige
-- usuario_id = auth.uid() e o app gravava a regra sem dono.
-- =============================================================

-- ── CONTAS ──────────────────────────────────────────────────────────────
CREATE POLICY "contas_update" ON contas
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "contas_delete" ON contas
  FOR DELETE USING (usuario_id = auth.uid());

-- ── CATEGORIAS ──────────────────────────────────────────────────────────
-- Só as próprias. As de usuario_id NULL são padrão compartilhado: visíveis
-- para todos (policy de SELECT da 08) e editáveis por ninguém.
CREATE POLICY "categorias_update" ON categorias
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "categorias_delete" ON categorias
  FOR DELETE USING (usuario_id = auth.uid());

-- ── REGRAS_CATEGORIA ────────────────────────────────────────────────────
CREATE POLICY "regras_update" ON regras_categoria
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "regras_delete" ON regras_categoria
  FOR DELETE USING (usuario_id = auth.uid());

-- ── TRANSACOES ──────────────────────────────────────────────────────────
CREATE POLICY "transacoes_update" ON transacoes
  FOR UPDATE USING (
    conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  )
  WITH CHECK (
    conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  );

CREATE POLICY "transacoes_delete" ON transacoes
  FOR DELETE USING (
    conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  );

-- ── Dono da regra ───────────────────────────────────────────────────────
-- Rede de proteção: se algum caminho de escrita esquecer o usuario_id de
-- novo, o default preenche em vez de estourar 42501.
ALTER TABLE regras_categoria ALTER COLUMN usuario_id SET DEFAULT auth.uid();

-- A unicidade global de `padrao` é de antes do multi-usuário. Com ela, o
-- segundo usuário a corrigir "^IFOOD" colidiria com a regra do primeiro —
-- e o upsert tentaria atualizar uma linha que ele não pode nem enxergar.
-- A chave certa é (dono, padrão).
ALTER TABLE regras_categoria DROP CONSTRAINT IF EXISTS regras_categoria_padrao_key;
ALTER TABLE regras_categoria ADD CONSTRAINT regras_categoria_usuario_padrao_key
  UNIQUE (usuario_id, padrao);

-- ── Verificação ─────────────────────────────────────────────────────────
SELECT tablename, cmd, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('contas', 'categorias', 'regras_categoria', 'transacoes')
ORDER BY tablename, cmd, policyname;
