# Spécification Technique & Fiches d'Interaction : Étape 4 (Marché aux Enchères)

---

## 1. Page Liste des Enchères

### 1.1 Layout Visuel & Filtres (ASCII)

La page adopte une densité élevée pour présenter un maximum d'offres dès le premier écran, avec des badges de temps restant dynamiques.

```
====================================================================================================
YOKKAI COLLEC' - MARCHÉ AUX ENCHÈRES
====================================================================================================
[YOKKAI COLLEC']  Boosters  Collection  Catalogue  [MARCHÉ]  Échanges  Amis | (Q) (N) (1 450 K) (U)
----------------------------------------------------------------------------------------------------
MARCHÉ AUX ENCHÈRES  ·  1 284 cartes actuellement en vente

[ Rechercher une carte... ] [ Toutes raretés v ] [ Trier par: Fin imminente v ]  [ + VENDRE UNE CARTE ]
----------------------------------------------------------------------------------------------------
  +---------+   +---------+   +---------+   +---------+   +---------+   +---------+
  | [LR]    |   | [SSR]   |   | [SSR]   |   | [SR]    |   | [SR]    |   | [R]     |
  |         |   |         |   |         |   |         |   |         |   |         |
  |  VISUEL |   |  VISUEL |   |  VISUEL |   |  VISUEL |   |  VISUEL |   |  VISUEL |
  | CARTE   |   | CARTE   |   | CARTE   |   | CARTE   |   | CARTE   |   | CARTE   |
  |         |   |         |   |         |   |         |   |         |   |         |
  |Kuro Kits|   |Aoi Dragon|  |Ren Cyber|   |Yuki Frost|  |Ken Flame|   |Taro Shin|
  |Spirit R |   |Neo Tokyo|   |Cyberpunk|   |Winter S |   |Kendo Ace|   |Street V |
  |---------|   |---------|   |---------|   |---------|   |---------|   |---------|
  | 02m 14s |   | 14m 50s |   | 01h 12m |   | 03h 45m |   | 08h 10m |   | 18h 30m |
  | 4 500 K |   | 1 200 K |   |   850 K |   |   320 K |   |   210 K |   |    45 K |
  | [Suivre]|   | [Suivi] |   | [Suivre]|   | [Suivre]|   | [Suivre]|   | [Suivre]|
  +---------+   +---------+   +---------+   +---------+   +---------+   +---------+
----------------------------------------------------------------------------------------------------
                                      <  1  [2]  3  4  5  ...  24  >
====================================================================================================

```

### 1.2 Composants & Interactions de la Liste

- **Barre de Filtres** :
- Filtres compacts : Rareté (`Toutes`, `LR`, `SSR`, `SR`, `R`, `C`), Tri (`Fin imminente`, `Prix croissant`, `Prix décroissant`, `Les plus populaires`).
- Bouton d'Action à droite : `+ VENDRE UNE CARTE` (Bouton Primaire `#1D1844` avec border `#5244B5`).

- **Cartes de la Grille (Format 6 colonnes)** :
- **Badge Temps Restant** :
- `< 5 min` : Fond `#4C0A1B`, Texte `#FF3355` clignotant + icône sablier.
- `< 1 heure` : Fond `#523B00`, Texte `#FFCC33`.
- `> 1 heure` : Fond `#04000B`, Texte `#A29DBE`.

- **Prix Actuel** : Typographie Heading Bold en `#FFCC33` avec symbole Karas (`K`).
- **Nom de la Franchise** : Légende sous le nom du personnage en `#A29DBE` (11px).
- **Bouton Suivre / Suivi** :
- Non suivi : Icon Cœur vide, Texte `#A29DBE`, fond `#0F0C1D`.
- Suivi : Icon Cœur plein `#FF60B5`, fond `rgba(255, 96, 181, 0.15)`, border `1px solid #FF60B5`.

- **Clic sur la carte** : Transition instantanée vers la page de **Détail de l'Enchère**.

---

## 2. Page Détail d'une Enchère

### 2.1 Layout Wireframe (ASCII)

Mise en page immersive en 2 colonnes avec suivi du compte à rebours en temps réel et zone d'enchère dynamique.

