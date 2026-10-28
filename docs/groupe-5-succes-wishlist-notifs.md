# Spécification Technique & Fiches d'Interaction : Étape 6

---

## 1. Page Succès

### 1.1 Layout Visuel & Barre de Progression Global (ASCII)

La page Succès gratifie la progression du joueur à travers des hauts faits d'ouverture, de collection, de marché et d'interaction sociale.

```
====================================================================================================
YOKKAI COLLEC' - SUCCÈS ET HAUTS FAITS
====================================================================================================
[YOKKAI COLLEC']  Boosters  Collection  Catalogue  Marché  Échanges  Amis  [SUCCÈS] | (1 450 K) (U)
----------------------------------------------------------------------------------------------------
PROGRESSION GLOBALE DES SUCCÈS
28 / 60 succès débloqués  ( 46% )
[██████████████████████████████████...................................] (Barre dorée #FFCC33)

[ Tous (60) ]   [ En cours (28) ]   [ Complétés (4) ]   [ Réclamés (24) ]   (Filtres par état)
----------------------------------------------------------------------------------------------------
GRILLE DES SUCCÈS

  +-----------------------------------+   +-----------------------------------+
  | 🏆 OUVERTEUR FRÉNÉTIQUE (02/05)   |   | ⚡ PREMIER PAS DANS LE MARCHÉ     |
  | Ouvrir 10 boosters réguliers      |   | Placer votre première surenchère  |
  |                                   |   |                                   |
  | Progression : 7 / 10 boosters     |   | Progression : 1 / 1 (COMPLÉTÉ !)  |
  | [███████████████████.......] 70%  |   | [███████████████████████████] 100%|
  |                                   |   | (Lueur d'or active #FFB700)       |
  | Récompense : + 250 Karas          |   | Récompense : + 100 Karas          |
  |                                   |   |                                   |
  | [ ÉTAT : EN COURS ]               |   | [ RÉCLAMER 100 KARAS (Actif) ]    |
  +-----------------------------------+   +-----------------------------------+

  +-----------------------------------+   +-----------------------------------+
  | 🌟 LÉGENDE DU TANTŌ               |   | 🤝 ÉCHANGEUR ÉQUITABLE            |
  | Obtenir votre première carte LR   |   | Conclure 5 échanges d'amis        |
  |                                   |   |                                   |
  | Progression : 1 / 1 (RÉCLAMÉ)     |   | Progression : 2 / 5               |
  | [███████████████████████████] 100%|   | [██████████.................] 40% |
  |                                   |   |                                   |
  | Récompense : + 1 000 Karas        |   | Récompense : + 300 Karas          |
  |                                   |   |                                   |
  | [ RÉCLAMÉ ✓ (Vert #00E699) ]      |   | [ ÉTAT : EN COURS ]               |
  +-----------------------------------+   +-----------------------------------+
====================================================================================================

```

### 1.2 Fiche d'Interaction & États des Cartes de Succès

| Etat du Succès  | Style Visuel de la Carte                                     | Indication de Progression                               | Action Utilisateur                               |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------ |
| **1. En cours** | Card `#0F0C1D`, border `#1D1844`, texte `#A29DBE`            | Barre violette `#5244B5` + ratio numérique (ex: `7/10`) | Aucune action (Bouton informatif gris `#3E385D`) |
| **2. Complété** | Border dorée `#FFB700`, `--glow-gold-sm` active              | Barre dorée `#FFCC33` à `100%` + mention `COMPLÉTÉ !`   | Bouton Primaire Doré `RÉCLAMÉ {N} KARAS`         |
| **3. Réclamé**  | Card légèrement assombrie (Opacité `0.75`), border `#1D1844` | Barre dorée à `100%` + mention `RÉCLAMÉ`                | Badge Vert `#00E699` `RÉCLAMÉ ✓`                 |

#### Animation au clic sur "Réclamer"

1. Clic sur `RÉCLAMER 100 KARAS`.
2. La carte effectue une impulsion `Scale 1.03 -> 1.0` avec flash blanc.
3. Déclenchement instantané de l'animation **Crédit de Karas** sur le solde de la Topbar (+100 K enregistrés avec l'effet `Punch 1.25x`).
4. La carte transite en **État 3 (Réclamé)** via fondu `200ms fast`.

---

## 2. Page Wishlist

### 2.1 Layout & Grille Visuelle (ASCII)

