# Design System & Langage d'Animation : Yokkai Collec'

Ce document spécifie le Design System et le Langage d'Animation pour l'interface du jeu **Yokkai Collec'**. Il s'appuie directement sur l'identité visuelle de l'animation de reveal LR : ambiance sombre, mystérieuse, premium, inspirée des interfaces de jeux gacha AAA (Genshin Impact, Honkai Star Rail).

---

## 1. Tokens de Design (Tailwind & CSS Variables)

### 1.1 Palette de Couleurs & Surfaces

#### Couleurs de Fond et Neutres

```css
:root {
  /* Fond Profond / Modales / Overlays */
  --bg-deep: #04000b;
  /* Fond Principal */
  --bg-main: #090714;
  /* Cartes, Cartes d'interface, Panneaux */
  --bg-surface: #0f0c1d;
  /* Surface Elevée / Conteneurs Intérieurs */
  --bg-surface-elevated: #16122b;

  /* Bordures, Accents Structuraux & Separateurs */
  --border-subtle: #1d1844;
  --border-active: #2e276d;
  --border-focus: #5244b5;

  /* Textes */
  --text-primary: #f2f0ff;
  --text-secondary: #a29dbe;
  --text-muted: #625c83;
  --text-disabled: #3e385d;
}
```

#### Système des Couleurs de Rareté

| Rareté                     | Couleur Principale (Hex) | Gradient de Carte / Badge (CSS)                     | Glow / Ombre Porosité               |
| -------------------------- | ------------------------ | --------------------------------------------------- | ----------------------------------- |
| **C (Common)**             | `#8A889A`                | `linear-gradient(135deg, #2A2838 0%, #15141E 100%)` | `0 0 10px rgba(138, 136, 154, 0.2)` |
| **R (Rare)**               | `#2B82C9`                | `linear-gradient(135deg, #1C4D78 0%, #0E2943 100%)` | `0 0 12px rgba(43, 130, 201, 0.35)` |
| **SR (Super Rare)**        | `#A033E5`                | `linear-gradient(135deg, #681B9A 0%, #300A4C 100%)` | `0 0 18px rgba(160, 51, 229, 0.5)`  |
| **SSR (Super Super Rare)** | `#E53360`                | `linear-gradient(135deg, #9C1B3B 0%, #4C0A1B 100%)` | `0 0 24px rgba(229, 51, 96, 0.65)`  |
| **LR (Legendary Rare)**    | `#FFB700`                | `linear-gradient(135deg, #B58200 0%, #523B00 100%)` | `0 0 30px rgba(255, 183, 0, 0.8)`   |

#### Overlay / Finition "Shiny"

_La variante **Shiny** normale est une finition de **LR** tirée directement. Une SSR portant le flag historique `is_shiny` est une **SSR INFINITY**, obtenue par évolution de cinq SSR normales identiques ; trois LR normales identiques donnent une **LR INFINITY**. Le nom technique de certaines classes/effets reste historique._

```css
--shiny-overlay: linear-gradient(
  115deg,
  rgba(255, 0, 128, 0.4) 0%,
  rgba(0, 234, 255, 0.4) 33%,
  rgba(255, 221, 0, 0.4) 66%,
  rgba(183, 0, 255, 0.4) 100%
);
--shiny-border: linear-gradient(135deg, #ff60b5, #00e5ff, #ffd700);
--shiny-glow: 0 0 25px rgba(255, 221, 0, 0.5), 0 0 45px rgba(0, 235, 255, 0.3);
```

#### Couleurs Fonctionnelles

| Fonction             | Couleur Hex | Variante Translucide (Glow / BG) |
| -------------------- | ----------- | -------------------------------- |
| **Succès / Positif** | `#00E699`   | `rgba(0, 230, 153, 0.15)`        |
| **Danger / Erreur**  | `#FF3355`   | `rgba(255, 51, 85, 0.15)`        |
| **Alerte / Warning** | `#FF9900`   | `rgba(255, 153, 0, 0.15)`        |
| **Devise (Karas)**   | `#FFCC33`   | `rgba(255, 204, 51, 0.2)`        |

