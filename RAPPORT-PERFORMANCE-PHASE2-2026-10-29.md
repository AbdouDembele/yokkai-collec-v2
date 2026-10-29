# Résumé exécutif

Audit de phase 2 du 29 octobre 2026 sur le VPS actuel, après lecture complète du rapport de phase 1, de la PR #8, de ses tests et de ses migrations. Référence de départ : master 35d06a2. Les gains de phase 1 sont conservés. Les six cibles serveur ont été mesurées avant toute modification. Ce rapport distingue les mesures de production en lecture seule, les variantes SQL non déployées et les tests de code isolés.

Deux corrections retenues : réutiliser la vérification Auth pendant la récupération initiale de la langue, et dédupliquer les catégories brutes avant leur normalisation dans la projection des profils. Les autres variantes n'apportent pas de gain suffisamment régulier, ou régressent. Aucune modification de score, RLS, droits, qualité d'image, données, Pro, drops ou infrastructure.

**État au moment de cette PR : corrections préparées et testées, migration non appliquée et déploiement non effectué.** La validation et les références de livraison seront consignées dans la PR et dans la copie finale du rapport. Le cache Cloudflare n'est pas modifié : accès au compte indisponible. Le parcours Chrome connecté reste bloqué par le service de contrôle, même après la reconnexion indiquée par l'utilisateur. Aucun waterfall ni Core Web Vital connecté n'est inventé.

# Baseline après phase 1

Mesures à partir de 02:49 UTC. Trois appels HTTP séquentiels par RPC, même échantillon que la phase 1 ; médianes descriptives, aucun p95/p99 sur trois appels.

| RPC                                 | Médiane HTTP phase 2 | Contrôle                       |
| ----------------------------------- | -------------------: | ------------------------------ |
| get_card_binder_metadata, 24 cartes |               119 ms | réponse identique à la phase 1 |
| get_binder_catalogue_page, vide     |               139 ms | réponse identique              |
| get_binder_catalogue_page, Naruto   |               244 ms | réponse identique              |

8 vCPU ; charge 5,15/3,46/3,59. RAM 15 Gio, 9,4 Gio disponibles, aucun swap. Disque 33 %, inodes 8 %. vmstat : 43–68 % idle, I/O wait 0–3 %, steal 0 %. Conteneurs attendus sains, zéro redémarrage/OOM ; aucun blocage PostgreSQL. Les compteurs historiques pg_stat_statements mêlent avant et après phase 1 et ne permettent pas de conclure à une régression récente.

Les trois profils de comparaison sont publics et non bannis, avec respectivement 1, 51 et 2 501 cartes distinctes. Ils représentent le minimum, la médiane et le maximum de 268 joueurs ayant des cartes. Ce n'est pas un échantillon aléatoire de toute la population. Aucun identifiant utilisateur n'est publié dans les preuves jointes.

# Cloudflare / images

Huit objets du bucket public card-images : petit et grand JPEG/PNG/WebP/GIF. Trois GET par objet, 24 requêtes ; tailles 224 octets à 6 146 566 octets. Tous répondent 200, Content-Type correct, Cache-Control max-age=3600, ETag présent, Vary Accept-Encoding, aucun Set-Cookie, aucun Age. Content-Length absent sur ces réponses HTTP ; les octets effectivement reçus sont conservés dans les preuves. **DYNAMIC/DYNAMIC/DYNAMIC pour les huit objets**, TTFB 50–142 ms. Aucun redimensionnement ni réencodage.

Les noms n'ont pas d'extension. Cloudflare documente un cache par extension, et non par MIME : cela explique l'inéligibilité par défaut. Sans accès aux règles du compte, un bypass supplémentaire ne peut pas être exclu ; la causalité exclusive et l'ordre des règles restent à confirmer avec Cloudflare Trace. [Comportement par défaut](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/).

## Configuration manuelle exacte proposée

Fichier prêt à examiner : docs/performance-phase2/cloudflare-card-images-rule.json, désactivé par défaut. Dans la zone yokkai-collec.com, Rules → Cache Rules :

```text
(http.host eq "api.yokkai-collec.com"
 and http.request.method in {"GET" "HEAD"}
 and starts_with(http.request.uri.path, "/storage/v1/object/public/card-images/")
 and http.request.uri.query eq ""
 and not any(http.request.headers.names[*] eq "authorization")
 and not any(http.request.headers.names[*] eq "cookie"))
```

Action : Eligible for cache. Edge TTL : utiliser Cache-Control de l'origine, **bypass si absent** (bypass_by_default). Browser TTL : respecter l'origine. Garder la clé de cache par défaut et Origin Cache Control ; ne pas imposer un TTL qui ignore private/no-store/Set-Cookie. Le TTL observé reste 3 600 s. Aucun cache global.

