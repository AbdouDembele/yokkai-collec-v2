# Spécification Technique & Fiches d'Interaction : Étape 5

---

## 1. Page Mon Profil (Édition)

### 1.1 Architecture Visuelle & Layout

L'édition de profil regroupe la personnalisation de l'identité visuelle du joueur et la gestion de sa **Vitrine d'Exhibition** (5 cartes de prestige affichées publiquement).

```
====================================================================================================
YOKKAI COLLEC' - MON PROFIL (ÉDITION)
====================================================================================================
[YOKKAI COLLEC']  Boosters  Collection  Catalogue  Marché  Échanges  [AMIS] | (Q) (N) (1 450 K) (U)
----------------------------------------------------------------------------------------------------
ÉDITION DU PROFIL

+--------------------------------------------------------------------------------------------------+
| AVATAR ET IDENTITÉ                                                                               |
| +-----------+  Pseudo: @KitsuneMaster (Non modifiable)                                           |
| |  AVATAR   |  [ CHANGER L'AVATAR (Lien URL Imgur) ]                                             |
| | (96x96px) |                                                                                    |
| +-----------+  Bio (300 car. max) :                                                              |
|                [ Collectionneur passionné de cartes LR Shiny. Toujours ouvert aux  ]            |
|                [ échanges de la franchise Spirit Realm !                           ]            |
|                ( 112 / 300 caractères )                                                          |
+--------------------------------------------------------------------------------------------------+
| CARTES EN VITRINE (5 EMPLACEMENTS DE PRESTIGE)                                                   |
|                                                                                                  |
| +-----------+   +-----------+   +-----------+   +-----------+                                    |
| | [LR] [S]  |   | [SSR]     |   | [SSR]     |   | [EMPLAC.  |                                    |
| |           |   |           |   |           |   |   VIDE]   |                                    |
| | Kuro Kits |   | Aoi Drag. |   | Ren Cyber |   |           |                                    |
| | [Changer] |   | [Changer] |   | [Changer] |   |  [ + ]    |                                    |
| +-----------+   +-----------+   +-----------+   +-----------+                                    |
| Slot 1 (LR)     Slot 2 (SSR)    Slot 3 (SSR)    Slot 4 (Vide)                                    |
+--------------------------------------------------------------------------------------------------+
                                [ ENREGISTRER LES MODIFICATIONS ] (Bouton Primaire)
====================================================================================================

```

### 1.2 Fiche d'Interaction & Sélection des Cartes en Vitrine

- **Changer une carte en vitrine** : Clic sur `[Changer]` ou `[ + ]` -> Ouvre un mini-sélecteur d'inventaire en modale compacte.
- **Sélection d'emplacement** : Seules les cartes possédées en propre peuvent être assignées.
- **Limiteur de texte Bio** : Compteur dynamique `112 / 300`. Si `> 300`, la bordure du champ passe en rouge `#FF3355` avec désactivation du bouton `Enregistrer`.
- **Validation** : Clic sur `ENREGISTRER` -> Notification Toast vert `#00E699` : _"Profil mis à jour avec succès !"_.

---

## 2. Page Profil Public

### 2.1 Layout Visuel & États du Bouton Ami (ASCII)

Ce profil est visible par l'ensemble de la communauté au clic sur un pseudo dans le marché, le catalogue ou la liste d'amis.

La liste et le nombre d'amis sont visibles uniquement par le propriétaire sur son profil et sur /friends. Un visiteur, même ami accepté, ne voit ni liste ni compteur ni section de remplacement. Cette règle est indépendante de la confidentialité de la collection.

```
====================================================================================================
YOKKAI COLLEC' - PROFIL PUBLIC : @ShadowMaster
====================================================================================================
[YOKKAI COLLEC']                                                                    (1 450 K) (U)
----------------------------------------------------------------------------------------------------
 < RETOUR

+--------------------------------------------------------------------------------------------------+
| +-----------+  @ShadowMaster  ·  Inscrit le 12/01/2026                                           |
| |  AVATAR   |  Collection : 342 cartes · Valeur estimée : 45 800 Karas                          |
| | (96x96px) |  "À la recherche des cartes LR de la franchise Cyberpunk."                         |
| +-----------+                                                                                    |
|                BOUTON D'ACTION AMITIÉ : [ + AJOUTER EN AMI ]  (ou autre état)                     |
+--------------------------------------------------------------------------------------------------+
| CARTES EN VITRINE DE @ShadowMaster                                                               |
| +-----------+   +-----------+   +-----------+   +-----------+                                    |
| | [LR] [S]  |   | [LR]      |   | [SSR]     |   | [SSR]     |                                    |
| | Kuro Kits |   | Gashadok. |   | Ren Cyber |   | Aoi Drag. |                                    |
| +-----------+   +-----------+   +-----------+   +-----------+                                    |
+--------------------------------------------------------------------------------------------------+

```