---

### 1.2 Typographie

Familles recommandées :

- **Titres & Valeurs** : `Cinzel` ou `Orbitron` ou `Montserrat` (Sans-Serif géométrique premium / All Caps)
- **Corps de texte & UI** : `Inter` ou `Plus Jakarta Sans`

| Rôle UI                          | Fonte        | Taille (px / rem) | Graisse        | Interligne | Space-lettering |
| -------------------------------- | ------------ | ----------------- | -------------- | ---------- | --------------- |
| **Display (Reveal, Victoire)**   | Heading Font | 48px / 3rem       | Bold (700)     | 1.1        | +0.1em          |
| **Titre H1 (Pages)**             | Heading Font | 32px / 2rem       | Bold (700)     | 1.2        | +0.05em         |
| **Titre H2 (Modales, Sections)** | Heading Font | 24px / 1.5rem     | SemiBold (600) | 1.3        | Normal          |
| **Titre H3 (Sous-titres)**       | Body Font    | 18px / 1.125rem   | SemiBold (600) | 1.4        | Normal          |
| **Body Large**                   | Body Font    | 16px / 1rem       | Regular (400)  | 1.5        | Normal          |
| **Body Base**                    | Body Font    | 14px / 0.875rem   | Regular (400)  | 1.5        | Normal          |
| **UI Small / Captions**          | Body Font    | 12px / 0.75rem    | Medium (500)   | 1.4        | +0.02em         |
| **Badges & Boutons (UPPERCASE)** | Heading Font | 12px / 0.75rem    | Bold (700)     | 1.0        | +0.08em         |

---

### 1.3 Échelle d'Espacement, Rayons & Ombres

#### Espacement (Tailwind Base)

`4px (1)` | `8px (2)` | `12px (3)` | `16px (4)` | `24px (6)` | `32px (8)` | `48px (12)` | `64px (16)`

#### Rayons de Courbure (Border Radius)

