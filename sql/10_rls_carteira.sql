-- =============================================================
-- MIGRATION 10 — RLS para tabelas de carteira (ativos, posicoes, proventos)
-- =============================================================

-- Habilitar RLS nas tabelas (se não estiver já)
ALTER TABLE ativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE posicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE proventos ENABLE ROW LEVEL SECURITY;

-- Remover policies antigas/inseguras se existirem
DROP POLICY IF EXISTS "logado_ativos" ON ativos;
DROP POLICY IF EXISTS "logado_posicoes" ON posicoes;
DROP POLICY IF EXISTS "logado_proventos" ON proventos;

-- ── ATIVOS: Usuário vê e edita apenas seus ativos ──────────────────────
-- ativos.conta_id pode ser NULL (ativo geral) ou referencia à conta do usuário
CREATE POLICY "ativos_select" ON ativos
  FOR SELECT USING (
    conta_id IS NULL
    OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  );

CREATE POLICY "ativos_insert" ON ativos
  FOR INSERT WITH CHECK (
    conta_id IS NULL
    OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  );

CREATE POLICY "ativos_update" ON ativos
  FOR UPDATE USING (
    conta_id IS NULL
    OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  )
  WITH CHECK (
    conta_id IS NULL
    OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  );

CREATE POLICY "ativos_delete" ON ativos
  FOR DELETE USING (
    conta_id IS NULL
    OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
  );

-- ── POSICOES: Acesso via ativo ─────────────────────────────────────────
-- posicoes.ativo_id referencia ativos, então valer a mesma regra
CREATE POLICY "posicoes_select" ON posicoes
  FOR SELECT USING (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

CREATE POLICY "posicoes_insert" ON posicoes
  FOR INSERT WITH CHECK (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

CREATE POLICY "posicoes_update" ON posicoes
  FOR UPDATE USING (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  )
  WITH CHECK (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

CREATE POLICY "posicoes_delete" ON posicoes
  FOR DELETE USING (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

-- ── PROVENTOS: Acesso via ativo ────────────────────────────────────────
CREATE POLICY "proventos_select" ON proventos
  FOR SELECT USING (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

CREATE POLICY "proventos_insert" ON proventos
  FOR INSERT WITH CHECK (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

CREATE POLICY "proventos_update" ON proventos
  FOR UPDATE USING (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  )
  WITH CHECK (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

CREATE POLICY "proventos_delete" ON proventos
  FOR DELETE USING (
    ativo_id IN (
      SELECT id FROM ativos
      WHERE conta_id IS NULL
      OR conta_id IN (SELECT id FROM contas WHERE usuario_id = auth.uid())
    )
  );

-- Verificação
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('ativos', 'posicoes', 'proventos')
ORDER BY tablename, policyname;