### 2.2 Matrice des 4 États du Bouton "Ajouter en ami"

| État                   | Intitulé & Style du Bouton                            | Description & Action au clic                                                                        |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **1. Pas ami**         | `[ + AJOUTER EN AMI ]` (Bouton Primaire)              | Envoie une demande. Passe immédiatement à l'État 2 avec micro-animation.                            |
| **2. Demande envoyée** | `[ DEMANDE EN ATTENTE ]` (Secondaire / Désactivé)     | Représente l'attente de confirmation. Clic possible pour `Annuler la demande`.                      |
| **3. Demande reçue**   | `[ ACCEPTATION ]` & `[ REFUSER ]` (Dual Buttons)      | Apparaît si l'autre joueur nous a déjà demandé. `Accepter` (Vert `#00E699`), `Refuser` (`#FF3355`). |
| **4. Déjà ami**        | `[ AMIS ✓ ]` (Badge Vert) + `[ PROPOSER UN ÉCHANGE ]` | Indique l'amitié active et offre l'action directe d'ouverture de l'écran d'échange.                 |

---

## 3. Page Amis

### 3.1 Layout & Recherche

Recherche instantanée de pseudos et navigation par onglets pour la gestion du réseau social du joueur.

```
====================================================================================================
YOKKAI COLLEC' - GESTION DES AMIS
====================================================================================================
[YOKKAI COLLEC']  Boosters  Collection  Catalogue  Marché  Échanges  [AMIS (2)] | (1 450 K) (U)
----------------------------------------------------------------------------------------------------
AMIS ET DEMANDES

[ Q Rechercher un pseudo (ex: @Kitsune)... ]  [ CHERCHER ]

[ MES AMIS (24) ]   [ DEMANDES REÇUES (2) ]   [ DEMANDES ENVOYÉES (1) ]  (Onglets Framer Motion)
----------------------------------------------------------------------------------------------------
  LISTE DES DEMANDES REÇUES (2)

  +----------------------------------------------------------------------------------------------+
  | (Avatar) @CyberSamurai  ·  148 cartes  ·  Demande reçue il y a 2h                             |
  | [ ACCEPTER ] (Bouton Vert #00E699)              [ REFUSER ] (Bouton Danger)                  |
  +----------------------------------------------------------------------------------------------+
  | (Avatar) @KpopFan99    ·  89 cartes   ·  Demande reçue hier                                  |
  | [ ACCEPTER ] (Bouton Vert #00E699)              [ REFUSER ] (Bouton Danger)                  |
  +----------------------------------------------------------------------------------------------+
====================================================================================================

```

### 3.2 Spécification des États Vides (Empty States)

```
                     +-------------------------------------------------------+
                     |                 ( ICONE RESEAU VIDE )                 |
                     |                                                       |
                     |              AUCUNE DEMANDE REÇUE POUR L'INSTANT      |
                     |   Vous n'avez aucune demande d'ami en attente.        |
                     |                                                       |
                     |            [ RECHERCHER DES JOUEURS ]                 |
                     +-------------------------------------------------------+

```

- **Mes Amis (Vide)** : _"Vous n'avez pas encore d'ami. Recherchez des membres pour échanger vos cartes !"_
- **Demandes reçues (Vide)** : _"Aucune demande d'ami en attente."_
- **Demandes envoyées (Vide)** : _"Aucune demande d'ami envoyée en cours."_

---

## 4. Module d'Échange (Proposer un Échange & Offre Reçue)

### 4.1 Écran "Proposer un Échange" (Dual Columns)

Un système d'échange équitable en 2 colonnes permettant de combiner **cartes + compensation financière en Karas**.

