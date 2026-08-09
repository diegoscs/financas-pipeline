-- =============================================================
-- PIPELINE DE FINANÇAS PESSOAIS — SCHEMA (PostgreSQL / Supabase)
-- =============================================================
-- CONVENÇÕES IMPORTANTES (respeitar em todo o pipeline):
--   1. valor > 0  => entrada de dinheiro
--      valor < 0  => saída de dinheiro
--      Nunca usar coluna separada de "tipo débito/crédito".
--   2. Contas do tipo 'cartao' são PASSIVO: snapshot de saldo é
--      lançado NEGATIVO (fatura em aberto = dívida).
--   3. Transferência entre contas suas (incl. aporte em
--      investimento e pagamento de fatura) => eh_interna = true.
--      Isso NÃO é gasto e NÃO é receita.
-- =============================================================

-- -------------------------------------------------------------
-- DIMENSÃO: contas
-- -------------------------------------------------------------
create table if not exists contas (
  id            smallint primary key,
  nome          text not null unique,          -- 'Nubank Cartão'
  instituicao   text not null,                 -- 'nubank' | 'itau' | 'caixa_fisico'
  tipo          text not null check (tipo in ('corrente','cartao','investimento','dinheiro')),
  entra_no_patrimonio boolean not null default true,
  ativa         boolean not null default true
);

insert into contas (id, nome, instituicao, tipo) values
  (1, 'Nubank Conta',   'nubank', 'corrente'),
  (2, 'Nubank Cartão',  'nubank', 'cartao'),
  (3, 'Itau Conta',     'itau',   'corrente'),
  (4, 'Itau Cartão',    'itau',   'cartao'),
  (5, 'Dinheiro/VR',    'manual', 'dinheiro')
on conflict (id) do nothing;

-- -------------------------------------------------------------
-- DIMENSÃO: categorias (2 níveis — grupo controla o cálculo)
-- -------------------------------------------------------------
create table if not exists categorias (
  id      smallserial primary key,
  nome    text not null unique,
  grupo   text not null check (grupo in ('receita','essencial','nao_essencial','investimento','interna'))
);

insert into categorias (nome, grupo) values
  ('Salário','receita'), ('Freelance','receita'),
  ('Moradia','essencial'), ('Mercado','essencial'), ('Transporte','essencial'),
  ('Saúde','essencial'), ('Educação','essencial'),
  ('Delivery','nao_essencial'), ('Lazer','nao_essencial'),
  ('Assinaturas','nao_essencial'), ('Compras','nao_essencial'),
  ('Aporte','investimento'),
  ('Transferência interna','interna'), ('Pagamento de fatura','interna'),
  ('Não classificado','nao_essencial')
on conflict (nome) do nothing;

-- -------------------------------------------------------------
-- REGRAS de categorização (regex, versionável, não hardcoded)
-- -------------------------------------------------------------
create table if not exists regras_categoria (
  id           smallserial primary key,
  padrao       text not null,        -- regex, aplicado com ~* (case-insensitive)
  categoria_id smallint not null references categorias(id),
  prioridade   smallint not null default 100,  -- menor = avaliado primeiro
  ativa        boolean not null default true
);

-- -------------------------------------------------------------
-- FATO: transacoes
-- -------------------------------------------------------------
create table if not exists transacoes (
  id             uuid primary key default gen_random_uuid(),

  -- Chave de idempotência: sha256(conta_id|data|valor|descricao_normalizada)
  -- Permite reprocessar períodos sobrepostos sem duplicar.
  hash_natural   text not null unique,

  conta_id       smallint not null references contas(id),
  data           date not null,
  valor          numeric(12,2) not null check (valor <> 0),
  descricao      text not null,
  contraparte    text,                       -- nome/chave de quem recebeu o Pix
  metodo         text check (metodo in ('pix','credito','debito','ted','boleto','dinheiro','outro')),

  categoria_id   smallint references categorias(id),
  origem_categoria text check (origem_categoria in ('regra','llm','manual')),
  confianca      numeric(3,2),               -- 0..1, usado pra fila de revisão

  eh_interna     boolean not null default false,
  transferencia_id uuid,                     -- agrupa as 2 pernas de uma transferência

  fonte          text not null,              -- 'ofx_itau' | 'api_nubank' | 'telegram'
  ingerido_em    timestamptz not null default now()
);