Le préfixe public/card-images/ exclut Auth, REST, API applicative, object/sign, autres buckets et médias privés. Authorization, Cookie et toute query string excluent la requête. Les cookies sont exclus par prudence supplémentaire. Avant activation, inspecter Workers, Page Rules, Cache Rules et leur ordre : la dernière règle correspondante gagne pour un réglage commun. Ne pas déplacer aveuglément un bypass de sécurité. [Réglages](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/), [priorité](https://developers.cloudflare.com/cache/how-to/cache-rules/order/).

Après activation : rejouer les mêmes huit URL sans credentials/query ; MISS éventuel puis HIT/HIT, Age croissant au même point de présence. Contrôler aussi Auth, REST, signed URL, Authorization, Cookie et query : aucun HIT par cette règle. Un objet modifié au même chemin nécessite une purge ciblée ou l'attente du TTL ; aucune purge globale. Ensuite comparer 5 minutes de Storage/RustFS à charge comparable. **Cache après, baisse du trafic origine et gain RustFS : non mesurés, règle non appliquée.**

# Auth

Fenêtre Envoy initiale de 5 minutes : 1 819 requêtes, dont 800 /auth/v1/user. Autre fenêtre de 5 minutes, avec classement par User-Agent : 638 Node et 55 navigateur. Ces fenêtres sont distinctes ; elles ne mesurent ni des utilisateurs uniques ni des sessions. Les référents seuls ne permettent pas d'attribuer les appels à Node.

Chaîne confirmée dans le code : navigation/prefetch ou appel API → proxy updateSession → getClaims → GoTrue /user avec la signature symétrique actuelle ; puis rendu serveur getCurrentUser → getUser, déjà mémoïsé par React cache dans ce rendu. Les API Pro benefits et profile-style gardent chacune proxy et handler authentifiés. Le navigateur possède aussi des lectures d'identité à l'initialisation de notifications, interactions de mur, promo Discord et parrainage. Versions runtime vérifiées : SSR 0.12.7, Auth JS 2.117.1. La création d'un client seule ne prouve pas un appel /user ; la récupération d'un utilisateur absent et le chemin getClaims symétrique peuvent en déclencher.

Double lecture précisément démontrée : sans cookie de langue, le proxy crée un second client et appelle une seconde fois getClaims pour récupérer get_my_locale. Même requête, même session déjà vérifiée. Sur l'exécution isolée des vrais modules du proxy avec transport Auth simulé : **2 clients/2 vérifications → 1 client/1 vérification, -50 % sur ce chemin**. Le contexte est une variable créée dans chaque invocation ; aucun cache global, header d'identité, résultat client non vérifié ou réutilisation entre utilisateurs. Les handlers et SQL restent responsables de leurs autorisations. Les pages de partage qui contournent updateSession continuent à vérifier leur session pour cette récupération.

Les tests ajoutés couvrent deux requêtes concurrentes avec deux identités, refus Auth malgré des headers forgés, cookie renouvelé, headers privés, erreur de langue, partage et API. Aucun test existant modifié. Les tests existants de panne/lenteur du style Pro restent inchangés : statut publié avant le style et conservé si le style échoue. Fréquence Pro 30 s et séparation des appels conservées. **Appels réels avant/après par session : non mesurés sans navigateur.** Ce correctif ne prétend pas expliquer ni supprimer les 638 appels Node de toute la fenêtre.

# get_binder_albums_page

Trois EXPLAIN ANALYZE par cohorte, rôle authenticated et identité positionnée, transactions read-only, aucun utilisateur modifié. Médianes SQL : **1230 / 1378 / 1418 ms**. Favoris seuls : 1 263 / 1 271 / 1 315 ms. Ce ne sont pas des TTFB HTTP connectés.

Plan du corps SECURITY DEFINER expliqué séparément sous son propriétaire avec les mêmes claims : catalogue global 92 757 liens, 4 384 classeurs. Environ 105 500–106 200 blocs trouvés en cache ; 4 939–4 943 blocs temporaires (~38,6 Mio). Le catalogue distinct, ses tris et le calcul de preuve éditoriale dominent. Environ 33 122 sous-lectures de règles média et 92 757 passages dans le lateral ; pagination après calcul exact de progression et favoris. Un LIMIT placé avant ces agrégats modifierait le tri et les totaux.

Variantes en lecture seule : suppression du DISTINCT initial avec garde des noms, agrégation en deux étapes, suppression de matérialisation pour le classement, work_mem local à 16 Mio, remplacement d'un EXISTS redondant par le résultat de jointure. Le dernier produit exactement les mêmes 92 757 liens (EXCEPT ALL dans les deux sens = zéro) mais ralentit jusqu'à ~3,3 s et augmente les blocs lus. Les agrégations ont des gains irréguliers et davantage de temporaires ; work_mem accroît le budget par nœud/concurrence. **Aucune de ces variantes n'est livrée.** Plan après et TTFB avant/après : sans objet, fonction inchangée.

# Profils

get_profile_details_with_binders : médianes SQL **161 / 171 / 2124 ms**. Décomposition indicative, mesurée par composants séparés et non additionnable à l'identique : get_profile ~9–16 ms ; get_profile_details ~138–165 ms ; binder_favorite_keys ~18 / 33 / 854 ms ; resolve_binder_widgets ~1 ms. Le gros profil paie surtout les favoris/résolutions et le second passage sur les liens du catalogue. Le wrapper relit aussi get_profile et remplace le favoriteAlbums calculé par son délégué ; ces chemins sensibles ne sont pas réécrits dans ce lot.

Correction isolée et mesurée : widgetCategories normalise chaque catégorie pour chaque carte avant DISTINCT. Dédupliquer les catégories **brutes** puis appliquer le DISTINCT normalisé conserve les espaces/casse/Unicode, le filtre vide, le tri, le JSON et tous les autres champs. Cinq paires alternées en lecture seule : médiane **119.6 → 38.9 ms (~67,5 %)** pour ce seul sous-calcul ; mêmes 686 blocs, résultat identique. Cela ne représente pas une baisse de 67,5 % du profil complet.

Migration 20261029043000_profile_category_projection_performance.sql : une expression dans get_profile_details, CREATE OR REPLACE conservant ACL/owner/STABLE/search_path/SECURITY DEFINER. Tests d'équivalence de toute la réponse, public/privé/propriétaire/ami/étranger/bloqué, champs de catégories hétérogènes, erreurs, accès anon, données et propriétés de fonction. Les tests existants du profil et de la phase 1 restent inchangés. Après production : à mesurer avec les mêmes trois cohortes et paramètres ; TTFB connecté indisponible à ce stade.

# Classement

Médianes SQL : **329 / 361 / 357 ms** pour les trois cohortes, limite 6. Le plan recalcule ~45 800 copies et ~45 600 variantes pour 321 profils éligibles, puis classe 268 joueurs publics ; ~846 blocs temporaires (~6,6 Mio). La formule, les égalités de compétition, l'ordre d'affichage, les blocages, les filtres et l'enrichissement Pro sont sensibles. Réduire une matérialisation diminue les temporaires à ~457 blocs, sans gain de latence régulier sur les trois cohortes. **Aucun changement livré au classement**, pas de cache de classement personnalisé. Les moyennes historiques ~516 ms sur ~10 470 appels donnent la priorité en volume, pas une latence actuelle garantie.

# RustFS

20 fenêtres de ~15 s, 303,6 s au total (02:54:09–02:59:13 UTC). CPU moyen 1.063 cœur, plage 0.987–1.497. 9 fenêtres sans requête Storage, avec CPU proche d'un cœur. Pic de lecture disque ~18,8 Mo/s pendant une fenêtre sans requête Storage ; plusieurs fenêtres restent à zéro lecture disque tout en consommant un cœur. 219 réponses Storage observées, aucun 5xx. Une partie du début inclut les 24 GET de l'échantillon d'images ; cette charge d'audit est signalée. Zéro redémarrage/OOM, mémoire et compteurs réseau/cgroup conservés dans les preuves.

Les logs Docker étaient vides : les logs réels sont écrits dans /logs. Lecture des fichiers récents : cycles scanner atteignant leur budget de 1 800 s, arrêt du worker et curseur persisté, génération clôturée, recovery_required=false, environ toutes les 31 min. Les threads CPU sont rustfs-worker ; leur nom ne suffit pas à attribuer chaque milliseconde au scanner. Activité interne probable, **lien causal exact non prouvé**. Aucune preuve de saturation ou de panne Storage ; pas de redémarrage, de changement de scanner, de volume ou de cache FD.

Sur une autre fenêtre initiale, Storage n=187 : moyenne 61,5 ms, p50 50,9 ms, p95 138,6 ms, statuts 200/304 uniquement. Ce p95 repose sur une fenêtre réelle et ne devient pas un p99. Après cache CDN : non mesuré, faute de règle appliquée.

# Browser performance

Compte existant via session Chrome actuelle autorisé par l'utilisateur. Le service répond toujours « browser access host is unavailable », et le pipe natif est absent, y compris après réinitialisation et reconnexion signalée. Aucun accès aux cookies Chrome, aucun JWT d'utilisateur créé, aucun login ou pack consommé pour contourner ce blocage.

Waterfall connecté, TTFB document, FCP/LCP/INP/CLS, élément LCP, desktop/mobile/réseau lent, cold/warm, visite simple/session 5 min : **non vérifiés**. Les chiffres SQL et curl ne les remplacent pas. Il reste à rejouer Home, catalogue/Naruto, profil, collection/classeurs, classement, trades via Social et notifications, sans mutation, lorsque Chrome sera accessible. L'interface n'est pas modifiée dans ce lot ; vérification visuelle responsive/zoom non effectuée.

# Nombre de requêtes

Fenêtre serveur initiale : 1 819 requêtes Envoy/5 min ; Auth user 800, images 187, statuts Regular/Decision Pack 76/70, user_cards 69, get_game_info 54, notifications 50, billing_has_game_pro 48, non-lus sociaux 44, get_profile 44, fil public 42, binder metadata 40. Pas de 5xx dans cette fenêtre. L'audit n'a déclenché aucune ouverture de pack : les ouvertures vues dans les logs viennent du trafic existant.

Le navigateur appelle aussi les assets Next, fonts/sounds et Realtime ; ils ne sont pas tous visibles dans les logs Supabase. Aucun ratio requêtes/session ni MB/session fiable n'est calculable ici. Les 207 requêtes/visite historiques ne démontrent ni un bug ni un comportement acceptable sans parcours réel.

# Modifications effectuées

- utils/supabase/proxy.ts : contexte vérifié optionnel, local à l'invocation.
- proxy.ts : réutilisation du client et de la décision vérifiée pour la langue initiale ; partage conserve une vérification propre.
- tests/auth-proxy-dedup.test.mjs : nouveaux tests de déduplication et d'isolation.
- supabase/migrations/20261029043000_profile_category_projection_performance.sql : projection des catégories seulement, **non appliquée au moment de cette PR**.
- tests/profile-category-performance-db.test.mjs : équivalence complète et ACL, sans modification des tests existants.
- docs/sql/rollback-profile-category-projection-2026-10-29.sql : retour arrière SQL.
- Ce rapport, docs/performance-phase2/evidence.json et configuration Cloudflare proposée (désactivée).

Aucune configuration de production modifiée pendant le diagnostic. Aucun index, policy, grant, formule de score, RPC de phase 1 ou image modifié. SQL exécuté uniquement en lecture seule jusqu'à l'éventuelle application coordonnée de la migration. Les variantes rejetées ne sont pas des migrations.

# Rollback

Auth : redéployer le commit master précédent 35d06a2 ou reverter les deux fichiers du proxy via PR/CI ; pas d'état persistant ni de changement de cookie/secret. SQL : appliquer docs/sql/rollback-profile-category-projection-2026-10-29.sql après coordination ; corps initial rétabli, ACL préservées, pas de suppression de registre. La migration suivante devra expliciter la réconciliation, sans la réappliquer aveuglément. Cloudflare proposée : désactiver uniquement la règle, purger les URL concernées si nécessaire ; aucune purge globale. RustFS/classement/classeurs/Pro : aucun rollback requis, inchangés.

# Risques / limitations

Les tests de transport Auth sont isolés ; -50 % concerne uniquement le chemin initial sans cookie de langue. Le trafic agrégé varie avec l'activité réelle et ne permet pas d'attribuer un gain par joueur. Les petits échantillons SQL ne donnent pas de p95/p99 représentatif. Les mesures de corps SQL sous leur propriétaire reproduisent SECURITY DEFINER, mais ne sont pas des appels HTTP. Les variantes peuvent produire des plans différents selon statistiques et charge : celles sans gain stable ont été rejetées. Le gain de catégories est limité dans un profil dominé par les favoris. L'accès Cloudflare et le navigateur connecté restent nécessaires pour terminer le volet CDN/ressenti.

# Prochaines optimisations

1. Activer la règle Cloudflare après inspection des règles existantes, puis mesurer HIT/Age et Storage/RustFS à charge comparable.
2. Rétablir l'accès au navigateur pour compter réellement Auth/RPC/assets par navigation et capturer les cascades de requêtes.
3. Réduire le calcul global des liens classeurs et des favoris via un plan équivalent testé ; conserver les snapshots éditoriaux, alias, conflits et tri exacts. Les tentatives de ce lot ne suffisent pas.
4. Étudier une agrégation de classement sans les temporaires, uniquement avec preuve d'équivalence de score/ordre/visibilité et gain mesuré.
5. Investiguer le scanner RustFS avec les métriques internes appropriées ; aucun tuning fondé uniquement sur le nom des threads ou un warning.

# Conclusion

**SAIN** : gains de phase 1, mémoire/disque, Auth/Storage sans 5xx observés, absence de blocage/OOM/restart. **À SURVEILLER** : volume Auth Node, scanner RustFS, classement recalculé et variabilité. **PROBLÈME CONFIRMÉ** : images extensionless DYNAMIC, coût global des classeurs/favoris, normalisation répétée des catégories et double lecture Auth de langue initiale. La phase 2 reste partiellement vérifiée tant que le cache CDN et le parcours connecté ne sont pas accessibles ; aucune amélioration de Core Web Vitals n'est revendiquée.
