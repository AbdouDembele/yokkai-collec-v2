# CI GitHub Actions — réactivation du 14/10/2026

Le dépôt étant désormais public, la CI automatique est réactivée pour les Pull
Requests ciblant `master` et les pushes sur `master`. Le lancement manuel reste
disponible avec `workflow_dispatch`.

Les contrôles locaux complets sont facultatifs. Aucune PR mergée sans CI GitHub Actions verte sur la branche à jour avec origin/master. Le hook pre-push bloque uniquement les pushes directs sur master.

## Budget historique — 12/10/2026

## Changements

- Concurrency et `cancel-in-progress: true` étaient déjà présents : conservés, testés. Les nouveaux pushes d’une même PR annulent l’exécution précédente.
- Cache npm via setup-node était déjà actif sur les quatre jobs : conservé.
- Le job checks calcule le diff complet base…head de la PR (pas seulement le dernier commit). PostgreSQL17 et les50 surenchères concurrentes ne démarrent que pour migrations, scripts ou tests SQL ; chaque push master les exécute toujours.
- Les tests SQL sont reconnus par les chemins -db, postgres17, migration-security, SECURITY DEFINER, drop-rates, fichiers .sql, et les sources utilisant replayMigrations/bootstrapSQL/PGlite. Pour une suppression, le contenu est lu depuis la base Git. Un diff impossible ou des SHA invalides font échouer le contrôle ; aucune désactivation silencieuse.
- `.next/cache` est persisté avec une clé OS/Node22/lockfile/sources et repli sur la même version de dépendances. Cache de compilation uniquement, pas de remplacement du build ni des tests.

Le filtre est exécuté dans checks : aucun cinquième runner facturé. PostgreSQL17 dépend donc de checks et attend sa fin ; il tourne sur master même si checks échoue (sauf annulation du run), et sur une PR SQL dont le filtre a réussi. Compromis : jusqu’à88 secondes de latence supplémentaire, pas de hausse du temps runner PostgreSQL lui-même. Lint, tsc, format, tous les tests, audit prod, rejeu PGlite et build restent inchangés.

## Estimation des minutes consommées

Référence verte : run38173772862, 11/10/2026, durées GitHub started_at/completed_at. Les minutes facturées sont arrondies par job ; elles ne sont pas le temps mural du workflow parallèle.

| Job                      | Durée observée | Minutes arrondies |
| ------------------------ | -------------- | ----------------- |
| Audit prod               | 30 s           | 1                 |
| PostgreSQL17/concurrence | 88 s           | 2                 |
| checks                   | 458 s          | 8                 |
| migration-security       | 35 s           | 1                 |
| Total                    | 611 s runner   | 12                |

| Cas                                   | Avant  | Après estimé |
| ------------------------------------- | ------ | ------------ |
| PR uniquement front/docs/tests client | 12 min | 10–11 min    |
| PR SQL/scripts                        | 12 min | 12–13 min    |
| Push master                           | 12 min | 12–13 min    |

La fourchette tient compte du fetch de l’historique, de la restauration/sauvegarde du cache et de l’arrondi. Le cache Next pourrait économiser environ0–15 secondes sur le build de33 secondes, pas plusieurs minutes ; aucune économie supplémentaire revendiquée pour npm/concurrency déjà en place. À mesurer après rétablissement de la CI. Exemple10 PR front +10 merges master :240 minutes avant, environ220–240 après selon caches et arrondis. Tests de filtre verts localement, CI indisponible : ne pas merger avant CI verte.

Références : [Next.js CI Build Caching](https://nextjs.org/docs/pages/guides/ci-build-caching), [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
