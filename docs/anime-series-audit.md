# Audit Anime/Manga par série identifiable

Cette branche remplace la politique de la PR #481 : **une série identifiable par classeur**, avec regroupement des saisons et parties directes. Tokyo Ghoul et Tokyo Ghoul:re ont deux identités distinctes. Le mapping de franchise précédent reste une comparaison historique, sans cohabitation des moteurs de projection.

## Portée de cette livraison

Cette livraison réalise l'audit, produit une proposition A/B/C/D et fournit une **recette locale** de projection par carte. Elle ne modifie aucun écran ni aucune RPC produit, ne s'intègre pas encore au pipeline d'import, n'installe aucune migration en production et ne réinitialise aucun favori. La validation éditoriale précède l'intégration applicative. Les fichiers SQL sous `supabase/recipes/` ne sont pas des migrations automatiques.

Les exports de catalogue et les rapports détaillés restent locaux, hors Git : identifiants de cartes et agrégats de production ne sont pas publiés dans cette PR. Les tests versionnés utilisent uniquement des fixtures synthétiques.

## Provenance

`cards.source_id` est un identifiant de personnage dans l'import AniList, pas un identifiant de média. Le script `data/clean_and_assign_rarity.py` écrit l'espace source `anilist` et le personnage dans `data/characters_clean.csv`. `data/anilist_par_anime.py` conserve un personnage dans `etat_scraping.json` avec le média le plus populaire associé au moment de l'import. Cet artefact permet de retrouver un média candidat par titre exact ; il ne reconstitue pas toutes les apparitions du personnage.

Une carte est corroborée lorsque l'espace source, le CSV original, l'identifiant et l'identité du personnage dans l'artefact concordent. Un nom modifié ou une preuve manquante protège la carte au lieu de forcer sa réassociation. `source=manual` est toujours exclu. La catégorie Anime/Manga, un numéro ou un titre trouvé sur AniList ne prouvent rien seuls. Une concordance de titre sert à résoudre le média dans les preuves d'import, après établissement de la provenance ; l'identité du média est ensuite recoupée avec la réponse API actuelle.

La règle ne couvre que le lien primaire prouvé : une licence secondaire n'hérite jamais du média primaire. Une divergence du romaji, de la licence primaire par rapport aux transformations historiques connues ou des titres API protège aussi cette association. Les altérations historiques ne sont pas réparées automatiquement.

## Décisions

`anime-series-decisions.mjs` distingue les relations et la série :

- A : même média avec plusieurs libellés, ou relation directe de saison/partie vérifiée et même identité de série ; proposition soumise à revue, pas une approbation de production.
- B : film, spécial, remake, frontière d'adaptation ou fragment de saisons dont la série racine reste à établir.
- C : série distincte ou absence de regroupement A établi ; conserver le rangement source.
- D : origine manuelle/inconnue, association non prouvée ou autre catégorie.

Les quatre règles Tokyo Ghoul fournies par le propriétaire sont explicites, indépendamment de la traversée du graphe. Aucun SEQUEL, SPIN_OFF, ALTERNATIVE ou préfixe ne suffit à lui seul. Les règles A ne passent jamais automatiquement par une relation B/C/D. Un composant de saisons déjà enregistré sous un seul libellé n'est pas réaffecté : cela évite de recréer une fragmentation à partir d'un sous-ensemble.

Les identifiants de classeurs sont stables pour le manifeste versionné et distincts du texte affiché. Une modification de titre ne change pas l'identité. Lors d'une révision future, conserver les identifiants existants ; ne pas recalculer une identité publiée à partir d'une nouvelle racine chronologique.

## Projection de recette et limites avant intégration

La recette SQL stocke des classeurs stables, des règles de média, des preuves d'origine par carte et une affectation par lien source exact. Les preuves comportent l'instantané complet de la carte : une modification locale ultérieure rend l'affectation inopérante jusqu'à nouvelle revue. La vue conserve la carte et le lien d'origine dans tous les cas.

