# Audit de performance — production Yokkai Collec, 29 octobre 2026

## Résumé

Audit commencé sur le commit 67aba74d8cfe2dc44ae96cb0ff7e01e7d3a8e7ed, VPS Netcup actuel uniquement. Les mesures confirment un coût SQL excessif dans le catalogue et surtout son enrichissement en métadonnées de classeur. Aucune saturation globale, aucun redémarrage ou changement d'infrastructure effectué pendant le diagnostic. Les corrections ci-dessous sont préparées dans cette PR ; leur application et les mesures finales seront consignées après CI et coordination SQL.

## État infrastructure

- CPU : 8 vCPU ; charge 2,83/4,09/4,59. Échantillon vmstat de 10 s : 47–72 % d'inactivité, wa=0 %, st=0 %, aucun swap. Des pointes ponctuelles restent possibles hors de cet échantillon.
- RAM : 15 Gio, 9,3 Gio disponibles ; l'espace libre faible correspond surtout au cache disque. Aucune pression mémoire et aucun OOM relevé.
- Disque : 251 Go, 72 Go utilisés (30 %), inodes 7 %. Aucune erreur kernel récente. La mesure PostgreSQL détaillée des temps I/O est désactivée ; ne pas interpréter ses compteurs à zéro comme une latence nulle.
- Réseau : aucune preuve de saturation. Les mesures HTTP séparent DNS/TCP/TLS/TTFB et total ; la RPC reste lente même avec TLS vérifié directement sur l'origine.
- Docker : services attendus actifs, healthchecks présents sains, zéro restart et zéro OOMKilled. Les conteneurs de création du bucket et d'inspection ancienne sont arrêtés ; ils ne servent pas de trafic.
- Limites : zéro throttling cgroup, processus Next autour de 19 descripteurs sur une limite de 524288, Auth autour de 54/524287. Pas d'épuisement de PID/descripteurs observé.
- PostgreSQL 17.6 : environ 50 connexions clientes, max_connections=100 ; majorité idle, zéro transaction idle-in-transaction, zéro blocage, zéro deadlock. Les attentes de réplication WalSenderWaitForWal sont normales. Cache de blocs historique ~99,96 %. La base fait ~414 Mo.

## Architecture réellement observée

Coolify 4.4.7 et Traefik 3.6 ; Next.js 16.4.2 ; Supabase PostgreSQL 17.6.1.136, PostgREST 14.17, Auth 2.196.0, Realtime 2.134.10, Storage 1.74.0, Supavisor 2.9.12, Envoy 1.39.1, Vector 0.53, Analytics 1.50.10 et RustFS 1.0.0. Le frontend est sur le réseau Coolify, Supabase sur son réseau dédié, Traefik relie les deux. Le flag de classeurs stables est activé : le catalogue joueur utilise get_binder_catalogue_page, puis get_card_binder_metadata. get_catalogue_cards_page est l'ancien chemin de recherche, pas celui du flag actif.

## Problèmes trouvés et corrections proposées

### IMPORTANT — Métadonnées des classeurs relues pour chaque carte

pg_stat_statements depuis le 26 octobre : get_card_binder_metadata, 71797 appels, moyenne 628 ms, temps cumulé ~45102 s (12,5 h). EXPLAIN sur 24 cartes : 342 ms ; les tables d'alias sont relues 29 fois, dont ~11300 alias par passage.

Correction : matérialiser les liens des cartes demandées, agréger une fois les alias nécessaires, puis joindre les résultats. Les vues éditoriales restent la référence. Aucun droit, politique RLS, limite (1–500), regroupement, image ou donnée joueur changé. Équivalence vérifiée en lecture seule sur 24/60/500 cartes de production, ainsi que zéro, identifiants inconnus et 501 éléments.

### IMPORTANT — Le catalogue sans recherche construit inutilement tous les candidats

RPC catalogue actif historique : 2934 appels, moyenne 791 ms. Requête sans recherche : ~482 ms de TTFB médian via Cloudflare ; EXPLAIN 750 ms sur un échantillon. L'ancien chemin matérialise et trie le catalogue avant de ne retourner que 24 cartes.