```
====================================================================================================
YOKKAI COLLEC' - PROPOSER UN ÉCHANGE À @ShadowMaster
====================================================================================================
[YOKKAI COLLEC']                                                                    (1 450 K) (U)
----------------------------------------------------------------------------------------------------
 < ANNULER ET RETOURNER AUX AMIS

+------------------------------------------+   +------------------------------------------+
| TU PROPOSES (TON INVENTAIRE)             |   | TU DEMANDES (INVENTAIRE DE @ShadowMaster)|
|                                          |   |                                          |
|  +---------+   +---------+               |   |  +---------+                             |
|  | [SSR]   |   | [SR]    |               |   |  | [LR]    |                             |
|  | Aoi Drag|   | Ken Fla.|               |   |  | Kuro Kit|                             |
|  | [ Ret. ]|   | [ Ret. ]|               |   |  | [ Ret. ]|                             |
|  +---------+   +---------+               |   |  +---------+                             |
|  (2 cartes sélectionnées)                |   |  (1 carte sélectionnée)                  |
|                                          |   |                                          |
|  + [ Ajouter une carte de ma collec. ]   |   |  + [ Choisir une carte chez @ShadowM. ]  |
|                                          |   |                                          |
|  COMPENSATION EN KARAS :                 |   |  COMPENSATION EN KARAS :                 |
|  [ 200      ] Karas (Vos Karas: 1 450 K) |   |  [ 0        ] Karas                      |
+------------------------------------------+   +------------------------------------------+

⚠️ ERREUR KARAS INSUFFISANTS (Si Saisie > 1 450 K) :
"Solde de Karas insuffisant pour couvrir cette compensation !" (Border Rouge #FF3355)

----------------------------------------------------------------------------------------------------
                            [ ENVOYER LA PROPOSITION D'ÉCHANGE ] (Bouton Primaire)
====================================================================================================

```

### 4.2 Écran & Modale "Offre d'Échange Reçue"

#### A. Écran d'Examen d'une Offre Reçue

Présente les deux lots de cartes en face-à-face avec les 3 actions possibles : `ACCEPTER`, `REFUSER`, `CONTRE-PROPOSER`.

```
====================================================================================================
YOKKAI COLLEC' - OFFRE D'ÉCHANGE REÇUE DE @CyberSamurai
====================================================================================================
+------------------------------------------+   +------------------------------------------+
| CE QUE TU REÇOIS                         |   | CE QUE TU DONNES                         |
| • 1x Card : Kuro Kitsune (LR)            |   | • 2x Cards : Aoi Dragon (SSR) + 100 K    |
+------------------------------------------+   +------------------------------------------+

  [ ACCEPTER L'ÉCHANGE ]             [ CONTRE-PROPOSER ]             [ REFUSER L'ÉCHANGE ]
  (Bouton Vert #00E699)              (Bouton Secondaire)             (Bouton Danger #FF3355)

```

#### B. Modale de Confirmation d'Action Irréversible

Déclenchée au clic sur `ACCEPTER L'ÉCHANGE` pour prévenir les erreurs de manipulation.

```
+----------------------------------------------------------------------------------------------------+
| BACKDROP BLUR (#04000B - 80%)                                                                      |
|      +--------------------------------------------------------------------------------------+      |
|      |  CONFIRMATION DE L'ÉCHANGE                                             [X Annuler]   |      |
|      |                                                                                      |      |
|      |  ⚠️ ACTION IRRÉVERSIBLE                                                              |      |
|      |  Vous êtes sur le point de finaliser cet échange avec @CyberSamurai.                 |      |
|      |                                                                                      |      |
|      |  • Les cartes échangées changeront immédiatement de propriétaire.                    |      |
|      |  • Les compensations en Karas seront immédiatement transférées.                      |      |
|      |                                                                                      |      |
|      |  [ CONFIRMER ET ÉCHANGER MAINTENANT (Vert #00E699) ]                                 |      |
|      |  [ Annuler et vérifier ]                                                             |      |
|      +--------------------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------------------------+

```

---

## 5. Synthèse des Transitions & Feedback d'Animation (Étape 5)

1. **Acceptation de Demande d'Ami** : Changement d'état du bouton avec micro-animation `Spring` de Framer Motion.
2. **Transfert d'Échange Validé** : Animation de double glissement des cartes (Croisement des colonnes en `600ms`) suivi de la fermeture de la modale.
3. **Contre-proposition** : Duplication de l'offre initiale dans l'éditeur dual-column avec statut de modification.
