# QUA-01 — preuves Prettier (PR #152)

Branche recréée depuis 3f4f9a27008e0e6ee585c2aa3179d643a6098c86. Reformatage recréé depuis master à jour ; seule la PR #157 reste ouverte, avec exception explicite du propriétaire.

## Comparaison avant / après

Reformatage mécanique : bd2cc17e9f603cab4b8e517ddb9f3d3cbf296ad8, référencé dans .git-blame-ignore-revs. Les 246 fichiers ont été comparés exactement à la sortie Prettier stable du commit précédent ; debug-check AST réussi. Adaptations des tests dans un commit séparé : e271957.

Configuration : arrowParens avoid, trailingComma none. Après configuration : 58 échecs sur les 141 tests concernés ; après normalisation des espaces : 15 ; après les adaptations syntaxiques autorisées : 0.

Suite complète identique avant et après : 373 tests, 372 réussites, 1 ignoré, 0 échec. TypeScript vert. Build comparatif avec node node_modules/next/dist/bin/next build --webpack vert avant et après. Lint : 0 erreur, 7 avertissements après formatage (dont directives ESLint déplacées par le formatage). format:check vert.

Le build Turbopack Windows échoue déjà sur master dans le résolveur Google fonts. Le build standard reste exigé en CI Linux. Aucune migration ni écriture en prod. Le script ne formate que les fichiers suivis ; migrations, données, fichiers générés et lockfiles exclus.

## Hash et rendu préservés

Le seul hash concerne le bloc cinématique de components/boosters.tsx, dans tests/card-sharing-client.test.mjs, pour préserver l'animation lors de l'ajout du partage. SHA-256 brut inchangé : 9cead83e7e9322974d64869b01d95badacd8668533503d21d21d41e9d4268634. Prettier ajoute des parenthèses : égalité après normalisation des seuls espaces non démontrable ; fichier exclu, aucune mise à jour du hash. Aucun fichier de migration ou de référence haché modifié.

styles/card-tokens.css est consommé comme données brutes par ImageResponse. Ses gradients multilignes faisaient échouer les trois tests fonctionnels. Fichier exclu et conservé exactement : les trois tests passent sans adaptation de leurs assertions.

## Inventaire des 64 échecs initiaux

Tous passent dans la suite complète finale. Comptage AST des appels assert.\* avant et après : 64 comparaisons, zéro différence. Classement par type principal ; certains tests cumulent plusieurs types.

### Parenthèses équivalentes (10)

- `tests/admin-card-management.test.mjs` — un CSV admin sans source_id bascule en source manuelle pour obtenir un identifiant stable — 8 assertions avant et après.
- `tests/trade-polling.test.mjs` — les actions d’examen sont désactivées dès que l’offre change ou disparaît — 8 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la wishlist d'un ami se filtre par recherche, rareté et catégorie — 9 assertions avant et après.
- `tests/ui-presentation.test.mjs` — le compteur de cartes ouvre toute collection autorisée en lecture seule — 9 assertions avant et après.
- `tests/ui-presentation.test.mjs` — le compteur wishlist d'un ami ouvre toute sa wishlist et chaque carte reste cliquable — 5 assertions avant et après.
- `tests/ui-presentation.test.mjs` — le chat d’enchère est visible mais réservé au vendeur et aux utilisateurs ayant misé — 37 assertions avant et après.
- `tests/ui-presentation.test.mjs` — mobile : vitrine du profil en carrousel tactile et page Amis sans débordement — 11 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la Collection groupe les tuiles et sélectionne tous les exemplaires disponibles — 13 assertions avant et après.
- `tests/ui-presentation.test.mjs` — Phase 6 : liste du marché, suivi et Mes enchères — 26 assertions avant et après.
- `tests/ui-presentation.test.mjs` — Phase 6 : la mise en vente confirme le verrouillage et signale la réinitialisation d'image — 4 assertions avant et après.

### Espaces et retours à la ligne (46)

