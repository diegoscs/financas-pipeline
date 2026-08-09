#!/usr/bin/env python3
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(
    host=os.getenv("SUPABASE_DB_HOST"),
    port=os.getenv("SUPABASE_DB_PORT"),
    database=os.getenv("SUPABASE_DB_NAME"),
    user=os.getenv("SUPABASE_DB_USER"),
    password=os.getenv("SUPABASE_DB_PASSWORD"),
)
cursor = conn.cursor()

print("🔧 Corrigindo data de fechamento da fatura...")
print("="*60)

# 1. Adicionar coluna
try:
    cursor.execute("ALTER TABLE transacoes ADD COLUMN data_fechamento_fatura DATE")
    conn.commit()
    print("✓ Coluna criada")
except psycopg2.Error as e:
    if "already exists" in str(e):
        print("✓ Coluna já existe")
    else:
        print(f"Erro: {e}")
    conn.rollback()

# 2. Corrigir Itaú (vencimento 10/08 → transações até 09/08 são de julho)
cursor.execute("""
UPDATE transacoes
SET data_fechamento_fatura = '2026-08-10'::date
WHERE fonte = 'xlsx_itau_cartao'
  AND data < '2026-08-10'::date
  AND data_fechamento_fatura IS NULL
""")
itau_count = cursor.rowcount
conn.commit()
print(f"✓ Itaú: {itau_count} transações corrigidas para fatura de julho")

# 3. Corrigir Nubank (vencimento 01/08 → transações até 31/07 são de julho)
cursor.execute("""
UPDATE transacoes
SET data_fechamento_fatura = '2026-08-01'::date
WHERE fonte = 'ofx_nubank_cartao'
  AND data < '2026-08-01'::date
  AND data_fechamento_fatura IS NULL
""")
nubank_count = cursor.rowcount
conn.commit()
print(f"✓ Nubank: {nubank_count} transações corrigidas para fatura de julho")

# 4. Verificar
print("\n📊 VERIFICAÇÃO:")
print("="*60)
cursor.execute("""
SELECT
  fonte,
  data_fechamento_fatura,
  COUNT(*) as total,
  SUM(valor) as soma
FROM transacoes
WHERE data_fechamento_fatura IS NOT NULL
GROUP BY fonte, data_fechamento_fatura
ORDER BY fonte, data_fechamento_fatura
""")

for row in cursor.fetchall():
    print(f"{row[0]:20s} | Fatura: {row[1]} | {row[2]:3d} trans. | R$ {row[3]:.2f}")

cursor.close()
conn.close()
print("\n✅ Correção concluída!")
