-- =========================================================================
-- Adicionar suporte a múltiplos usuários: armazenar CPF por conta
-- =========================================================================

-- Adicionar coluna cpf_mascarado para reconhecimento de transferências internas
ALTER TABLE contas ADD COLUMN IF NOT EXISTS cpf_mascarado text;

-- Adicionar comentário explicativo
COMMENT ON COLUMN contas.cpf_mascarado IS 'CPF/CNPJ mascarado do titular (ex: "406.048" de "•••.406.048-••"). Usado para reconhecer transferências entre contas próprias no extrato.';

-- Para o usuário atual, popular com CPF conhecido
-- O usuário precisa fornecer isto no onboarding depois
-- UPDATE contas SET cpf_mascarado = '406.048' WHERE nome LIKE '%Nubank%' OR nome LIKE '%Itau%' OR nome LIKE '%C6%' OR nome LIKE '%Santander%' OR nome LIKE '%Bradesco%';
