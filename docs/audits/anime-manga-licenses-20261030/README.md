# Audit V3 du tri des licences ANIME/MANGA — sans application

Le nettoyage reste en attente. Cette synthèse conserve le résultat de l'audit V3 demandé avant toute opération destructive. Aucun SQL de nettoyage, migration ni déploiement n'est inclus dans cette PR.

## Décisions intégrées

- Le fichier comporte désormais 80 KEEP, 137 MERGE et 1 588 DELETE. Seule la décision expressément autorisée pour Aria AA remplace DELETE par MERGE vers Aria the Scarlet Ammo.
- Le regroupement Aria demandé est déjà satisfait par l'identité stable actuelle ; les six cartes sont préservées, sans association dupliquée à créer.
- DELETE inclut les cartes catalogue exactement identifiées, leurs exemplaires possédés et leurs dépendances nécessaires. Les cartes KEEP/MERGE restent protégées.
- Les enchères actives doivent être arrêtées proprement ; toute présence de séquestre impose d'exclure et de signaler le cas. Les historiques doivent être préservés.
- Les échanges pending concernés peuvent être annulés. Les choix de packs peuvent être retirés uniquement si chaque pack actif conserve une récompense valide.
- Les références wishlist et de bannière autorisées peuvent être retirées. Les références de vitrine doivent préserver les profils et les autres cartes.
- Aucun fichier image ni objet Storage ne doit être supprimé.

## Résultat V3

Les correspondances physiques exactes ont été distinguées des classeurs parents afin de ne pas élargir le périmètre par simple nom de licence. Le jeu de candidats résolus a été figé par IDs et ne recoupe aucune carte KEEP/MERGE résolue. Ces contrôles restent une photographie d'une production active et devront être répétés sous verrou avant toute application.

Huit sources restent non résolues ; 89 lignes MERGE correspondent à 27 noms de cible non validés. Ces lignes restent SKIP + REPORT. Aucune proposition d'alias n'est transformée en décision utilisateur.

Parmi les fusions exactes, certaines sont déjà satisfaites ; d'autres concernent un classeur entier ou seulement une association au sein d'un parent plus large. Leurs mappings et le rollback sélectif restent à préparer et à répéter, sans déplacer de cartes hors périmètre.

Les contrôles de séquestre et de récompenses pending passent à la capture V3. Une vérification supplémentaire a détecté des vitrines référençant des IDs d'exemplaires plutôt que des IDs catalogue ; ces dépendances sont documentées dans le rapport privé.

## Sauvegarde et restauration

Une sauvegarde cohérente de la base entière remplace la sauvegarde ciblée insuffisante de V1. L'archive reste privée sur le VPS et couvre le schéma, les données et les dépendances, ainsi que les métadonnées Storage. Les fichiers binaires Storage restent intacts et hors du dump SQL.

Une restauration SQL réelle a réussi dans un conteneur isolé, sans réseau ni port publié, avec les tâches planifiées désactivées. Tous les compteurs de contrôle correspondent au même snapshot source. Le clone jetable a été supprimé.

Cette restauration valide l'exploitabilité du dump. Elle ne vaut pas encore répétition de l'application du nettoyage et de son rollback sélectif ; le lot n'est donc pas déclaré exécutable.

## Livrables privés et reprise

RAPPORT-LICENCES-SUPPRESSION-CARTES-V3.md, la copie Excel V3 et les CSV de correspondances/IDs restent dans les livrables locaux hors Git. Le fichier Excel original n'est pas écrasé. Aucun identifiant de carte, détail de possession, lien d'image, snapshot brut, archive ou secret n'est publié dans cette PR.

Les prochaines étapes sont de valider les correspondances restantes ou leur exclusion explicite, de préparer les mappings et la transaction contrôlée, puis de répéter l'application et le retour arrière sur une restauration isolée. Toute application future nécessite un nouvel impact, les assertions critiques et la coordination SQL de docs/COLLABORATION.md.

La PR #15 des fonctionnalités de classeurs reste séparée, en brouillon et sans déploiement.