Une carte manuelle partageant `Tokyo Ghoul √A` avec une carte AniList reste dans son groupe source. Les groupes utilisent une clé stable distincte du libellé : un classeur manuel et un classeur AniList peuvent avoir le même titre sans être fusionnés. L'interface devra les distinguer par une indication d'origine accessible, sans renommer les titres sources. Aucun client actuel ne doit être branché sur la nouvelle vue en utilisant uniquement son `display_name` comme clé.

La recette refuse l'installation si l'ancien moteur `global_binder_settings` existe. Aucun seed approuvé ni script d'activation de production n'est fourni. Une simulation locale peut approuver les seuls candidats A dans le conteneur jetable ; le manifeste livré reste non approuvé. Le rollback désactive la présentation sans restaurer une ancienne copie des données joueurs.

L'intégration future devra adapter ensemble les RPC de classeurs personnels/amis, les profils, les filtres, les favoris et le client pour transporter les clés stables. Les droits d'accès existants restent obligatoires. Les favoris historiques sont indexés par nom : lorsqu'un nom désigne plusieurs groupes protégés, conserver la préférence brute et demander une résolution plutôt que l'attribuer silencieusement. Aucun nettoyage de favoris n'est nécessaire à l'audit. Toute éventuelle remise à zéro demanderait une opération séparée, une sauvegarde privée et une autorisation explicite.

Le nouvel import devra écrire un registre de provenance vérifiable avec personnage, média et lot d'import, puis consulter uniquement les règles de médias approuvées. `planFutureMedia` démontre le comportement attendu : un média connu et approuvé retrouve son identifiant stable ; une nouvelle saison inconnue est mise en revue et les origines protégées sont exclues. Ce helper n'est pas encore raccordé au script d'import. Le normaliseur historique des titres devra être revu séparément avant cette intégration ; aucun changement global de normalisation ne doit affecter les imports manuels ou les autres catégories.

## AniList et cache

