-- =============================================================
-- MIGRATION 12 — RLS para faturas (INSERT/UPDATE/DELETE)
-- =============================================================

-- A migração 08 criou apenas SELECT para faturas
-- Mas ao importar arquivo, precisa escrever novas faturas
-- Adicionar policies de escrita

CREATE POLICY "faturas_insert" ON faturas
  FOR INSERT WITH CHECK (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

CREATE POLICY "faturas_update" ON faturas
  FOR UPDATE USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

CREATE POLICY "faturas_delete" ON faturas
  FOR DELETE USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

-- Verificar
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'faturas'
ORDER BY policyname;
