import os
import psycopg2
from dotenv import load_dotenv
import re

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


def _carregar_regras():
    """Carrega regras de categorização do banco ordenadas por prioridade."""
    conn = _get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT r.id, r.padrao, r.categoria_id, c.nome as categoria_nome
        FROM regras_categoria r
        JOIN categorias c ON c.id = r.categoria_id
        WHERE r.ativa = true
        ORDER BY r.prioridade ASC
    """)

    regras = []
    for row in cursor.fetchall():
        regras.append({
            "id": row[0],
            "padrao": row[1],
            "categoria_id": row[2],
            "categoria_nome": row[3],
        })

    cursor.close()
    conn.close()

    return regras


def categorizar(transacoes: list) -> list:
    """
    Aplica regras de categorização às transações.

    Fluxo:
    1. Carrega regras de regras_categoria (ORDER BY prioridade)
    2. Para cada transação:
       - Testa regex contra descricao normalizada
       - Se match: atualiza categoria_id, origem_categoria='regra', confianca=0.95
       - Se sem match: categoria_id = 'Não classificado', confianca=0
    3. Retorna transações categorizadas

    Args:
        transacoes: list de Transacao

    Returns:
        list de Transacao (com categoria_id preenchido)
    """
    if not transacoes:
        return transacoes

    regras = _carregar_regras()
    categoria_nao_classificado = _obter_id_nao_classificado()

    for transacao in transacoes:
        categorizado = False

        # Testar cada regra em ordem de prioridade
        for regra in regras:
            try:
                if re.search(regra["padrao"], transacao.descricao, re.IGNORECASE):
                    transacao.categoria_id = regra["categoria_id"]
                    transacao.origem_categoria = "regra"
                    transacao.confianca = 0.95
                    categorizado = True
                    break  # Primeira regra que bate vence
            except re.error:
                # Padrão regex inválido — pular
                pass

        # Se nenhuma regra bateu, marcar como não classificado
        if not categorizado:
            transacao.categoria_id = categoria_nao_classificado
            transacao.origem_categoria = None
            transacao.confianca = 0.0

    return transacoes


def _obter_id_nao_classificado():
    """Busca o ID da categoria 'Não classificado'."""
    conn = _get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM categorias WHERE nome = 'Não classificado'")
    result = cursor.fetchone()

    cursor.close()
    conn.close()

    if result:
        return result[0]
    else:
        # Fallback: retorna 15 (visto no schema_financas.sql)
        return 15


def atualizar_categorias_no_bd(transacoes: list) -> dict:
    """
    Atualiza categoria_id, origem_categoria e confianca no banco de dados.

    Args:
        transacoes: list de Transacao (já categorizadas)

    Returns:
        {
            'atualizadas': int,
            'nao_classificadas': int,
            'regras_aplicadas': int
        }
    """
    if not transacoes:
        return {"atualizadas": 0, "nao_classificadas": 0, "regras_aplicadas": 0}

    conn = _get_connection()
    cursor = conn.cursor()

    atualizadas = 0
    nao_classificadas = 0
    regras_aplicadas = 0

    categoria_nao_classificado = _obter_id_nao_classificado()

    for transacao in transacoes:
        cursor.execute("""
            UPDATE transacoes
            SET categoria_id = %s,
                origem_categoria = %s,
                confianca = %s
            WHERE hash_natural = %s
        """, (
            transacao.categoria_id,
            transacao.origem_categoria,
            float(transacao.confianca) if transacao.confianca else None,
            transacao.hash_natural,
        ))

        if cursor.rowcount > 0:
            atualizadas += 1
            if transacao.categoria_id == categoria_nao_classificado:
                nao_classificadas += 1
            else:
                regras_aplicadas += 1

    conn.commit()
    cursor.close()
    conn.close()

    return {
        "atualizadas": atualizadas,
        "nao_classificadas": nao_classificadas,
        "regras_aplicadas": regras_aplicadas,
    }
