-- =============================================================
-- MIGRATION 16 — Histórico mensal do patrimônio investido
--
-- A aba Investimentos guardava o fechamento de cada mês no localStorage do
-- navegador. Limpar os dados do site apagava o histórico, e abrir de outro
-- aparelho começava do zero.
--
-- Por que tabela nova e não `snapshots_saldo`: a chave de lá é
-- (conta_id, data_ref), e a aba Carteira faz upsert nela com a data de hoje
-- toda vez que alguém informa o saldo de uma reserva. Duas telas gravando a
-- mesma chave com noções diferentes de valor fariam a última vencer, em
-- silêncio — a mesma classe de bug que as migrações 14 e 15 fecharam.
--
-- Aqui a chave é (usuario_id, competencia): um fechamento por mês, por
-- pessoa. Regravar o mesmo mês substitui, que é o certo — um mês tem um
-- patrimônio só.
-- =============================================================

CREATE TABLE IF NOT EXISTS investimentos_historico (
  usuario_id  UUID NOT NULL DEFAULT auth.uid()
              REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'YYYY-MM'. Texto e não date porque competência é rótulo de mês, não
  -- instante: virar date convidaria o fuso a transformar 2026-01 em dezembro.
  competencia TEXT NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- O dia a que o valor se refere. Separado da competência de propósito:
  -- fechar setembro no dia 15 é legítimo, mas a tela precisa poder dizer que
  -- o número é do dia 15 e não do fim do mês.
  data_ref    DATE NOT NULL,

  reservas    NUMERIC(14,2) NOT NULL DEFAULT 0,
  bolsa       NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Guardado, e não calculado como reservas + bolsa, porque o valor pode ser
  -- digitado à mão para um mês em que não havia registro das partes. Sem o
  -- total próprio, um fechamento antigo viraria zero.
  total       NUMERIC(14,2) NOT NULL,

  -- 'carteira' = veio somado das contas e posições; 'manual' = digitado.
  -- A tela mostra a diferença: número digitado não se confere com o banco.
  origem      TEXT NOT NULL DEFAULT 'carteira' CHECK (origem IN ('carteira', 'manual')),

  atualizado  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (usuario_id, competencia)
);

ALTER TABLE investimentos_historico ENABLE ROW LEVEL SECURITY;

-- As quatro, não duas. A migração 08 criou só SELECT e INSERT em quatro
-- tabelas e o buraco passou sete semanas despercebido: UPDATE sem policy não
-- é recusado, apenas não encontra linha.
CREATE POLICY "investimentos_historico_select" ON investimentos_historico
  FOR SELECT USING (usuario_id = auth.uid());

CREATE POLICY "investimentos_historico_insert" ON investimentos_historico
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "investimentos_historico_update" ON investimentos_historico
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "investimentos_historico_delete" ON investimentos_historico
  FOR DELETE USING (usuario_id = auth.uid());

-- ── Verificação ─────────────────────────────────────────────────────────
-- Tem que voltar 4 linhas: SELECT, INSERT, UPDATE, DELETE.
SELECT cmd, policyname
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'investimentos_historico'
ORDER BY cmd;
