# Licences : le choix filtre le classement principal — local

La page Licences conserve une seule liste de joueurs. Sans licence choisie, elle affiche le score global pondéré par rareté. Le choix d’une licence dans le menu filtre cette liste, la progression personnelle, les objectifs et les règles. La couverture et le titre de la licence accompagnent la progression personnelle compacte. Le bouton « Toutes les licences » revient au score global.

La recherche, le choix de catégorie et le menu A–Z restent visibles ; aucune licence n’est sélectionnée automatiquement. La recherche de joueur, Top 100 / Amis et la pagination fonctionnent dans le périmètre choisi. Une nouvelle sélection remet à zéro la recherche de joueur et l’offset, tout en conservant le filtre Amis. Changer de catégorie efface la licence sélectionnée. Les réponses dépassées ne remplacent pas la nouvelle sélection.

Le lecteur SQL protégé existant reçoit la clé exacte du classeur. La liste indique le rang, le pourcentage de complétion et le nombre de cartes distinctes possédées sur le total de la licence. Les ex æquo conservent leur rang commun. Les profils privés, bloqués, supprimés ou bannis suivent les mêmes règles qu’auparavant. Le panneau d’aperçu séparé a été supprimé.

Les avatars et pseudos personnalisés sont conservés ; les profils restent consultables au clic. L’indicateur de mouvement s’affiche seulement pour le compte connecté. Les traductions EN/FR sont incluses.

Recette navigateur locale EN/FR : sélection Dragon Ball avec données réelles, recherche d’un joueur dans cette licence et retour global ; indicateur personnel sur les quatre classements. Largeurs 320/375/768/1024/1440 px et zoom CSS 200 % contrôlés, sans débordement de page. Zoom natif 200 % non vérifié. Les historiques de hausse/baisse ou stabilité utilisés pour la recette restent des réponses simulées dans le navigateur, sans réécrire les observations de joueurs.

Nouveaux tests sur la sélection du classement principal, le filtre Amis, les réponses dépassées, le retour global et les états initiaux EN/FR. Aucun test existant modifié dans ce lot.

Le filtrage de licence n’ajoute aucune migration. La migration associée aux indicateurs, `20261031030000_referral_rank_history.sql`, ajoute l’historique de Parrainages via le helper interne existant : appliquée seulement en local, pas sur le VPS. Retour arrière documenté dans `docs/rollback/referral-rank-history.sql`. Aucun push ni déploiement pour cette itération locale.