```
====================================================================================================
YOKKAI COLLEC' - ENCHÈRE : KURO KITSUNE (LR SHINY)
====================================================================================================
[YOKKAI COLLEC']                                                                    (1 450 K) (U)
----------------------------------------------------------------------------------------------------
 < RETOUR AU MARCHÉ

+-------------------------------------+   KURO KITSUNE (LR SHINY)
|                                     |   Franchise: Spirit Realm Chromatics · Vendeur: @KitsuneMaster
|   +-----------------------------+   |   ----------------------------------------------------------
|   | [LR] [SHINY]                |   |   PRIX ACTUEL                     TEMPS RESTANT
|   |                             |   |   4 850 Karas                     00:02:14  ⚠️ FIN IMMINENTE
|   |        GRANDE IMAGE         |   |   (18 enchères posées)            (+1 min ajoutée à chaque mise)
|   |        DE LA CARTE          |   |   ----------------------------------------------------------
|   |                             |   |   FAIRE UNE ENCHÈRE
|   |         (HALO DORÉ          |   |   [ +10 Karas (4 860 K) ]   (Bouton rapide d'enchère)
|   |        PERSISTANT)          |   |
|   |                             |   |   Ou saisir un montant :
|   |                             |   |   [ 4860       ] Karas (Min: 4 860 K)  [ PLACER L'ENCHÈRE ]
|   +-----------------------------+   |
|                                     |   ⚠️ Message Alerte: "Solde insuffisant (Vos Karas: 1 450 K)"
+-------------------------------------+   ----------------------------------------------------------
                                          HISTORIQUE DES MISES (18)
                                          · @ShadowNinja   · 4 850 Karas   · Il y a 42 sec (+1 min)
                                          · @CyberSamurai  · 4 840 Karas   · Il y a 1 min 15 sec
                                          · @KpopFan99     · 4 500 Karas   · Il y a 4 min 02 sec
                                          · @KitsuneMaster · 1 000 Karas (Prix de départ)
====================================================================================================

```

### 2.2 Fiche d'Interaction & Règles de la Surenchère

#### A. Règle Anti-Sniping ("Anti-Dernière Seconde")

- **Déclencheur** : Toute offre placée au cours des **5 dernières minutes** ajoute automatiquement **+1 minute supplémentaire** au compte à rebours.
- **Notification Visuelle** :
- Apparition d'un Toast / Banner animé sous le chrono : _"⏱️ Une minute a été ajoutée à l'enchère !"_ avec flash doré `#FFCC33` (durée `300ms`).

#### B. Zone d'Offre & Boutons d'Action

- **Bouton Rapide `+10 Karas**` :
- Calcule automatiquement `Prix Actuel + 10`.
- Style : Bouton Primaire Doré avec `--glow-gold-sm`. Un clic valide immédiatement l'offre si le solde est suffisant.

- **Champ d'Offre Libre** :
- Input numérique (`#04000B`, border `#1D1844`). Validation automatique du montant minimum (`>= Prix Actuel + 10`).
- En cas d'erreur de frappe : Message sous le champ _"L'offre doit être d'au moins {Min} Karas"_.

#### C. Gestion des Erreurs de Solde

- Si `Solde Karas Utilisateur < Offre Minimale` :
- Le bouton `PLACER L'ENCHÈRE` passe en état désactivé / d'alerte.
- Affichage du message d'erreur rouge `#FF3355` : _"Solde de Karas insuffisant (Votre solde: {Solde} K)"_.
- Lien d'action rapide à côté : `[ Obtenir des Karas ]`.

#### D. État "Enchère Remportée" (Résolution)

- Lorsque le chrono atteint `00:00:00` et que l'utilisateur courant est le meilleur enchérisseur :
- La zone d'enchère est remplacée par le conteneur de victoire vert `#00E699` (`rgba(0, 230, 153, 0.15)`).
- Apparition du badge `ENCHÈRE REMPORTÉE !`.
- La carte est transférée directement dans l'inventaire avec l'animation **Célébration** (+ Confettis 2D).

---

## 3. Modale "Mettre aux Enchères"

### 3.1 Structure & Wireframe ASCII

Cette modale s'ouvre depuis la vue détaillée d'une carte possédée ou depuis le bouton `+ VENDRE UNE CARTE` du marché.

