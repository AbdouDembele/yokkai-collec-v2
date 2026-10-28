# Intégration des classeurs stables Anime/Manga

Mise à jour du contrat produit : voir [Classeurs par licence confirmée](confirmed-license-binders.md). Le propriétaire a depuis autorisé un classeur commun à toutes les cartes d'une licence confirmée, y compris les imports manuels, avec conservation de leurs données sources. Le présent document décrit aussi le mode historique utilisé pour le retour arrière.

Référence éditoriale : `mapping_v3_quality_candidate.json`, SHA-256
`11d454c073cf2c60d31c6d34452ad621501f17875d2d1aa906f6ebb337ed7b88`.
Les deux séparations et les cinq changements de noms ont été autorisés par le propriétaire le 25 octobre 2026. Le fichier original reste immuable. Cette validation éditoriale n'autorise aucun déploiement ou activation en production.

## Installation inactive

Les migrations `20261025010000`, `20261025010001` et `20261025010002` ajoutent la projection, les préférences de classeurs et l'export des nouvelles préférences. Elles ne réécrivent aucune carte, licence source, collection, favori historique ou widget historique. Leur application au VPS exige une autorisation de déploiement distincte ; le rapport de livraison consigne leur état réel.

Deux conditions indépendantes contrôlent l'usage : `NEXT_PUBLIC_STABLE_BINDERS_ENABLED=true` dans l'application et `anime_series_settings.enabled=true` dans la base. Elles sont désactivées par défaut. Les anciens RPC restent disponibles.

Les clés `series:<uuid>` identifient les séries éditorialement vérifiées ; les clés `source:<sha256(category + U+001F + source)>` conservent les classeurs sources. Le nom affiché ne sert jamais d'identifiant. `Card.anime` reste le titre source ; `Card.binders` contient les identités et alias vérifiés pour la recherche et la progression.

## Chargement privé et garde-fous

`scripts/prepare-stable-binder-seed.mjs` prépare un SQL privé à partir du mapping, du CSV des 1 326 exclusions, du cache AniList vérifié et d'un reçu d'approbation portant l'empreinte exacte. Il n'accepte aucune URL de base et n'exécute rien. Le SQL refuse un chargement lorsque la projection est activée et conserve `enabled=false`.

Le reçu contient `mapping_sha256`, `editorial_approved: true`, `production_approved: false`, la date et la référence à la décision du propriétaire. Ne pas publier le seed, les UUID du catalogue, les preuves d'import ou le snapshot dans Git. Ne pas réutiliser ce reçu comme autorisation de production.

Les associations sont admissibles uniquement pour un média A approuvé, une carte AniList Anime/Manga dont la provenance et les champs sources correspondent au snapshot et son lien primaire exact. La liste d'exclusions est prioritaire. Les licences secondaires restent indépendantes. Seul `favoris_count`, agrégat de popularité mutable, est exclu de la comparaison de provenance : un souhait de joueur ne doit pas déplacer une carte. Tout changement d'identité, de titre, d'image, de rareté ou de source invalide l'association jusqu'à réexamen.

La liste d'exclusions conserve aussi les UUID supprimés par un opérateur : restaurer ultérieurement un UUID ne doit pas perdre sa protection. Le seed ignore les cartes absentes et les preuves devenues périmées ; il ne recrée aucune carte et ne met jamais à jour le snapshot pour forcer un rattachement. Un seed d'une autre version est refusé.

Avant une future intervention autorisée, comparer le catalogue vivant au snapshot et produire les écarts ; ne pas actualiser automatiquement les preuves devenues périmées. Contrôler aussi la présence d'une ancienne projection expérimentale : l'installation refuse `global_binder_settings` et une collision de tables doit être examinée, sans suppression automatique.

## Parcours de l'application et données joueur

Les albums du joueur et des profils autorisés, leurs cartes, les totaux, les sélecteurs de widgets, les filtres de catégorie/rareté/possession et la recherche utilisent les nouveaux RPC bornés. La recherche considère les noms affichés, titres sources et variantes anglaises/romaji vérifiées. La progression compte les UUID de cartes distincts, toutes copies et raretés confondues ; les compteurs du classeur ne diminuent pas lorsqu'un filtre de cartes est actif.

Un ancien favori désignant une seule clé est résolu à la lecture. Un favori ambigu reste conservé et demande un choix explicite dans l'interface. Les décisions sont enregistrées dans des tables additives ; aucun reset n'est nécessaire. Les widgets utilisent également une projection parallèle, avec les anciennes entrées ambiguës signalées. L'export de compte inclut ces nouvelles préférences et conserve les limites et la réservation existantes. Les nouvelles tables de préférences suivent la suppression autorisée d'un compte via leur FK `auth.users ... ON DELETE CASCADE` ; cette intégration ne supprime aucun compte.

Les preuves, paramètres et la vue de projection sont privés et sous RLS. Les joueurs passent par des RPC SECURITY DEFINER à `search_path=''` ; les lectures de possessions réutilisent `can_view_collection` et les protections de profil. Les RPC publics ne donnent que des métadonnées de catalogue. Les nouveaux droits authentifiés sont documentés dans l'allowlist de sécurité et doivent faire partie de la revue de la PR.

## Futurs imports AniList

La collecte enregistre explicitement `anilist_media_id`, distinct du `source_id` du personnage. Le nettoyage transmet cet ID, la version de preuve et un condensat liant personnage, média et titres exacts. Les CSV historiques sans ID média ne sont jamais enrichis par supposition.

Le CLI officiel utilise `import_anilist_cards(jsonb,uuid)`, accessible au seul service role. Il précontrôle les identifiants existants avant tout téléchargement ; le RPC insère uniquement et refuse toute mise à jour d'une carte existante. Les images utilisent des chemins immuables avec SHA-256, sans écrasement. Un média approuvé avec preuve complète reçoit son classeur ; sinon la nouvelle carte garde son titre source et entre en revue. Le mode de rapprochement par nom/catégorie est refusé pour AniList.

Ordre d'une future intégration autorisée : sauvegarde vérifiée → migrations inactives → vérification des droits et anciens RPC → seed privé réconcilié au catalogue courant → application avec flag désactivé → validation en recette → décision explicite d'activation des deux flags. Ne lancer aucun import avec le nouveau CLI avant installation du RPC.

## Recette et retour arrière

`scripts/rehearse-stable-binders.mjs` ne reçoit que des fichiers et crée une base PostgreSQL 17 locale jetable, sans réseau. Il rejoue toutes les migrations, charge le snapshot exact sans normaliser les fixtures, utilise des joueurs synthétiques, compare chaque classeur et chaque lien protégé et vérifie les empreintes avant/après chargement, activation, désactivation et réactivation. `--keep` conserve uniquement cette base de recette pour des contrôles complémentaires.

Le retour arrière opérationnel est logique : désactiver le flag applicatif puis exécuter la recette SQL `supabase/recipes/disable_stable_binders.sql` sur l'environnement explicitement autorisé. Les sources réapparaissent ; les preuves et nouvelles préférences restent conservées pour réactivation. Ne pas supprimer les tables ou réécrire les favoris historiques. Pour revenir au binaire ancien, conserver les migrations additives et le RPC d'import afin de garder l'historique des preuves ; ne pas réintroduire l'ancien import avec écrasement.

Les résultats privés détaillés et les limites de vérification figurent dans `.tools/anime-series-integration/delivery/README.md`. Aucune CI verte ou validation visuelle ne constitue à elle seule une autorisation de production.
