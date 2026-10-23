# La base de données par l'exemple

Ce document suit **un seul problème réel**, de son enregistrement en base jusqu'à la réponse du Copilote. Le but est de savoir, à chaque étape, **quelle table intervient, quelle ligne est lue ou écrite, et pourquoi**.

Les données sont celles du script de démo (`db/seed/seed_demo_data.py`). Les schémas sont dans `docs/diagrammes/` (21 à 24), avec un PNG haute définition dans `docs/diagrammes/png/`.

> **Mise à jour (recherche par symptôme).** Les schémas 22 à 24 montrent encore la version précédente, avec un seul embedding par message. Le texte ci-dessous décrit le fonctionnement actuel : Claude liste chaque symptôme du message, et chaque symptôme est cherché séparément.

| Étape | Schéma | Question |
|---|---|---|
| 1 | `21-db-exemple-contenu-initial` | Comment une panne et sa solution sont-elles stockées ? |
| 2 | `22-db-exemple-comprehension` | Le message arrive : que renvoie Claude, et que fait la base ? |
| 3 | `23-db-exemple-recherche` | Comment la base retrouve-t-elle les cas ? |
| 4 | `24-db-exemple-reponse` | Que reçoit et renvoie Claude, et qu'est-ce qui est enregistré ? |

---

## 1. La base au départ : une panne et sa solution

![Contenu initial](diagrammes/png/21-db-exemple-contenu-initial.png)

**L'histoire :** le 2 septembre, Alan intervient sur un GAB Opteva 720 (agence Branch 14). La carte reste bloquée. Il vérifie le lecteur, puis le mécanisme de rétention, sans résultat. Il réinitialise ensuite le lecteur, et le problème est réglé.

Cette seule visite est répartie sur **6 tables** :

**`intervention`** : la visite (qui, quel appareil, quand). Elle ne contient pas de texte du problème.

| intervention_id | device_id | technician_id | opened_at | final_outcome_status |
|---|---|---|---|---|
| 3001 | 501 → `device` | 7 → `technician` | 2026-09-02 09:14 | resolved |

**`intervention_symptom`** : les phrases écrites par le technicien, **chacune avec son embedding**.

| intervention_symptom_id | intervention_id | symptom_id | raw_text | embedding vector(1024) |
|---|---|---|---|---|
| 9001 | 3001 | 21 | La carte est retenue par le GAB. | [0.021, -0.043, 0.118, …, 0.007] |
| 9002 | 3001 | 22 | La transaction ne s'achève pas. | [-0.012, 0.061, 0.034, …, -0.020] |
| 9003 | 3001 | 23 | Les espèces ne sont pas distribuées. | [0.044, 0.009, -0.071, …, 0.015] |

**`intervention_action`** : les solutions tentées, dans l'ordre.

| intervention_action_id | intervention_id | action_id | sequence_order | raw_text | outcome_status | is_confirmed_solution |
|---|---|---|---|---|---|---|
| 7001 | 3001 | 41 | 1 | Checked card reader for damage. | no_effect | false |
| 7002 | 3001 | 42 | 2 | Checked card-retention mechanism. | no_effect | false |
| 7003 | 3001 | 43 | 3 | Reinitialized card reader. | resolved | **TRUE** |

**`diagnosis`** : la cause.

| diagnosis_id | intervention_id | description |
|---|---|---|
| 501 | 3001 | Card reader firmware/state got stuck; reinitialization cleared it. |

**`symptom`** et **`action`** (le catalogue) : les noms officiels. `9001` pointe vers `symptom 21` (« Carte retenue par le GAB ») et `7003` pointe vers `action 43` (« Reinitialize card reader »).

**`symptom_action_outcome_stats`** : le taux de réussite, **calculé** par le job `recompute_stats`, jamais saisi à la main.

| symptom_id | action_id | device_type | attempts | successes | accuracy_score |
|---|---|---|---|---|---|
| 21 | 43 | gab | 1 | 1 | 1.0000 |

### Ce qu'il faut retenir
- **L'embedding n'existe que dans `intervention_symptom.embedding`** : un vecteur de 1024 nombres, calculé une seule fois par Voyage AI à partir de `raw_text`, quand le symptôme est enregistré. Deux phrases de même sens donnent des vecteurs proches.
- **Une solution n'a pas d'embedding.** On la retrouve parce qu'elle a le même `intervention_id` qu'un symptôme proche de la question.
- `targets_symptom_id = NULL` : l'action vaut pour tous les symptômes de la visite. Quand il est renseigné (par exemple pour une proposition approuvée), l'action ne vise que ce symptôme-là.
- `error_code` est un référentiel séparé, relié à `fault` et pas aux interventions.

---

## 2. Le message arrive et Claude le comprend

![Compréhension](diagrammes/png/22-db-exemple-comprehension.png)

Le technicien 4 écrit : *« Bonjour, sur le GAB Opteva 720 la carte est restée bloquée dans le lecteur et la transaction ne se termine pas, il affiche E42 »*.

