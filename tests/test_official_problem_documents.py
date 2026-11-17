import json
from pathlib import Path

import pytest

from app.schemas.usual_problem_schema import OfficialProblemDocument
from scripts.load_official_problems import read_documents


ROOT = Path(__file__).resolve().parents[1]


def test_documents_officiels_dn250_sont_valides_et_cites():
    documents = read_documents(ROOT / "db" / "problemes_officiels")

    assert len(documents) == 3
    assert {document.device_type for document in documents} == {"gab"}
    assert all("DN Series 250V" in document.documentation.model_variants for document in documents)
    assert all(document.documentation.document_number == "01750350043 E" for document in documents)
    assert all("Source :" in document.reply for document in documents)
    assert all("code" not in document.label.casefold() for document in documents)


def test_document_officiel_refuse_un_identifiant_de_source_incoherent(tmp_path):
    source = json.loads(
        (ROOT / "db" / "problemes_officiels" / "dn-series-250-service-required.json")
        .read_text(encoding="utf-8")
    )
    (tmp_path / "mauvais-nom.json").write_text(json.dumps(source), encoding="utf-8")

    with pytest.raises(ValueError, match="doit se nommer"):
        read_documents(tmp_path)


def test_document_officiel_refuse_une_procedure_non_documentee(tmp_path):
    source = json.loads(
        (ROOT / "db" / "problemes_officiels" / "dn-series-250-cash-jam.json")
        .read_text(encoding="utf-8")
    )
    source["documentation"]["unsupported_field"] = "unexpected"
    (tmp_path / f"{source['source_key']}.json").write_text(json.dumps(source), encoding="utf-8")

    with pytest.raises(ValueError):
        OfficialProblemDocument.model_validate_json(
            (tmp_path / f"{source['source_key']}.json").read_text(encoding="utf-8")
        )
