# Correction du chargement des classeurs avec favoris historiques

Le chargement connecté pouvait dépasser la limite SQL de huit secondes, alors que les requêtes publiques et un compte synthétique ayant un seul favori passaient. Les journaux PostgREST ont confirmé le code `57014` dans `get_binder_albums_page`, puis les mesures en lecture seule ont localisé les répétitions dans `legacy_binder_targets`.

Les fonctions de favoris appelaient ce résolveur pour chaque ancien favori. Un compte contenant 51 favoris pouvait donc relire plusieurs dizaines de fois la projection complète du catalogue. La migration `20261025050000_batch_legacy_binder_favorites` remplace cette boucle implicite par un traitement groupé : règles de licences exactes en premier, puis une seule projection pour les noms et alias restant à résoudre. Le calcul des conflits ne lit les compteurs que lorsqu'il existe réellement plusieurs cibles.

Les cartes, licences, mapping, favoris enregistrés et choix explicites ne changent pas. Le résolveur groupé reste privé ; les droits des RPC exposés restent identiques. Aucun délai SQL n'est augmenté. Les règles de séparation éditoriale ne sont pas modifiées.

Le test de régression compare les résultats avant et après correction : 51 favoris, alias communs à plusieurs classeurs, licences secondaires partagées entre catégories, titres absents, choix positifs et négatifs, résolutions déjà faites et mode historique après désactivation du regroupement. Il vérifie aussi les données intactes et l'interdiction d'accès direct au résolveur privé pour les rôles joueurs et service.

La recette complète ajoute un scénario de 51 favoris synthétiques sur tout le catalogue, sans filtre, avec recherche et en favoris seuls. Chaque requête utilise le rôle `authenticated` et la limite inchangée de huit secondes. Les insertions de cette fixture restent dans une transaction terminée par `ROLLBACK` ; aucune préférence réelle n'est utilisée pour un test d'écriture.