- `tests/admin-card-management.test.mjs` — une carte existante accepte une nouvelle image par URL ou fichier — 6 assertions avant et après.
- `tests/admin-card-management.test.mjs` — le remplacement d'une image admin utilise une nouvelle URL pour contourner les caches — 3 assertions avant et après.
- `tests/admin-card-management.test.mjs` — la suppression admin demande une confirmation explicite — 6 assertions avant et après.
- `tests/admin-card-management.test.mjs` — un admin peut filtrer les cartes avec une liste de catégories — 11 assertions avant et après.
- `tests/admin-player-management.test.mjs` — la fiche joueur affiche son inventaire et confirme la modération — 10 assertions avant et après.
- `tests/card-reports.test.mjs` — card reports appear only in detail modals with the three reasons — 4 assertions avant et après.
- `tests/card-shell.test.mjs` — le shell conserve le ratio 5:7 et ne modifie pas la face — 3 assertions avant et après.
- `tests/card-shell.test.mjs` — le tilt ne rerend pas React et anime seulement transform et opacite — 6 assertions avant et après.
- `tests/card-shell.test.mjs` — les reveals et la confirmation Decision Pack gardent les composants directs — 3 assertions avant et après.
- `tests/direct-invalidations.test.mjs` — les consommateurs réconcilient les seules portées utiles sans toucher au reveal — 8 assertions avant et après.
- `tests/market-reconciliation.test.mjs` — le polling Marché reste à 3 s et conserve l'anti-snipe — 5 assertions avant et après.
- `tests/sr-reveal.test.mjs` — le reveal SR possede un flash bref et un pulse sans reprendre le burst SSR/LR — 4 assertions avant et après.
- `tests/sr-reveal.test.mjs` — SSR et LR escaladent rayons, particules, shake et duree — 12 assertions avant et après.
- `tests/trade-polling.test.mjs` — la page Échanges poll toutes les 3 s sans chevauchement et respecte la visibilité — 12 assertions avant et après.
- `tests/trade-polling.test.mjs` — deux annulations dans le même tick ne déclenchent qu’un seul appel RPC — 8 assertions avant et après.
- `tests/trade-polling.test.mjs` — l’annulation reste disponible uniquement pour une offre envoyée en attente — 4 assertions avant et après.
- `tests/trade-polling.test.mjs` — une acceptation devenue impossible traduit TRADE_NOT_PENDING et recharge l’offre examinée — 4 assertions avant et après.
- `tests/trade-polling.test.mjs` — le popover dépend uniquement de son ID et les liens conservent ami et carte — 7 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les échanges réutilisent les cartes standard sans écraser leurs textes internes — 5 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les titres H1 utilisent la police locale HYWenHei-85W — 5 assertions avant et après.
- `tests/ui-presentation.test.mjs` — l'ouverture centralise ses durées, se passe et ne bloque pas le reveal sur les rafraîchissements — 13 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les modales imbriquées libèrent le scroll et la confirmation remplace le détail — 6 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la destruction multiple est active et transmet tous les exemplaires sélectionnés — 9 assertions avant et après.
- `tests/ui-presentation.test.mjs` — l’aperçu wishlist du profil garde des cartes compactes — 2 assertions avant et après.
- `tests/ui-presentation.test.mjs` — une carte d'ami ouvre une proposition d'échange présélectionnée et extensible — 5 assertions avant et après.
- `tests/ui-presentation.test.mjs` — le catalogue reprend la sidebar sans notion de possession ni action de masse — 22 assertions avant et après.
- `tests/ui-presentation.test.mjs` — une carte de la wishlist ouvre le détail partagé du catalogue et ses possesseurs — 5 assertions avant et après.
- `tests/ui-presentation.test.mjs` — le bouton de retrait de la wishlist utilise le style danger rouge — 2 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la liste d’amis affiche la présence et actualise la dernière activité — 11 assertions avant et après.
- `tests/ui-presentation.test.mjs` — le sélecteur de cartes mises en avant recherche et remonte la sélection — 5 assertions avant et après.
- `tests/ui-presentation.test.mjs` — le profil invalide l’avatar partagé et la Topbar le recharge — 4 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la destruction groupée demande une confirmation chiffrée — 4 assertions avant et après.
- `tests/ui-presentation.test.mjs` — barre d'outils Collection compacte sur mobile et tiroir fermé même en mouvement réduit — 6 assertions avant et après.
- `tests/ui-presentation.test.mjs` — Collection, Catalogue et Marché partagent une seule échelle de colonnes — 6 assertions avant et après.
- `tests/ui-presentation.test.mjs` — Phase 5 : habillage des boosters sans toucher au reveal — 21 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les boosters annoncent les gains autoritaires avant confirmation — 11 assertions avant et après.
- `tests/ui-presentation.test.mjs` — une carte révélée ouvre le détail de collection avant sa mise en vente — 5 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la modale de détail hiérarchise verrouillage, progression et actions avancées — 17 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les cartes verrouillees sont exclues des actions sensibles — 8 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la mise en vente suggère la valeur de marché sans remplacer le prix par défaut — 8 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la recherche du marché filtre en mémoire par nom et franchise — 6 assertions avant et après.
- `tests/ui-presentation.test.mjs` — la recherche multi-termes partage une sémantique ET entre Collection, Catalogue et Marché — 9 assertions avant et après.
- `tests/ui-presentation.test.mjs` — l’inscription vérifie le pseudo après debounce sans remplacer la validation de soumission — 11 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les notifications se relisent à l'ouverture du panneau et au retour sur l'onglet — 8 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les pages Paramètres et Admin transmettent le solde de Karas à la Topbar — 6 assertions avant et après.
- `tests/ui-presentation.test.mjs` — tri de la Collection : rareté par défaut, dates, nom français et ordre stable — 16 assertions avant et après.

