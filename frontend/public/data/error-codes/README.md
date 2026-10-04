# Codes d'erreur fréquents (réponses enregistrées côté frontend)

Chaque code d'erreur listé ici apparaît en **bulle de suggestion** dans le Copilote.
Quand le technicien clique dessus :

1. le code s'affiche dans le chat comme son message ;
2. le Copilote répond avec le texte `reply` du fichier JSON.

Le backend n'est **jamais** appelé : la réponse est lue directement dans ce dossier.

## Ajouter un code d'erreur (2 étapes)

**1. Créer le fichier `<CODE>.json` dans ce dossier**, par exemple `T05.json` :

```json
{
  "code": "T05",
  "device_type": "tpe",
  "label": "Lecteur de puce défaillant",
  "reply": [
    "Code T05 : le lecteur de puce ne répond pas.",
    "1. Première vérification…",
    "2. Deuxième vérification…"
  ]
}
```

| Champ | Rôle |
| --- | --- |
| `code` | Code affiché par l'équipement. Il apparaît en gras sur la bulle et dans le message du technicien. |
| `device_type` | `"gab"` ou `"tpe"` : la bulle ne s'affiche que pour cet équipement (sélecteur GAB / TPE). |
| `label` | Texte court affiché sur la bulle, à côté du code. |
| `reply` | La réponse du Copilote. Chaque élément de la liste devient un paragraphe. |

**2. Ajouter le nom du fichier dans `index.json`** :

```json
{
  "files": ["E42.json", "E43.json", "E67.json", "T05.json"]
}
```

L'ordre de `index.json` est l'ordre d'affichage des bulles.

## Retirer un code

Enlevez son nom de `index.json` (vous pouvez garder le fichier, il sera ignoré).

## En cas d'erreur

Un fichier introuvable ou mal rempli (champ manquant, `device_type` invalide, JSON mal formé)
est simplement **ignoré** : les autres codes continuent de s'afficher. La raison exacte est
écrite dans la console du navigateur (F12 → Console), préfixée par `[codes d'erreur]`.

## Après une modification

Avec Docker, reconstruisez le frontend pour que les fichiers soient copiés dans l'image :

```powershell
cd frontend
docker compose up --build -d
```

> Les réponses fournies pour E42, E43 et E67 sont des **exemples** rédigés à partir des
> descriptions de la base : à relire et adapter avec vos procédures réelles.
