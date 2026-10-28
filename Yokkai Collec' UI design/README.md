# Handoff : Yokkai Collec' — UI v3 (toutes les vues)

## Vue d'ensemble
Maquettes haute fidélité de l'ensemble du jeu de cartes gacha **Yokkai Collec'** : ouverture de boosters (Regular + Decision), Collection, Profil (moi / autre joueur), Marché & enchères, page d'enchère, Échanges entre amis, Recherche, Wishlist, Notifications, topbar globale, et une page Design system.

## À propos des fichiers de design
Les fichiers de `design/` sont des **références de design en HTML** (prototypes montrant l'apparence et le comportement visés), **pas du code de production à copier**. La tâche est de **recréer ces écrans dans le codebase existant (Next.js + Tailwind)** avec ses patterns, son routing, son state et son API. La logique des maquettes (données mockées, timers, setState) est uniquement démonstrative : la vraie logique métier existe déjà côté code.

Pour ouvrir les maquettes : servir le dossier `design/` en local (ex. `npx serve design`) puis ouvrir `Yokkai Collec v3.dc.html`. Le rendu d'une carte est isolé dans `YokaiCard.dc.html` (composant de référence).

## Fidélité
**Haute fidélité.** Couleurs, typo, rayons, ombres, animations et copies sont finaux. À reproduire au pixel près. Les **noms de cartes et les initiales au centre des cartes sont des placeholders** → à remplacer par les vraies données / illustrations.

---

## Design tokens
Voir `tokens/tailwind.preset.js` (prêt à brancher en preset Tailwind).

**Couleurs de base (imposées)**
- `void` #04000B — overlays (rgba(4,0,11,.86) + blur 6px), inputs, zones en retrait
- `night` #090714 — fond de page. Fond global : `radial-gradient(1200px 600px at 50% -10%, #1D1844 0%, transparent 60%), #090714`
- `surface` #0F0C1D — panneaux / tuiles
- `veil` #1D1844 — bordures 1px, hover, chip actif. Bordure hover renforcée : #3A3280

**Accents**
- `accent-gold` #E8C26A — CTA primaires, focus, badges NEW (texte #04000B dessus). Or clair #F6DC8E pour montants karas
- `accent-neon` #A77BFF — social / info (propositions d'échange). Alternative d'accent : cyan #3FE0D0
- `success` #5BE3A5 (En tête, en ligne) · `danger` #FF5A6E (Surenchéri, < 5 min, destruction)
- Texte : ink #F1EEFF · ink-2 #A8A3C7 · ink-3 #8580AB

**Karas (monnaie)** : losange 10×10 tourné à 45°, radius 2px, `linear-gradient(135deg,#FFF3C4,#E8C26A 55%,#9A7420)`, suivi du montant en #F6DC8E, chiffres tabulaires, format `fr-FR` (1 240).

**Typographie** (Google Fonts)
- Display : **Cinzel** 600/700 — H1 `clamp(28px,4vw,40px)` ls .03em lh 1.1 ; nom de carte ; chiffres de timer
- UI : **Sora** 400–700 — 17/15/14/13/12px
- Overline : Sora 500, 12px, uppercase, ls .24em, couleur accent
- Section title : 13px 600 uppercase ls .16em #A8A3C7

**Rayons** : 4 badge · 10 input · 12 carte · 16 panneau · 20 modale/hero · 999 CTA/chips
**Espacement** : 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48. Conteneur max 1120–1280px, padding horizontal 24px.
**Ombres** : card `0 8px 24px rgba(4,0,11,.7)` · modal `0 30px 80px rgba(4,0,11,.9)` · glows rareté (preset).
**Mouvement** : easing `cubic-bezier(.2,.8,.2,1)` · flip 700ms · rangement 550ms · invocation 900ms.

**Composants de base**
- Bouton primaire : h 48–56, radius 999, bg accent, texte #04000B 700 ; hover `brightness(1.1)` ; glow `0 0 30px accent/35%`
- Secondaire : transparent, border 1px #1D1844, texte #F1EEFF ; hover bg #1D1844
- Destructif : border rgba(255,90,110,.6), bg rgba(255,90,110,.14), texte #FF8A98
- Désactivé : bg #090714, border #1D1844, texte #8580AB, cursor not-allowed
- Chip : h 32–34, radius 999 ; actif bg #1D1844 + border accent + texte #F1EEFF ; inactif bg #090714 + border #1D1844 + texte #A8A3C7
- Pastilles statut : padding 4px 10px, radius 999, 12px 600 — En tête `rgba(91,227,165,.14)/#5BE3A5`, Surenchéri `rgba(255,90,110,.14)/#FF7A8A`

---

## Composant Carte (`YokaiCard`)
Ratio **5:7**, radius 12, `container-type:inline-size` (toutes les tailles internes en `cqw` → la carte scale de 44px à 300px).
Props : `rarity: 'C'|'R'|'SR'|'SSR'|'LR'`, `shiny: boolean` (SSR/LR uniquement), `name`, `glyph` (→ remplacer par l'illustration), `category`, `number` (#001), `animated`.

Structure (couches, de bas en haut) : cadre (gradient, inset 1.5–3px) → [surcouche shiny] → fond intérieur radial → anneau décoratif → foil/reflet → [holo shiny] → étincelles → contenu (n° + badge en haut, visuel au centre, nom Cinzel + catégorie en bas).

| Rareté | Cadre | Badge | Animation |
|---|---|---|---|
| C (gris) | frame-c | #9097AB | aucune |
| R (bronze) | frame-r | #D08A55 | reflet statique |
| SR (argent) | frame-sr chromé | gradient blanc→#AEB6C6 | halo léger |
| SSR (rose) | frame-ssr | #FF5FA8 | halo pulsé 2.6s, reflet balayant 3.4s, 3 étincelles |
| LR (gold noir) | frame-lr conic, **rotation 6s** | fond #000, texte #F6DC8E | pulse 3s, reflet doré 4s, 4 étincelles, liseré intérieur or |
| **Shiny** (surcouche SSR/LR) | + conic prismatique `screen` opacité .75, **rotation 4s** | + mini-badge holo « ✦ » | foil holo 4.5s alterné, 8 étincelles blanches, glow rgba(200,230,255,.55) pulse 2.2s |

Le Shiny **n'est pas un palier** : il se superpose à la rareté de base (tri : LR✦ > LR > SSR✦ > SSR > SR > R > C).

Dos de carte : `public/assets/card-back.png` en `background-size:cover`, radius 12.

---

## Écrans

### 0. Topbar (globale, sticky, h 68)
bg rgba(9,7,20,.86) + blur 12px, border-bottom #1D1844. Gauche : logo (carré 34px bordure accent « Y ») + wordmark Cinzel 17px sur 2 lignes. Centre : onglets **Boosters · Collection · Marché · Échanges · Wishlist** (14px 500, actif #F1EEFF + soulignement 2px accent, inactif #8580AB). Droite : bouton Design system, recherche (rond 40px), **cloche** (badge rouge #FF5A6E compteur non-lus), **pilule karas** (bg #04000B, bordure or 35%, montant #F6DC8E — toujours visible), avatar 40px → profil.
**Panneau notifications** : dropdown 400px, radius 16. Item = icône carrée 36px colorée par type + texte (titre en gras) + temps + point accent si non lu (fond rgba(29,24,68,.45)). Types : wishlist mise aux enchères (♥ rose) → page enchère ; surenchéri (↑ rouge) ; proposition d'échange (⇄ violet) ; pack prêt (✦ or) ; enchère gagnée (✓ vert) ; carte vendue (◆) ; ami ajouté ; mission accomplie (+karas). « Tout marquer comme lu ».

### 1. Boosters
- **Sélection** : 2 panneaux (grid auto-fit min 420px), chacun = image du pack flottante (`yk-float 5s`) + nom Cinzel 26px + description + barre de recharge + CTA « Ouvrir » ou bouton désactivé « Disponible dans mm:ss ». Decision Pack : tag rose « Choix unique », visuel = même pack teinté `hue-rotate(-42deg) saturate(1.3)` (**à remplacer par un visuel dédié**). Ligne des taux par rareté en chips.
- **Déchirure** : pack centré, tremblement puis scale 1.4 + fade + flash plein écran blanc→violet (700ms). Son « rumble » puis « tear ».
- **Révélation** : un déclenchement global sur le paquet lance la séquence complète. Les cartes se révèlent ensuite successivement et rejoignent la rangée, sans clic individuel sur chaque carte. Ordre imposé : rareté croissante ; effets SR/SSR/LR et Shiny conservés. Badges NEW / « Doublon ×n ». Compteur de progression et bouton son on/off.
- **Reveals spéciaux** :
  - SR : burst argent + tintement.
  - **SSR** : burst rose + 2 anneaux de choc + texte « SUPER SUPER RARE » (Cinzel 22px, glow rose) au-dessus du paquet.
  - **LR** : overlay plein écran « Invocation légendaire » — fond radial or, rayons coniques rotatifs 40s, carte 300px qui monte (`yk-rise`), nom Cinzel 44px + NEW, « Toucher pour continuer ».
  - **Shiny** (SSR ou LR) : même overlay en version prismatique « ✦ Invocation Shiny ✦ » + disque holo contre-rotatif 12s en `screen`.
- **Decision Pack — choix** : après les 10 reveals, bandeau rose « **Choisissez UNE carte à garder** — Les 9 autres seront perdues définitivement » + CTA « Garder cette carte » (désactivé tant que rien n'est choisi). Carte choisie : lift -10px scale 1.04, contour 2px accent + glow, tag « À GARDER » ; les autres à opacité .55. Modale de confirmation (carte 160px, « Garder X ? », « Revoir mon choix » / « Confirmer »). Après : carte gardée tag « GARDÉE », les 9 autres `grayscale(1) brightness(.6)`, opacité .3, scale .92, tampon rouge « PERDUE ».
- **Récap** : chips de raretés obtenues, « N nouvelles cartes », CTA « Voir ma collection » / « Retour aux boosters ».

### 2. Collection
Header (overline « Grimoire · Série 1 », H1, barre de complétion, bouton « Sélection multiple »). 5 tuiles de complétion par rareté. Panneau filtres : raretés (chips avec point couleur + compteur) + chip « Shiny uniquement » (point holo) ; 12 catégories + Toutes. Grille `auto-fill minmax(164px,1fr)` gap 28/20, **triée par rareté**. Sous chaque carte : « OBTENUE LE » (11px uppercase #8580AB) + date (13px #A8A3C7). Badges : ×n (bas-droite), NEW.
- **Carte gelée (en enchère)** : voile rgba(4,0,11,.66) + bordure or 40% + cadenas + « EN ENCHÈRE » + temps restant ; non sélectionnable, pas d'actions.
- **Sélection multiple** : pastille 28px en haut-gauche (vide : bordure #A8A3C7 ; cochée : bg accent + ✓), contour 2px accent offset 4px. Barre flottante bas (pilule, max 760px) : « n sélectionnée(s) · +X karas · Tout · Aucune · [Détruire la sélection] ». Modale de confirmation avec aperçu des cartes et barème C 1 · R 5 · SR 15 · SSR 30 · LR 50.
- **Modale détail** (max 820px) : carte 260px avec tilt 3D au survol (±22°) + reflet ; lien « Personnaliser l'image (Imgur) ». Infos : rareté, nom Cinzel 32px, catégorie, n°, date longue, exemplaires, **valeur de marché** (moyenne des enchères passées, « — » si aucun historique). Bloc « Fusion SSR → LR disponible » si ≥3 SSR identiques. Actions : **Mettre aux enchères** (primaire) → formulaire inline (prix de départ défaut 10, durées 15 min/30 min/1 h/4 h/12 h/24 h en grille 3×2, compteur x/5 actives, mention gel) ; **Détruire rapidement · +X karas** (destructif) → confirmation inline.

### 3. Profil
Bannière 150px (gradients violet/or), avatar 112px anneau or (bouton ✎ si c'est moi), pseudo Cinzel 30px + @handle, bio, date d'inscription. Actions : moi → « Modifier le profil » ; autre → « ✓ Ami » + « ⇄ Proposer un échange ». Bandeau de statistiques : la tuile Amis est réservée au propriétaire. **4 cartes mises en avant** sur scène radiale (bouton « Changer » sous chaque carte si c'est moi). Onglets Collection (avec dates) / Wishlist. Colonne droite sticky Amis uniquement sur son propre profil (input « Ajouter par pseudo… », bouton et liste). La vue « autre joueur », même pour un ami accepté, n'affiche ni tuile ni colonne Amis, ni élément de remplacement, et ne propose aucune action d'édition.

### 4. Marché
Onglets-chips avec compteur : Enchères en cours · Mes enchères · Gagnées · Vendues ; pilule « Mes ventes actives x/5 ». Filtres : rareté + tri (Fin imminente / Prix croissant / Prix décroissant). Grille de tuiles `minmax(210px,1fr)` : carte + pilule timer (#FF5A6E si < 5 min, #F6DC8E si < 1 h) + cœur si en wishlist ; nom, « Mise actuelle » en or, statut (En tête / Surenchéri / Ma vente), « n mises · par X ».
Vues listes (Mes enchères / Gagnées / Vendues) : lignes `52px | infos | montant + pastille statut`. Statuts : En tête, Surenchéri, timer de mes ventes, Gagnée, Vendue, « Non vendue · dégelée ».

### 5. Page d'enchère
2 colonnes. Gauche : carte grand format (max 420px) **+ historique des mises juste en dessous** (avatar, pseudo/« Vous », temps relatif, montant ; la meilleure en or). Droite : rareté, nom Cinzel 44px, catégorie, vendeur ; panneau : « Se termine dans » (Cinzel 40px) + mise actuelle (32px or) + barre de temps ; alerte anti-snipe rouge si < 5 min (« toute mise ajoute 1 minute ») ; bannière En tête / Surenchéri ; **« Surenchérir +10 → X »** (primaire 56px) ; champ offre libre (placeholder « Minimum X ») + « Offre libre » ; mention « karas prélevés immédiatement ». État **terminée** : pastille « Enchère terminée », « Remportée par X », montant, bouton désactivé. Tuiles valeur de marché + solde.

### 6. Échanges (amis uniquement)
Bannière « Proposition reçue » (fond dégradé violet, mini-cartes ⇄, Refuser / Accepter). Sélecteur d'ami (chips avatar + statut en ligne). Deux colonnes « Vous donnez » / « Vous recevez · Ami » séparées par un rond ⇄ : zone de dépôt (pointillés) des cartes choisies, champ karas optionnel, valeur estimée « ≈ X karas », picker de la collection (miniatures 64px, contour accent si choisie). Pied : mention + « Envoyer la proposition » (désactivé tant que les deux côtés sont vides).

### 7. Recherche
Barre 64px (radius 999, bordure #3A3280 + halo). Liste de résultats : miniature, nom, rareté, pastille « En enchère · timer », catégorie + avatars empilés des possesseurs + « n possesseurs », valeur, bouton cœur wishlist. Panneau détail sticky à droite : carte, valeur de marché, CTA « Voir l'enchère », toggle wishlist, liste des possesseurs (→ profil).

### 8. Wishlist
Header « Visible sur votre profil », compteur « n aux enchères en ce moment », toggle « M'alerter quand une carte passe aux enchères », CTA « + Ajouter une carte ». Tuiles : carte + cœur (retirer), nom, valeur ; CTA or « En enchère · montant · timer » → page enchère, sinon « Aucune enchère en cours » en pointillés. Tri : en enchère d'abord.

---

## Interactions & comportement
- Transitions hover : translateY(-3 à -6px) sur les cartes/tuiles, border → #3A3280 sur panneaux cliquables.
- Toasts : pilule centrée sous la topbar, bg #1D1844, 2.6s.
- Sons (Web Audio synthétisés dans la maquette → **à remplacer par de vrais fichiers**) : rumble, tear, flip, slide, sr, ssr, lr, shiny, flutter (tout révéler).
- Responsive : toutes les grilles en `auto-fill/auto-fit minmax()` ; topbar testée à ~900px.
- `prefers-reduced-motion` → équivalent de `animated=false` (désactive rotations, pulses, étincelles, déchirure).

## State (côté UI uniquement)
Boosters : `phase: select|tearing|dealt`, `idx`, `hand`, `revealed{}`, `spot` (overlay LR/Shiny), `callout` (SSR), `pick`, `kept`. Collection : filtres `cat/rar/shinyOnly`, `selMode`, `sel{}`, `modal`, `mAction: null|auction|destroy`. Marché : `tab`, `rarity`, `sort`. Le reste (soldes, enchères, timers, possession, notifications) vient de l'API existante.

## Assets
- `public/assets/booster-pack.png` (1024×1536, PNG transparent) — visuel du Regular Pack
- `public/assets/card-back.png` (1064×1479) — dos de carte
- Polices Google : Cinzel, Sora, Noto Serif JP
- Icônes : SVG inline simples (loupe, cloche, cadenas, haut-parleur) + glyphes ✦ ♥ ⇄ ◷

## Fichiers
- `design/Yokkai Collec v3.dc.html` — tous les écrans (navigation via la topbar)
- `design/YokaiCard.dc.html` — composant carte de référence
- `design/support.js` — runtime nécessaire pour ouvrir les maquettes
- `tokens/tailwind.preset.js` — tokens Tailwind
- `PROMPT_CODEX.md` — prompt prêt à coller dans Codex
