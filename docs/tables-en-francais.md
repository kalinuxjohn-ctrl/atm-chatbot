# Tables en français

La migration [`0019_table_names_french.sql`](../db/migrations/0019_table_names_french.sql)
renomme **24 tables**, sans recréer de table ni copier les lignes. Les colonnes,
schémas (`public`, `main_app`), types énumérés, séquences, index, contraintes et
permissions restent inchangés. Les attributs Python/JavaScript et les contrats
HTTP restent aussi inchangés : par exemple `technician_id` reste `technician_id`.

Les migrations 0001 à 0018 conservent leurs noms historiques et leur contenu.
Une base neuve les applique d'abord, puis applique 0019. Sur une base existante,
le suivi `schema_migrations` évite de rejouer les anciennes migrations.

## Correspondance

| Schéma | Ancien nom | Nouveau nom |
|---|---|---|
| public | technician | technicien |
| public | manufacturer | fabricant |
| public | device_model | modele_appareil |
| public | device_model_version | version_modele_appareil |
| public | device | appareil |
| public | component | composant |
| public | symptom | symptome |
| public | intervention_symptom | symptome_intervention |
| public | intervention_action | action_intervention |
| public | diagnosis | diagnostic |
| public | symptom_action_outcome_stats | statistiques_resultats_symptome_action |
| public | conversation_message | message_conversation |
| public | conversation_context | contexte_conversation |
| public | fault | panne |
| public | error_code | code_erreur |
| public | solution_proposal | proposition_solution |
| public | usual_problem | panne_frequente |
| public | intervention_add | ajout_intervention |
| main_app | accounts | comptes |
| main_app | login_throttles | blocages_connexion |
| main_app | map_points | points_carte |
| main_app | conversation_participants | participants_conversation |
| main_app | message_attachments | pieces_jointes_message |
| main_app | call_logs | journal_appels |

Noms déjà français, conservés : `public.intervention`, `public.action`,
`public.conversation`, `main_app.sessions`, `main_app.conversations`,
`main_app.messages`. La table technique `public.schema_migrations` reste inchangée.
Les noms SQL sont sans accents pour simplifier les outils et éviter les identifiants
à citer entre guillemets.

## Lancement direct avec Docker (WSL)

Depuis la racine du dépôt, avec le fichier `.env` déjà configuré :

```bash
docker compose up --build
```

`compose.yaml` inclut automatiquement les trois configurations. Pour le lancement
en arrière-plan : `docker compose up -d --build` ; état et ports : `docker compose ps`.
L'image Python de base est construite automatiquement par Compose avant l'API
et les migrations, meme sur une nouvelle installation Docker.
Pour migrer une ancienne installation, arrêter d'abord les applications avec
`docker compose stop` afin de ne pas faire fonctionner l'ancien code pendant le renommage.

Application : <http://localhost:8080> ; API : <http://localhost:8000/docs> ;
PostgreSQL : `localhost:5432`. Les ports configurés dans `.env` restent prioritaires.
Tous les comptes et leurs mots de passe restent identiques.
Les lanceurs existants restent facultatifs : aucune commande ci-dessus ne les utilise.
Ne pas lancer `down -v` : cette option supprime les volumes de données.

## Retour aux anciens noms

Le retour arrière doit accompagner le retour au code de `app-in-prod`.
Arrêter les applications, démarrer seulement `db`, puis, **depuis WSL** :

```bash
docker compose -p atm-chatbot -f compose.backend.yaml -f docker-compose.main-app.yml -f docker-compose.local.yml stop
docker compose -p atm-chatbot -f compose.backend.yaml -f docker-compose.main-app.yml -f docker-compose.local.yml up -d --no-deps db
docker compose -p atm-chatbot -f compose.backend.yaml -f docker-compose.main-app.yml -f docker-compose.local.yml exec -T db psql -U postgres -d atm_chatbot -v ON_ERROR_STOP=1 < db/rollback/0019_table_names_french.sql
```

Le rollback transactionnel restaure les noms et retire uniquement l'enregistrement
de 0019 du suivi des migrations. Il ne réinitialise aucune donnée. Ne pas relancer
le code `db-en-francais` après un rollback ; repasser au code `app-in-prod` d'abord.
Les exports et outils SQL externes doivent eux aussi utiliser les nouveaux noms.
Le [diagramme UML du chatbot en PNG](diagrammes/png/25-base-chatbot-francais.png)
et sa [version SVG zoomable](diagrammes/25-base-chatbot-francais.svg) montrent
les 21 tables, 134 colonnes et 34 relations du schema `public` apres 0019.
Les colonnes et types gardent leurs noms SQL reels ; `?` indique une colonne nullable.
La [source Graphviz](diagrammes/25-base-chatbot-francais.dot) permet de regenerer
les images. Les autres illustrations historiques peuvent encore montrer les anciens noms.

## Tests

`python -B -m unittest discover -s tests -p test_french_table_names.py -v`
vérifie les noms ORM, les clés étrangères, la correspondance aller/retour et les
tables attendues par le job Node.

`TEST_FRENCH_TABLE_MIGRATION=true python -B -m pytest tests/test_french_table_migration.py -q`
vérifie PostgreSQL sur une base jetable : installation des anciennes migrations,
renommage, conservation des OID/droits/relations/données, séquences, rollback et
réapplication. `DATABASE_URL` doit utiliser un rôle pouvant créer des bases ;
la base de l'application n'est pas modifiée.