La Wishlist répertorie les cartes convoitées par le joueur et affiche un indicateur en temps réel lorsqu'une de ces cartes est en vente aux enchères.

```
====================================================================================================
YOKKAI COLLEC' - MA WISHLIST
====================================================================================================
[YOKKAI COLLEC']  Boosters  Collection  Catalogue  Marché  Échanges  Amis  [WISHLIST (3)] | (1 450 K)
----------------------------------------------------------------------------------------------------
MA WISHLIST  ·  3 cartes suivies
Recevez une alerte dès qu'une de ces cartes est mise aux enchères sur le marché.

  +---------+   +---------+   +---------+
  | [LR] [S]|   | [SSR]   |   | [SR]    |
  |         |   |         |   |         |
  |  VISUEL |   |  VISUEL |   |  VISUEL |
  | CARTE   |   | CARTE   |   | CARTE   |
  |         |   |         |   |         |
  |Kuro Kits|   |Aoi Drag.|   |Ken Fla. |
  |Spirit R |   |Neo Tokyo|   |Kendo A. |
  |---------|   |---------|   |---------|
  | EN VENTE|   | NON DISP|   | EN VENTE|
  | 4 500 K |   |         |   |   220 K |
  | [RETIRE]|   | [RETIRE]|   | [RETIRE]|
  +---------+   +---------+   +---------+
====================================================================================================

```

### 2.2 Fiche d'Interaction & État Vide (Empty State)

- **Retirer de la Wishlist** :
- Clic sur le bouton `[ Retirer ]` (ou icône Cœur brisé) sous la carte.
- La carte se retire avec une animation de sortie `Scale 1 -> 0` + `Opacité 0` (`200ms fast`).
- Les autres cartes de la grille se resserrent en `Framer Motion Layout`.

#### État Vide (Empty State Wishlist)

```
                     +-------------------------------------------------------+
                     |                 ( ICONE ÉTOILE VIDE )                 |
                     |                                                       |
                     |               VOTRE WISHLIST EST VIDE                 |
                     |   Vous ne suivez actuellement aucune carte.           |
                     |   Parcourez le Catalogue pour ajouter les cartes      |
                     |   que vous rêvez de posséder !                        |
                     |                                                       |
                     |            [ EXPLORER LE CATALOGUE ]                  |
                     +-------------------------------------------------------+

```

---

## 3. Panneau de Notifications (Drawer Topbar)

### 3.1 Structure & Wireframe du Drawer (ASCII)

Ce panneau latéral coulissant s'ouvre depuis la droite au clic sur la cloche de la Topbar.

```
====================================================================================================
YOKKAI COLLEC' - OVERLAY PANNEAU NOTIFICATIONS (WIDTH 400PX)
====================================================================================================
                                      +------------------------------------------------------------+
                                      | NOTIFICATIONS (3 non lues)         [ Tout marquer lu ]  [X]|
                                      +------------------------------------------------------------+
                                      | 🔵 NON LU - Enchères                                       |
                                      | 💛 Carte Wishlist aux enchères !                           |
                                      | Kuro Kitsune (LR) de votre wishlist est en vente.          |
                                      | Prix actuel: 4 500 K · Il y a 5 min                        |
                                      +------------------------------------------------------------+
                                      | 🔵 NON LU - Urgence                                        |
                                      | 🚨 Vous avez été surenchéri !                             |
                                      | Une offre de 1 250 K a été posée sur Aoi Dragon.          |
                                      | Fin dans 04m 12s · Il y a 12 min                           |
                                      +------------------------------------------------------------+
                                      | 🔵 NON LU - Marché                                         |
                                      | 👑 Enchère remportée !                                     |
                                      | Félicitations ! Vous avez remporté Ren Cyber pour 850 K.   |
                                      | Il y a 1h                                                  |
                                      +------------------------------------------------------------+
                                      | LU - Social                                                |
                                      | 👤 Nouvelle demande d'ami                                  |
                                      | @CyberSamurai vous a envoyé une demande d'ami.             |
                                      | Il y a 3h                                                  |
                                      +------------------------------------------------------------+
                                      | LU - Échanges                                              |
                                      | 🔄 Proposition d'échange reçue                             |
                                      | @KpopFan99 vous propose un échange de cartes.             |
                                      | Il y a 5h                                                  |
                                      +------------------------------------------------------------+
                                      | LU - Récompenses                                           |
                                      | 🏆 Succès débloqué !                                       |
                                      | Succès : Premier pas dans le marché (+100 Karas).          |
                                      | Il y a 1 jour                                              |
                                      +------------------------------------------------------------+

```

