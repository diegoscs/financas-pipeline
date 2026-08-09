-- Rodar ANTES de publicar a app em qualquer URL pública.
--
-- Remove as policies que liberam a base inteira para o papel anon (a chave
-- que fica embutida no JavaScript do browser). Depois disso a app só volta
-- a funcionar com Supabase Auth configurado.

drop policy if exists tmp_anon_contas         on contas;
drop policy if exists tmp_anon_categorias     on categorias;
drop policy if exists tmp_anon_regras         on regras_categoria;
drop policy if exists tmp_anon_transacoes     on transacoes;
drop policy if exists tmp_anon_snapshots      on snapshots_saldo;
drop policy if exists tmp_anon_ingestion_log  on ingestion_log;

-- Conferir que não sobrou nenhuma:
select policyname, tablename from pg_policies
where schemaname = 'public' and policyname like 'tmp_anon_%';

-- ── Substituto com auth (descomentar quando houver login) ───────────────────
-- Requer uma coluna user_id uuid em cada tabela de dados, com
-- default auth.uid() e referências a auth.users(id).
--
-- create policy dono_le    on transacoes for select to authenticated
--   using (user_id = auth.uid());
-- create policy dono_grava on transacoes for insert to authenticated
--   with check (user_id = auth.uid());
