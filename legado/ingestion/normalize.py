import hashlib
import re
from collections import defaultdict
from decimal import Decimal

from unidecode import unidecode

# Prefixos de gateway de pagamento: "Mp *Doutorgranola", "Dm*Spotify", "Anthropic* Claude"
_GATEWAY = re.compile(r"^(MP|DM|PAG|PAGSEGURO|IUGU|STONE)\s*\*\s*", re.I)
# Padding de caractere repetido que o Itaú insere: "1518aaaaaaaaguaruja"
_PADDING = re.compile(r"([A-Z])\1{3,}")
_ESPACOS = re.compile(r"\s+")


def normalizar_descricao(bruta: str) -> str:
    """Normaliza para hash e para casamento de regras.

    NÃO tenta separar cidade/país do estabelecimento. O Itaú concatena sem
    separador ("Rockaffesao Paulobra") e qualquer heurística para desgrudar
    isso erra mais do que acerta. As regras de categoria casam no prefixo,
    que é a parte estável e informativa.
    """
    s = unidecode(bruta or "").upper().strip()
    s = _GATEWAY.sub("", s)
    s = _PADDING.sub(r"\1", s)
    s = _ESPACOS.sub(" ", s)
    return s.strip()


def calcular_hash(conta_id: int, data, valor: Decimal, desc_norm: str, ocorrencia: int) -> str:
    chave = f"{conta_id}|{data.isoformat()}|{Decimal(valor):.2f}|{desc_norm}|{ocorrencia}"
    return hashlib.sha256(chave.encode("utf-8")).hexdigest()


def atribuir_hashes(transacoes: list) -> list:
    """Numera transações idênticas dentro do arquivo e calcula o hash.

    Dois cafés de R$ 19,90 no mesmo lugar no mesmo dia são gastos distintos e
    legítimos. Sem o índice de ocorrência o hash colide e o dedupe descarta um
    deles silenciosamente. Como o índice deriva da ordem estável do arquivo,
    reprocessar o mesmo arquivo gera exatamente os mesmos hashes.
    """
    contador = defaultdict(int)
    for t in transacoes:
        t.descricao = normalizar_descricao(t.descricao)
        chave = (t.conta_id, t.data, Decimal(t.valor), t.descricao)
        contador[chave] += 1
        t.ocorrencia = contador[chave]
        t.hash_natural = calcular_hash(t.conta_id, t.data, t.valor, t.descricao, t.ocorrencia)
    return transacoes
