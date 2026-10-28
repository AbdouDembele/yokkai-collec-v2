# Spécification Technique & Fiches d'Interaction : Étape 7

---

## 1. Landing Page (Avant connexion) — Desktop & Mobile

### 1.1 Directives d'Alignement Design System

- **Conservation stricte** : Aucune modification de la structure, de l'ordre des sections ou des textes originaux.
- **Palette & Surfaces** :
- Fond général : `#090714` (`--bg-main`).
- Sections alternées & Hero : `#04000B` (`--bg-deep`) avec gradients sombres radiaux.
- Cartes de fonctionnalités & Cartes de démonstration : `#0F0C1D` (`--bg-surface`), bordures `#1D1844`.

- **Animations au Scroll & Visites** :
- **Apparition des sections** : Fondu ascendant `Moyenne (350ms cubic-bezier(0.16, 1, 0.3, 1))`, opacité `0 -> 1`, translateY `20px -> 0px`.
- **Grille de démonstration de cartes** : Animation `Stagger` (30ms d'intervalle entre chaque carte).
- **Survol des Boutons CTA** : Transitions `Courte (200ms)`, lueur discrète `--glow-gold-sm` ou `#5244B5`.

---

### 1.2 Layout Visuel ASCII (Desktop & Mobile)

#### A. Version Desktop (1920x1080)

```
====================================================================================================
YOKKAI COLLEC' - LANDING PAGE (DESKTOP)
====================================================================================================
[YOKKAI COLLEC']  Fonctionnalités  Raretés  Marché  Communauté | [ SE CONNECTER ]  [ REJOINDR' LA CHASSE ]
----------------------------------------------------------------------------------------------------
HERO SECTION
             LA CHASSE AUX YOKKAIS D'ÉLITE COMMENCE ICI
      Collectionnez, échangez et maîtrisez le marché de cartes gacha d'exception.

      [ REJOINDR' LA CHASSE (Bouton Primaire Doré) ]     [ DÉCOUVRIR LE CATALOGUE ]

      +-----------------------------------------------------------------------+
      |  [VISUEL HERO : 3 CARTES EN ÉVENTAIL - LR SHINY / SSR / SR]           |
      |  (Halos lumineux persistant #FFB700 et #E53360, particules en suspension)|
      +-----------------------------------------------------------------------+

----------------------------------------------------------------------------------------------------
SECTION 1 : UN SYSTÈME DE RARETÉ UNIQUE
  [ C ] Common   |   [ R ] Rare   |   [ SR ] Super Rare   |   [ SSR ] Ultra   |   [ LR ] Legendary
  (Grille montrant les bordures et lueurs officielles du Design System)

SECTION 2 : FONCTIONNALITÉS CLÉS
  +----------------------+  +----------------------+  +----------------------+
  | 📦 BOOSTERS REGULIERS|  | ⚖️ MARCHÉ AUX ENCHÈRES|  | 🔄 ÉCHANGES ENTRE AMIS|
  | Un booster offert    |  | Achetez et vendez en |  | Échangez vos doublons|
  | toutes les 15 min.   |  | temps réel avec Karas|  | en toute équité.     |
  +----------------------+  +----------------------+  +----------------------+

SECTION 3 : CTA FINAL
  PRÊT À CONSTRUIRE VOTRE DECK DE LÉGENDE ?
  [ CRÉER UN COMPTE GRATUITEMENT ]
====================================================================================================

```

#### B. Version Mobile (375x812)

```
+-----------------------------------+
| [YOKKAI]               [ = MENU ] |
+-----------------------------------+
| HERO SECTION                      |
| LA CHASSE AUX YOKKAIS D'ÉLITE     |
| COMMENCE ICI                      |
|                                   |
| [ REJOINDR' LA CHASSE (Full W) ]  |
| [ DÉCOUVRIR LE CATALOGUE ]        |
|                                   |
| +-------------------------------+ |
| | [VISUEL HERO : 1 CARTE LR]    | |
| | (Halo doré #FFB700)           | |
| +-------------------------------+ |
|                                   |
| RARETÉS (SWIPER HORIZONTAL)       |
| [<]  [ LR ] [ SSR ] [ SR ]  [>]   |
|                                   |
| FONCTIONNALITÉS (CARD STACK)      |
| +-------------------------------+ |
| | 📦 BOOSTERS RÉGULIERS         | |
| +-------------------------------+ |
| | ⚖️ MARCHÉ AUX ENCHÈRES        | |
| +-------------------------------+ |
| | 🔄 ÉCHANGES ENTRE AMIS        | |
| +-------------------------------+ |
+-----------------------------------+

```

---

### 1.3 Fiche de Compatibilité Visuelle (Signalement de Contraste)

Dans le cadre de l'application de la nouvelle palette sombre gacha AAA `#090714` / `#04000B`, voici les **3 ajustements de visuels** à prendre en compte :

1. **Illustrations des masques/filigranes clairs** : Les éléments graphiques d'arrière-plan de l'ancienne LP qui utilisaient des violets clairs ou gris saturés doivent passer en opacité réduit (`10% opacity`) avec teintes violettes foncées `#1D1844` pour éviter d'agresser l'œil et préserver la hiérarchie.
2. **Cartes de démonstration Rareté Common (C)** : Sur fond sombre `#04000B`, les bordures grises `#8A889A` de rareté C risquent de manquer de présence. Une lueur d'ambiance très subtile `rgba(138, 136, 154, 0.15)` a été appliquée autour des cartes C.
3. **Logos de Partenaires / Medias** : Tout logo ou icône externe utilisé en pied de page doit être converti en **version monochrome blanche/violette adoucie** (`#A29DBE`) pour respecter l'ambiance nocturne premium.

---

## 2. Page de Connexion — Desktop & Mobile

### 2.1 Intégration Visuelle

La page de connexion est intégrée directement dans le décor sombre du site, sur fond `#090714` avec un conteneur central `#0F0C1D` bordé de `#1D1844`.

```
====================================================================================================
YOKKAI COLLEC' - CONNEXION (DESKTOP)
====================================================================================================
[YOKKAI COLLEC']                                                                    (1 450 K) (U)
----------------------------------------------------------------------------------------------------

                  +--------------------------------------------------------+
                  |  CONTENT DE TE REVOIR                                  |
                  |  Connectez-vous pour accéder à vos boosters et vos cartes|
                  |                                                        |
                  |  ADRESSE EMAIL                                         |
                  |  [ email@exemple.com                                ]  |
                  |                                                        |
                  |  MOT DE PASSE                                          |
                  |  [ ••••••••••••••••                                 ]  |
                  |                                                        |
                  |  ⚠️ State Erreur (Si identifiants faux) :               |
                  |  "Email ou mot de passe incorrect." (#FF3355)           |
                  |                                                        |
                  |  [ SE CONNECTER (Bouton Primaire - Full Width) ]       |
                  |  (State Chargement: Spinner animé + opacité 80%)       |
                  |                                                        |
                  |  Pas encore de compte ? [ Rejoindre la chasse ]        |
                  +--------------------------------------------------------+

====================================================================================================

```

#### Version Mobile ( Connexion )

```
+-----------------------------------+
| [YOKKAI COLLEC']              [X] |
+-----------------------------------+
| CONTENT DE TE REVOIR              |
|                                   |
| EMAIL                             |
| [ email@exemple.com             ] |
|                                   |
| MOT DE PASSE                      |
| [ •••••••••••••                 ] |
|                                   |
| [ SE CONNECTER ]                  |
|                                   |
| Pas encore de compte ?            |
| [ Rejoindre la chasse ]           |
+-----------------------------------+

```

### 2.2 Fiche d'Interaction & États des Champs

- **État Repos (Default)** : Field background `#04000B`, border `1px solid #1D1844`, placeholder `#625C83`.
- **État Focus** : Field border passe à `#5244B5`, halo de focus `0 0 10px rgba(82, 68, 181, 0.3)` via transition `Fast (200ms)`.
- **État Chargement (Bouton)** :
- Clic sur `Se connecter` -> Desactivation du bouton.
- Icône de Spinner rotatif `#F2F0FF` à la place du texte. Durée minimale `500ms`.

- **État Erreur** :
- Border du champ concerné passe en rouge `#FF3355` avec halo `0 0 10px rgba(255, 51, 85, 0.3)`.
- Message sous le bloc : _"Email ou mot de passe incorrect."_ (Texte `#FF3355` 13px).

---

## 3. Page d'Inscription — Desktop & Mobile

### 3.1 Layout Visuel ASCII (Desktop & Mobile)

#### A. Version Desktop (1920x1080)

```
====================================================================================================
YOKKAI COLLEC' - INSCRIPTION (DESKTOP)
====================================================================================================
[YOKKAI COLLEC']                                                                    (1 450 K) (U)
----------------------------------------------------------------------------------------------------

                  +--------------------------------------------------------+
                  |  COMMENCE TA COLLECTION                                |
                  |  Créez votre compte et recevez votre premier booster ! |
                  |                                                        |
                  |  PSEUDO                                                |
                  |  [ KitsuneMaster                                    ]  |
                  |  ⚠️ State Erreur : "Ce pseudo est déjà pris, essaie-en un autre." |
                  |                                                        |
                  |  ADRESSE EMAIL                                         |
                  |  [ email@exemple.com                                ]  |
                  |                                                        |
                  |  MOT DE PASSE                                          |
                  |  [ ••••••••••••••••                                 ]  |
                  |                                                        |
                  |  [ CRÉER MON COMPTE (Bouton Primaire Doré) ]           |
                  |                                                        |
                  |  Déjà un compte ? [ Se connecter ]                     |
                  +--------------------------------------------------------+

====================================================================================================

```

#### B. Version Mobile (375x812)

```
+-----------------------------------+
| [YOKKAI COLLEC']              [X] |
+-----------------------------------+
| COMMENCE TA COLLECTION            |
|                                   |
| PSEUDO                            |
| [ KitsuneMaster                 ] |
|                                   |
| EMAIL                             |
| [ email@exemple.com             ] |
|                                   |
| MOT DE PASSE                      |
| [ •••••••••••••                 ] |
|                                   |
| [ CRÉER MON COMPTE ]              |
|                                   |
| Déjà un compte ?                  |
| [ Se connecter ]                  |
+-----------------------------------+

```

### 3.2 Fiche d'Interaction & Validation Pseudo

- **Champ Pseudo** :
- Validation dynamique à la saisie (debounce `300ms`).
- En cas de pseudo indisponible : La bordure passe en rouge `#FF3355` et le message _"Ce pseudo est déjà pris, essaie-en un autre."_ s'affiche sous le champ.

- **Redirection & Bienvenue** :
- Dès validation réussie de l'inscription : Redirection immédiate vers la page **Sélection des Boosters** avec déclenchement de la notification Toast vert `#00E699` : _"Bienvenue dans la chasse ! Votre premier booster est disponible."_.

---

## 4. Tableau Synthétique des Formats Responsive (Étape 7)

| Écran / Composant     | Desktop (>= 1024px)                       | Mobile (< 768px)                                         |
| --------------------- | ----------------------------------------- | -------------------------------------------------------- |
| **Landing Hero**      | Layout 2 colonnes avec cartes en éventail | 1 colonne centrée, carte unique LR, CTA Full-Width       |
| **Grille Raretés LP** | Ligne horizontale de 5 raretés            | Swiper horizontal scrollable avec flèches                |
| **Formulaires Auth**  | Card centrée de `460px` de largeur        | Conteneur fluide `100% width` avec padding `16px`        |
| **Topbar Auth**       | Topbar complète avec solde & navigation   | Header minimaliste avec Logo + Bouton de fermeture `[X]` |