Les [conditions officielles](https://docs.anilist.co/guide/terms-of-use) et les [limites de débit](https://docs.anilist.co/guide/rate-limiting) ont été consultées. Le propriétaire a confirmé un usage commercial inférieur à 150 USD/mois. L'outil exige cette confirmation avant une requête, ainsi qu'un objectif d'audit précis et une liste explicite de médias issue du catalogue local. Il n'énumère pas le catalogue AniList et ne suit pas récursivement les relations.

Le client déduplique les ID, limite les lots à 50, espace les requêtes de 2,5 secondes, respecte 429/Retry-After/RateLimit-Reset, borne les reprises et sauvegarde après chaque lot. Le cache exclut les données hors périmètre et expire au bout de sept jours. Il est réservé à l'audit et ne doit pas devenir un miroir ou une base de secours AniList. Les scripts historiques de collecte massive ne sont pas exécutés par cette livraison.

## Reproduction et tests

Les chemins de snapshots et résultats restent hors Git. Exemple après préparation de preuves d'import et contrôle des conditions API :

```powershell
node scripts/fetch-anime-audit-media.mjs --scope /local/scope.json --output /local/media-cache.json --commercial-under-150-confirmed
node scripts/audit-anime-series.mjs --snapshot /local/catalogue.json --import-csv data/characters_clean.csv --import-state data/etat_scraping.json --media-cache /local/media-cache.json --normalized-titles /local/normalized-titles.json --previous-mapping /local/previous-mapping.json --output /local/audit
node scripts/rehearse-anime-series.mjs --snapshot /local/catalogue.json --mapping /local/audit/mapping_anime_manga.json --report /local/audit/staging-postgres.json
node --test tests/anime-series-audit.test.mjs
```

La recette PostgreSQL 17 impose un Docker local, sans réseau ni port publié. Elle charge exactement les lignes du catalogue Anime/Manga dans le conteneur jetable, ajoute des joueurs entièrement synthétiques et des cartes témoins des autres catégories, compare les empreintes complètes avant/après, puis supprime son propre conteneur. Les collections réelles ne sont pas clonées.

Les tests couvrent Tokyo Ghoul, une source partagée entre manuel et AniList, les origines inconnues, les liens secondaires, un média absent, la décision sur une suite majeure, les saisons futures, les règles non approuvées, l'invalidation des preuves après modification, les droits et le rollback. La suite complète est exécutée dans GitHub Actions ; aucun test existant n'est affaibli.

La validation visuelle reste **bloquée et non vérifiée** : computer-use Windows a interrompu sa première action Chrome faute de pouvoir déterminer l'URL avec certitude, malgré une configuration locale explicite lors du précédent essai. Aucun nouveau mécanisme d'interface n'a contourné cet arrêt. Cette branche n'intègre pas encore les nouvelles clés aux écrans ; elle ne prétend donc pas avoir validé les profils, favoris, recherche ou progression du nouveau modèle dans le navigateur.

## Révision éditoriale V2

La V1 reste reproductible sans option nouvelle. `--review-v2 --baseline-v1 /local/v1/mapping_anime_manga.json` sélectionne la révision ; la référence V1 est obligatoire pour reprendre les identifiants de classeurs déjà publiés. Les résultats V2 s’écrivent dans un dossier distinct : ne jamais écraser les exports V1.

Les fichiers `data/editorial/anime-series-v2-*.json` contiennent uniquement des identifiants et métadonnées de médias publics, des décisions individuelles et leurs sources. La revue couvre chaque relation B de la V1, puis une passe supplémentaire des relations TV directes qui restaient séparées. Une relation SEQUEL/PREQUEL, un format ONA/OVA/SPECIAL ou un film ne déclenche plus un classement B général. Chaque paire a un résultat explicite, un motif et les identités vérifiées. Les listes de médias des groupes historiques et lexicaux sont explicites ; aucun titre proche n’est converti en règle de production.

Les décisions C et les vrais cas B interdisent aussi les ponts indirects. Deux groupes explicitement distincts ne peuvent pas être réunis par un ancien libellé physique partagé. Ce contrôle protège notamment les adaptations originales/remakes, les spin-offs, les croisements Conan/Lupin et les deux séries Tokyo Ghoul. Les décisions du propriétaire réunissent les chapitres narratifs Fate/Grand Order, Mononoke TV/films et GREAT PRETENDER/razbliuto. Les parodies FGO et les autres branches Fate restent distinctes.

La V2 peut projeter une séparation d’un libellé historique mal regroupé ou une correction de son seul nom affiché. Les cartes manuelles et incertaines restent dans leur espace source, même lorsque le texte affiché correspond à celui du nouveau classeur. Les anciennes sources, liens secondaires et métadonnées ne sont pas réécrits. Les identifiants V1 repris restent stables ; lorsqu’un fragment V1 est absorbé par un autre classeur de la même série, un export privé de correspondance documente les identifiants absorbés. Une future intégration des favoris devra utiliser cette correspondance et conserver les préférences brutes.

Pour la recette V2, ajouter `--protected-cards /local/v1/manual_imports_protected.csv` à `rehearse-anime-series.mjs`. Le test compare alors, pour chaque carte protégée, tous les liens, noms affichés et clés de classeurs aux valeurs indépendantes du snapshot. Les comptages de chaque classeur utilisent des ensembles d’UUID distincts, et les empreintes complètes des tables restent identiques après installation, simulation et rollback. Le conteneur n’a ni réseau ni port publié. Sa connexion PostgreSQL utilise explicitement le loopback TCP interne pour attendre le serveur définitif après initdb.

Les CSV privés V2 comprennent les revues B/TV, les libellés historiques, les variantes lexicales, les conflits de l’ancien mapping, les titres sources et médias exacts, les cartes concernées, l’inventaire de fragmentation, les faux positifs et la comparaison V1/V2 par média et par carte. Le cas restant sans preuve de continuité conserve son rangement source. Aucun favori n’est réinitialisé et les indicateurs d’approbation/activation du manifeste restent faux.

Cette V2 demeure une livraison d’audit et de recette : aucun nouvel écran ou branchement client n’est ajouté. Les tests visuels du modèle et son intégration aux profils, recherche, filtres et favoris restent à réaliser avant une demande d’activation. Les contrôles CI complets sont exécutés exclusivement dans GitHub Actions.

## V3 : comparaison exhaustive des noms du catalogue

`anime-license-name-index.mjs` découvre les candidats avec des index, sans décider de leur appartenance à une série. La fonction reçoit toutes les licences physiques, y compris celles qui ne contiennent que des cartes protégées ou des liens secondaires. Elle utilise :

- Unicode NFKC, casse, ponctuation et espaces, avec conservation des écritures non latines ; les textes sources ne sont pas modifiés.
- Un trie de préfixes **par mots entiers** des noms sources et des titres anglais/romaji de leurs médias connus. `Naruto` n’est pas le préfixe par mot de `Narutoland`.
- Des index de noms compacts et de bases de saisons/parties, ainsi que les équivalences exactes de titres d’un même média. Les synonymes API sont limités à l’index d’égalité ; les abréviations ne deviennent pas des préfixes de franchise.
- Des listes de trigrammes avec une borne de recouvrement et une distance d’édition calculée sur une bande. Le moteur n’énumère pas toutes les paires de licences. Les petites distances restent des candidats, y compris les faux positifs comme Black Bullet/Black Butler.

La complexité de la construction du trie est proportionnelle au volume de titres indexés, puis aux appartenances de groupes émises. La recherche orthographique dépend des listes de trigrammes visitées et des distances candidates, pas d’une matrice complète de toutes les licences. Les métriques exportent ces deux coûts, le nombre de vérifications de distance et la taille théorique d’une matrice exhaustive. Le résultat exhaustif est défini par ces critères déclarés ; il ne prétend pas détecter tous les surnoms ou traductions non documentés.

`anime-series-v3-groups.json` contient les seuls groupes supplémentaires explicitement examinés : identifiants exacts, formats, titres, preuves et motifs. Certaines saisons étaient séparées en V2 parce qu’un OVA ou une saison intermédiaire n’avait pas de carte éligible dans le catalogue ; le cache de relations et les sources officielles permettent de confirmer le projet complet. Le graphe sert de preuve locale, jamais de règle d’union générale. L’exception V2 sur les deux Gaiden est corrigée explicitement avec les ID 3371 et 3665, sans absorber la série principale ni Die Neue These.

La V3 conserve la V2 comme référence immuable, reprend les identifiants existants lorsque possible et fournit la correspondance des fragments absorbés. Elle interdit encore les frontières V2, les croisements indirects et toutes les grandes séries Yu-Gi-Oh!. Le propriétaire a reconfirmé Tokyo Ghoul/Tokyo Ghoul:re. Les parties majeures JoJo restent distinctes ; dans le catalogue audité, leurs cartes sont manuelles et ne reçoivent aucune association AniList ni modification de présentation. Les changements et leur validation ne réécrivent aucun titre source.

Reproduction, avec dossiers locaux privés séparés :

```powershell
node scripts/audit-anime-series.mjs --snapshot /local/v3/catalogue.json --import-csv data/characters_clean.csv --import-state data/etat_scraping.json --media-cache /local/media-cache.json --normalized-titles /local/normalized.json --baseline-v2 /local/v2/mapping_anime_manga.json --review-v3 --output /local/v3
node scripts/audit-anime-license-names.mjs --snapshot /local/v3/catalogue.json --matches /local/v3/anilist_matches.csv --media-cache /local/media-cache.json --mapping-v2 /local/v2-on-same-snapshot/mapping_anime_manga.json --mapping-v3 /local/v3/mapping_anime_manga.json --output /local/v3
node scripts/rehearse-anime-series.mjs --snapshot /local/v3/catalogue.json --mapping /local/v3/mapping_anime_manga.json --protected-cards /local/v2/manual_imports_protected.csv --report /local/v3/staging-postgres.json
node --test tests/anime-series-audit.test.mjs tests/anime-series-v2.test.mjs tests/anime-series-v3.test.mjs
```

La comparaison V2/V3 utilise un nouvel instantané de production lu dans une transaction READ ONLY puis ROLLBACK. Le même instantané est rejoué pour les deux versions. La recette PostgreSQL reste jetable, locale et sans réseau. Les exports couvrent tous les noms, les groupes de préfixes et leurs membres, les alias documentés, les exclusions, les propositions, les conflits V2 et les liens d’affichage protégés. Une licence sans candidat est explicitement inventoriée, pas oubliée. Aucun export de carte ni de joueur réel n’est publié dans GitHub.

La V3 est une préparation pour validation. Aucun favori n’est réinitialisé et aucune migration ni activation n’est autorisée en production. Elle n’ajoute aucun écran et ne valide pas encore le comportement visuel d’un client utilisant les nouvelles clés.

La recherche de titre contenu utilise aussi un automate Aho-Corasick sur les mots des noms sources. Il retrouve notamment les noms principaux précédés d’un qualificatif de sortie ou de saison, sans comparer chaque licence à toutes les autres. Les seuls rapprochements textuels ne deviennent toujours pas des preuves d’identité.

## Dernière revue de qualité V3

La V3 d'origine reste immuable. Une revue ciblée reprend les 60 classeurs multi-médias/sources les plus volumineux, les 20 ensembles restants avec le plus de médias, puis 20 cas de risque ou choix éditoriaux explicites. Le tableau privé de 100 groupes comporte les noms sources exacts, médias, cibles et justifications individuelles, avec un détail normalisé par média/source. Il distingue les identités éligibles des simples candidats inéligibles : une carte protégée n'est jamais réattribuée à partir d'un candidat d'import.

Le contrôle de continuité exploite les relations déjà collectées. La passe finale parcourt les saisons représentées et leurs médias intermédiaires sans carte éligible, sans limite arbitraire de profondeur, et s'arrête à la première série représentée distincte. Chaque frontière trouvée reçoit une justification ; ce parcours ne forme aucune nouvelle union de franchise. Les libellés historiques multi-médias et les relations internes ALTERNATIVE/SPIN_OFF/CHARACTER/OTHER sont contrôlés séparément. Les preuves inconnues ne sont pas inventées pour les médias absents : un futur import devra apporter sa provenance et passer en revue.

Deux rapprochements sont corrigés dans un candidat séparé : le spécial de la comédie lycéenne ONE PIECE in LOVE ne relève pas de la série de pirates ; la nouvelle série TV RILAKKUMA ne constitue pas une saison des productions Netflix en stop-motion. Les preuves officielles et les corrections de noms sont conservées dans `anime-series-v3-quality-amendments.json`. Le propriétaire a confirmé le classeur unique Galaxy Express 999 pour la TV et le cycle cinéma ; cette exception est conservée explicitement.

`applyQualityAmendments(mapping, amendments, protectedCardIds)` dans `scripts/anime-series-quality-decisions.mjs` est une préparation pure, sans connexion ni écriture de base. Elle exige la liste explicite des cartes protégées, conserve toutes les preuves et licences sources, refuse une dérive de la base ou une approbation/activation, et garde les clés des identités retenues. Une réapplication sur le candidat échoue au lieu de produire un nouveau changement silencieux. Les tests synthétiques vérifient ces refus, les séparations exactes et la conservation des identités.

Le candidat et la recette restent désactivés et non approuvés. Aucun favori n'est réinitialisé. Le [plan d'intégration](anime-series-integration-plan.md) détaille les contrats par clé stable, les RPC et droits, la recherche, les filtres, les favoris, la progression, les profils, les imports, la recette visuelle requise et le rollback. Il ne branche pas encore le client sur le nouveau modèle.
