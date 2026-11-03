# Contre-offres et favoris des cartes révélées — 3 novembre 2026

## Comportement

La confirmation d’acceptation utilise les mêmes dimensions et les mêmes lots que la révision d’un échange. Les anciennes règles contradictoires de largeur sont supprimées. Sur ordinateur, la hauteur suit le contenu, avec une limite liée à la fenêtre ; sur téléphone, la présentation reste en plein écran. Les lots suivent l’ordre commun : « Tu donnes » en rouge à gauche, « Tu reçois » en vert à droite. Les actions restent accessibles au bas de la modale.

Les cartes révélées appartenant à un classeur favori portent une étoile jaune et le texte « Collection favorite » / « Favorite collection » au-dessus de leur illustration. L’icône reprend celle des classeurs. Le badge peut coexister avec la liste de souhaits et le statut de doublon. Une description accessible identifie aussi le favori.

La coche de sélection est placée dans une ligne sous l’illustration. Un espace distinct sépare cette ligne des mentions LR/SSR et « Nouvelle ». Le survol et le focus ne déplacent pas le bouton en mode sélection ; le choix au clavier reste disponible.

Une lecture groupée et bornée détermine les favoris du joueur connecté pour les identifiants du pack. Les règles de classeurs canoniques, de fusions, de licences secondaires et de choix explicites sont conservées. Les anciens albums restent pris en charge lorsque le flag des classeurs stables est désactivé. Aucun résultat personnalisé n’est partagé entre joueurs et aucune carte ni récompense n’est attribuée par cette lecture. Une erreur ou une réponse tardive n’interrompt pas l’ouverture et ne relance jamais son attribution.

## Validation locale avant production

- 127 tests ciblés passants : nouveaux lecteurs et badges, droits SQL, traductions, trades, présentations, packs et animations existantes. Bases PGlite locales jetables, sans ouverture de pack ni échange en production.
- 56 scénarios Chrome : 320, 375, 768, 1024 et 1440 px ; simulation de zoom 200 % sur les vues ordinateur ; anglais et français ; résultats de 5/50 cartes et contre-offres de 3/50 cartes. Pas de débordement horizontal ni de chevauchement des badges. Les confirmations ont la même largeur que les révisions. Les boutons restent visibles sans faire défiler les petites contre-offres sur ordinateur.
- 14 contrôles supplémentaires de sélection, aux mêmes largeurs et zooms, en anglais et français : 50 cartes cochées, absence de recouvrement de la rareté et des mentions LR/SSR/Nouvelle, survol/focus et bascule au clavier.
- Éléments examinés visuellement : modales sur mobile et ordinateur, étoiles seules et cumulées avec souhait/doublon.
- Scénarios SQL : autre utilisateur, compte banni, refus anonyme/service_role, retrait explicite d’un favori, fusions, catégories et licences secondaires, plus de 72 favoris, entrées vides et limite de 500 identifiants.

La route `/design-system/trade-pack-favorites-preview` fournit des fixtures en mémoire pour reproduire les deux interfaces. Comme les autres prévisualisations, elle reste inaccessible en production.

## Migration et test protégé

Migration : `20261103033000_pack_favorite_cards.sql`, non appliquée au moment de la préparation de cette PR.

Walid a explicitement validé l’ajout de `public.get_pack_favorite_card_ids(uuid[], boolean)` à l’allowlist stricte des droits SQL. Le lecteur est réservé à `authenticated`, exige un compte actif, utilise exclusivement `auth.uid()` et accepte au plus 500 identifiants. Aucun test existant ni aucune assertion existante n’est supprimé ou assoupli. Les empreintes des cartes et des animations restent inchangées et passantes.

La CI complète sera exécutée par GitHub Actions avant fusion. L’application de la migration nécessitera la coordination SQL et une sauvegarde validée.
