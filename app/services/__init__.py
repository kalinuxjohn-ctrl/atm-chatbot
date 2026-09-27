"""
Package des services métier.

Volontairement VIDE de tout import agrégé -- contrairement à
app/models/__init__.py (qui DOIT tout importer d'un coup pour que
SQLAlchemy résolve les relationship() passées en chaîne de caractères),
les services n'ont aucune dépendance de ce genre entre eux.

Importer tous les services ici forcerait Python à charger CHAQUE module
(y compris leurs dépendances tierces : requests, sentence-transformers...)
dès que N'IMPORTE LEQUEL est utilisé -- une seule dépendance manquante pour
un service (ex: `requests` pour llm_service.py) casserait alors des
fonctionnalités totalement indépendantes (ex: le seed, qui n'a besoin que
d'embeddings_service.py). C'est exactement l'erreur rencontrée.

Toujours importer directement depuis le sous-module concerné :
    from app.services.embeddings_service import generate_embedding
    from app.services.llm_service import generate_reply
"""