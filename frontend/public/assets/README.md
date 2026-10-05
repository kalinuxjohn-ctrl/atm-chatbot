# Images du frontend

Toutes les images modifiables du site sont rangées ici.

```
assets/
├── images/
│   ├── logo.svg              logo (en-têtes, pied de page, icône de l'onglet)
│   ├── home-background.svg   fond plein écran de l'accueil + fond de la barre latérale du Copilote
│   └── app-background.svg    fond de la zone de conversation du Copilote
└── avatars/                  vos images d'avatars (vide par défaut, voir plus bas)
```

## Changer une image de fond ou le logo

**Le plus simple :** remplacez le fichier en gardant **exactement le même nom**.

**Pour utiliser un autre format** (photo `.jpg`, `.png`, `.webp`…) :

1. déposez l'image dans `assets/images/`, par exemple `assets/images/agence.jpg` ;
2. ouvrez `public/css/assets.css` et changez la ligne correspondante :

```css
--image-home-background: url("/assets/images/agence.jpg");
```

`assets.css` est le **seul** fichier où les chemins des fonds sont écrits.

Le logo est utilisé directement dans les pages HTML : remplacez simplement `logo.svg`
(format carré conseillé).

### Conseils

| Image | Conseil |
| --- | --- |
| Fond de l'accueil | Grande image (1920 × 1080 minimum), plutôt sombre. Un voile foncé est ajouté par-dessus pour que le texte blanc reste lisible. |
| Fond du chat | Image **claire et calme** : les messages s'affichent par-dessus. Une photo chargée gêne la lecture. |
| Logo | Carré, fond non transparent de préférence (il est affiché dans un carré arrondi). |

## Avatars

Par défaut, les avatars (Technicienne, Technicien) sont **dessinés en code** dans
`public/js/components/avatar.js`. C'est ce qui permet leurs animations : yeux qui clignent,
bouche qui bouge quand le Copilote parle.

Pour utiliser une **image** à la place :

1. déposez l'image dans `assets/avatars/`, par exemple `technicienne.png`. Format carré,
   visage centré : elle est affichée dans un cercle ;
2. dans `avatar.js`, décommentez la ligne `image:` de l'avatar voulu :

```js
female: {
  label: "Technicienne",
  image: "/assets/avatars/technicienne.png",
  ...
```

Une image d'avatar n'est pas animée. Si le chemin est faux, le dessin d'origine est
utilisé, et la raison est écrite dans la console du navigateur (F12).

## Après une modification

Avec Docker, reconstruisez le frontend (les fichiers sont copiés dans l'image) :

```powershell
cd frontend
docker compose up --build -d
```
