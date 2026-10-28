# Spécification Technique & Fiches d'Interaction : Étape 3

---

## 1. Page Sélection des Boosters

### 1.1 Architecture Visuelle & Layout

- **Arrière-plan** : Gradient radial immersif `#090714` vers `#04000B`.
- **En-tête** : Titre `SELECTION DES BOOSTERS` (Heading Display 32px `#F2F0FF`), sous-titre _"Choisissez votre tirage pour enrichir votre collection"_ (`#A29DBE`).
- **Disposition** : Grille 2 colonnes centrée (Cartes de boosters format vertical grand angle `400px x 560px`, `radius-xl`, fond `#0F0C1D`, border `1px solid #1D1844`).

```
+----------------------------------------------------------------------------------------------------+
| [YOKKAI COLLEC']  [BOOSTERS]  Collection  Catalogue  Marché  Échanges  Amis  ... | (N)  (1 450 K) (U) |
+----------------------------------------------------------------------------------------------------+
| SÉLECTION DES BOOSTERS                                                                             |
| Choisissez votre tirage pour enrichir votre collection                                             |
|                                                                                                    |
|    +------------------------------------+        +------------------------------------+            |
|    | BOOSTER RÉGULIER                   |        | BOOSTER DÉCISIF                    |            |
|    | [3/5 EN RÉSERVE]                   |        | [ ÉVÉNEMENT QUOTIDIEN ]            |            |
|    |                                    |        |                                    |            |
|    |         ILLUSTRATION PACK          |        |         ILLUSTRATION PACK          |            |
|    |          VIOLET & ORB              |        |         DORÉ & RAYONS              |            |
|    |                                    |        |                                    |            |
|    | 5 cartes par pack                  |        | 1 carte à garder parmi 5           |            |
|    | Rechargement : 1 pack / 15 min     |        | Rechargement : 1 tirage / 24h      |            |
|    | Status : Disponible maintenant     |        | Status : Revient demain à 00:00    |            |
|    |                                    |        |                                    |            |
|    | [  OUVRIR UN BOOSTER (Actif)  ]    |        | [ REVIENT DANS 08:14:22 (Désactiv) ]|            |
|    +------------------------------------+        +------------------------------------+            |
+----------------------------------------------------------------------------------------------------+

```

### 1.2 Cartes de Boosters & États d'Interaction

#### A. Carte Booster Régulier

- **Header & Badges** : Badge Pill top-left `#1D1844` avec texte `3/5 EN RÉSERVE` (Gris/Violet `#A29DBE`).
- **Visuel Central** : Illustration vectorielle de pack scellé violet sombre (`#1D1844` / `#5244B5`) avec orbe d'énergie pulsing.
- **Informations** :
- Titre : `BOOSTER RÉGULIER` (`24px` Bold `#F2F0FF`)
- Description : _ Contient 5 cartes · Tirage fréquent (C à LR) _
- Timer / Dispo : Si dispo -> Text vert `#00E699` _"Disponible maintenant"_. Si réserve vide -> Text `#FF9900` _"Prochain dans 12:45"_.

- **Action** :
- Si disponible : Bouton Primaire `OUVRIR UN BOOSTER` (Glow `#5244B5`).
- Si indisponible : Bouton Désactivé `RÉSERVE ÉPUISÉE (12:45)`.

#### B. Carte Booster Décisif

- **Header & Badges** : Badge Pill top-left `#523B00` avec texte `ÉVÉNEMENT QUOTIDIEN` en or `#FFB700` (`glow-gold-sm`).
- **Visuel Central** : Illustration vectorielle de pack scellé doré lumineux avec particules or en suspension.
- **Informations** :
- Titre : `BOOSTER DÉCISIF` (`24px` Bold `#FFB700`)
- Description : _ Révèle 5 cartes. Choisissez-en 1 seule à conserver, les 4 autres sont converties en Karas. _
- Status : Text `#FFCC33` _"1 carte à garder parmi 5"_ · _"Revient demain à 00:00"_.

- **Action** :
- Si disponible : Bouton Primaire Doré `LANCER LE TIRAGE DÉCISIF` (`--glow-gold-lg`).
- Si déjà utilisé : Bouton Désactivé `REVIENT DANS 08:14:22`.

---

## 2. Écran d'Ouverture : Booster Régulier

### 2.1 Séquence de Révélation & Layout

- **Structure** : Alignement horizontal de **5 cartes face cachée** (ratio `2:3`, dos violet sombre `#0F0C1D` avec motif filigrane).
- **Ordre de Révélation** : Le joueur utilise le **déclenchement global du paquet**. Les cartes sont ensuite révélées successivement dans l'**ordre de rareté croissante** (trié automatiquement par le serveur : C -> R -> SR -> SSR -> LR / Shiny) pour créer une montée progressive de la tension gacha. Il n’y a pas de clic individuel sur chaque carte.

