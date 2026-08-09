import hashlib
import os
from datetime import datetime
from pathlib import Path

from supabase import create_client
import os as os_module

from dotenv import load_dotenv

load_dotenv()


def upload_bronze(arquivo_path: str, fonte: str) -> str:
    """
    Sobe arquivo cru pro bucket 'bronze' do Supabase Storage.

    Args:
        arquivo_path: caminho local absoluto do arquivo
        fonte: identificador (ex: 'ofx_nubank_cartao', 'xlsx_itau_cartao')

    Returns:
        bronze_path: str no formato
          {fonte}/ano={YYYY}/mes={MM}/{timestamp}_{hash8}.{ext}
          Ex: ofx_nubank_cartao/ano=2026/mes=07/2026-07-29T093000_a1b2c3d4.ofx

    Raises:
        FileNotFoundError: arquivo não existe
        Exception: erro de conexão Supabase
    """
    if not os_module.path.exists(arquivo_path):
        raise FileNotFoundError(f"Arquivo não encontrado: {arquivo_path}")

    # Conectar ao Supabase
    supabase_url = os_module.getenv("SUPABASE_URL")
    supabase_key = os_module.getenv("SUPABASE_SECRET_KEY")
    supabase = create_client(supabase_url, supabase_key)

    # Ler arquivo e gerar hash8
    with open(arquivo_path, "rb") as f:
        file_content = f.read()
    hash8 = hashlib.sha256(file_content).hexdigest()[:8]

    # Extrair extensão
    ext = Path(arquivo_path).suffix.lstrip(".")

    # Gerar timestamp (ISO format, sem separadores para ficar compacto)
    now = datetime.now()
    timestamp = now.strftime("%Y-%m-%dT%H%M%S")
    year = now.strftime("%Y")
    month = now.strftime("%m")

    # Montar caminho: {fonte}/ano={YYYY}/mes={MM}/{timestamp}_{hash8}.{ext}
    filename = f"{timestamp}_{hash8}.{ext}"
    bronze_path = f"{fonte}/ano={year}/mes={month}/{filename}"

    # Upload para Supabase Storage
    supabase.storage.from_("bronze").upload(
        path=bronze_path,
        file=file_content,
        file_options={"content-type": "application/octet-stream"},
    )

    return bronze_path