- `radius-sm`: `4px` (Badges, petits toptips)
- `radius-md`: `8px` (Boutons, champs, petites cartes)
- `radius-lg`: `14px` (Conteneurs, modales, cartes de jeu)
- `radius-xl`: `24px` (Pill-buttons, conteneurs d'exception)
- `radius-full`: `9999px` (Avatars, compteurs)

#### Ombres et Lueurs (Box Shadow CSS)

```css
/* Ombre Portée de Composant Basique */
--shadow-card: 0 8px 24px -4px rgba(4, 0, 11, 0.8), 0 0 0 1px #1d1844;

/* Survol Composant Interactif */
--shadow-hover:
  0 12px 32px -4px rgba(4, 0, 11, 0.95), 0 0 12px rgba(82, 68, 181, 0.4);

/* Lueurs Dorées (Thème LR / Karas) */
--glow-gold-sm: 0 0 12px rgba(255, 183, 0, 0.35);
--glow-gold-lg:
  0 0 30px rgba(255, 183, 0, 0.6), 0 0 60px rgba(255, 183, 0, 0.2);

/* Ombre Inset Panneau Renfoncé */
--shadow-inset: inset 0 2px 6px 0 rgba(0, 0, 0, 0.6);
```

---

## 2. Composants UI (Spécifications React/Tailwind)

### 2.1 Boutons

```
Bouton Primaire : Fond #1D1844, Bordure #5244B5, Texte #F2F0FF
Etat Survol     : Fond #2E276D, Glow 0 0 15px rgba(82,68,181,0.5)
Etat Pressé     : Scale 0.97, Fond #16122B

```

| Type         | État Repos        | État Survol | État Pressé | État Focus |
| ------------ | ----------------- | ----------- | ----------- | ---------- |
| **Primaire** | BG: `#1D1844`<br> |

<br>Border: `1px solid #5244B5`<br>

<br>Text: `#F2F0FF` | BG: `#2E276D`<br>

<br>Glow: `0 0 16px rgba(82, 68, 181, 0.5)` | Scale: `0.97`<br>

<br>BG: `#16122B` | Outline: `2px solid #FFCC33`<br>

<br>Offset: `2px` |
| **Secondaire** | BG: `#0F0C1D`<br>

<br>Border: `1px solid #1D1844`<br>

<br>Text: `#A29DBE` | BG: `#16122B`<br>

<br>Border: `1px solid #2E276D`<br>

<br>Text: `#F2F0FF` | Scale: `0.98` | Outline: `2px solid #5244B5`<br>

<br>Offset: `2px` |
| **Danger** | BG: `rgba(255, 51, 85, 0.1)`<br>

<br>Border: `1px solid #FF3355`<br>

<br>Text: `#FF3355` | BG: `#FF3355`<br>

<br>Text: `#FFFFFF`<br>

<br>Glow: `0 0 16px rgba(255, 51, 85, 0.5)` | Scale: `0.97` | Outline: `2px solid #FF3355`<br>

<br>Offset: `2px` |
| **Désactivé** | BG: `#0F0C1D`<br>

<br>Border: `1px solid #16122B`<br>

<br>Text: `#3E385D`<br>

<br>Cursor: `not-allowed` | Pas de changement | Pas de changement | Pas d'outline |

---

### 2.2 Champs de Formulaire & Entrées

- **Fond** : `#04000B`
- **Bordure** : `1px solid #1D1844`
- **Texte Saisi** : `#F2F0FF` | **Placeholder** : `#625C83`
- **Focus State** : Bordure passée à `#5244B5` + `box-shadow: 0 0 10px rgba(82, 68, 181, 0.3)`
- **State Erreur** : Bordure passée à `#FF3355` + `box-shadow: 0 0 10px rgba(255, 51, 85, 0.3)`

---

### 2.3 Navigation, Filtres et Onglets

#### Onglets (Tabs)

- **Conteneur** : Background `#04000B`, padding `4px`, radius `10px`, border `1px solid #1D1844`.
- **Inactif** : Text `#A29DBE`, background transparent.
- **Actif** : Text `#F2F0FF`, background `#0F0C1D`, border `1px solid #2E276D`, shadow `0 2px 8px rgba(0,0,0,0.5)`. Animation glissée du fond d'onglet via Framer Motion (`layoutId`).

#### Pastilles de Filtre (Pills)

- **Inactif** : Background `#0F0C1D`, border `1px solid #1D1844`, text `#A29DBE`.
- **Actif** : Background `#1D1844`, border `1px solid #5244B5`, text `#F2F0FF`, lueur discrète `0 0 8px rgba(82, 68, 181, 0.4)`.

---

### 2.4 Cartes de Jeu (Composants Interface)

- **Ratio** : `2:3` (Carte standard verticale).
- **Fond (Dos de carte)** : Background `#0F0C1D`, motif vectoriel filigrane violet foncé, bordure `#1D1844`.
- **Comportement Survol (Catalogue/Inventaire)** :
- Translate Y : `-6px`
- Rotate : `-1deg` à `1deg` (selon la position de la souris)
- Transition : `200ms cubic-bezier(0.16, 1, 0.3, 1)`
- Affichage d'un reflet oblique blanc/violet en overlay CSS (gradient linéaire 45 deg glissant).

---

### 2.5 Modales & Panneaux

- **Overlay (Backdrop)** : Background `#04000B` à `80%` d'opacité + `backdrop-filter: blur(8px)`.
- **Boîte Modale** : Background `#0F0C1D`, border `1px solid #1D1844`, radius `14px`, shadow `0 20px 50px rgba(0, 0, 0, 0.9)`.
- **Barre de Titre** : Séparateur bas `#1D1844`, typographie Heading All Caps.

---

### 2.6 Notification / Toasts

- **Position** : Bottom-Right (`bottom: 24px`, `right: 24px`).
- **Dimensions** : Width `320px`, Height auto.
- **Style** : Background `#0F0C1D`, border left `4px solid [Couleur_Fonctionnelle]`, shadow `0 10px 25px rgba(0,0,0,0.8)`.

---

### 2.7 Badges de Rareté

Composants pills compacts affichant le texte de rareté.

- **Format** : Text 10px, Bold, Tracking +0.1em, Padding `2px 8px`, Radius `4px`.
- **Badge C** : BG `#15141E`, Border `#8A889A`, Text `#8A889A`
- **Badge R** : BG `#0E2943`, Border `#2B82C9`, Text `#2B82C9`
- **Badge SR** : BG `#300A4C`, Border `#A033E5`, Text `#A033E5`
- **Badge SSR** : BG `#4C0A1B`, Border `#E53360`, Text `#E53360`
- **Badge LR** : BG `#523B00`, Border `#FFB700`, Text `#FFB700`, Glow `0 0 8px rgba(255, 183, 0, 0.5)`
- **Badge Shiny (Pill Superposé)** : Gradient iridescent `#FF60B5` -> `#00E5FF`, Text `#04000B`, Font Black.

---

### 2.8 Compteur de Karas (Devise)

- **Visuel** : Badge arrondi (Pill) avec icône Karas (Gemme/Pièce stilisée).
- **Style** : Background `#04000B`, border `1px solid #FFCC33`, text `#FFCC33`, font Heading Bold.
- **Lueur** : Inset glow léger `inset 0 0 8px rgba(255, 204, 51, 0.15)`.

---

## 3. Langage d'Animation (Framer Motion & CSS)

### 3.1 Durées Standard & Easings

| Catégorie            | Durée     | Courbe CSS (cubic-bezier)       | Usage                                         |
| -------------------- | --------- | ------------------------------- | --------------------------------------------- |
| **Micro (Instant)**  | `100ms`   | `cubic-bezier(0.2, 0, 0, 1)`    | Feedback bouton pressé, toptip                |
| **Courte (Fast)**    | `200ms`   | `cubic-bezier(0.16, 1, 0.3, 1)` | Hover states, changement d'onglet, toggles    |
| **Moyenne (Normal)** | `350ms`   | `cubic-bezier(0.16, 1, 0.3, 1)` | Ouverture modale, apparition toast, drop-down |
| **Longue (Slow)**    | `600ms`   | `cubic-bezier(0.7, 0, 0.84, 0)` | Transitions de page, apparitions d'inventaire |
| **Séquence / Drama** | `2000ms+` | Multi-étapes (fiches dédiées)   | Reveals de cartes, fusions, succès majeurs    |

```javascript
// Exemples de configurations Framer Motion
export const transitions = {
  fast: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  normal: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  slow: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  bounce: { type: "spring", stiffness: 400, damping: 25 }
};
```

---

### 3.2 Comportements d'Animation Courants

#### Stagger (Grilles et Listes)

- Chaque carte ou ligne apparaît avec un décalage séquentiel.
- **Delay entre items** : `30ms` (pour que la grille complète mette < 300ms à charger).
- **Effet par item** : Opacité `0` -> `1`, translateY `15px` -> `0px`.

#### Transitions entre Pages

- **Page Out** : Opacité `1` -> `0`, Scale `1` -> `0.98`, durée `150ms`.
- **Page In** : Opacité `0` -> `1`, Scale `1.02` -> `1`, durée `250ms`, delay `100ms`.

#### Skeletons (Etats de chargement)

- Background de base : `#0F0C1D`.
- Animation : Gradient balayeur `#0F0C1D` -> `#1D1844` -> `#0F0C1D`.
- Durée du cycle : `1.5s` en boucle infinie (`linear`).

#### Reduced Motion Policy (`prefers-reduced-motion`)

- Suppression de tous les mouvements de translation, rotation, tremblement, et explosions de particules.
- Conservation exclusive de fondus d'opacité (`fade-in` / `fade-out`) réglés sur `150ms`.

---

## 4. Fiches Techniques des Moments Forts

### 4.1 Reveal SR (Super Rare - Violet)

_Durée totale : 1.2 seconde. Animation rapide pour ne pas frustrer l'utilisateur._

```
0.0s ──── Tremblement léger ──── 0.3s ──── Flip 180° ──── 0.6s ──── Flash & Particules Violets ──── 1.2s

```

| Temps           | Élément   | Effet / Animation                   | Valeurs & Hex                            | Easings / Props                |
| --------------- | --------- | ----------------------------------- | ---------------------------------------- | ------------------------------ |
| **0.0s - 0.3s** | Carte     | Léger tremblement latéral           | Scale `1` -> `1.03`, X: `±2px`           | `ease-in-out`                  |
| **0.3s - 0.6s** | Carte     | Rotation Y (Flip face visible)      | RotateY `0deg` -> `180deg`               | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **0.6s**        | Shockwave | Onde de choc circulaire 2D          | Scale `0` -> `2.5`, Opacité `1` -> `0`   | Border `2px solid #A033E5`     |
| **0.6s - 1.2s** | Canvas 2D | 15 Particules violettes ascendantes | Hex `#A033E5`, `#D88BFF`, taille `2-4px` | Vitesse initiale `200px/s`     |
| **0.6s - 1.2s** | Carte     | Aura résiduelle fixe                | `box-shadow: 0 0 20px #A033E5`           | Fade-in `200ms`                |

---

### 4.2 Reveal SSR (Super Super Rare - Rose/Rouge)

_Durée totale : 1.8 seconde. Tension modérée, effet percutant._

```
0.0s ── Assombrissement BG ── 0.5s ── Slow Motion + Tilt ── 0.8s ── Flip + Explosion ── 1.8s

```

| Temps           | Élément    | Effet / Animation                   | Valeurs & Hex                                                | Easings / Props                 |
| --------------- | ---------- | ----------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| **0.0s - 0.5s** | Background | Assombrissement du fond             | Opacité `#04000B` -> `90%`                                   | `linear`                        |
| **0.2s - 0.5s** | Carte      | Tremblement + Tilt vertical         | Scale `1.05`, Y: `±4px`, RotateZ: `±2deg`                    | `ease-in-out`                   |
| **0.5s - 0.8s** | Carte      | Flip rapide avec ralenti avant 180° | RotateY `0deg` -> `180deg`                                   | `cubic-bezier(0.7, 0, 0.84, 0)` |
| **0.8s**        | Ecran      | Flash de lumière blanc/rose         | Overlay `#FFF` / `#E53360`, Opacité `0.6` -> `0`             | Durée `150ms`                   |
| **0.8s - 1.8s** | Canvas 2D  | 35 Particules éclatantes + Rayons   | Hex `#E53360`, `#FF80A0`, 8 Rayons SVG `#E53360`             | Rotation rayons `15deg/s`       |
| **0.8s - 1.8s** | Carte      | Halo vibrant persistant             | `box-shadow: 0 0 30px #E53360, 0 0 60px rgba(229,51,96,0.3)` | Pulsation `1.5s`                |

---

### 4.3 Reveal de la Variante "Shiny" (Sur-effet Iridescent)

_Durée totale : 2.0 secondes. S'ajoute après le reveal basique d'une carte SSR ou LR._

```
0.0s ── Balayage Prismatique ── 0.6s ── Impact Iridescent ── 1.2s ── Pluie d'étoiles ── 2.0s

```

| Temps           | Élément       | Effet / Animation                           | Valeurs & Hex                                    | Easings / Props                |
| --------------- | ------------- | ------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| **0.0s - 0.6s** | Surface Carte | Balayage d'une ligne prismatique diagonal   | Gradient Gradient Rainbow (Opacité `0.8`)        | TranslateX `-100%` -> `200%`   |
| **0.6s**        | Carte         | Impact de brillance (Scale Bounce)          | Scale `1.0` -> `1.1` -> `1.0`                    | `spring(stiffness: 500)`       |
| **0.6s - 2.0s** | Overlay Carte | Couche holographique réactive au curseur    | Filter `hue-rotate`, blend-mode `color-dodge`    | Suivi souris/gyroscope         |
| **0.6s - 2.0s** | Canvas 2D     | 25 Particules en forme d'étoiles 4 branches | Multi-couleurs (`#00E5FF`, `#FF60B5`, `#FFD700`) | Chute lente avec scintillement |

---

### 4.4 Évolution / Fusion (5 SSR normales → 1 SSR INFINITY ; 3 LR normales → 1 LR INFINITY)

_Durée totale : 3.0 secondes. Cérémonie de sacrifice et de création. Le schéma d’animation historique à trois cartes ci-dessous est illustratif ; il ne définit pas le coût SSR de cinq exemplaires._

```
0.0s ── Cartes en cercle ── 0.8s ── Aspiration au centre ── 1.5s ── Compression / Implosion ── 1.7s ── Explosion INFINITY ── 3.0s

```

| Temps           | Élément       | Effet / Animation                     | Valeurs & Hex                                            | Easings / Props                 |
| --------------- | ------------- | ------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| **0.0s - 0.8s** | 3 Cartes      | Disposition en triangle & Levitation  | Scale `0.8`, Elevation Y `-20px`                         | `ease-out`                      |
| **0.8s - 1.5s** | 3 Cartes      | Convergence vers le centre + Rotation | Distance centre `150px` -> `0px`, Rotate `0` -> `360deg` | `cubic-bezier(0.5, 0, 0.75, 0)` |
| **1.5s - 1.7s** | Point Central | Implosion (Aspiration de la lumière)  | Orbe noir/violet rétrécissant, Scale `1` -> `0`          | Glow `#1D1844` réduit           |
| **1.7s**        | Centre        | Explosion de création (Big Bang 2D)   | Flash blanc pur, Shockwave Arc-en-ciel                   | Opacité `1` -> `0` (`200ms`)    |
| **1.7s - 3.0s** | Carte Finale  | Apparition de la carte INFINITY       | Scale `0` -> `1.05` -> `1.0`                             | `spring(damping: 15)`           |

---

### 4.5 Enchère Remportée

_Durée totale : 1.5 seconde. Célébration gratifiante._

| Temps           | Élément         | Effet / Animation                           | Valeurs & Hex                                  | Easings / Props    |
| --------------- | --------------- | ------------------------------------------- | ---------------------------------------------- | ------------------ |
| **0.0s - 0.3s** | Panneau Enchère | Déplacement & Validation                    | Border passe de `#1D1844` à `#00E699`          | Transition `200ms` |
| **0.3s - 0.8s** | Text / Badge    | Apparition du texte "REMPORTÉ !"            | Scale `0.5` -> `1.2` -> `1.0`, Color `#00E699` | Elastic `spring`   |
| **0.3s - 1.5s** | Canvas UI       | Confettis géométriques 2D (Séquence courte) | 30 Confettis `#00E699`, `#FFCC33`, `#F2F0FF`   | Gravité `400px/s²` |

---

### 4.6 Surenchère Reçue (Alerte / Action Perdue)

_Durée totale : 0.6 seconde. Alerte claire, non intrusive mais urgente._

| Temps           | Élément      | Effet / Animation                   | Valeurs & Hex                                   | Easings / Props   |
| --------------- | ------------ | ----------------------------------- | ----------------------------------------------- | ----------------- |
| **0.0s - 0.4s** | Card Enchère | Secousse horizontale (Shake Erreur) | Translate X: `[0, -8, 8, -6, 6, -3, 3, 0]px`    | `linear`          |
| **0.0s - 0.6s** | Bordure      | Flash d'alerte rouge                | Border color `#FF3355`, Glow `0 0 15px #FF3355` | Pulsation 1 cycle |

---

### 4.7 Succès Débloqué

_Durée totale : 2.5 secondes. Notification en haut/centre de l'écran._

```
0.0s ── Slide Down Toast ── 0.3s ── Eclat Doré Icône ── 2.0s ── Hold ── 2.5s ── Slide Up

```

| Temps           | Élément      | Effet / Animation                       | Valeurs & Hex                                    | Easings / Props                 |
| --------------- | ------------ | --------------------------------------- | ------------------------------------------------ | ------------------------------- |
| **0.0s - 0.3s** | Toast Banner | Entrée par le haut                      | TranslateY `-100%` -> `0%`                       | `cubic-bezier(0.16, 1, 0.3, 1)` |
| **0.3s - 0.6s** | Icône Succès | Éclat de lumière d'or                   | Scale `1` -> `1.3` -> `1.0`, Glow `#FFCC33`      | `spring`                        |
| **0.3s - 1.2s** | Canvas local | 10 Scintillements dorés autour du toast | Particules étoiles `#FFCC33`, opacité `1` -> `0` | Fondu lent                      |
| **2.2s - 2.5s** | Toast Banner | Sortie                                  | Opacité `1` -> `0`, TranslateY `0%` -> `-20px`   | `ease-in`                       |

---

### 4.8 Crédit de Karas (Achat ou Gain de Devise)

_Durée totale : 1.0 seconde. Animation localisée sur le compteur de devises._

| Temps           | Élément        | Effet / Animation                 | Valeurs & Hex                                   | Easings / Props                           |
| --------------- | -------------- | --------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| **0.0s - 0.3s** | Compteur       | Grossissement temporaire (Punch)  | Scale `1.0` -> `1.25` -> `1.0`                  | `cubic-bezier(0.175, 0.885, 0.32, 1.275)` |
| **0.0s - 0.8s** | Texte Compteur | Décompte rapide des chiffres      | Ex: `1 200` -> `1 500` avec effet rouleau       | Rafraîchissement `30ms`                   |
| **0.2s - 1.0s** | Flottant UI    | Text `+300` émergeant du compteur | TranslateY `0px` -> `-30px`, Opacité `1` -> `0` | Color `#FFCC33`, Bold                     |

---

## 5. Règles de Cohérence Visuelle (Anti-Sapin de Noël)

Pour préserver l'aspect sombre, premium et épuré du site, les développeurs doivement respecter strictement ces 5 règles :

1. **Règle des Lueurs (Glows)** :

- **Interdiction** : Pas de `box-shadow` lumineuse permanente sur plus de 3 éléments simultanés à l'écran.
- **Usage strict** : Les lueurs de couleurs vives (`#A033E5`, `#E53360`, `#FFB700`) sont réservées aux états **Hover**, aux cartes **LR / Shiny**, et aux **éléments actifs sélectionnés**. Le reste de l'UI utilise la couleur de bordure sourde `#1D1844`.

2. **Règle des Particules (Canvas 2D)** :

- **Interdiction** : Aucune particule sur l'interface de navigation générale (Marché, Profil, Catalogue).
- **Usage strict** : Les particules sont strictement restreintes aux **Modales de Tirage (Reveals)**, au moment de la **Fusion de Cartes**, et sur le composant de **Succès Débloqué**.

3. **Hierarchie Lumineuse** :

- L'œil de l'utilisateur doit toujours être attiré par la carte ou l'action principale.
- Si une modale est ouverte, le fond principal subit un flou (`backdrop-filter: blur(8px)`) et un assombrissement `#04000B` à `80%` pour éteindre toute source de lumière secondaire.

4. **Animations Fréquentes vs Rares** :

- **Fréquent** (Navigation, filtres, enchère rapide) : Seulement des transitions de `100ms` à `200ms` sur la position, la couleur ou l'opacité.
- **Rare** (Tirages SR/SSR/LR, Succès, Fusions) : Animations événementielles jusqu'à `2.5s` avec effets visuels riches.

5. **Dégradation Légère (Performance & Accessibilité)** :

- Si le nombre de FPS chute sous 45, ou si `prefers-reduced-motion: reduce` est actif : désactiver immédiatement les canvas de particules et remplacer le flou `backdrop-filter` par une couleur solide à 95% d'opacité `#04000B`.
