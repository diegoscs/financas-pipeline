-- =============================================================
-- MIGRATION 06 — Fechar a base atrás de login
--
-- ⚠ ORDEM OBRIGATÓRIA. Rodar isto antes de existir uma conta deixa o app
--   inacessível: as policies anon somem e não há usuário para entrar.
--
--   1. `npm run dev`, abrir o app, clicar em "Primeira vez? Criar a conta"
--   2. Criar a conta e conseguir ENTRAR (confirmar e-mail se for exigido)
--   3. Só então rodar este arquivo
--   4. No painel do Supabase: Authentication → Sign In / Providers →
--      DESATIVAR "Allow new users to sign up"
--
--   O passo 4 não é opcional. Com cadastro aberto, qualquer pessoa cria uma
--   conta, vira `authenticated` e passa por todas as policies abaixo. A trava
--   inteira depende dele, e ele vive no painel — não neste arquivo.
-- =============================================================

-- ── Fora as policies anônimas ───────────────────────────────────────────────
drop policy if exists tmp_anon_contas          on contas;
drop policy if exists tmp_anon_categorias      on categorias;
drop policy if exists tmp_anon_regras          on regras_categoria;
drop policy if exists tmp_anon_transacoes      on transacoes;
drop policy if exists tmp_anon_snapshots       on snapshots_saldo;
drop policy if exists tmp_anon_ingestion_log   on ingestion_log;
drop policy if exists tmp_anon_ingestion_log_2 on ingestion_log;
drop policy if exists tmp_anon_faturas         on faturas;

-- ── Só quem está logado ─────────────────────────────────────────────────────
-- App de uma pessoa: não há coluna user_id nem segregação por dono. Isso é
-- deliberado — multi-tenancy aqui seria complexidade sem uso. O que separa o
-- dono do resto do mundo é o cadastro estar fechado.
create policy logado_contas        on contas           for all to authenticated using (true) with check (true);
create policy logado_categorias    on categorias       for all to authenticated using (true) with check (true);
create policy logado_regras        on regras_categoria for all to authenticated using (true) with check (true);
create policy logado_transacoes    on transacoes       for all to authenticated using (true) with check (true);
create policy logado_snapshots     on snapshots_saldo  for all to authenticated using (true) with check (true);
create policy logado_ingestion_log on ingestion_log    for all to authenticated using (true) with check (true);
create policy logado_faturas       on faturas          for all to authenticated using (true) with check (true);

-- ── Conferência ─────────────────────────────────────────────────────────────
-- Não pode sobrar nenhuma linha com roles = {anon}.
select tablename, policyname, roles::text
from pg_policies where schemaname = 'public'
order by tablename, policyname;
