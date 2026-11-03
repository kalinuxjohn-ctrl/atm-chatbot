# Diagrammes UML

1. [Cas d'utilisation](#1-cas-dutilisation)
2. [Diagramme de classes du domaine](#2-diagramme-de-classes-du-domaine)
3. [Diagramme de classes du code (couches)](#3-diagramme-de-classes-du-code-couches)
4. [Diagrammes de séquence](#4-diagrammes-de-séquence)
5. [Diagramme d'états d'un appel](#5-diagramme-détats-dun-appel)
6. [Diagramme de déploiement](#6-diagramme-de-déploiement)

---

## 1. Cas d'utilisation

Trois acteurs : le **technicien**, le **modérateur** (un technicien qui gère tous les points de la carte) et l'**administrateur** (qui gère en plus les comptes). Chaque acteur hérite des droits du précédent.

```mermaid
flowchart LR
    technicien([Technicien])
    moderateur([Modérateur])
    administrateur([Administrateur])

    moderateur -. hérite .-> technicien
    administrateur -. hérite .-> moderateur

    subgraph application[Espace techniciens]
        seConnecter((Se connecter))
        changerMotDePasse((Changer son mot de passe))
        consulterCarte((Consulter la carte))
        gererSesPoints((Ajouter / modifier / supprimer ses points))
        rechercherProximite((Chercher les points proches))
        envoyerMessage((Envoyer un message, une photo, un vocal))
        lireMessages((Lire ses conversations))
        appeler((Appeler un technicien))
        repondreAppel((Répondre / refuser un appel))
        consulterHistorique((Consulter l'historique des appels))
        gererTousPoints((Gérer tous les points))
        gererComptes((Créer et désactiver des comptes))
        gererRoles((Changer les rôles))
        reinitialiserMotDePasse((Réinitialiser un mot de passe))
    end

    technicien --- seConnecter
    technicien --- changerMotDePasse
    technicien --- consulterCarte
    technicien --- gererSesPoints
    technicien --- rechercherProximite
    technicien --- envoyerMessage
    technicien --- lireMessages
    technicien --- appeler
    technicien --- repondreAppel
    technicien --- consulterHistorique
    moderateur --- gererTousPoints
    administrateur --- gererComptes
    administrateur --- gererRoles
    administrateur --- reinitialiserMotDePasse
```

---

## 2. Diagramme de classes du domaine

Les objets métier et leurs relations. Chaque classe correspond à une table du schéma `main_app` (voir [base-de-donnees.md](base-de-donnees.md)).

```mermaid
classDiagram
    direction LR

    class Technician {
        +int technicianId
        +string fullName
        +bool active
    }
    class Account {
        +int technicianId
        +string username
        +string passwordHash
        +AccountRole role
        +bool isActive
        +Date lastLoginAt
    }
    class Session {
        +string tokenHash
        +Date expiresAt
    }
    class MapPoint {
        +uuid id
        +string title
        +string description
        +MapPointCategory category
        +float latitude
        +float longitude
    }
    class Conversation {
        +int id
        +ConversationKind kind
        +Date lastMessageAt
    }
    class ConversationParticipant {
        +int lastReadMessageId
    }
    class Message {
        +int id
        +MessageKind kind
        +string textContent
        +Date createdAt
    }
    class MessageAttachment {
        +uuid id
        +string storageFileName
        +string mediaType
        +int byteSize
    }
    class CallLog {
        +uuid id
        +CallStatus status
        +string endReason
        +Date startedAt
        +Date answeredAt
        +Date endedAt
    }

    class AccountRole {
        <<enumeration>>
        technician
        moderator
        admin
    }
    class MapPointCategory {
        <<enumeration>>
        atm_site
        tpe_client
        parts_depot
        difficult_access
        other
    }
    class CallStatus {
        <<enumeration>>
        missed
        answered
        declined
        failed
    }

    Technician "1" -- "0..1" Account : possède
    Account "1" *-- "0..*" Session : ouvre
    Technician "0..1" -- "0..*" MapPoint : crée
    Conversation "1" *-- "2..*" ConversationParticipant
    Technician "1" -- "0..*" ConversationParticipant
    Conversation "1" *-- "0..*" Message
    Technician "1" -- "0..*" Message : envoie
    Message "1" *-- "0..1" MessageAttachment
    Technician "1" -- "0..*" CallLog : appelant
    Technician "1" -- "0..*" CallLog : appelé
    Account ..> AccountRole
    MapPoint ..> MapPointCategory
    CallLog ..> CallStatus
```

---

## 3. Diagramme de classes du code (couches)

Chaque module suit le même découpage. Exemple avec le module Carte ; les modules Comptes, Messagerie et Appels sont construits de la même façon.

```mermaid
classDiagram
    direction TB

    class mapRoutes {
        <<routes>>
        +createMapRouter() Router
    }
    class requireAuthenticatedUser {
        <<middleware>>
        +requireAuthenticatedUser(request, response, next)
    }
    class mapPointController {
        <<controller>>
        +listPointsInBoundingBox(request, response)
        +listPointsNearLocation(request, response)
        +createPoint(request, response)
        +readPoint(request, response)
        +updatePoint(request, response)
        +deletePoint(request, response)
    }
    class mapSchemas {
        <<schemas zod>>
        mapPointCreationSchema
        mapPointUpdateSchema
        boundingBoxQuerySchema
        proximityQuerySchema
    }
    class mapPointService {
        <<service>>
        +listMapPointsInVisibleArea(user, boundingBox)
        +listMapPointsAroundLocation(user, position)
        +readMapPoint(user, pointId)
        +createMapPoint(user, pointContent)
        +modifyMapPoint(user, pointId, pointChanges)
        +removeMapPoint(user, pointId)
    }
    class mapPointModel {
        <<model>>
        +findMapPointById(pointId)
        +findMapPointsInBoundingBox(boundingBox)
        +findMapPointsNearLocation(position)
        +insertMapPoint(point)
        +updateMapPoint(pointId, changes)
        +deleteMapPoint(pointId)
    }
    class database {
        <<core>>
        +queryDatabase(sqlText, parameters)
        +runInTransaction(work)
    }
    class errors {
        <<core>>
        ReferenceNotFoundError 404
        AccessDeniedError 403
        InvalidReferenceError 422
    }

    mapRoutes --> requireAuthenticatedUser
    mapRoutes --> mapPointController
    mapPointController --> mapSchemas : valide
    mapPointController --> mapPointService
    mapPointService --> mapPointModel
    mapPointService ..> errors : lève
    mapPointModel --> database
```

| Couche | Responsabilité | Connaît HTTP ? | Connaît SQL ? |
|---|---|---|---|
| `routes/` | Associe une URL à ses middlewares et à son contrôleur | oui | non |
| `controllers/` | Valide l'entrée, appelle le service, renvoie le JSON | oui | non |
| `services/` | Règles métier (droits, limites, cohérence) | non | non |
| `models/` | Lit et écrit en base | non | oui |
| `schemas/` | Décrit les données attendues (zod) | non | non |

---

## 4. Diagrammes de séquence

### 4.1 Connexion

```mermaid
sequenceDiagram
    actor Utilisateur
    participant Navigateur
    participant Gateway as main-app-gateway
    participant Auth as main-app-auth
    participant BD as PostgreSQL

    Utilisateur->>Navigateur: saisit nom et mot de passe
    Navigateur->>Gateway: POST /api/auth/login
    Gateway->>Auth: transmet la requête
    Auth->>BD: le couple (nom, IP) est-il bloqué ?
    BD-->>Auth: non
    Auth->>BD: lire le compte
    BD-->>Auth: compte + empreinte
    Auth->>Auth: vérifier le mot de passe (argon2id)
    alt mot de passe correct
        Auth->>BD: créer la session (empreinte du jeton)
        Auth-->>Navigateur: 200 + cookie de session
        Navigateur-->>Utilisateur: page d'accueil
    else mot de passe incorrect
        Auth->>BD: compter l'échec
        Auth-->>Navigateur: 401 « Identifiants incorrects »
    end
```

### 4.2 Ajout d'un point sur la carte

```mermaid
sequenceDiagram
    actor Technicien
    participant Page as Page Carte
    participant Map as main-app-map
    participant BD as PostgreSQL

    Technicien->>Page: clique sur la carte et remplit le formulaire
    Page->>Map: POST /api/map/points
    Map->>BD: vérifier la session
    Map->>Map: valider titre, catégorie, coordonnées
    Map->>BD: INSERT INTO map_points
    BD-->>Map: point créé
    Map-->>Page: 201 + point
    Page-->>Technicien: nouvelle épingle sur la carte
```

### 4.3 Envoi et réception d'un message

La réception se fait par interrogation régulière du serveur (toutes les 3 secondes).

```mermaid
sequenceDiagram
    actor Alice
    participant PageA as Page Messagerie (Alice)
    participant Messaging as main-app-messaging
    participant BD as PostgreSQL
    participant PageB as Page Messagerie (Bob)
    actor Bob

    Alice->>PageA: écrit un message
    PageA->>Messaging: POST /conversations/12/messages
    Messaging->>BD: Alice participe-t-elle à la conversation 12 ?
    Messaging->>BD: INSERT INTO messages
    Messaging-->>PageA: 201 + message
    loop toutes les 3 secondes
        PageB->>Messaging: GET /conversations/12/messages?after=<dernier id>
        Messaging->>BD: messages plus récents
        Messaging-->>PageB: nouveaux messages
    end
    PageB-->>Bob: affiche le message
    PageB->>Messaging: POST /conversations/12/read
```

### 4.4 Appel vocal

Le serveur ne fait que mettre les deux navigateurs en relation. Le son passe ensuite directement entre eux.

```mermaid
sequenceDiagram
    actor Alice
    participant NavA as Navigateur d'Alice
    participant Calls as main-app-calls (WebSocket)
    participant NavB as Navigateur de Bob
    actor Bob

    Alice->>NavA: clique sur « Appeler Bob »
    NavA->>Calls: call.start
    Calls-->>NavA: call.ringing
    Calls-->>NavB: call.incoming
    NavB-->>Bob: sonnerie
    Bob->>NavB: « Répondre »
    NavB->>Calls: call.accept
    Calls-->>NavA: call.accepted
    NavA->>Calls: call.offer (SDP)
    Calls-->>NavB: call.offer
    NavB->>Calls: call.answer (SDP)
    Calls-->>NavA: call.answer
    NavA->>Calls: call.ice-candidate
    Calls-->>NavB: call.ice-candidate
    Note over NavA,NavB: audio WebRTC direct, sans passer par le serveur
    Alice->>NavA: raccroche
    NavA->>Calls: call.hang-up
    Calls-->>NavA: call.ended
    Calls-->>NavB: call.ended
    Calls->>Calls: écrit la ligne dans call_logs
```

---

## 5. Diagramme d'états d'un appel

```mermaid
stateDiagram-v2
    [*] --> Sonnerie : call.start
    [*] --> Echec : appelé occupé ou hors ligne

    Sonnerie --> EnCours : call.accept
    Sonnerie --> Refuse : call.decline
    Sonnerie --> Manque : 30 s sans réponse / l'appelant raccroche
    Sonnerie --> Echec : connexion perdue

    EnCours --> Termine : call.hang-up
    EnCours --> Termine : connexion perdue

    Termine --> [*] : journal « answered »
    Refuse --> [*] : journal « declined »
    Manque --> [*] : journal « missed »
    Echec --> [*] : journal « failed »
```

Un utilisateur ne peut avoir qu'un appel à la fois : pendant la sonnerie ou la conversation, un autre appel reçoit « occupé ».

---

## 6. Diagramme de déploiement

```mermaid
flowchart TB
    subgraph poste[Poste du technicien]
        navigateur[Navigateur web]
    end

    subgraph serveur[Serveur Docker]
        subgraph reseauApp[Réseau main-app-network]
            gateway[main-app-gateway<br/>nginx · port 8080]
            auth[main-app-auth<br/>Node.js]
            map[main-app-map<br/>Node.js]
            messaging[main-app-messaging<br/>Node.js]
            calls[main-app-calls<br/>Node.js]
        end
        uploads[(Volume<br/>main-app-uploads)]
        subgraph reseauChatbot[Réseau du chatbot]
            db[(db<br/>PostgreSQL)]
        end
    end

    tuiles[Fournisseur de tuiles<br/>HTTPS]

    navigateur -- HTTP / WebSocket --> gateway
    gateway --> auth & map & messaging & calls
    auth & map & messaging & calls --> db
    messaging --> uploads
    map --> tuiles
```

Les quatre conteneurs Node.js utilisent la même image ; seule la commande de démarrage change.