create index if not exists idx_trans_data      on transacoes (data desc);
create index if not exists idx_trans_conta_data on transacoes (conta_id, data desc);
create index if not exists idx_trans_revisao   on transacoes (data)
  where categoria_id is null or confianca < 0.7;

-- -------------------------------------------------------------
-- SNAPSHOTS de saldo — a "verdade" do patrimônio
-- -------------------------------------------------------------
-- Sem isso é impossível saber quanto você REALMENTE guardou.
-- Grave o saldo de cada conta a cada rodada semanal.
create table if not exists snapshots_saldo (
  conta_id   smallint not null references contas(id),
  data_ref   date not null,
  saldo      numeric(14,2) not null,
  fonte      text not null,
  primary key (conta_id, data_ref)
);

-- =============================================================
-- VIEWS ANALÍTICAS
-- =============================================================

-- MÉTODO 1 — FLUXO: quanto entrou menos quanto saiu
create or replace view vw_fluxo_mensal as
select
  date_trunc('month', t.data)::date                                as mes,
  sum(t.valor) filter (where t.valor > 0)                          as receita,
  abs(sum(t.valor) filter (where t.valor < 0))                     as despesa_total,
  abs(sum(t.valor) filter (where t.valor < 0 and c.grupo = 'essencial'))     as despesa_essencial,
  abs(sum(t.valor) filter (where t.valor < 0 and c.grupo = 'nao_essencial')) as despesa_nao_essencial,
  abs(sum(t.valor) filter (where t.valor < 0 and c.grupo = 'investimento'))  as aportes,
  sum(t.valor)                                                     as guardado_fluxo
from transacoes t
left join categorias c on c.id = t.categoria_id
where t.eh_interna = false          -- <<< crítico: exclui as duas pernas
group by 1;

-- MÉTODO 2 — ESTOQUE: variação do patrimônio entre fechamentos
create or replace view vw_patrimonio_mensal as
with snap_ranked as (
  select
    s.conta_id,
    date_trunc('month', s.data_ref)::date as mes,
    s.saldo,
    row_number() over (
      partition by s.conta_id, date_trunc('month', s.data_ref)
      order by s.data_ref desc
    ) as rn
  from snapshots_saldo s
  join contas ct on ct.id = s.conta_id and ct.entra_no_patrimonio
),
por_mes as (
  select mes, sum(saldo) as patrimonio
  from snap_ranked where rn = 1
  group by mes
)
select
  mes,
  patrimonio,
  patrimonio - lag(patrimonio) over (order by mes) as guardado_estoque
from por_mes;

-- RECONCILIAÇÃO — a métrica de qualidade do pipeline
-- Se o gap for grande, existe gasto não rastreado ou erro de
-- classificação (transferência não marcada como interna).
create or replace view vw_reconciliacao_mensal as
select
  f.mes,
  f.receita,
  f.despesa_total,
  f.guardado_fluxo,
  p.guardado_estoque,
  p.guardado_estoque - f.guardado_fluxo as gap,
  round(
    100.0 * abs(p.guardado_estoque - f.guardado_fluxo) / nullif(f.receita, 0)
  , 1) as gap_pct_receita,
  case
    when p.guardado_estoque is null then 'sem_snapshot'
    when abs(p.guardado_estoque - f.guardado_fluxo)
         <= greatest(50, 0.03 * coalesce(f.receita, 0)) then 'ok'
    else 'investigar'
  end as status
from vw_fluxo_mensal f
left join vw_patrimonio_mensal p using (mes)
order by f.mes desc;

-- FILA DE REVISÃO — o que o pipeline não resolveu sozinho
create or replace view vw_fila_revisao as
select id, data, conta_id, valor, descricao, contraparte, confianca
from transacoes
where categoria_id is null
   or categoria_id = (select id from categorias where nome = 'Não classificado')
   or confianca < 0.7
order by abs(valor) desc;
