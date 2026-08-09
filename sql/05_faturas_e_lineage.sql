-- =============================================================
-- MIGRATION 05 — Faturas, lineage e chaves secundárias
--
-- Estas mudanças foram aplicadas direto no Supabase durante o
-- desenvolvimento e não existiam em arquivo. Consolidadas aqui para o
-- schema ser reproduzível do zero.
-- =============================================================

-- ── Faturas (ADR-001) ───────────────────────────────────────────────────────
-- A fatura de agosto contém compras de julho. transacoes.data continua sendo
-- a data da COMPRA (regime de caixa); a competência é uma dimensão nova.

create table if not exists faturas (
  id             bigserial primary key,
  conta_id       smallint not null references contas(id),
  -- primeiro dia do mês de referência: 2026-08-01 = fatura de agosto/2026
  competencia    date not null,
  vencimento     date,
  valor_total    numeric,
  status         text not null default 'aberta'
                 check (status in ('aberta','fechada','paga')),
  arquivo_origem text,
  criada_em      timestamptz not null default now(),
  atualizada_em  timestamptz not null default now(),

  -- Segunda trava, independente do hash_natural. O hash impede o mesmo
  -- LANÇAMENTO entrar duas vezes; isto impede a mesma FATURA entrar duas
  -- vezes mesmo que o banco reemita o arquivo com descrições diferentes.
  unique (conta_id, competencia)
);

comment on column faturas.competencia is
  'Primeiro dia do mês de referência. 2026-08-01 = fatura de agosto/2026.';

alter table faturas enable row level security;

-- ── Colunas novas em transacoes ─────────────────────────────────────────────
alter table transacoes add column if not exists fatura_id   bigint references faturas(id) on delete set null;
alter table transacoes add column if not exists id_externo  text;
alter table transacoes add column if not exists execucao_id uuid;
alter table transacoes add column if not exists apelido     text;

comment on column transacoes.fatura_id is
  'Fatura em que o lançamento foi cobrado. Nulo para conta corrente e dinheiro.';

-- FITID do OFX. NÃO é único: no Nubank a compra internacional e o IOF dela
-- compartilham o mesmo. Usado junto com o valor para detectar reexportação
-- com descrição alterada — caso real em que R$ 4,00 foram contados duas vezes
-- porque o mesmo IOF veio como 'IOF de compra internacional' e depois como
-- 'IOF de "Anthropic* Claude Sub"'.
comment on column transacoes.id_externo is
  'FITID do OFX. Não é único; usar sempre com valor. Checagem secundária ao hash_natural.';

comment on column transacoes.execucao_id is
  'Lote de importação. Permite desfazer um import sem tocar nos outros.';

-- 'descricao' entra no hash_natural, então é imutável. Renomear para exibição
-- grava aqui: mudar a descrição quebraria o dedupe.
comment on column transacoes.descricao is
  'Texto normalizado do banco. IMUTÁVEL: entra no hash_natural e no casamento de regras.';
comment on column transacoes.apelido is
  'Nome dado pelo usuário, só para exibição. Não afeta hash nem regras.';

create index if not exists transacoes_fatura_id_idx   on transacoes (fatura_id);
create index if not exists transacoes_execucao_id_idx on transacoes (execucao_id);
create index if not exists transacoes_id_externo_idx
  on transacoes (conta_id, id_externo, valor) where id_externo is not null;

-- ── ingestion_log vira o histórico de importações ───────────────────────────
alter table ingestion_log add column if not exists conta_id    smallint references contas(id);
alter table ingestion_log add column if not exists arquivo     text;
alter table ingestion_log add column if not exists competencia date;
alter table ingestion_log add column if not exists desfeita_em timestamptz;

alter table ingestion_log enable row level security;

-- ── Categorias ──────────────────────────────────────────────────────────────
-- 'Alimentação fora' faltava: sql/03 referenciava a categoria por nome e ela
-- nunca existiu, então (select id ...) virava NULL e a regra entrava quebrada.
insert into categorias (nome, grupo) values ('Alimentação fora', 'nao_essencial')
on conflict (nome) do nothing;

-- 'Não classificado' estava em 'nao_essencial' e poluía o corte essencial vs
-- não-essencial. Ganha grupo próprio.
alter table categorias drop constraint if exists categorias_grupo_check;
alter table categorias add constraint categorias_grupo_check
  check (grupo = any (array['receita','essencial','nao_essencial','investimento','interna','indefinido']));
update categorias set grupo = 'indefinido' where nome = 'Não classificado';

-- ── Regras ──────────────────────────────────────────────────────────────────
-- Os padrões são compilados com new RegExp() NO BROWSER: são regex JavaScript.
-- Nunca usar \m, \M ou \y (sintaxe do Postgres) — em JS viram literais e a
-- regra passa a casar coisa errada em silêncio. Use \b.
--
-- O padrão é a chave: corrigir a mesma descrição duas vezes tem que TROCAR a
-- regra, não criar uma segunda. Duas regras com o mesmo padrão e categorias
-- diferentes fazem vencer a mais antiga, e a correção nova é ignorada.
alter table regras_categoria drop constraint if exists regras_categoria_padrao_key;
alter table regras_categoria add constraint regras_categoria_padrao_key unique (padrao);

-- ── Policies temporárias ────────────────────────────────────────────────────
-- ⚠ Liberam a base inteira para o papel anon. Ver sql/desfazer_policies_anon.sql
create policy if not exists tmp_anon_faturas       on faturas       for all to anon using (true) with check (true);
create policy if not exists tmp_anon_ingestion_log on ingestion_log for all to anon using (true) with check (true);

-- ── Compras vs saldo (descoberto num extrato real de jan/2026) ──────────────
-- 'valor_total' guardava grandezas diferentes conforme a fonte:
--   XLSX Itaú : 'Valor (parcial)' = soma das COMPRAS do ciclo
--   OFX Nubank: BALAMT            = SALDO devedor no instante do extrato
--
-- Compras 541,58, pagamentos+estorno 2.061,87, saldo final 156,50. Os dois
-- números estão certos e medem coisas diferentes; comparar um com o outro
-- acusava R$ 385,08 de erro inexistente.
alter table faturas add column if not exists total_compras numeric;
alter table faturas add column if not exists saldo_final   numeric;

comment on column faturas.total_compras is 'Soma das compras do ciclo. O "quanto gastei".';
comment on column faturas.saldo_final   is 'Saldo devedor no fim do período (BALAMT). O "quanto falta pagar".';
comment on column faturas.valor_total   is 'O número que o arquivo chama de total, seja qual for. Mantido para lineage.';
