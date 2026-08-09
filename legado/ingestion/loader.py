import os
import uuid
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

from .schemas import ResultadoParse

load_dotenv()


def _get_connection():
    """Cria conexão com PostgreSQL via credenciais do .env"""
    return psycopg2.connect(
        host=os.getenv("SUPABASE_DB_HOST"),
        port=os.getenv("SUPABASE_DB_PORT"),
        database=os.getenv("SUPABASE_DB_NAME"),
        user=os.getenv("SUPABASE_DB_USER"),
        password=os.getenv("SUPABASE_DB_PASSWORD"),
    )


def carregar(
    resultado: ResultadoParse,
    bronze_path: str,
    duracao_ms: int,
) -> dict:
    """
    Insere transações, snapshot e log de forma idempotente.

    Operações em sequência:
    1. Insere transações com ON CONFLICT (hash_natural) DO NOTHING
    2. Upsert snapshot em snapshots_saldo por (conta_id, data_ref)
    3. Grava linha em ingestion_log

    Args:
        resultado: ResultadoParse com transacoes, snapshot, avisos
        bronze_path: caminho retornado por upload_bronze()
        duracao_ms: tempo decorrido da parse até aqui

    Returns:
        {
            'execucao_id': UUID,      # agrupa a rodada
            'fonte': str,
            'linhas_lidas': int,      # len(resultado.transacoes)
            'linhas_novas': int,      # INSERT efetivos
            'linhas_dup': int,        # ignoradas pelo ON CONFLICT
            'status': 'ok' | 'vazio' | 'erro',
            'error_msg': Optional[str]
        }
    """
    execucao_id = str(uuid.uuid4())
    fonte = resultado.transacoes[0].fonte if resultado.transacoes else "desconhecida"
    linhas_lidas = len(resultado.transacoes)
    linhas_novas = 0
    linhas_dup = 0
    status = "ok"
    error_msg = None

    try:
        conn = _get_connection()
        cursor = conn.cursor()

        # 1. Inserir transações com ON CONFLICT
        if resultado.transacoes:
            transacoes_data = [
                (
                    t.hash_natural,
                    t.conta_id,
                    str(t.data),
                    float(t.valor),
                    t.descricao,
                    t.contraparte,
                    t.metodo,
                    t.eh_interna,
                    fonte,
                    bronze_path,
                )
                for t in resultado.transacoes
            ]

            returned = execute_values(
                cursor,
                """
                INSERT INTO transacoes
                  (hash_natural, conta_id, data, valor, descricao,
                   contraparte, metodo, eh_interna, fonte, bronze_path)
                VALUES %s
                ON CONFLICT (hash_natural) DO NOTHING
                RETURNING hash_natural
                """,
                transacoes_data,
                fetch=True,
            )
            linhas_novas = len(returned) if returned else 0
            linhas_dup = linhas_lidas - linhas_novas

        # 2. Upsert snapshot
        if resultado.snapshot:
            cursor.execute("""
                INSERT INTO snapshots_saldo
                  (conta_id, data_ref, saldo, fonte)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (conta_id, data_ref) DO UPDATE
                SET saldo = EXCLUDED.saldo, fonte = EXCLUDED.fonte
            """, (
                resultado.snapshot.conta_id,
                str(resultado.snapshot.data_ref),
                float(resultado.snapshot.saldo),
                resultado.snapshot.fonte,
            ))

        # 3. Inserir log de execução
        if linhas_lidas == 0:
            status = "vazio"

        cursor.execute("""
            INSERT INTO ingestion_log
              (execucao_id, fonte, bronze_path, status, linhas_lidas, linhas_novas, linhas_dup, duracao_ms)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            execucao_id,
            fonte,
            bronze_path,
            status,
            linhas_lidas,
            linhas_novas,
            linhas_dup,
            duracao_ms,
        ))

        conn.commit()
        cursor.close()
        conn.close()

    except Exception as e:
        status = "erro"
        error_msg = str(e)
        # Tentar registrar o erro no log mesmo
        try:
            conn = _get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO ingestion_log
                  (execucao_id, fonte, bronze_path, status, linhas_lidas, linhas_novas, linhas_dup, duracao_ms, erro_msg)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                execucao_id,
                fonte,
                bronze_path,
                status,
                linhas_lidas,
                linhas_novas,
                linhas_dup,
                duracao_ms,
                error_msg,
            ))
            conn.commit()
            cursor.close()
            conn.close()
        except Exception:
            pass

    return {
        "execucao_id": execucao_id,
        "fonte": fonte,
        "linhas_lidas": linhas_lidas,
        "linhas_novas": linhas_novas,
        "linhas_dup": linhas_dup,
        "status": status,
        "error_msg": error_msg,
    }