Correction : chemin sans recherche utilisant les index existants pour la page ; total exact calculé séparément. Tri global rareté/nom/UUID avant pagination, filtres multiples, plafonds et propriété wishlisted conservés. Aucun nouvel index.

### IMPORTANT — Recherche sélective empêchée d'utiliser les index existants

Recherche Naruto : TTFB médian 963 ms, EXPLAIN 889 ms. La sous-requête corrélée du candidat visite 92326 cartes ; une autre étape construit ~91760 lignes inutiles. Correction : séparer les candidats nom/franchise en UNION, utiliser les index trigrammes existants et borner les lectures par clé primaire. Les filtres catégorie/rareté sont appliqués avant l'enrichissement. Le chemin optimisé se limite à 5000 candidats et aux recherches littérales d'au moins un terme de 3 caractères ; les recherches larges, courtes ou contenant des jokers gardent le chemin de référence. Résultat complet identique, sans LIMIT arbitraire sur les résultats.

### IMPORTANT — Polices et sons publics personnalisés par le proxy

GET /fonts/profile/gothic-latin.woff2, /fonts/Cinzel-Bold.ttf et /assets/sfx/LR.mp3 : private, no-store + Set-Cookie et CF-Cache-Status BYPASS. Le matcher faisait traverser ces fichiers statiques par le rafraîchissement Auth et la personnalisation de langue.

Correction : exclure uniquement les extensions de polices dans /fonts/ et les MP3 dans /assets/sfx/ ; Cache-Control public,max-age=3600 limité à ces deux répertoires. Pas de immutable car les noms ne sont pas versionnés. Les pages, API Pro, Auth, médias privés et garde design-system gardent leurs contrôles. Aucun changement visuel ni réduction de qualité d'image.

## Mesures avant/après — préparation

Ces comparaisons proviennent de requêtes SELECT/EXPLAIN en production sans remplacer les fonctions. Elles ne sont pas encore les chiffres de production après déploiement.

| Lecture                            |                       Avant | Variante proposée | Observation                         |
| ---------------------------------- | --------------------------: | ----------------: | ----------------------------------- |
| Métadonnées 24 cartes              |                      342 ms |          56–59 ms | 5539 → 1070 blocs partagés touchés  |
| Métadonnées 500 cartes             | fonction existante comparée |            130 ms | même réponse, pas de limite réduite |
| Catalogue vide, rareté, 24 cartes  |                      750 ms |             65 ms | même total et même page             |
| Catalogue filtré Anime/LR, page 2  |                      235 ms |             57 ms | même résultat                       |
| Catalogue par nom                  |                      529 ms |            103 ms | même résultat                       |
| Naruto, recherche sélective bornée |                      889 ms |            186 ms | même total 566                      |
| Uzumaki Naruto                     | fonction existante comparée |            133 ms | même total 6                        |
| Film/FILM/LR                       | fonction existante comparée |            264 ms | même total 40                       |

Mesures HTTP initiales via Cloudflare : métadonnées 24 cartes 360 ms médian, catalogue vide 481 ms, recherche Naruto 963 ms. Pages non connectées / et /catalog : TTFB médian 134/76 ms via edge, 73/50 ms via origine. Ce dernier point ne mesure pas le rendu complet d'un catalogue connecté.

## PostgreSQL

Requêtes historiques lentes supplémentaires : get_binder_albums_page ~1705 ms/382 appels ; get_profile_details_with_binders ~753 ms/1298 ; classement ~517 ms/10233 appels ; ouverture multiple de packs ~1844 ms/1642 appels (nombre de packs variable). Elles restent à profiler spécifiquement avant une autre modification. Ne pas réécrire la logique de score, les droits ou les drops sur la base d'une moyenne historique.

cards + card_franchises triés par date : historique 1016 ms/190 appels, pointe 4134 ms ; EXPLAIN SELECT limité à 24 : 121 ms. Ce n'est pas le même volume que les appels historiques et le catalogue actif n'utilise pas ce tri. Pas d'index ajouté sans comparaison de forme/volume identiques.

