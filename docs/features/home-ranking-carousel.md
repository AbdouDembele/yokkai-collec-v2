# Classements tournants sur l’accueil — local

Le bloc alterne PowerRanking, J’aime des profils et Licences toutes les cinq secondes. Les onglets permettent de choisir une vue ; aucun bouton pause ni commande en bas. Le lien Voir le classement ouvre directement la vue correspondante via `/leaderboard?ranking=likes` ou `licenses`.

Le PowerRanking reste rendu par le serveur. Les deux autres vues utilisent leurs lecteurs SQL existants, limités à six joueurs, à la première arrivée du bloc dans la zone visible. Une lecture par vue et montage est partagée entre les cycles, sans polling. Une erreur reste limitée à sa vue, avec relance manuelle. Les styles autorisés des joueurs sont conservés.

Les onglets portent les icônes trophée, cœur et livre ; cœur et livre sont aussi utilisés dans les encarts personnels de leurs pages de classement. Le podium utilise des accents or, argent et bronze et des avatars plus grands. Sur ordinateur, podium et joueurs suivants se présentent côte à côte. Sur mobile, le premier joueur précède les deux autres marches.

Le cadre conserve la même hauteur entre les trois vues, adaptée à l’écran, avec défilement interne si nécessaire. Les sections suivantes du Home ne se déplacent donc pas à chaque cycle. Les vues inactives restent inertes et cachées aux technologies d’assistance. La rotation se suspend au survol, au focus, hors écran, quand l’onglet est masqué ou lorsqu’un aperçu joueur est ouvert. Les préférences de mouvement réduit désactivent la rotation et l’animation, sans empêcher la navigation manuelle.

Un clic normal sur un joueur ouvre le profil compact existant ; les clics modifiés conservent la navigation native. Une vue vide de J’aime propose de découvrir la communauté. Tous les textes joueur sont dans les catalogues EN/FR.

Les cinq améliorations complémentaires et leur migration sont détaillées dans [ranking-improvements.md](ranking-improvements.md). La migration d’historique est appliquée uniquement à Supabase local, pas au VPS. Les règles de calcul des scores sont conservées.

Recette locale FR/EN : trois vues, cycle de cinq secondes, commandes clavier, aperçu sans changement de route, retours de focus, mouvement réduit, erreurs et relance, données synthétiques de likes limitées au navigateur de test, largeurs 320/375/600/768/1024/1440/720. Zoom CSS à 200 % contrôlé ; zoom natif à 200 % non vérifié. Le test existant `i18n-home-ranking` reste inchangé. Le remplacement de l’intervalle attendu de 8000 par 5000 ms dans `home-ranking-carousel-data` a été validé par Walid et doit être signalé dans la description de la PR #15.