```
====================================================================================================
YOKKAI COLLEC' - OUVERTURE BOOSTER RÉGULIER
====================================================================================================
[YOKKAI COLLEC']                                                                    (1 450 K) (U)
----------------------------------------------------------------------------------------------------
                                    TIRAGE BOOSTER RÉGULIER
                      Révélez vos cartes de gauche à droite (3 / 5 révélées)

  +---------+     +---------+     +---------+     +---------+     +---------+
  | [ C ]   |     | [ R ]   |     | [ SR ]  |     | [ ??? ] |     | [ ??? ] |
  |         |     |         |     |         |     |         |     |         |
  |  VISUEL |     |  VISUEL |     |  VISUEL |     |   DOS   |     |   DOS   |
  | REVELÉ  |     | REVELÉ  |     | REVELÉ  |     |  CARTE  |     |  CARTE  |
  |         |     |         |     |         |     |         |     |         |
  |Taro Shin|     |Ken Flame|     |Yuki Frost|    |         |     |         |
  |Street V |     |Kendo Ace|     |Winter S |     | ATTENTE  |     | ATTENTE |
  +---------+     +---------+     +---------+     +---------+     +---------+
  [Détruire]     [Détruire]     [Détruire]     [ En attente ]  [ En attente ]
   (+ 10 K)        (+ 25 K)        (+ 75 K)

----------------------------------------------------------------------------------------------------
                                     [  VOIR MA COLLECTION  ]
====================================================================================================

```

### 2.2 Fiche d'Interaction & Micro-Animations

1. **Écran Initial (5 cartes face cachée)** :

