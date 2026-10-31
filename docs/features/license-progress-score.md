# Licences : points dès la première carte — local

Le score v2 additionne la rareté de chaque carte distincte du catalogue actuellement possédée, même si aucun de ses classeurs n’est terminé. Pondération conservée : C = 1, R = 2, SR = 4, SSR = 8, LR = 15.

Une carte partagée entre plusieurs licences compte une fois. Les exemplaires supplémentaires, Shiny et Infinity n’ajoutent aucun bonus. Perdre une carte retire seulement ses points ; ajouter une nouvelle carte au catalogue ne retire pas les points déjà collectés. Le nombre de licences entièrement terminées reste une seconde mesure et départage les scores égaux. Si ces deux valeurs sont égales, le rang est partagé.

Le Home et la page Licences utilisent `global:progress-score` (suffixe `:legacy` si les classeurs stables sont désactivés). Le JSON conserve `metric=completion-score` et expose `scoreVersion=2` pour compatibilité d’affichage. Le mode v1 `global:completion-score` et tous ses tests SQL restent inchangés.

L’historique v2 utilise `licenses:progress-score:v2`, séparé des formules précédentes. Le premier relevé démarre le suivi : aucune flèche ne compare deux formules différentes. Les règles de confidentialité, les blocages, les gardes de compte et les limites de pagination sont inchangés.

Migration `20261031020000_license_progress_score.sql` : appliquée et enregistrée uniquement sur Supabase local, **pas appliquée sur le VPS**. Aucune nouvelle signature ou permission SQL. Sauvegarde locale de la fonction avant application. Le retour arrière `docs/rollback/license-progress-score.sql` a été vérifié en transaction annulée ; restaurer l’application précédente avant ce rollback, qui conserve les observations.

Validation : nouveau test SQL des classeurs incomplets, cinq raretés, alias, copies/variantes, départage, perte de carte, changement de catalogue, confidentialité, pagination, amis, mode legacy, historique séparé et droits. Test v1 conservé et passé. Test de sécurité de toutes les migrations passé.

Modification de test produit validée par Walid dans la conversation : seules les deux clés attendues dans `tests/home-ranking-carousel-data.test.mjs` deviennent `global:progress-score` et `global:progress-score:legacy`. Aucune assertion supprimée ou assouplie. À signaler explicitement dans la description de la PR #15.

Sur le compte local abdou : 135 cartes distinctes, 845 points v2 contre 10 points v1, deux licences terminées. Aucun déploiement demandé.