| # | Ce qui se passe | Tables | Lecture / écriture |
|---|---|---|---|
| 1 | Ouvrir la conversation | `conversation` | INSERT de la ligne 15 (premier message) |
| 1 | Charger la mémoire | `conversation_context` | SELECT : aucune ligne, donc `{}` |
| 2 | Vérifier et enregistrer le message | `conversation_message` | INSERT de la ligne 101 (`role = user`) |
| 3 | **Appel 1 à Claude** (compréhension) | aucune | — |
| 4 | Convertir les textes en ID | `device_model`, `error_code` | SELECT : `model_id = 10`, `error_code_id = 1` |
| 5 | Mettre à jour la mémoire en Python | aucune (pas encore écrite) | — |

**Ce que Claude renvoie** : du texte uniquement, jamais d'ID de la base.
```json
{
  "intent": "diagnostic",
  "device_type_text": "gab",
  "model_name_text": "Opteva 720",
  "error_code_text": "E42",
  "reformulated_problem_text": "La carte reste bloquée dans le lecteur du GAB et la transaction ne se termine pas",
  "symptoms": [
    {"number": 1, "text": "La carte reste bloquée dans le lecteur du GAB"},
    {"number": 2, "text": "La transaction ne se termine pas"}
  ]
}
```

**`symptoms`** liste chaque symptôme distinct du message, numéroté à partir de 1. Chaque texte doit se comprendre seul, car il sera cherché séparément. Le backend nettoie la liste : il retire les doublons et les textes vides, renumérote, et garde au plus `MAX_SYMPTOMS_PER_MESSAGE` symptômes (5 par défaut). Si la liste est vide, `reformulated_problem_text` sert de symptôme unique.

**Le champ `intent` décide de la suite :**
- `diagnostic` → recherche en base (étape 3) ;
- `conversation` → tout le reste (demande de détail, suivi, question générale) :
  Claude a déjà rédigé sa réponse dans le même appel, avec toute la conversation
  et les résultats de `conversation_context.last_search` relus en base.

---

## 3. La recherche en base

![Recherche](diagrammes/png/23-db-exemple-recherche.png)

1. **Chaque symptôme devient un vecteur.** Les textes de `symptoms` sont envoyés à Voyage AI en **un seul appel groupé** (`retrieval_service.fetch_similar_symptoms_per_symptom`), qui renvoie un vecteur par symptôme : `query_vector_1`, `query_vector_2`. Ces vecteurs ne sont jamais stockés. Avec un seul symptôme, l'appel unitaire habituel est utilisé, avec son cache.
2. **pgvector compare chaque vecteur à tous les symptômes** enregistrés : **une requête par symptôme du technicien** (`retrieval_service.fetch_similar_symptoms`) :
   ```sql
   SELECT isym.intervention_symptom_id, isym.intervention_id, isym.symptom_id, isym.raw_text,
          1 - (isym.embedding <=> :query_vector) AS similarity
   FROM intervention_symptom isym
   JOIN intervention iv ON iv.intervention_id = isym.intervention_id
   JOIN device d        ON d.device_id = iv.device_id
   WHERE isym.embedding IS NOT NULL
     AND d.device_type = 'gab'
     AND d.model_id IN (SELECT model_id FROM device_model WHERE UPPER(TRIM(model_name)) = 'OPTEVA 720')
   ORDER BY isym.embedding <=> :query_vector
   LIMIT 8
   ```
   Les jointures avec `intervention`, `device` et `device_model` servent **uniquement à filtrer** (GAB, Opteva 720). La comparaison des vecteurs se fait dans `intervention_symptom`.
3. **Seuil de pertinence**, appliqué à chaque requête : seuls les résultats avec `similarity ≥ SYMPTOM_SIMILARITY_THRESHOLD` sont gardés. Les scores ci-dessous sont un exemple :
   - symptôme 1 (carte bloquée) : 9001 (0.91), 9004 (0.87) ;
   - symptôme 2 (transaction) : 9002 (0.88), 9005 (0.62).
4. **Regroupement par intervention** (`case_retrieval_service._group_matches_by_intervention`) : pour chaque intervention, on garde la meilleure correspondance **de chaque symptôme du technicien**. Une intervention peut donc être rattachée à **plusieurs** symptômes :
   - 3001 : symptôme 1 → 9001, symptôme 2 → 9002 ;
   - 3045 : symptôme 1 → 9004, symptôme 2 → 9005.
5. **Classement, 3 cas au maximum** (`_case_rank_key`) : d'abord le **nombre de symptômes recoupés**, puis la **similarité moyenne**. Une intervention qui recoupe 2 symptômes passe devant une intervention plus proche sur un seul. Ici, les deux en recoupent 2, et 3001 a la meilleure moyenne : **Cas 1 = 3001**, **Cas 2 = 3045**.
6. **Lecture du dossier complet de chaque cas** (`build_case`) :
   - `intervention` ;
   - `technician` (le nom) ;
   - `device` (le site) ;
   - `intervention_action` (triée par `sequence_order`) ;
   - `diagnosis` ;
   - `symptom_action_outcome_stats`, avec la clé `(21, 43, gab)`, soit 100 % sur 1 cas.