```
+----------------------------------------------------------------------------------------------------+
| BACKDROP BLUR (#04000B - 80%)                                                                      |
|      +--------------------------------------------------------------------------------------+      |
|      |  METTRE UNE CARTE AUX ENCHÈRES                                         [X Fermer]   |      |
|      |                                                                                      |      |
|      |  +-----------------------+   CARTE : Kuro Kitsune (SSR)                              |      |
|      |  | [SSR]                 |   Franchise: Spirit Realm Chromatics                      |      |
|      |  |                       |   -----------------------------------------------------   |      |
|      |  |     VISUEL CARTE      |   PRIX DE DÉPART (KARAS)                                  |      |
|      |  |                       |   [ 10         ]  (Min: 10 Karas · Recommandé: 250 K)      |      |
|      |  |                       |   -----------------------------------------------------   |      |
|      |  |                       |   DURÉE DE L'ENCHÈRE                                      |      |
|      |  |                       |   ( ) 15 min   ( ) 30 min   (*) 1h   ( ) 4h   ( ) 12h   ( ) 24h|      |
|      |  +-----------------------+   -----------------------------------------------------   |      |
|      |                              ⚠️ CONTRAT DE VENTE & AVERTISSEMENTS                    |      |
|      |                              • La carte sera VERROUILLÉE pendant toute la durée.     |      |
|      |                              • Toute personnalisation d'image Imgur sera RÉINITIALISÉE|      |
|      |                              -----------------------------------------------------   |      |
|      |                              [ CONFIRMER ET PUBLIER L'ENCHÈRE (Bouton Primaire) ]    |      |
|      +--------------------------------------------------------------------------------------+      |
+----------------------------------------------------------------------------------------------------+

```

### 3.2 Spécifications des Champs & Avertissements

- **Prix de départ** : Par défaut fixé à `10 Karas`.
- **Sélecteur de Durée (Pills Radio)** : Options cliquables : `15 min` | `30 min` | `1h` | `4h` | `12h` | `24h`.
- **Notes d'Avertissement (Panneau `#04000B` bordé `#1D1844`)** :

1. _Pendant l'enchère, la carte sera verrouillée et indisponible pour les échanges, la destruction ou le jeu._
2. _Toute image personnalisée via Imgur sera réinitialisée vers l'illustration officielle de la carte pour des raisons de conformité du marché._

- **Validation** : Clic sur `PUBLIER L'ENCHÈRE` -> Fermeture modale + notification Toast vert `#00E699` : _"Votre carte est désormais aux enchères !"_.

---

## 4. Page "Mes Enchères"

### 4.1 Navigation par Onglets

La page rassemble l'historique de vente et d'achat de l'utilisateur sous 3 onglets principaux :

- `En cours ({n})` : Ventes actives + Enchères posées en tant qu'acheteur.
- `Gagnées ({n})` : Enchères remportées (prêtes à être réclamées si besoin).
- `Vendues ({n})` : Historique des ventes conclues avec gains en Karas encaissés.

```
====================================================================================================
YOKKAI COLLEC' - MES ENCHÈRES
====================================================================================================
[YOKKAI COLLEC']  Boosters  Collection  Catalogue  [MARCHÉ]  Échanges | (Q) (N) (1 450 K) (U)
----------------------------------------------------------------------------------------------------
MES ENCHÈRES

[  EN COURS (0)  ]   [  GAGNÉES (0)  ]   [  VENDUES (0)  ]   (Tabs avec Indicator Framer Motion)
----------------------------------------------------------------------------------------------------

                     +-------------------------------------------------------+
                     |                                                       |
                     |                   ( ICONE COFFRE VIDE )               |
                     |                                                       |
                     |            AUCUNE ENCHÈRE EN COURS POUR LE MOMENT     |
                     |   Vous n'avez actuellement aucune vente active ni aucune |
                     |   offre déposée sur le marché.                        |
                     |                                                       |
                     |            [ PARCOURIR LE MARCHÉ AUX ENCHÈRES ]       |
                     |                                                       |
                     +-------------------------------------------------------+

====================================================================================================

```

### 4.2 Spécification des États Vides (Empty States)

| Onglet       | Message d'État Vide                           | Illustration / Icône                | Bouton d'Action Recommandé  |
| ------------ | --------------------------------------------- | ----------------------------------- | --------------------------- |
| **En cours** | _"Aucune enchère en cours pour le moment"_    | Coffre-fort ouvert sombre `#1D1844` | `Parcourir le marché`       |
| **Gagnées**  | _"Vous n'avez pas encore remporté d'enchère"_ | Trophée / Couronne grisée `#625C83` | `Voir les fin imminentes`   |
| **Vendues**  | _"Aucun historique de vente enregistrée"_     | Sac de Karas vide `#0F0C1D`         | `Mettre une carte en vente` |

---

## 5. Synthèse des Transitions & Feedback d'Animation (Étape 4)

1. **Mise à jour d'Enchère en Temps Réel** : Flash lumineux violet/or `#FFCC33` sur la ligne d'historique des mises (`200ms fast`).
2. **Prolongation +1 Min (Anti-Sniping)** : Animation d'impulsion sur le chronomètre avec changement de couleur temporaire vers `#FF3355`.
3. **Mise en Vente Validée** : Toast de notification glissant depuis le coin inférieur droit (`Normal 350ms`), suivi d'un rafraîchissement silencieux de l'inventaire.