### 3.2 Spécification des 6 Types de Notifications

| Type de Notification         | Icône & Code Couleur           | Titre Exemple                   | Description & Action                                                                               |
| ---------------------------- | ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| **1. Wishlist aux enchères** | 💛 Cœur d'Or (`#FFB700`)       | _Carte Wishlist aux enchères !_ | "Kuro Kitsune (LR) est en vente pour 4 500 K." -> Clic redirige vers le détail de l'enchère.       |
| **2. Surenchéri**            | 🚨 Alerte Rouge (`#FF3355`)    | _Vous avez été surenchéri !_    | "Une nouvelle offre a été posée sur Aoi Dragon." -> Clic redirige vers l'enchère pour surenchérir. |
| **3. Enchère remportée**     | 👑 Couronne Verte (`#00E699`)  | _Enchère remportée !_           | "Vous avez remporté l'enchère pour Ren Cyber !" -> Redirige vers la collection.                    |
| **4. Demande d'ami**         | 👤 Profil Violet (`#5244B5`)   | _Nouvelle demande d'ami_        | "@CyberSamurai vous a envoyé une demande d'ami." -> Clic ouvre la page Amis.                       |
| **5. Offre d'échange**       | 🔄 Flèches Oranges (`#FF9900`) | _Proposition d'échange reçue_   | "@KpopFan99 vous propose un échange." -> Clic ouvre le module d'échange.                           |
| **6. Succès débloqué**       | 🏆 Trophée Doré (`#FFCC33`)    | _Succès débloqué !_             | "Succès : Premier pas dans le marché (+100 K)." -> Clic ouvre la page Succès.                      |

### 3.3 États du Panneau de Notifications

#### A. État "Lu" vs "Non Lu"

- **Non lu** : Fond `#16122B`, border-left `3px solid #5244B5` (ou la couleur du type), pastille bleue lumineuse `#00E5FF` à gauche.
- **Lu** : Fond transparent / `#0F0C1D`, border-left `none`, texte légèrement adouci (Opacité `0.7`).
- **Bouton "Tout marquer comme lu"** :
- Un clic efface toutes les pastilles bleues et passe le fond de tous les items en état lu via une transition `Fast (200ms)`.

#### B. État Vide (Empty Notifications)

```
                                      +------------------------------------------------------------+
                                      | NOTIFICATIONS                                          [X] |
                                      +------------------------------------------------------------+
                                      |                                                            |
                                      |                   ( ICONE CLOCHE AU REPOS )                |
                                      |                                                            |
                                      |                AUCUNE NOTIFICATION POUR LE MOMENT          |
                                      |   Vous êtes à jour ! Vos alertes et activités             |
                                      |   apparaîtront ici.                                        |
                                      |                                                            |
                                      +------------------------------------------------------------+

```

#### C. État d'Erreur ("Impossible de charger tes notifications")

```
                                      +------------------------------------------------------------+
                                      | NOTIFICATIONS                                          [X] |
                                      +------------------------------------------------------------+
                                      |                                                            |
                                      |                   ( ICONE ALERTE ROUGE #FF3355 )           |
                                      |                                                            |
                                      |             IMPOSSIBLE DE CHARGER TES NOTIFICATIONS        |
                                      |   Une erreur de connexion est survenue lors de la          |
                                      |   récupération de vos alertes.                             |
                                      |                                                            |
                                      |               [ RÉESSAYER ] (Bouton Secondaire)            |
                                      |                                                            |
                                      +------------------------------------------------------------+

```

---

## 4. Synthèse des Transitions & Feedback d'Animation (Étape 6)

1. **Ouverture du Drawer Notification** : Slide-left depuis le bord droit de l'écran `300ms cubic-bezier(0.16, 1, 0.3, 1)` avec Backdrop blur `8px`.
2. **Réclamation de Récompense Succès** : Animation **Crédit de Karas** (effet `Punch 1.25x` sur la Topbar) + transition de la carte vers l'état réclamé.
3. **Suppression Wishlist** : Disparition de la carte par rétrécissement `Scale 0` et réalignement automatique des cartes adjacentes.
