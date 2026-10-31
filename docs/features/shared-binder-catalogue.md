# Lecture partagée du catalogue des classeurs

Après le déploiement de la PR #15, le plan réel du VPS montre un second parcours complet des liens canoniques dans le calcul de popularité. La lecture des 72 classeurs doit traiter environ 83 000 associations deux fois.

Le lecteur partage maintenant son catalogue matérialisé entre les compteurs personnels, les couvertures et les votes communautaires. Les titres ambigus de la communauté sont toujours résolus sur tout le catalogue, même si la page affiche une seule catégorie. Les visites du classeur d'un autre joueur ne lisent pas ses votes comme ceux du demandeur. Les droits, les préférences explicites, les anciennes préférences et les conflits restent inchangés.

Aucun cache, index supplémentaire ou relèvement global de mémoire. Signature, volatilité, SECURITY DEFINER, search_path et privilèges conservés. Aucun test existant modifié ; nouveau test d'équivalence avant/après et rollback sur les filtres, homonymes, fusions, propriétaires et profils privés.

## Mesure préparatoire sur le VPS

Même transaction read-only en isolation repeatable read, trois lectures avant/après, résultats JSON strictement égaux. Médianes : 2 234,63 ms avant et 1 366,47 ms pour le candidat SELECT, soit environ 39 % de moins. Ce candidat est exécuté sans modifier la fonction en production. La mesure du lecteur réellement livré reste à faire après CI et déploiement. Ce n'est pas un test de charge simultanée.

Migration : 20261031130000_shared_binder_catalogue.sql, pas encore appliquée au VPS. Retour arrière : docs/rollback/shared-binder-catalogue.sql.
