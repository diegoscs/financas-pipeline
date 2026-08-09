-- Habilitar RLS em todas as tabelas
ALTER TABLE transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE faturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE regras ENABLE ROW LEVEL SECURITY;

-- Criar tabela de usuários se não existir
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  criado_em TIMESTAMP DEFAULT NOW()
);

-- Política para transacoes: usuário só vê suas próprias
CREATE POLICY "Usuários veem suas próprias transações"
  ON transacoes
  FOR SELECT
  USING (conta_id IN (
    SELECT contas.id FROM contas
    WHERE contas.usuario_id = auth.uid()
  ));

CREATE POLICY "Usuários inserem transações em suas contas"
  ON transacoes
  FOR INSERT
  WITH CHECK (conta_id IN (
    SELECT contas.id FROM contas
    WHERE contas.usuario_id = auth.uid()
  ));

-- Política para contas: usuário vê suas contas
CREATE POLICY "Usuários veem suas próprias contas"
  ON contas
  FOR SELECT
  USING (usuario_id = auth.uid());

CREATE POLICY "Usuários criam suas próprias contas"
  ON contas
  FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

-- Política para categorias: públicas (padrão) ou do usuário
CREATE POLICY "Usuários veem categorias padrão e suas"
  ON categorias
  FOR SELECT
  USING (usuario_id IS NULL OR usuario_id = auth.uid());

CREATE POLICY "Usuários criam suas próprias categorias"
  ON categorias
  FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

-- Política para faturas
CREATE POLICY "Usuários veem suas próprias faturas"
  ON faturas
  FOR SELECT
  USING (conta_id IN (
    SELECT contas.id FROM contas
    WHERE contas.usuario_id = auth.uid()
  ));

-- Política para snapshots
CREATE POLICY "Usuários veem seus snapshots"
  ON snapshots
  FOR SELECT
  USING (conta_id IN (
    SELECT contas.id FROM contas
    WHERE contas.usuario_id = auth.uid()
  ));

-- Política para regras
CREATE POLICY "Usuários veem suas regras"
  ON regras
  FOR SELECT
  USING (usuario_id IS NULL OR usuario_id = auth.uid());

CREATE POLICY "Usuários criam suas próprias regras"
  ON regras
  FOR INSERT
  WITH CHECK (usuario_id = auth.uid());
