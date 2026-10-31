# Audit de performance du lot Classeurs / Classements — 31 octobre 2026

## Périmètre et état

Revue des changements de la PR brouillon #15 : découverte des classeurs, popularité et couvertures, progression après ouverture, classements et recherche A–Z, historique des rangs, carrousel Home et annonce des nouveautés. Travail enregistré localement, sans push ni déploiement dans cette phase.

Migration supplémentaire : `20261031120000_pending_features_performance.sql`, appliquée uniquement à Supabase local Kara, **pas au VPS**. Retour arrière : [pending-features-performance.sql](../rollback/pending-features-performance.sql). Les migrations antérieures du lot restent à déployer ensemble dans leur ordre, après CI GitHub verte et coordination SQL.

## Corrections retenues

- Catalogue : la comparaison avec le snapshot de preuve relit la carte par sa clé primaire seulement si la preuve est évaluée. Toutes les colonnes de la carte ne traversent plus les jointures de la vue. Le contrôle de snapshot, dont l’exclusion du compteur de favoris, reste identique.
- Classeurs : suppression d’un DISTINCT sur la ligne complète, déjà rendu redondant par les agrégats qui dédupliquent les identités. Les favoris, conflits, catégories, couvertures, ordre et pagination restent inchangés.
- Classement par licence : restriction aux cartes candidates avant le contrôle exact du lien canonique. Les règles de source, preuves de média, fusions par clé et fusions par association sont conservées. La restriction inclut explicitement les anciennes clés source sans source_license enregistrée.
- Classement global : réutilisation de la rareté de base déjà jointe aux identités possédées, suppression d’un second accès au catalogue et d’une déduplication redondante. Formule v2, variantes, doublons, égalités et total des licences conservés.
- Historique : insertion de la page en une commande puis projection groupée des observations. Mêmes identités autorisées, même référence à sept jours, huit observations au maximum et rétention de 35 jours. Aucun nouveau droit SQL.
- Navigateur : annulation des lectures de classement remplacées par un nouveau filtre ou un démontage, avec conservation du délai maximal existant ; une réponse obsolète n’est pas affichée.
- Home : regroupement des invalidations en une seule lecture simultanée et une relance fraîche si nécessaire ; pas de rafale concurrente. Le carrousel réutilise ses résultats lors des changements de visibilité.
- Packs : les métadonnées de classeur déjà reçues à l’ouverture sont réutilisées. Les compteurs de possession sont toujours relus à chaque ouverture ; aucun cache de progression périmé. L’enrichissement de secours reste disponible si l’ancien serveur ne renvoie pas les métadonnées.

## Mesures SQL locales

Catalogue local : 82 557 cartes et 82 988 liens. Production consultée en lecture seule pour vérifier les volumes et index : environ 88 951 exemplaires et 414 profils selon pg_stat_user_tables (estimations, pas un décompte contractuel).

Simulation locale transactionnelle : 400 comptes synthétiques, 90 483 exemplaires au total et 408 joueurs possédant une carte. Trois lectures séquentielles par cas et version, mêmes données ; médianes ci-dessous. Les résultats JSON avant/après sont comparés exactement. Toutes les données synthétiques et modifications de référence sont annulées par ROLLBACK.

| Lecture                                |    Avant |    Après | Réduction |
| -------------------------------------- | -------: | -------: | --------: |
| Licences global, 6 joueurs             | 1 292 ms | 1 050 ms |      19 % |
| Liste de 72 classeurs avec couvertures |   870 ms |   816 ms |       6 % |
| Classement Naruto                      |   425 ms |    68 ms |      84 % |

Les premières mesures exploratoires du sélecteur A–Z passent d’environ 762 à 575 ms sur le catalogue sans données synthétiques ; ce n’est pas la médiane du scénario ci-dessus. La suppression des appels répétés réduit aussi le coût total par parcours, au-delà du temps de chaque lecteur.

Limites : ces mesures portent sur PostgreSQL local, avec des lectures séquentielles. Elles ne représentent ni une charge de connexions simultanées, ni les latences réseau du VPS. Le global Licences reste la lecture la plus coûteuse (environ une seconde dans cette simulation). Une mesure après livraison devra confirmer le comportement réel ; aucun cache partagé de résultats personnalisés ou de confidentialité n’est ajouté.

## Vérifications

- Équivalence de tous les 82 988 liens du catalogue, sans différence, et des sorties des lecteurs testés avant/après.
- Contrats SQL inchangés : signatures, SECURITY DEFINER, volatilité, search_path et ACL. Aucune table, fonction ou permission accessible supplémentaire.
- Nouveaux tests uniquement : migration/rollback avec fusion primaire-secondaire et homonymes de catégories ; annulation et délai des requêtes ; absence d’enrichissement redondant ; regroupement des invalidations sans affichage obsolète. Aucun test existant modifié.
- Tests existants des classements, historique, confidentialité, égalités, licences secondaires, preuves, favoris, couvertures, recherche et sécurité des migrations rejoués avec succès.
- Compilation webpack de production et TypeScript réussis dans une copie locale isolée, pour conserver le serveur de développement.
- Parcours de navigation et comptage des appels vérifiés sur la compilation de production locale : classement, sélection de licence, quatre onglets, Collection/classeurs et Home. Les rotations du carrousel ne déclenchent aucune nouvelle lecture de classement.
- Vérification des débordements de 320 à 1440 px et à zoom CSS 200 %. Zoom natif du navigateur à 200 % non vérifié. Aucune ouverture de pack ni message envoyé dans ces parcours.

La CI complète reste exclusivement exécutée par GitHub Actions au prochain push. Ces contrôles locaux ne la remplacent pas. Aucune affirmation d’absence absolue de latence en production.