### Rendu fonctionnel inchangé (3)

- `tests/card-share-image-render.test.mjs` — ImageResponse génère chaque rareté et format, y compris les variantes Shiny — 3 assertions avant et après.
- `tests/card-share-image-render.test.mjs` — illustration expirée ou non autorisée : cadre de remplacement, sans échec — 2 assertions avant et après.
- `tests/card-share-image-render.test.mjs` — illustration Imgur autorisée : téléchargée et conservée dans le rendu social — 6 assertions avant et après.

### Empreinte inchangée et contrat client (1)

- `tests/card-sharing-client.test.mjs` — reveal : partage uniquement final et animation LR intacte — 4 assertions avant et après.

### Guillemets équivalents (2)

- `tests/rarity-colors.test.mjs` — card-tokens reste la source de verite des couleurs R et SR — 8 assertions avant et après.
- `tests/ui-presentation.test.mjs` — les nouveaux visuels distinguent le booster régulier du Decision Pack — 8 assertions avant et après.

### Position textuelle et décimale CSS (1)

- `tests/ui-presentation.test.mjs` — l’avatar ouvre un menu profil compact avec résumé et actions — 22 assertions avant et après.

### Espace JSX explicite (1)

- `tests/ui-presentation.test.mjs` — la collection annonce l’évolution de cinq SSR normales identiques en INFINITY (ancien intitulé du test : « non-Shiny en Shiny », terminologie historique corrigée) — 7 assertions avant et après.

## Exemples avant / après

- Espaces : `assert.match(source, /loading=true/)` → `assert.match(normalizeWhitespace(source), normalizeWhitespace(/loading=true/))`. Même contenu, normalisé des deux côtés.
- Parenthèses JSX : `/!readOnly&&<CardShareButton/` → `/!readOnly&&\(?<CardShareButton/`. Même condition et composant.
- Guillemets : apostrophes obligatoires → les deux délimiteurs acceptés, mêmes clés, valeurs et URL.
- Espace JSX : espace littéral → `{" "}` ramené à un espace avant normalisation ; expression métier conservée.
- Position : `topbar.indexOf(literal)` → `normalizeWhitespace(topbar).indexOf(normalizeWhitespace(literal))`. Même ordre et comparaison.
- Décimale CSS : `\.95` → `0?\.95`. Même valeur.
- Hash : comparaison SHA-256 inchangée ; fichier exclu.
- Rendu : dimensions et signature PNG inchangées ; gradients bruts exclus.

Le contrôle négatif limité par une fin de ligne sur le bloc cinématique inchangé reste inchangé : la normalisation ne doit pas étendre sa portée.

## Mutations contrôlées, non commitées

Interception temporaire des lectures en mémoire : aucun fichier applicatif modifié. Chaque exemple passe normalement (code 0), puis échoue (code 1) après mutation du contenu vérifié.

| Type            | Mutation                             | Preuve            |
| --------------- | ------------------------------------ | ----------------- |
| source-js       | renommer yk-card-shell-reflection    | 0 avant / 1 après |
| source-css      | ratio 5/7 → 4/7                      | 0 avant / 1 après |
| jsx-parentheses | remplacer CardShareButton            | 0 avant / 1 après |
| quotes          | token --rarity-r → --rarity-c        | 0 avant / 1 après |
| decimal         | opacité 0,95 → 0,94                  | 0 avant / 1 après |
| hash            | renommer une classe cinématique      | 0 avant / 1 après |
| rendering       | largeur PNG OG 1200 → 1199           | 0 avant / 1 après |
| jsx-whitespace  | changer le champ card.customImageUrl | 0 avant / 1 après |
| text-position   | remplacer le lien Recherche          | 0 avant / 1 après |

Une assertion supplémentaire d'espacement ajoutée sur master depuis l'essai interrompu est aussi adaptée : tests/booster-reveal-layout.test.mjs, « la révélation remonte les cartes et masque le grand en-tête de page ». Ses 5 assertions restent identiques en nombre et contenu.

Reprise du 11/10 : les tests du logo d’accueil (3 assertions) et du rangement multiple (6 assertions), ajoutés sur master, normalisent désormais les deux côtés ; le test de navigation conserve aussi les 2 nouvelles assertions de logo. Aucun contenu ni nombre d’assertions retiré.