get_catalogue_cards_page (ancien chemin) : trois appels HTTP espacés ~0,85–0,97 s ; statistiques 7 et 6 appels selon la signature normalisée, dont l'audit. Non modifié : le flag actif utilise get_binder_catalogue_page.

Statistiques planificateur présentes : cards ~92327 lignes estimées / 92326 réelles ; card_franchises ~92138 / 92757. Les n_live_tup très faibles de certaines tables viennent des compteurs réinitialisés lors de la migration, pas d'une preuve de mauvaises statistiques. Aucun ANALYZE ou réglage mémoire fait à l'aveugle. Des écritures temporaires historiques existent (~177 Go cumulés) : elles ne démontrent pas une saturation actuelle.

## Frontend et trafic

Fenêtre Envoy de 5 min : 2860 requêtes, dont 1196 Auth /user, 319 images publiques, 175 non-lus sociaux, 124 notifications, 106 enrichissements classeur. Une seconde fenêtre Auth distingue ~1261 appels node de ~78 navigateur ; les fenêtres ne sont pas exactement simultanées. Les appels Auth sont majoritairement côté serveur.

Source auditée : catalogue borné à 60 cartes ; enrichissement par lots de 500 ; images originales lazy/async ; polling arrêté dans les onglets cachés ; compte de messages partagé entre widgets. Aucune boucle de reconnexion ou récupération de toutes les cartes démontrée dans le parcours catalogue actif. getAllCards existe encore, sa seule existence ne prouve pas qu'il est appelé.

Les API Pro benefits puis profile-style toutes les 30 s pour un membre Pro répètent la vérification de membership et l'Auth proxy/handler. Optimisation future possible, mais conserver la publication du statut Pro même si le style échoue ou reste lent : les tests protègent explicitement ce comportement. Aucun contrôle Auth supprimé ici. Le nombre de requêtes dépend aussi du nombre de pages et de la durée des sessions ; le ratio fourni de 207 requêtes/visite ne suffit pas à démontrer une boucle.

## Images, Storage, RustFS

Bucket card-images : 158718 objets publics, moyenne ~80 Ko, p95 ~159 Ko, maximum ~6,1 Mo, formats JPEG/PNG/WebP/GIF. Avatars publics : moyenne ~411 Ko, p95 ~2,06 Mo, maximum ~3,45 Mo ; les GIF peuvent être coûteux. Médias de mur privés : 12 objets, restent privés.

Storage sur une fenêtre de 5 min : 319 réponses, 250 HTTP200 et 69 HTTP304 ; moyenne 54 ms, p50 32 ms, p95 172 ms ; aucun 5xx. Trois images natives : accès origine ~25–45 ms, edge ~48–84 ms de TTFB, Cache-Control max-age=3600 et ETag, sans Set-Cookie. Les images hors viewport utilisent le lazy natif ; aucun proxy de compression ni recompression ajouté (contrat produit existant).

RustFS consomme environ 1–1,4 cœur dans les échantillons, sans throttling/OOM, et lit ~159 Mo en 10 s dans l'échantillon cgroup. Ce bruit de fond mérite une observation plus longue ; les requêtes Storage ne démontrent pas une panne ou un besoin de redémarrage. Aucune modification RustFS faite.

## Cloudflare

Les chiffres 912620 requêtes, 29,98 Go, 4410 visites et 5,13 % de HIT sont fournis par l'exploitant ; accès au tableau de bord Cloudflare non disponible pour réinterroger ces 24 h et inspecter toutes les règles.

Les images publiques testées sont DYNAMIC malgré max-age=3600 et ETag : leurs chemins sont des identifiants sans extension. Ce comportement correspond à l'éligibilité par extension documentée par Cloudflare, qui ne se déduit pas du MIME. Une règle de bypass supplémentaire n'a pas pu être exclue sans l'accès à la zone. Les pages personnalisées et RPC dynamiques doivent rester hors cache.

