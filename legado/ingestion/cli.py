import argparse
import sys
import time
from pathlib import Path

from .storage import upload_bronze
from .loader import carregar
from .normalize import atribuir_hashes
from .parsers import ofx_nubank, xlsx_itau
from .categorize import categorizar, atualizar_categorias_no_bd
from .transfers import pareador_transferencias, atualizar_transferencias_no_bd


# Mapeamento de fonte → (parser, conta_id, nome_fonte)
PARSERS = {
    "ofx_nubank_cartao": {
        "parser": ofx_nubank.parse,
        "conta_id": 2,
        "fonte": "ofx_nubank_cartao",
    },
    "ofx_nubank_conta": {
        "parser": ofx_nubank.parse,
        "conta_id": 1,
        "fonte": "ofx_nubank_conta",
    },
    "xlsx_itau_cartao": {
        "parser": xlsx_itau.parse,
        "conta_id": 4,
        "fonte": "xlsx_itau_cartao",
    },
    "xlsx_itau_conta": {
        "parser": xlsx_itau.parse,
        "conta_id": 3,
        "fonte": "xlsx_itau_conta",
    },
}


def main():
    parser = argparse.ArgumentParser(
        description="Pipeline de ingestão: upload → parse → load"
    )
    parser.add_argument(
        "--fonte",
        required=True,
        choices=list(PARSERS.keys()),
        help="Tipo de arquivo e conta",
    )
    parser.add_argument(
        "--arquivo",
        required=True,
        help="Caminho local do arquivo a processar",
    )
    args = parser.parse_args()

    arquivo_path = Path(args.arquivo).resolve()

    if not arquivo_path.exists():
        print(f"❌ Arquivo não encontrado: {arquivo_path}", file=sys.stderr)
        sys.exit(1)

    config = PARSERS[args.fonte]
    parser_func = config["parser"]
    conta_id = config["conta_id"]
    fonte = config["fonte"]

    try:
        # 1. Upload para bronze (ANTES de qualquer coisa)
        print(f"📤 Fazendo upload para bronze...", end=" ")
        bronze_path = upload_bronze(str(arquivo_path), fonte)
        print(f"✓ {bronze_path}")

        # 2. Parse
        print(f"📝 Parseando arquivo...", end=" ")
        inicio = time.time()
        resultado = parser_func(str(arquivo_path), conta_id, fonte)
        atribuir_hashes(resultado.transacoes)
        duracao_ms = int((time.time() - inicio) * 1000)
        print(f"✓ {len(resultado.transacoes)} transações")

        # 3. Load (inserir em DB)
        print(f"💾 Carregando no banco...", end=" ")
        inicio_load = time.time()
        log = carregar(resultado, bronze_path, duracao_ms)
        duracao_load_ms = int((time.time() - inicio_load) * 1000)
        print(f"✓ {log['linhas_novas']} novas, {log['linhas_dup']} dups")

        # 4. Categorizar (Fase 2)
        if log["linhas_novas"] > 0:
            print(f"🏷️  Categorizando...", end=" ")
            inicio_cat = time.time()
            resultado.transacoes = categorizar(resultado.transacoes)
            cat_stats = atualizar_categorias_no_bd(resultado.transacoes)
            duracao_cat_ms = int((time.time() - inicio_cat) * 1000)
            print(f"✓ {cat_stats['regras_aplicadas']} classificadas, {cat_stats['nao_classificadas']} não classificadas")
        else:
            cat_stats = {"regras_aplicadas": 0, "nao_classificadas": 0}
            duracao_cat_ms = 0

        # 5. Pareador de transferências (Fase 2)
        if log["linhas_novas"] > 0:
            print(f"🔗 Pareando transferências...", end=" ")
            inicio_trans = time.time()
            resultado.transacoes = pareador_transferencias(resultado.transacoes)
            trans_stats = atualizar_transferencias_no_bd(resultado.transacoes)
            duracao_trans_ms = int((time.time() - inicio_trans) * 1000)
            print(f"✓ {trans_stats['pareadas']} pareadas")
        else:
            trans_stats = {"pareadas": 0}
            duracao_trans_ms = 0

        # Resumo
        print(f"\n{'='*60}")
        print(f"📊 Resumo da execução")
        print(f"{'='*60}")
        print(f"  execucao_id: {log['execucao_id']}")
        print(f"  fonte: {log['fonte']}")
        print(f"  bronze_path: {bronze_path}")
        print(f"  status: {log['status']}")
        print(f"  linhas_lidas: {log['linhas_lidas']}")
        print(f"  linhas_novas: {log['linhas_novas']}")
        print(f"  linhas_dup: {log['linhas_dup']}")
        print(f"  duracao_parse: {duracao_ms}ms")
        print(f"  duracao_load: {duracao_load_ms}ms")
        print(f"  duracao_categorize: {duracao_cat_ms}ms")
        print(f"  duracao_transfers: {duracao_trans_ms}ms")
        print(f"\n  Categorização:")
        print(f"    regras_aplicadas: {cat_stats['regras_aplicadas']}")
        print(f"    nao_classificadas: {cat_stats['nao_classificadas']}")
        print(f"\n  Transferências:")
        print(f"    pareadas: {trans_stats['pareadas']}")

        if resultado.snapshot:
            print(f"  snapshot: {resultado.snapshot.saldo} em {resultado.snapshot.data_ref}")

        if resultado.avisos:
            print(f"\n⚠️  Avisos:")
            for aviso in resultado.avisos:
                print(f"  - {aviso}")

        if log["error_msg"]:
            print(f"\n❌ Erro: {log['error_msg']}", file=sys.stderr)
            sys.exit(1)

        return 0

    except Exception as e:
        print(f"\n❌ Erro não esperado: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    sys.exit(main())
