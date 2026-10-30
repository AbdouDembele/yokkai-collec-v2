# Score de complétion des licences — local

Le classement global Licences compare désormais :

1. Le score de complétion, décroissant.
2. Le nombre de licences terminées, décroissant.

Si les deux valeurs sont égales, les joueurs partagent le même rang. Le pseudo et l’identifiant stabilisent uniquement l’ordre d’affichage. Le nombre de cartes distinctes ne départage plus ce nouveau mode.

## Calcul

Le calcul repose sur la collection actuelle et les associations actuelles du catalogue. Un classeur est terminé uniquement si le joueur possède encore chacune de ses cartes distinctes.

Pour chaque joueur, on rassemble les cartes de tous ses classeurs terminés, puis on déduplique par identifiant de carte. Chaque carte de cet ensemble rapporte les points de sa rareté de base :

| Rareté | Points |
| ------ | -----: |
| C      |      1 |
| R      |      2 |
| SR     |      4 |
| SSR    |      8 |
| LR     |     15 |

Une carte présente dans plusieurs classeurs terminés ne rapporte qu’une fois ses points. Les exemplaires supplémentaires et les variantes Shiny/Infinity n’ajoutent aucun bonus. Les cartes d’un classeur incomplet ne rapportent rien dans ce score, sauf si elles appartiennent aussi à un autre classeur terminé. Les changements de catalogue, transferts et suppressions sont pris en compte à la lecture suivante.

Exemple testé : C + R + SR + SSR + LR = 30 points. Une seconde licence contenant exactement ces cinq mêmes cartes augmente le nombre de licences terminées mais n’ajoute aucun point. Trois licences d’une carte C rapportent trois points.

## Interface et compatibilité

La page Classements et le carrousel du Home utilisent `global:completion-score` (ou le suffixe `:legacy` si les classeurs stables sont désactivés). Ils affichent deux mesures : score de complétion et licences terminées / total du catalogue. Les règles et les poids sont expliqués en EN/FR sur la page.

Les modes SQL `global:overall`, `global:completed`, `global:cards` et le classement par licence conservent leurs contrats. Les styles, protections de confidentialité, blocages bilatéraux, gardes de compte et limites de pagination sont conservés. Aucune nouvelle signature ni aucun nouveau droit SQL.

L’historique du nouveau score utilise une clé distincte `licenses:completion-score:v1`, séparée de l’ancien classement, avec un suffixe distinct pour le mode legacy. Aucune variation de rang entre les deux formules n’est affichée. Les observations existantes sont conservées.

## Migration et validation

- `20261031010000_license_completion_score.sql` : appliquée uniquement à Supabase local, **pas au VPS**.
- Dépend de `20261030233000_ranking_navigation_and_history.sql` ; appliquer les migrations avant l’application lors d’un futur déploiement.
- Retour arrière : restaurer l’application précédente, puis `docs/rollback/license-completion-score.sql`. Validé en transaction locale annulée ; il conserve les observations, retire uniquement le nouveau mode et laisse les lecteurs précédents utilisables.
- Adaptation produit validée par Walid : dans `tests/home-ranking-carousel-data.test.mjs`, les deux identifiants de mode attendus deviennent `global:completion-score` et `global:completion-score:legacy`. Toutes les autres assertions restent intactes. À signaler explicitement dans la description de la PR #15.
- Nouveaux tests SQL : poids exacts, union des cartes de licences terminées, doublons et variantes, grands/petits classeurs, départage et ex æquo, perte de carte, évolution du catalogue, modes stable/legacy, pagination, amis, profils privés/bloqués/bannis/supprimés, historique séparé et droits existants.
- Nouveaux tests d’interface : score + compteur de licences, pluriels EN/FR et compatibilité des anciennes mesures. Tests existants des modes globaux et par licence conservés.
- Recette navigateur locale FR/EN sur la page et le Home : valeurs réelles de la base locale, règles de pondération, mode par licence inchangé, largeurs 320/375/600/768/1024/1440/720 et zoom CSS à 200 %. Zoom natif à 200 % non vérifié.
- Aucun push ni déploiement en production dans cette tâche ; CI complète réservée à GitHub Actions.