- Entrée des cartes en `Stagger` (50ms d'intervalle) avec léger effet de lévitation (`Y: 10px -> 0px`).

2. **Séquence globale de révélation (Card Flip)** :

- Un déclenchement sur le paquet lance toute la séquence ; chaque carte applique ensuite son reveal dans l’ordre, sans clic individuel.
- **Carte C / R** : Rotation Y `180deg` en `200ms cubic-bezier(0.16, 1, 0.3, 1)`.
- **Carte SR** : Applique la fiche d'animation **Reveal SR** (Tremblement 300ms -> Flip 180° -> Onde de choc violette `#A033E5` -> 15 particules).
- **Carte SSR** : Applique la fiche d'animation **Reveal SSR** (Assombrissement fond -> Slow motion -> Flash blanc/rose `#E53360` -> 35 particules).
- **Carte LR** : Applique l'animation originale **Reveal LR** (Tension 2.5s -> Explosion dorée `#FFB700` -> Pluie de particules dense -> Halo persistant).

3. **Sous chaque carte révélée** :

- Nom du personnage (`#F2F0FF` Bold) + Nom de la franchise (`#A29DBE`).
- Bouton `Détruire (+X Karas)` : Style Danger neutre.

4. **Action "Détruire"** :

- Clic sur `Détruire` : La carte passe à `40% opacité`, un overlay rouge discret avec mention `DÉTRUITE` apparaît, et le bouton se transforme en `Conserver`.

5. **Navigation finale ("Voir ma collection")** :

- Les cinq cartes rejoignent `user_cards` dès l’ouverture du Regular Pack ; le reveal ne crée aucun état en attente de confirmation.
- La destruction individuelle, la sélection multiple et la mise aux enchères agissent donc sur des cartes déjà présentes dans la Collection.
- Le panneau récapitulatif et son lien « Voir ma collection » apparaissent uniquement lorsque toutes les cartes ont été retournées.
- Aucune redirection automatique n’est déclenchée à la fin du reveal.

---

## 3. Écran d'Ouverture : Booster Décisif

### 3.1 Déroulement & Règle du Choix Unique

- **Révélation** : Identique au Booster Régulier : déclenchement global depuis le paquet, puis 5 cartes révélées successivement par ordre croissant de rareté avec leurs effets lumineux respectifs.
- **Contrainte d'Action** : **Aucun bouton "Détruire" n'est présent sous les cartes**.
- **Transition "Choix Décisif"** : Une fois la 5ème carte révélée, l'interface bascule en mode sélection d'élite avec le message : _"CHOISIS TA CARTE DÉCISIVE · Les 4 autres seront converties en Karas"_.

```
====================================================================================================
YOKKAI COLLEC' - OUVERTURE BOOSTER DÉCISIF (SÉLECTION)
====================================================================================================
[YOKKAI COLLEC']                                                                    (1 450 K) (U)
----------------------------------------------------------------------------------------------------
                                    FAIS TON CHOIX DÉCISIF
             Cliquez sur la carte que vous souhaitez conserver dans votre collection

  +---------+     +---------+     +---------+     +---------+     +---------+
  | [ R ]   |     | [ SR ]  |     | [ SSR ] |     | [ LR ]  |     | [ SR ]  |
  |         |     |         |     |         |     | [SHINY] |     |         |
  |  VISUEL |     |  VISUEL |     |  VISUEL |     |  VISUEL |     |  VISUEL |
  | REVELÉ  |     | REVELÉ  |     | REVELÉ  |     | REVELÉ  |     | REVELÉ  |
  |         |     |         |     |         |     |         |     |         |
  |Taro Shin|     |Ken Flame|     |Ren Cyber|     |Kuro Kit |     |Yuki Fros|
  |Street V |     |Kendo Ace|     |Cyberpunk|     |Spirit R |     |Winter S |
  +---------+     +---------+     +---------+     +---------+     +---------+
  [ Choisir ]     [ Choisir ]     [ Choisir ]   [ GARDER CELLE-CI ] [ Choisir ]
                                                (Glow d'Or #FFB700)
====================================================================================================

```

### 3.2 Modale de Confirmation Décisive

Au clic sur `GARDER CELLE-CI` sous une carte (par exemple la carte LR Shiny) :

```
+----------------------------------------------------------------------------------------------------+
| BACKDROP BLUR (#04000B - 80%)                                                                      |
|      +--------------------------------------------------------------------------------------+      |
|      |  CONFIRMER LE CHOIX DÉCISIF                                            [X Annuler]   |      |
|      |                                                                                      |      |
|      |  +-----------------------+   Voulez-vous garder cette carte ?                        |      |
|      |  | [LR] [SHINY]          |   "Kuro Kitsune (Shiny LR)"                              |      |
|      |  |                       |                                                           |      |
|      |  |     VISUEL CARTE      |   ⚠️ LES 4 AUTRES CARTES SERONT PERDUES                      |      |
|      |  |      SÉLECTIONNÉE     |   Elles seront automatiquement converties en :            |      |
|      |  |                       |   + 650 Karas                                             |      |
|      |  +-----------------------+                                                           |      |
|      |                              [ CONFIRMER ET CONSERVER CETTE CARTE ]                  |      |
|      |                              [ Revenir au choix ]                                    |      |
|      +--------------------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------------------------+

```

### 3.3 Écran de Résultat Après Confirmation

- **Animation de désintégration (600ms)** : Les 4 cartes non choisies se dissolvent en poussière d'étoiles dorées (`#FFCC33`).
- **Mise en valeur** : La carte choisie glisse au centre de l'écran, s'agrandit (`Scale 1.15`), et rayonne d'un aura d'or persistant.
- **Message de bilan** :
- Titre : `CARTE AJOUTÉE À TA COLLECTION !`
- Sous-titre : `+ 650 Karas crédités depuis les cartes non conservées.`

- **Feedback Economie** : L'animation **Crédit de Karas** est instantanément jouée sur le compteur global (`Punch 1.25x` + incrément numérique de Karas).
- **Bouton Final** : `RETOURNER AU HUB DES BOOSTERS` (Bouton Primaire).

---

## 4. Tableau Récapitulatif des Modificateurs et Animations

| Écran / Moment        | Composant Impliqué          | Animation & Dureé                               | Code Couleur / Token                           |
| --------------------- | --------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| **Sélection Booster** | Card Hover                  | `Fast (200ms)`, Scale 1.02                      | `#1D1844` -> `#2E276D`, Glow `#5244B5`         |
| **Sélection Booster** | Booster Décisif             | Continuous Pulsation `2.0s`                     | `--glow-gold-lg` (`#FFB700`)                   |
| **Reveal Régulier**   | Flip Carte C / R            | `Fast (200ms)`, RotateY `180deg`                | Border `#2B82C9`                               |
| **Reveal Régulier**   | Flip Carte SR / SSR / LR    | Fiches dédiées SR (1.2s), SSR (1.8s), LR (2.5s) | Violet `#A033E5`, Rose `#E53360`, Or `#FFB700` |
| **Booster Décisif**   | Désintégration des 4 cartes | Particle Dissolve `600ms`                       | Particules d'or `#FFCC33` (Opacité `1` -> `0`) |
| **Bilan Décisif**     | Crédit de Karas non gardés  | `Punch 1.25x` + Increment `800ms`               | Text `#FFCC33` + Glow inset                    |
