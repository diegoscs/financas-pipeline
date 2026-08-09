-- =============================================================
-- MIGRATION 02 — Lineage do bronze + observabilidade
-- Rodar DEPOIS de schema_financas.sql
-- =============================================================

-- -------------------------------------------------------------
-- Rastreabilidade: cada transação aponta pro arquivo cru
-- que a originou no Supabase Storage.
-- -------------------------------------------------------------
alter table transacoes
  add column if not exists bronze_path text;

comment on column transacoes.bronze_path is
  'Caminho no bucket bronze. Ex: itau_conta/ano=2026/mes=07/2026-07-29T093000_a1b2c3.ofx';

-- -------------------------------------------------------------
-- Log de execução — transforma "rodou" em "rodou bem"
-- -------------------------------------------------------------
create table if not exists ingestion_log (
  id             bigserial primary key,
  execucao_id    uuid not null,          -- agrupa todas as fontes de uma rodada
  fonte          text not null,
  bronze_path    text,
  status         text not null check (status in ('ok','vazio','erro')),
  linhas_lidas   integer not null default 0,
  linhas_novas   integer not null default 0,
  linhas_dup     integer not null default 0,   -- ignoradas pelo hash_natural
  erro_msg       text,
  duracao_ms     integer,
  iniciado_em    timestamptz not null default now()
);

create index if not exists idx_log_execucao on ingestion_log (execucao_id);
create index if not exists idx_log_erro on ingestion_log (iniciado_em desc)
  where status = 'erro';

-- Resumo da última rodada — primeira coisa a olhar no Metabase
create or replace view vw_ultima_execucao as
select fonte, status, linhas_lidas, linhas_novas, linhas_dup,
       duracao_ms, iniciado_em, erro_msg
from ingestion_log
where execucao_id = (
  select execucao_id from ingestion_log order by iniciado_em desc limit 1
)
order by fonte;

-- -------------------------------------------------------------
-- CONFERÊNCIA DE CARTÃO
-- Como o cartão entra no patrimônio, existem duas fontes para a
-- mesma dívida: as transações lançadas e o snapshot de saldo.
-- Elas TÊM que concordar. Divergência = compra faltando,
-- pagamento não lançado, ou parcela futura contaminando o saldo.
-- -------------------------------------------------------------
create or replace view vw_conferencia_cartao as
with calculado as (
  -- Soma de tudo no cartão: compras (negativas) + pagamentos (positivos)
  -- = dívida líquida em aberto.
  select t.conta_id, sum(t.valor) as saldo_calculado
  from transacoes t
  join contas c on c.id = t.conta_id
  where c.tipo = 'cartao'
  group by t.conta_id
),
ultimo_snap as (
  select distinct on (s.conta_id)
         s.conta_id, s.saldo as saldo_snapshot, s.data_ref
  from snapshots_saldo s
  join contas c on c.id = s.conta_id
  where c.tipo = 'cartao'
  order by s.conta_id, s.data_ref desc
)
select
  ct.nome,
  u.data_ref,
  c.saldo_calculado,
  u.saldo_snapshot,
  u.saldo_snapshot - c.saldo_calculado as diferenca,
  case
    when u.saldo_snapshot is null then 'sem_snapshot'
    when abs(u.saldo_snapshot - c.saldo_calculado) <= 1.00 then 'ok'
    else 'investigar'
  end as status
from contas ct
left join calculado c   on c.conta_id = ct.id
left join ultimo_snap u on u.conta_id = ct.id
where ct.tipo = 'cartao' and ct.ativa;