Amélioration sûre à préparer côté Cloudflare : règle exacte sur le hostname API, méthode GET/HEAD et préfixe /storage/v1/object/public/card-images/, sans querystring ni Authorization, en respectant les en-têtes origine. Exclure tous les autres buckets, /auth/, /rest/, /api/, /object/sign/ et médias privés. Vérifier l'absence de règles plus prioritaires et la purge ciblée après suppression d'image. Rien appliqué à Cloudflare ici. Une simple augmentation globale du TTL ne résout pas l'éligibilité sans extension et pourrait masquer des problèmes de confidentialité.

Sources : https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ ; https://developers.cloudflare.com/cache/concepts/cache-control/.

## Traefik et Realtime

Pas de 502/503/504 dans la fenêtre Envoy (2860 requêtes), ni d'erreur Traefik récente. Les mesures origine/edge placent le coût catalogue dans SQL, pas dans un timeout proxy : timeouts et réseaux Docker inchangés.

Realtime actif depuis le 26 octobre, zéro restart/OOM, healthcheck sain, aucun log récent d'erreur/reconnexion. Huit upgrades HTTP101 en 5 min ; ce volume seul n'est pas une tempête de reconnexion. Slots logiques actifs, WAL retenu ~3,8 Mo pour les deux slots Realtime et ~393 Mo pour Analytics ; surveiller l'évolution du dernier, sans supprimer de slot. Les frames WebSocket ne sont pas des requêtes HTTP supplémentaires.

## Modifications préparées et rollback

- supabase/migrations/20261029020000_catalogue_metadata_read_performance.sql : remplace seulement deux fonctions existantes ; pas de table, index, données, droits ou configuration d'infrastructure.
- proxy.ts : exclusions étroites des polices/sons publics.
- next.config.ts : TTL public de 1 h pour ces assets seulement.
- tests/catalogue-read-performance-db.test.mjs : nouvelles comparaisons aux définitions antérieures, variantes éditoriales/licences, rôles anon/authenticated, limites, ordre, filtres, wishlist et absence de droits supplémentaires.
- tests/public-assets-proxy.test.mjs : nouvelles frontières du matcher, notamment API avec suffixes .woff2/.mp3 qui doivent rester protégées.
- Ce rapport. Aucun test existant modifié ou affaibli.

Application SQL uniquement après sauvegarde validée, vérification de dérive et confirmation de coordination ; transaction unique avec lock_timeout et statement_timeout, puis recontrôle. Définitions précédentes sauvegardées pour retour arrière ciblé ; rétablir le commit précédent pour les en-têtes sans toucher aux données. CI GitHub verte et branche à jour exigées avant merge.

## Limites et points restant à surveiller

- Pas de test de charge ni d'action ouvrant un vrai pack. Pas de connexion créée ni de données utilisateur supprimées.
- Pas d'accès de contrôle navigateur connecté dans cette session (désactivé dans Work) : parcours connecté réel, waterfall navigateur, LCP/INP sur mobile lent et vérification visuelle manuelle restent à faire. Les lectures SQL et HTTP ne prouvent pas le temps ressenti complet d'un joueur.
- Mesures à faible concurrence, quelques appels seulement ; p95 calculé sur les logs pour Storage/Auth, pas sur trois appels RPC. Pas de promesse de gain p95 global sans observation après release.
- Les photos/GIF natifs volumineux et le coût RustFS restent à surveiller ; la qualité d'image est un contrat produit, aucune compression imposée.
- Classements, classeurs et profils ont des coûts significatifs : prochains profils ciblés si les lags persistent après correction du catalogue/enrichissement.
- Contrôler la hausse ou non des 5xx après release et le débit des appels Auth/RPC à trafic comparable. Les statistiques historiques ne sont ni réinitialisées ni effacées.

## Conclusion de diagnostic

**PROBLÈME CONFIRMÉ** dans les lectures du catalogue et les métadonnées. Infrastructure générale confortable pendant les mesures. Aucune cause réseau/Cloudflare/CPU globale démontrée ; le cache insuffisant des assets constitue un facteur additionnel, pas une explication unique.
