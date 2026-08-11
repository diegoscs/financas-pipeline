-- =============================================================
-- MIGRATION 11 — RLS para snapshots_saldo (INSERT/UPDATE/DELETE)
-- =============================================================

-- A migração 08 criou apenas SELECT para snapshots_saldo
-- Mas aplicações precisam escrever (quando registra provento, etc)
-- Adicionar policies de escrita

CREATE POLICY "snapshots_insert" ON snapshots_saldo
  FOR INSERT WITH CHECK (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

CREATE POLICY "snapshots_update" ON snapshots_saldo
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

CREATE POLICY "snapshots_delete" ON snapshots_saldo
  FOR DELETE USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

-- Verificar
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'snapshots_saldo'
ORDER BY policyname;
