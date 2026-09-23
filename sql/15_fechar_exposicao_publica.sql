-- =============================================================
-- MIGRATION 15 — Fechar o que sobrou exposto e terminar o multiusuário
--
-- A 14 consertou a escrita das quatro tabelas principais. Os advisors do
-- Supabase ainda apontavam cinco buracos, e investigar cada um revelou que
-- não eram só avisos de linter: `perfil` era literalmente compartilhada
-- entre as duas contas de login.
-- =============================================================

-- ── PERFIL: era singleton do tempo de um usuário só ─────────────────────
-- `CHECK (id = 1)` e nenhum dono: os dois usuários liam e sobrescreviam a
-- MESMA linha — nome e marco zero de um apareciam para o outro. Sem RLS,
-- a linha ainda era legível por qualquer um com a chave anônima, que é
-- pública por definição (vai no bundle do browser).
--
-- A chave passa a ser o dono. `id` não servia para nada além de travar a
-- tabela em uma linha.
ALTER TABLE perfil DROP CONSTRAINT perfil_id_check;
ALTER TABLE perfil ADD COLUMN usuario_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- O dono é quem já tem as contas: todos os dados existentes são de um
-- usuário só (conferido antes de rodar).
UPDATE perfil SET usuario_id = (
  SELECT c.usuario_id FROM contas c WHERE c.usuario_id IS NOT NULL LIMIT 1
) WHERE usuario_id IS NULL;

-- Abortar é melhor que seguir: perfil órfão viraria linha invisível para
-- todo mundo depois do RLS, e o onboarding recomeçaria do zero sem aviso.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM perfil WHERE usuario_id IS NULL) THEN
    RAISE EXCEPTION 'perfil sem dono: o backfill não achou usuário em contas';
  END IF;
END $$;

ALTER TABLE perfil DROP CONSTRAINT perfil_pkey;
ALTER TABLE perfil DROP COLUMN id;
ALTER TABLE perfil ALTER COLUMN usuario_id SET NOT NULL;
ALTER TABLE perfil ADD PRIMARY KEY (usuario_id);
ALTER TABLE perfil ALTER COLUMN usuario_id SET DEFAULT auth.uid();

ALTER TABLE perfil ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfil_select" ON perfil
  FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY "perfil_insert" ON perfil
  FOR INSERT WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "perfil_update" ON perfil
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "perfil_delete" ON perfil
  FOR DELETE USING (usuario_id = auth.uid());

-- ── COTACOES e INDICES: cache de dado público, mas não para anônimo ─────
-- Preço de ação e CDI são públicos, e o cache existe justamente para ser
-- compartilhado — separar por usuário multiplicaria as chamadas à brapi, que
-- tem 15.000/mês no plano gratuito. O que não pode é ficar aberto para a
-- chave anônima: ela é pública e qualquer um envenenaria o cache de preço.
--
-- Por isso `to authenticated`: a rota /api/mercado passa a falar com o banco
-- usando o token de quem chamou, não a chave anônima crua.
ALTER TABLE cotacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE indices  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cotacoes_select" ON cotacoes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cotacoes_insert" ON cotacoes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cotacoes_update" ON cotacoes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "indices_select" ON indices FOR SELECT TO authenticated USING (true);
CREATE POLICY "indices_insert" ON indices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "indices_update" ON indices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Sem policy de DELETE de propósito: cache não se apaga pela API.

-- ── USUARIOS: RLS ligado e zero policy, ou seja, ninguém entrava ────────
CREATE POLICY "usuarios_select" ON usuarios FOR SELECT USING (id = auth.uid());
CREATE POLICY "usuarios_insert" ON usuarios FOR INSERT WITH CHECK (id = auth.uid());

-- ── CONTROLE_CARGAS: não é deste projeto ────────────────────────────────
-- É a tabela de agendamento dos robôs do ambiente_dev, que falam com o
-- Postgres direto via psycopg (dono da tabela, RLS não se aplica). Ela não
-- tem por que estar no PostREST; tirar o grant a remove da superfície da API
-- em vez de deixá-la "protegida" por ausência de policy.
REVOKE ALL ON TABLE public.controle_cargas FROM anon, authenticated;

-- ── VIEWS: SECURITY DEFINER furava o RLS das tabelas de baixo ───────────
-- Todas as seis leem transacoes, contas, snapshots_saldo ou ingestion_log.
-- Como DEFINER, rodavam com a permissão de quem criou — o RLS que acabamos
-- de arrumar não valia para elas, e bastava consultar a view para ver o
-- dado de outro usuário. Com invoker, valem as regras de quem consulta.
ALTER VIEW vw_fluxo_mensal          SET (security_invoker = true);
ALTER VIEW vw_patrimonio_mensal     SET (security_invoker = true);
ALTER VIEW vw_reconciliacao_mensal  SET (security_invoker = true);
ALTER VIEW vw_fila_revisao          SET (security_invoker = true);
ALTER VIEW vw_ultima_execucao       SET (security_invoker = true);
ALTER VIEW vw_conferencia_cartao    SET (security_invoker = true);

-- ── Dono por omissão ────────────────────────────────────────────────────
-- Mesma rede de proteção que a 14 deu a regras_categoria. `criarConta` no
-- onboarding gravava sem usuario_id e tomava 42501 — o cadastro de conta
-- estava quebrado pelo mesmo motivo que a regra de categoria.
ALTER TABLE contas     ALTER COLUMN usuario_id SET DEFAULT auth.uid();
ALTER TABLE categorias ALTER COLUMN usuario_id SET DEFAULT auth.uid();

-- ── ATIVOS: ticker único no banco inteiro ───────────────────────────────
-- Mesmo problema que `regras_categoria.padrao` tinha: o segundo usuário a
-- cadastrar PETR4 colidiria com a linha do primeiro, que ele não enxerga
-- para atualizar. NULLS NOT DISTINCT mantém a dedupe de ativo sem conta,
-- que com a regra padrão do Postgres passaria a duplicar.
ALTER TABLE ativos DROP CONSTRAINT ativos_ticker_key;
ALTER TABLE ativos ADD CONSTRAINT ativos_conta_ticker_key
  UNIQUE NULLS NOT DISTINCT (conta_id, ticker);

-- ── Verificação ─────────────────────────────────────────────────────────
SELECT c.relname AS tabela, c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;
