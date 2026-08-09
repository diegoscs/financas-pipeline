from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass
class Transacao:
    """Contrato canônico. Todo parser retorna isto, seja OFX, XLSX ou CSV."""
    conta_id: int
    data: date
    valor: Decimal          # negativo = saída, positivo = entrada. SEMPRE.
    descricao: str
    fonte: str
    metodo: Optional[str] = None
    contraparte: Optional[str] = None
    eh_interna: bool = False
    id_externo: Optional[str] = None   # FITID etc. Guardado, nunca usado como chave.
    ocorrencia: int = 1                # índice dentro do grupo idêntico do arquivo
    hash_natural: Optional[str] = None
    bronze_path: Optional[str] = None
    categoria_id: Optional[int] = None
    origem_categoria: Optional[str] = None
    confianca: Optional[float] = None
    transferencia_id: Optional[str] = None


@dataclass
class Snapshot:
    """Saldo de uma conta num instante. Cartão vem negativo (passivo)."""
    conta_id: int
    data_ref: date
    saldo: Decimal
    fonte: str
    observacao: str = ""


@dataclass
class ResultadoParse:
    transacoes: list = field(default_factory=list)
    snapshot: Optional[Snapshot] = None
    avisos: list = field(default_factory=list)
