import json
from pathlib import Path

from scripts.load_example_problems import read_documents as read_example_problems
from scripts.load_intervention_examples import read_documents as read_intervention_examples


ROOT = Path(__file__).resolve().parents[1]


def test_problemes_usuels_de_reference_sont_valides_et_separes_par_equipement():
    documents = read_example_problems(ROOT / "db" / "problemes_exemples")

    assert len(documents) == 16
    assert sum(document.device_type == "gab" for document in documents) == 10
    assert sum(document.device_type == "tpe" for document in documents) == 6
    assert all("test" not in document.label.casefold() for document in documents)


def test_interventions_de_reference_sont_valides_et_recherchables():
    documents = read_intervention_examples(ROOT / "db" / "interventions_exemples" / "catalogue.json")

    assert len(documents) == 19
    assert sum(document.device_type == "gab" for document in documents) == 10
    assert sum(document.device_type == "tpe" for document in documents) == 9
    assert all(document.symptoms and document.actions and document.diagnosis.description for document in documents)
    assert all("test" not in document.summary.casefold() for document in documents)


def test_fichiers_problemes_usuels_sont_un_par_entree():
    paths = sorted((ROOT / "db" / "problemes_exemples").glob("*.json"))

    assert len(paths) == 16
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert path.stem == payload["source_key"]
