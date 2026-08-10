-- =============================================================
-- MIGRATION 08 — Implementar Row-Level Security (RLS) por usuário
--
-- ORDEM: Rodar DEPOIS que a tabela usuarios estiver criada
-- e ANTES de adicionar novos usuários
-- =============================================================

-- Criar tabela de usuários se não existir
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- ── Adicionar coluna usuario_id nas tabelas ─────────────────────────────────
ALTER TABLE contas ADD COLUMN usuario_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE categorias ADD COLUMN usuario_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE regras_categoria ADD COLUMN usuario_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── Remover policies inseguras ──────────────────────────────────────────────
DROP POLICY IF EXISTS logado_contas ON contas;
DROP POLICY IF EXISTS logado_categorias ON categorias;
DROP POLICY IF EXISTS logado_regras ON regras_categoria;
DROP POLICY IF EXISTS logado_transacoes ON transacoes;
DROP POLICY IF EXISTS logado_snapshots ON snapshots_saldo;
DROP POLICY IF EXISTS logado_ingestion_log ON ingestion_log;
DROP POLICY IF EXISTS logado_faturas ON faturas;

-- ── Implementar RLS seguro ──────────────────────────────────────────────────
-- CONTAS: Usuário vê e edita apenas suas próprias contas
CREATE POLICY "contas_select" ON contas
  FOR SELECT USING (usuario_id = auth.uid());

CREATE POLICY "contas_insert" ON contas
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "contas_update" ON contas
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "contas_delete" ON contas
  FOR DELETE USING (usuario_id = auth.uid());

-- TRANSACOES: Usuário vê transações apenas de suas contas
CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

CREATE POLICY "transacoes_insert" ON transacoes
  FOR INSERT WITH CHECK (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

CREATE POLICY "transacoes_update" ON transacoes
  FOR UPDATE USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  ) WITH CHECK (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

CREATE POLICY "transacoes_delete" ON transacoes
  FOR DELETE USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

-- CATEGORIAS: Padrão (sem usuario_id) ou do usuário
CREATE POLICY "categorias_select" ON categorias
  FOR SELECT USING (usuario_id IS NULL OR usuario_id = auth.uid());

CREATE POLICY "categorias_insert" ON categorias
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "categorias_update" ON categorias
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "categorias_delete" ON categorias
  FOR DELETE USING (usuario_id = auth.uid());

-- REGRAS: Padrão (sem usuario_id) ou do usuário
CREATE POLICY "regras_select" ON regras_categoria
  FOR SELECT USING (usuario_id IS NULL OR usuario_id = auth.uid());

CREATE POLICY "regras_insert" ON regras_categoria
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "regras_update" ON regras_categoria
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "regras_delete" ON regras_categoria
  FOR DELETE USING (usuario_id = auth.uid());

-- FATURAS: Usuário vê faturas apenas de suas contas
CREATE POLICY "faturas_select" ON faturas
  FOR SELECT USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

-- SNAPSHOTS: Usuário vê snapshots apenas de suas contas
CREATE POLICY "snapshots_select" ON snapshots_saldo
  FOR SELECT USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

-- INGESTION_LOG: Usuário vê logs de suas contas
CREATE POLICY "ingestion_log_select" ON ingestion_log
  FOR SELECT USING (
    conta_id IN (
      SELECT id FROM contas WHERE usuario_id = auth.uid()
    )
  );

-- ── Migrações de dados (apenas primeira execução) ──────────────────────────
-- Se rodando ANTES de qualquer multi-user: preencher usuario_id com NULL
-- (será preenchido quando o usuário fazer login pela primeira vez)

-- Para dados sem usuario_id ainda, deixar como NULL
-- Quando usuário fizer login, registrar em usuarios table
-- E criar dados padrão para ele

-- ── Verificação final ───────────────────────────────────────────────────────
-- Confirmar que não há mais policies inseguras
SELECT tablename, policyname, roles::text, qual
FROM pg_policies
WHERE schemaname = 'public' AND policyname LIKE '%logado%'
ORDER BY tablename, policyname;

-- Listar policies implementadas
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('contas', 'transacoes', 'categorias', 'regras_categoria')
ORDER BY tablename, policyname;
