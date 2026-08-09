-- Adicionar coluna de data de fechamento da fatura
ALTER TABLE transacoes
ADD COLUMN IF NOT EXISTS data_fechamento_fatura DATE;

-- Correção dos dados históricos:
-- Itaú Cartão: vencimento 10/08, então transações até 09/08 são de julho
UPDATE transacoes
SET data_fechamento_fatura = '2026-08-10'::date
WHERE fonte = 'xlsx_itau_cartao'
  AND data < '2026-08-10'::date
  AND data_fechamento_fatura IS NULL;

-- Nubank: vencimento 01/08, então transações até 31/07 são de julho
UPDATE transacoes
SET data_fechamento_fatura = '2026-08-01'::date
WHERE fonte = 'ofx_nubank_cartao'
  AND data < '2026-08-01'::date
  AND data_fechamento_fatura IS NULL;

-- Verificar correções
SELECT 
  fonte,
  COUNT(*) as total,
  COUNT(DISTINCT data_fechamento_fatura) as periodos,
  MIN(data_fechamento_fatura) as primeira_fatura,
  MAX(data_fechamento_fatura) as ultima_fatura
FROM transacoes
WHERE data_fechamento_fatura IS NOT NULL
GROUP BY fonte;