**Tables non lues pendant la recherche :** `symptom`, `action`, `component`, `error_code`, `fault`, `manufacturer`.

**Repli :** si aucun cas ne passe le seuil, `find_ranked_solutions` (avec `symptom_texts`, une recherche par symptôme dont les correspondances sont réunies) lit `symptom_action_outcome_stats` et `action`, et renvoie des résultats de type « stat ».

---

## 4. La réponse et ce qui est enregistré

![Réponse](diagrammes/png/24-db-exemple-reponse.png)

1. **Appel 2 à Claude (synthèse)** : les cas sont mis en texte (`_format_case`) et Claude rédige la réponse. **Claude ne lit ni n'écrit jamais la base.** Chaque cas indique les symptômes qu'il recoupe, par exemple : `symptômes recoupés : « La carte est retenue par le GAB. » (recoupe le symptôme 1 du technicien) ; « La transaction ne s'achève pas. » (recoupe le symptôme 2 du technicien)`. Avec plusieurs symptômes, le prompt les liste numérotés et demande à Claude d'indiquer, pour chaque cas, les symptômes qu'il recoupe, et de signaler un symptôme recoupé par aucun cas.
2. **Écritures, puis un seul `COMMIT`** :

| Table | Opération | Contenu |
|---|---|---|
| `conversation_message` | INSERT | ligne 102, `role = assistant`, avec la réponse de Claude |
| `conversation_context` | INSERT (1re fois) puis UPDATE | le JSON de mémoire, avec `last_search` |
| `conversation` | UPDATE | `updated_at = now()` |

Contenu de `conversation_context.context` après ce message :
```json
{
  "device_type": "gab", "model_id": 10, "model_name": "Opteva 720",
  "error_code_id": 1, "error_code": "E42", "intent": "diagnostic",
  "last_search": {
    "query": "La carte reste bloquée dans le lecteur du GAB et la transaction ne se termine pas",
    "symptoms": [
      {"number": 1, "text": "La carte reste bloquée dans le lecteur du GAB"},
      {"number": 2, "text": "La transaction ne se termine pas"}
    ],
    "results": [
      {"position": 1, "kind": "case", "intervention_id": 3001,
       "matched_symptom_text": "La carte est retenue par le GAB.", "matched_intervention_symptom_id": 9001,
       "matched_symptoms": [
         {"query_symptom_number": 1, "query_symptom_text": "La carte reste bloquée dans le lecteur du GAB",
          "intervention_symptom_id": 9001, "raw_text": "La carte est retenue par le GAB.", "similarity": 0.91},
         {"query_symptom_number": 2, "query_symptom_text": "La transaction ne se termine pas",
          "intervention_symptom_id": 9002, "raw_text": "La transaction ne s'achève pas.", "similarity": 0.88}
       ]},
      {"position": 2, "kind": "case", "intervention_id": 3045,
       "matched_symptom_text": "La carte reste coincée dans le distributeur.", "matched_intervention_symptom_id": 9004,
       "matched_symptoms": ["… même structure : 9004 pour le symptôme 1, 9005 pour le symptôme 2"]}
    ]
  }
}
```

- `matched_symptoms` : **toutes** les correspondances du cas, une par symptôme du technicien recoupé.
- `matched_symptom_text` / `matched_intervention_symptom_id` : la correspondance **la plus proche**, gardée comme référence unique du cas (affichage court, proposition de solution).

3. **Message suivant, « détaille le deuxième »** :
   - avant l'appel, le backend lit `last_search.results` et relit chaque cas
     en base (`build_case(3001)`, `build_case(3045)`) ;
   - Claude reçoit toute la conversation et ces cas, classe le message en
     `conversation`, explique le cas 2 et renvoie `result_position = 2` ;
   - le backend vérifie que la position 2 existe et écrit `selected_result`
     (intervention 3045) dans le contexte.

   Il n'y a **aucun embedding ni aucune requête pgvector** à cette étape.

---

## Récapitulatif : quelle table intervient où

| Table | Contenu initial | Compréhension | Recherche | Réponse |
|---|---|---|---|---|
| `conversation` | | INSERT (1er msg) | | UPDATE `updated_at` |
| `conversation_message` | | INSERT (user) | | INSERT (assistant) |
| `conversation_context` | | SELECT | | INSERT / UPDATE |
| `device_model` | ✔ | SELECT (nom → ID) | filtre modèle | |
| `error_code` | ✔ | SELECT (code → ID) | | |
| `device` | ✔ | | JOIN (filtre gab) + dossier | |
| `technician` | ✔ | | dossier (nom) | |
| `intervention` | ✔ | | JOIN + dossier | |
| `intervention_symptom` | ✔ + embedding | | **recherche vectorielle** (une requête par symptôme du technicien) | |
| `intervention_action` | ✔ | | dossier (solutions) | |
| `diagnosis` | ✔ | | dossier (cause) | |
| `symptom_action_outcome_stats` | calculée par le job | | fiabilité | |
| `symptom`, `action`, `component` | ✔ catalogue | | (ID seulement) | |
