# Navigation et cache — 3 novembre 2026

Cette livraison réduit le travail répété pendant la navigation et accélère le classement des collections. Elle ne met aucun HTML authentifié, solde, droit Pro ou résultat RPC en cache public.

## Changements

- Les illustrations publiques explicitement listées sous `/assets/` bénéficient du même cache HTTP borné d’une heure que les sons. Aucun `immutable` : les noms ne sont pas tous versionnés. Les en-têtes de sécurité sont conservés. Une URL inexistante ne reçoit pas cette règle publique, afin de ne pas cacher une page d’erreur personnalisée.
- Les lecteurs serveur du pseudo et du solde peuvent partager leur lecture `get_game_info` lorsqu’ils utilisent le même client pendant un rendu React. Ce cache est détruit entre requêtes et ne remplace jamais la vérification Auth. Un client explicitement fourni reste respecté.
- La présence garde son délai de 30 secondes entre les pages ordinaires, au lieu de redémarrer à chaque navigation. Elle reste suspendue lorsque la page est masquée.
- Les notices de sanction conservent une seule souscription et un seul polling de 30 secondes pendant la navigation. Une requête reste seule en vol et les changements de compte invalident les anciennes réponses. Seul un acquittement confirmé par le serveur ferme une notice.
- Le statut et le style Pro de présentation sont vérifiés toutes les deux minutes lorsque la page est visible, et immédiatement lors du retour au premier plan, du retour en ligne ou d’une modification du style. Chaque mutation conserve sa vérification indépendante côté serveur. Le statut peut donc rester affiché jusqu’à deux minutes avant de refléter une modification administrative faite dans un autre navigateur.
- Le classement évite deux grosses matérialisations des variantes de collection. Le calcul des points, les égalités, les recherches, les restrictions d’accès, les cosmétiques et l’historique restent inchangés. Aucun changement global de mémoire PostgreSQL.

## Mesures

Les trois paires en lecture seule sont enregistrées dans [ranking-evidence.json](performance-phase3/ranking-evidence.json). L’ordre avant/après est alterné ; le JSON complet a été comparé sur un même snapshot et reste identique.

| Mesure SQL                  |    Avant |  Après |
| --------------------------- | -------: | -----: |
| Médiane de trois exécutions | 1 187 ms | 746 ms |
| Blocs temporaires écrits    |    4 717 |  1 670 |

Cela représente environ 37 % de temps SQL et 65 % de blocs temporaires en moins sur cet échantillon. Ce n’est pas une mesure de navigation connectée de bout en bout, ni un p95 en heure de pointe.

Les essais sur les classeurs n’ont pas produit un gain suffisamment reproductible : aucune réécriture spéculative de leur logique ni augmentation globale de mémoire n’est incluse. Leur coût reste un point à suivre après la réduction de charge de cette livraison.

## Validation et déploiement

Les nouveaux tests comparent les projections complètes du classement avant/après (standard, Shiny, Infinity, doublons, égalités, recherche, amis et profil privé), vérifient les changements immédiats de collection et les ACL. Les scénarios client vérifient le changement de session, le cache privé, la présence et les rafales de lectures des notices. Les tests existants restent inchangés.

Aucune structure HTML, règle CSS ni taille d’image n’est modifiée ; les tests de rendu des notices et de présentation restent applicables. Il n’y a pas de nouvelle interface nécessitant une adaptation responsive.

Migration : `20261103020000_stream_collection_ranking.sql`. Appliquer après CI verte, coordination SQL et sauvegarde validée. Elle remplace uniquement le corps d’une fonction privée existante et conserve ses droits. L’application reste compatible avant comme après cette migration.

Après déploiement : vérifier le commit réellement exécuté, l’état du schéma, les réponses HTTP privées, les en-têtes des illustrations publiques et le temps SQL de la fonction complète. Le taux global de cache Cloudflare inclut des requêtes personnalisées non cachables ; il ne constitue pas à lui seul un objectif de performance.
