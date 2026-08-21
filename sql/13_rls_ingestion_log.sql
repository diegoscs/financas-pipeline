-- =============================================================
-- MIGRATION 13 — RLS para ingestion_log (INSERT/UPDATE/DELETE)
-- =============================================================

-- A migração 08 criou apenas SELECT para ingestion_log
-- Mas ao importar arquivo, precisa escrever logs
-- Adicionar policies de escrita

CREATE POLICY "ingestion_log_insert" ON ingestion_log
  FOR INSERT WITH CHECK (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

CREATE POLICY "ingestion_log_update" ON ingestion_log
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

CREATE POLICY "ingestion_log_delete" ON ingestion_log
  FOR DELETE USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

-- Verificar
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'ingestion_log'
ORDER BY policyname;
