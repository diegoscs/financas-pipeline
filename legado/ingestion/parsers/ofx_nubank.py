import codecs
import re
from decimal import Decimal

from ofxparse import OfxParser

from ..schemas import ResultadoParse, Snapshot, Transacao

_PIX = re.compile(r"\b(PIX|TRANSFERENCIA)\b", re.I)
_PAGAMENTO_FATURA = re.compile(r"PAGAMENTO\s+(RECEBIDO|DE\s+FATURA|EFETUADO)", re.I)


def parse(caminho: str, conta_id: int, fonte: str) -> ResultadoParse:
    """Lê OFX do Nubank (cartão ou conta). Sinais já vêm na convenção correta."""
    res = ResultadoParse()

    with codecs.open(caminho) as f:
        ofx = OfxParser.parse(f)

    conta = ofx.account
    ext = conta.statement

    for t in ext.transactions:
        desc = t.memo or t.payee or ""
        eh_interna = bool(_PAGAMENTO_FATURA.search(desc))

        res.transacoes.append(
            Transacao(
                conta_id=conta_id,
                data=t.date.date(),
                valor=Decimal(str(t.amount)),
                descricao=desc,
                fonte=fonte,
                metodo="pix" if _PIX.search(desc) else ("credito" if conta.type == 2 else "debito"),
                eh_interna=eh_interna,
                id_externo=t.id,
            )
        )

    # O OFX carrega o saldo — é o que dispensa registro manual.
    # Em cartão o BALAMT já vem negativo, que é exatamente a convenção de passivo.
    if ext.balance is not None:
        res.snapshot = Snapshot(
            conta_id=conta_id,
            data_ref=ext.balance_date.date(),
            saldo=Decimal(str(ext.balance)),
            fonte=fonte,
        )

    # FITID não é chave única no Nubank: uma compra internacional e o IOF dela
    # compartilham o mesmo FITID. Registrado como aviso, não como erro — o
    # hash_natural é que garante a unicidade.
    ids = [t.id for t in ext.transactions if t.id]
    if len(set(ids)) != len(ids):
        res.avisos.append(
            f"FITID repetido: {len(set(ids))} únicos em {len(ids)} lançamentos"
        )

    return res
