# Intégration UI Yokkai Collec’ — 24 septembre 2026

L’intégration couvre la présentation disponible dans ce dépôt. Elle n’est **pas
une validation de fidélité pixel parfaite à la v3** : les sources v3 et plusieurs
API métier manquent, et aucun navigateur n’est exposé par l’environnement.

## Sources réellement disponibles

- README complet lu dans `Yokkai Collec' UI design/README.md`.
- Référence carte : `Yokkai Collec' UI design/YokaiCard.dc.html`.
- Références d’écrans disponibles : v1 et v2, pas `Yokkai Collec v3.dc.html`.
- Le dossier `design_handoff_yokkai_collec/` et son preset sont absents.
- Tokens du README transcrits dans `tailwind.config.ts`, chargé via `@config`
  dans `app/globals.css`. Le même objet exporte les variables CSS : pas de
  seconde palette à maintenir. Les tokens des cadres viennent du HTML carte.
- Les deux PNG fournis ont été copiés dans `public/assets/`.
- Le HTML carte fourni traite encore SLR comme une rareté. Le composant suit
  plutôt le README : Shiny est une surcouche sur SSR ou LR uniquement.

## Correspondance et état

| Écran            | Route / composants                                                        | État réel                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fondations       | `app/layout.tsx`, `tailwind.config.ts`, `styles/ui.css`, `components/ui/` | Cinzel, Sora, Noto Serif JP via next/font ; boutons, chips, statuts, karas, avatar, dialog natif et toast                                                   |
| Carte            | `components/yokai-card.tsx`, `styles/cards.css`                           | 5:7, container queries, images réelles, cinq cadres, Shiny, animations, dos PNG                                                                             |
| Topbar           | `components/topbar.tsx`                                                   | Navigation, recherche, notifications, solde toujours affiché, profil et options de compte                                                                   |
| Boosters         | `/`, `components/boosters.tsx`                                            | Regular branché sur la transaction existante ; déchirure, pile, flip, rangement, SR/SSR/LR, récap, NEW et doublons dérivés de la collection avant ouverture |
| Decision Pack    | `BoosterReveal`                                                           | Choix, confirmation et état PERDUE prêts en présentation ; ouverture désactivée, API absente                                                                |
| Collection       | `/collection`, `components/collection.tsx`                                | Filtres, comptes par rareté, tri, dates, doublons, sélection multiple, détail et tilt ; actions métier désactivées                                          |
| Profil personnel | `/profile`                                                                | Pseudo, date d’inscription, cartes et comptes réels ; emplacements mis en avant et fonctions sociales indisponibles                                         |
| Profil public    | `/profile/[id]`                                                           | État indisponible tant que l’API publique manque ; aucune édition ni sélection multiple en lecture seule                                                    |
| Marché           | `/market`, `MarketView`                                                   | Quatre onglets, filtres et présentation grille/liste ; état indisponible faute de données                                                                   |
| Enchère          | `/market/[id]`, `AuctionView`                                             | Présentation contrôlée à deux colonnes, historique sous la carte ; route en état indisponible faute d’adaptateur API                                        |
| Échanges         | `/trades`                                                                 | Structure donner/recevoir et état indisponible ; pas de proposition fictive                                                                                 |
| Recherche        | `/catalog`                                                                | Catalogue réel via le getter existant `getAllCards()`, recherche, pagination d’affichage, détail latéral                                                    |
| Wishlist         | `/wishlist`                                                               | En-tête, emplacement d’alerte, accès au catalogue et état indisponible                                                                                      |
| Design system    | `/design-system`                                                          | Galerie explicite d’exemples de composants, distincts des données de partie                                                                                 |
| Sons             | `hooks/use-sfx.ts`, `public/assets/sfx/`                                  | Neuf WAV placeholders originaux, bouton couper/activer, erreurs audio non bloquantes                                                                        |

## Données et actions manquantes

