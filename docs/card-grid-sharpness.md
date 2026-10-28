# Netteté des grilles — 12/10/2026

## Cause et correction

#170 (`3316137d`) a abaissé la qualité de `YokaiCard` de 85 à 75 et introduit des sizes plus petits pour collection/profile. L’expérience facultative proposée après #165 n’a pas été adoptée par cette tâche ; ces sizes ont néanmoins été introduits ensuite par #170.

Toutes les illustrations de `YokaiCard` utilisent maintenant l’URL originale : même source, résolution, format et octets en grille, détail et révélation. Aucun resize ni réencodage, quelle que soit la densité. Lazy loading, decoding async et repli des images personnelles vers le catalogue sont conservés. Aucun changement SQL, aucune modification BIZ-08.

## Chemins avant correction

L’URL optimisée était `/_next/image?url=<URL Storage encodée>&w=<candidat>&q=75`, généralement WebP lorsque le navigateur l’accepte. L’optimiseur ne s’appliquait qu’au bucket public `card-images`, origine Supabase exacte, URL sans query/fragment. Les autres sources étaient natives.

| Grille                                   | sizes avant         | Mobile 390 px, DPR 1 / 3 | Desktop 1440 px, DPR 1 / 3 |
| ---------------------------------------- | ------------------- | ------------------------ | -------------------------- |
| Collection : exemplaires et albums       | 46vw / 30vw / 190px | 256 / 640 px             | 256 / 640 px               |
| Profil, vitrine, wishlist de profil      | 46vw / 30vw / 190px | 256 / 640 px             | 256 / 640 px               |
| Marché, enchères, wishlist communautaire | 100vw               | 640 / 1200 px            | 1920 / 3840 px             |
| Échanges : sélection et revue            | 100vw               | 640 / 1200 px            | 1920 / 3840 px             |
| Boosters : révélations, détail et zoom   | Native              | Résolution originale     | Résolution originale       |

Les candidats ci-dessus sont ceux de Next.js, calculés avec getImgProps sur le schéma réellement utilisé avant correction. Le navigateur peut choisir un candidat inférieur selon ses heuristiques/cache ; la correction supprime cette variabilité. Les PNG locaux des emballages boosters restent natifs. Les miniatures de sélection de bannière, avatars, notifications et GIF picker sont déjà des images natives ; ce ne sont pas des illustrations optimisées de cartes. Le partage conserve son pipeline serveur existant, sans réduction supplémentaire introduite ici.

## Sources vérifiées dans le navigateur

Toutes les paires grille/détail chargent la même currentSrc et les mêmes naturalWidth/naturalHeight. HEAD public : cinq réponses HTTP 200.

| Carte / fixture                                         | Origine                 | Résolution originale | Format    | Octets    |
| ------------------------------------------------------- | ----------------------- | -------------------- | --------- | --------- |
| SAM · C                                                 | Storage card-images     | 1200×960             | WebP      | 89 086    |
| BTS · LR                                                | Storage card-images     | 1920×1280            | JPEG      | 506 784   |
| Rin Shima · SR                                          | AniList character/large | 230×345              | PNG       | 116 060   |
| Ladybug · LR                                            | i.imgur.com             | 844×866              | PNG       | 504 031   |
| GIF personnel · SSR (fixture, pas de modification prod) | media.giphy.com         | 480×480              | GIF animé | 1 776 311 |

AniList et les GIF peuvent être de faible résolution à la source : la correction garantit la même netteté que le détail, sans inventer des pixels. Les images personnelles passent directement par leur URL (Imgur/Giphy autorisés par la validation existante) et les autres origines HTTPS gardent aussi leurs octets natifs.

Captures : cinq paires côte à côte à largeur identique 240 px ; seconde capture à 720 pixels pour reconstruire le raster 3×. Le navigateur intégré expose DPR=1 et ne permet pas de le remplacer : la seconde capture est une reconstruction physique explicitement indiquée, pas une prétendue capture sur appareil DPR=3. Les URL originales ne dépendent plus du DPR.

## Vérifications

Test rouge sur master : 1 échoue, 1 passe. Après correction : égalité du rendu grille/détail pour 7 sources × 5 raretés × 2 anciens sizes, lazy/async, aucun srcset ni proxy ; fallback natif sans boucle ; restrictions de l’optimiseur pour les autres usages inchangées. La page de preuve reste sous /design-system, interdite en production par le proxy existant.

## URL originales relevées (identiques dans les deux colonnes, DPR indépendant)

- SAM : https://api.yokkai-collec.com/storage/v1/object/public/card-images/5a85f6d10ebfb4a4895ecfae4d729bc0e57b12dfc96daae91d92f93571e9b559
- BTS : https://api.yokkai-collec.com/storage/v1/object/public/card-images/a2af29d706f2afb1db9ab31b100ef8d3c0450ccca1d8c775d54514f393c02048-678d3b22128b7404
- Rin Shima : https://s4.anilist.co/file/anilistcdn/character/large/b124586-9lGoHg1zZkFr.png
- Ladybug : https://i.imgur.com/tpX2zQu.png
- GIF personnel fixture : https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif

## État de livraison

CI GitHub refusée avant lancement : problème de paiement ou plafond GitHub Actions, annotation « The job was not started because recent account payments have failed or your spending limit needs to be increased ». PR non mergée ; les contrôles locaux passent. Aucune tentative de contournement de CI.
