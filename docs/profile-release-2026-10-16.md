# Livraison regroupée du profil — 16 octobre 2026

Cette livraison reprend exactement les modifications des PR #268 à #271, sans les animations expérimentales #262 :

- Cadrage des bannières, zoom et rotation à 90° ; image entière disponible.
- Édition du profil et de la vitrine séparées, bouton propriétaire dans l’en-tête de la vitrine.
- Choix de bannière uniquement parmi les cartes possédées, recherche locale et image catalogue. Import d’avatar 4 Mo inchangé.
- Possession et refus des URL de bannière contrôlés par les RPC serveur, y compris les anciens clients. Perte de dernière copie : retrait de la bannière ; évolution atomique : conservation.
- Bio sans poignée de redimensionnement, défilement interne et limite de 300 caractères inchangés.

## Séparation des tests

La PR #272 prépare séparément les deux contrats historiques déjà présents sur master, avec validation de Walid confirmée par l’utilisateur. Elle doit être mergée avant cette livraison produit. Les tests de cadrage, nouveaux par rapport à master, sont ajoutés avec leur schéma historique explicite ; les tests de possession utilisent le replay courant. Aucune assertion existante affaiblie par le diff produit après #272.

Les anciennes PR empilées sont remplacées par ces deux PR vers master pour éviter quatre builds successifs du site. Les anciens scripts de preuve d’import restent des traces historiques ; la preuve courante est `scripts/browser-proof-owned-card-banners.mjs`.

## Migrations et déploiement

- `20261016000000_profile_banner_frame.sql`
- `20261016000001_owned_card_banners.sql`

Leur état d’application est consigné dans la PR de livraison. Procédure officielle `scripts/deploy-migrations.sh` : comparaison du schéma, sauvegarde validée sur le VPS, transaction unique et vérification finale. L’utilisateur a confirmé l’absence de migration parallèle avec Walid avant cette livraison.

La production contient déjà la migration de traduction `20261015190000_english_achievement_texts.sql` de Walid (#255). La procédure isolée de déploiement utilise sa référence exacte pour contrôler la dérive ; cette livraison ne modifie ni ne merge cette PR.

Après merge de la livraison, laisser le webhook Coolify déployer. Ne pas lancer de déploiement manuel supplémentaire. Contrôler le commit de la file, le conteneur actif, les réponses HTTP et les règles SQL en lecture seule.