- **Global** : solde karas ; notifications, non-lus et action marquer lu.
- **Cartes / collection** : indicateur Shiny, numéro de catalogue, totaux par
  rareté pour la complétion, état gelé et expiration, prix de marché, valeurs
  de destruction, actions de destruction unitaire/groupée, création d’enchère,
  durées autorisées, nombre/limite de ventes, éligibilité et action de fusion,
  personnalisation d’image. Aucun barème ni règle n’a été recodé côté UI.
- **Decision** : disponibilité, tirage, transaction de conservation d’une seule
  carte, identifiant confirmé et reprise d’un choix en cours.
- **Profil** : bio/handle/avatar personnalisés, profils et collections publics,
  amis/statuts, cartes mises en avant, édition.
- **Marché** : listes de chaque vue, détail par identifiant, mises/historique,
  vendeur/gagnant, horodatages serveur, minimum et prochaine mise, soldes,
  états et texte anti-snipe, action d’enchérir. Les valeurs sont reçues par le
  modèle de présentation ; aucune règle de prix ou de durée n’est calculée.
- **Échanges** : amis, leurs cartes échangeables, propositions reçues, offres
  de cartes/karas, estimation et actions envoyer/accepter/refuser.
- **Recherche** : possesseurs, enchères associées, valeur, wishlist.
- **Wishlist** : liste persistée, ajout/retrait, préférence d’alerte, enchères
  associées et tri des cartes actuellement en vente.

## Écarts restants

1. La comparaison visuelle v3 à 1440 et environ 900 px reste à effectuer.
   `cua.getState()` renvoie zéro navigateur ; le navigateur intégré est
   indisponible. Aucun screenshot ni test d’interaction navigateur n’est revendiqué.
2. La maquette v3 et le preset original restent à fournir pour l’ajustement
   exact. Le serveur de références a pu être lancé avec
   `npx --yes serve "Yokkai Collec' UI design" -l tcp://127.0.0.1:3100`.
3. Les parties sans API ont des états indisponibles, et non les listes peuplées
   des maquettes. Les formulaires de destruction/enchère de la collection,
   la fusion, les pickers d’échange et les tuiles wishlist connectées restent
   à compléter une fois leurs contrats métier disponibles.
4. L’illustration Decision est la teinte du pack Regular ; le visuel dédié manque.
   Les sons sont des placeholders, pas les assets audio finaux.
5. La barre du pack représente le stock disponible/maximal ; la progression
   de recharge exacte attend une durée/heure de début fournie par le back.
6. Les cartes sans image signalent l’absence d’illustration. Les illustrations
   présentes remplacent les glyphes du prototype ; leur cadrage reste à valider.
7. La galerie démontre LR et Shiny, mais le Regular Pack actuel n’en tire pas :
   les taux existants ont été conservés, comme le confirme le test PostgreSQL.

## Vérifications

- `npm run build` : compilation, TypeScript et génération des routes réussies
  à chaque étape ; corrections CSS finales recompilées.
- `npm run lint` : aucune erreur ni avertissement applicatif. Le runtime HTML
  de référence est exclu car ce n’est pas du code de production.
- `npm test` : 37 tests métier existants et 4 tests de présentation.
- Contrôles UI : Shiny réservé à SSR/LR et option animated=false ; karas
  inconnus distincts de zéro ; lecture seule sans sélection ; un Decision
  confirmé affiche une carte gardée et neuf perdues.
- Contrôle du CSS compilé : classes de tokens et variables présentes, pas de
  token de couleur/ombre manquant ; motion réduite coupe rotations, pulses,
  étincelles, déchirure/flash et tilt.
- Les neuf WAV ont des en-têtes et tailles RIFF valides.
- Test HTTP du serveur de production local : galerie, PNG et WAV répondent
  200 ; les routes de jeu testées redirigent un visiteur anonyme vers la
  connexion (307). Aperçu lancé sur `http://127.0.0.1:3101/design-system`.
- Comparaison avec la sauvegarde initiale : `lib/data/cards.ts`, dépendances,
  tests métier, fonction d’ouverture et effet de rafraîchissement inchangés.

Les commits UI sont séparés des changements métier/authentification déjà
présents et non commités avant l’intervention. Les builds ont été exécutés sur
le workspace complet, qui inclut ces travaux préexistants.
