import os
import uuid
from decimal import Decimal
import psycopg2
from dotenv import load_dotenv

from .schemas import Transacao

load_dotenv()


def _get_connection():
    """Cria conexão com PostgreSQL"""
    return psycopg2.connect(
        host=os.getenv("SUPABASE_DB_HOST"),
        port=os.getenv("SUPABASE_DB_PORT"),
        database=os.getenv("SUPABASE_DB_NAME"),
        user=os.getenv("SUPABASE_DB_USER"),
        password=os.getenv("SUPABASE_DB_PASSWORD"),
    )


def pareador_transferencias(transacoes: list) -> list:
    """
    Identifica pares de transferência interna e marca como eh_interna=true.

    Heurística:
    - Mesmo valor absoluto
    - Sinais opostos (uma negativa, uma positiva)
    - Mesma data ou diferença de 1 dia
    - Descrição similar (contém "PIX", "TRANSFERENCIA", "TED")

    Exemplo:
      2026-07-15 -500 PIX JOAO (eh_interna=false → eh_interna=true)
      2026-07-15 +500 PIX RECEBIDO (eh_interna=false → eh_interna=true)
      ↓
      Ambas recebem transferencia_id=uuid e eh_interna=true

    Args:
        transacoes: list de Transacao

    Returns:
        list de Transacao (com eh_interna e transferencia_id preenchidos)
    """
    if not transacoes:
        return transacoes

    pareados = set()  # Hashes dos já pareados

    for i, t1 in enumerate(transacoes):
        if t1.hash_natural in pareados:
            continue

        # Procurar par para t1
        for j, t2 in enumerate(transacoes[i + 1 :], start=i + 1):
            if t2.hash_natural in pareados:
                continue

            # Critérios para pareamento
            if _sao_pares(t1, t2):
                # Gerar ID único para esse par
                pair_id = str(uuid.uuid4())

                t1.eh_interna = True
                t1.transferencia_id = pair_id
                pareados.add(t1.hash_natural)

                t2.eh_interna = True
                t2.transferencia_id = pair_id
                pareados.add(t2.hash_natural)

                break

    return transacoes


def _sao_pares(t1: Transacao, t2: Transacao) -> bool:
    """
    Verifica se duas transações são um par de transferência interna.

    Critérios:
    1. Valores opostos (t1.valor = -t2.valor)
    2. Datas próximas (mesma data ou 1 dia de diferença)
    3. Descrição contém "PIX", "TRANSFERENCIA", "TED", "DEPOSITO", "PAGAMENTO"
    """
    # Valores opostos?
    if abs(t1.valor + t2.valor) > Decimal("0.01"):  # Tolerância de centavo
        return False

    # Datas próximas?
    dias_diff = abs((t1.data - t2.data).days)
    if dias_diff > 1:
        return False

    # Descrição contém palavra-chave?
    palavras_chave = ["PIX", "TRANSFERENCIA", "TED", "DEPOSITO", "PAGAMENTO", "RECEBIDO"]
    desc1_upper = t1.descricao.upper()
    desc2_upper = t2.descricao.upper()

    tem_chave = any(palavra in desc1_upper or palavra in desc2_upper for palavra in palavras_chave)
    if not tem_chave:
        return False

    return True


def atualizar_transferencias_no_bd(transacoes: list) -> dict:
    """
    Atualiza eh_interna e transferencia_id no banco de dados.

    Args:
        transacoes: list de Transacao (já com pareamento feito)

    Returns:
        {
            'atualizadas': int,
            'pareadas': int (transações que fazem parte de um par)
        }
    """
    if not transacoes:
        return {"atualizadas": 0, "pareadas": 0}

    conn = _get_connection()
    cursor = conn.cursor()

    atualizadas = 0
    pareadas = 0

    for transacao in transacoes:
        if transacao.eh_interna:
            cursor.execute("""
                UPDATE transacoes
                SET eh_interna = true,
                    transferencia_id = %s
                WHERE hash_natural = %s
            """, (
                transacao.transferencia_id,
                transacao.hash_natural,
            ))

            if cursor.rowcount > 0:
                atualizadas += 1
                pareadas += 1

    conn.commit()
    cursor.close()
    conn.close()

    return {
        "atualizadas": atualizadas,
        "pareadas": pareadas,
    }
