# Classement des collections — barème v1

Le classement possède deux présentations qui réutilisent le même composant et le même calcul. La barre principale ouvre `/leaderboard` comme page indépendante, sans titre ni onglets Social ; **Leaderboard** se situe immédiatement après **Catalog**, avant **Admin**, et devient l'entrée active.

Dans Social, **Leaderboard**, après **Friends**, ouvre `/social/leaderboard` en conservant le titre, les onglets et le fournisseur d'état Social. **Social** reste actif dans la barre principale et l'onglet **Leaderboard** est sélectionné. Les liens Next permettent de revenir à Feed, Everyone et Friends dans le même contexte. La collection ne contient pas de bouton de classement.

La clé de `BoostersLoadPriority` reste stable uniquement entre les routes `/social` et `/social/*`, ce qui évite de remonter tout l'arbre, de vider les stores du fil et de refaire disparaître l'onglet Everyone à chaque navigation. Les autres routes conservent leurs frontières de remise à zéro, et le calcul de priorité reçoit toujours le chemin réel, notamment pour `/boosters`.

Un aperçu reste sur la home, directement sous **The market**, après **Big drops**. La home affiche jusqu'à six joueurs : podium compact avec le deuxième à gauche, le premier surélevé au centre, le troisième à droite, puis les autres en lignes. Les médailles respectent les rangs réels, y compris les égalités. Le score personnel et un lien vers le classement complet restent visibles. Son chargement est isolé dans Suspense : une erreur de classement ne bloque pas les autres panneaux.

Le score mesure la collection actuellement possédée, et non le nombre de boosters ouverts ni les gains cumulés. Le calcul et les positions sont établis côté SQL, jamais à partir d'un score envoyé par le navigateur.

Les trois premières places ont des reflets métalliques, un halo, une médaille flottante avec anneau animé et des particules discrètes. Une couronne dorée est placée au-dessus de l'avatar du premier. Or pour le premier, argent pour le deuxième, bronze pour le troisième ; les effets sont décoratifs, confinés aux panneaux et ne couvrent pas les noms. `prefers-reduced-motion` désactive toutes les animations.

| Carte / variante | Premier exemplaire |
| ---------------- | -----------------: |
| C                |                  5 |
| R                |                 25 |
| SR               |                100 |
| SSR              |              1 000 |
| LR               |              5 000 |
| SSR Infinity     |              6 000 |
| LR Infinity      |             18 000 |
| LR Shiny         |             50 000 |

Les poids sont un barème de collection, pas une estimation du prix ou de la probabilité exacte d'obtenir un personnage. SSR/LR sont fortement valorisées, tout en laissant une progression aux autres raretés. Une Infinity vaut le coût brut de sa fusion augmenté de 20 % : cinq SSR ou trois LR. Une LR Shiny vaut dix LR standard, en cohérence avec les 10 % de Shiny conditionnels à un tirage LR. Le flag historique `is_shiny` des SSR désigne Infinity ; il ne multiplie jamais encore son score par dix.

## Doublons et équité

Le premier exemplaire de chaque couple `(carte du catalogue, variante)` compte à 100 %. Les exemplaires 2 à 5 comptent chacun à 20 %. Les suivants ne rapportent plus rien. Le maximum par couple est donc 180 % de sa valeur de base. Le score conserve des entiers pour toutes les raretés.

- Cinq exemplaires de la même LR = 9 000 points, même si le joueur en possède cinquante.
- Deux LR différentes = 10 000 points : la diversité est récompensée.
- LR standard, LR Infinity et LR Shiny d'un même personnage sont des variantes distinctes.
- Les égalités de score partagent la position, avec classement de compétition : 1, 2, 2, 4. L'ordre alphabétique ne sert qu'à stabiliser l'affichage et les pages.
- Les ventes, échanges et destructions retirent les points des cartes quittant la collection. Aucun bonus historique n'est conservé : impossible de cumuler des points en se renvoyant une carte.
- Les cartes verrouillées ou en enchère comptent tant qu'elles appartiennent au joueur. Les choix Decision Pack en attente ne comptent pas.
- Une évolution vers une variante déjà possédée reste soumise au plafond. Elle peut diminuer le score si les cartes consommées disparaissent alors que la variante obtenue est déjà plafonnée. Le classement mesure des actifs présents, pas l'effort passé.
- Aucun multiplicateur lié au Pro, aux Karas, aux images personnalisées, à l'ancienneté ou au premier propriétaire. L'accès Pro peut toujours accélérer l'acquisition : ce classement compare des collections, pas le mérite ou le temps de jeu.

## Visibilité et coût

Seuls les profils publics, actifs, non bannis et possédant au moins une carte apparaissent. Un profil privé consulte son score et sa ventilation personnelle sans être classé publiquement. Les blocages sont appliqués dans les deux sens ; masquer un joueur ne change pas les rangs globaux, donc ne permet pas de gagner des places artificiellement. Les cartes précises des autres joueurs ne sont pas renvoyées.

La page indépendante ouvre **Top 100**. Dans Social, la vue **Friends** est sélectionnée initialement : elle affiche le joueur et ses amis acceptés, dans l'ordre de leurs positions globales, avec un badge **Friend**. Les deux vues restent disponibles dans chaque contexte. Les amis privés, sans carte, bannis, supprimés ou bloqués ne sont pas exposés.

La recherche par pseudo est soumise avec **Search** ou Entrée. Dans **Top 100**, elle cherche parmi tous les joueurs classés, même au-delà des cent premiers ; dans **Friends**, elle reste limitée aux amis et au joueur. Les rangs sont calculés avant ces filtres et les blocages. La limite des cent joueurs suit l'ordre déterministe score, pseudo puis identifiant, y compris en cas d'égalité. La recherche ignore la casse et les espaces de bord, accepte au plus 64 caractères et traite `%` et `_` littéralement. Une réponse ancienne ne remplace pas une recherche plus récente.

La RPC en lecture seule agrège les exemplaires côté base. Sa nouvelle signature à quatre arguments renvoie au plus 100 entrées par page, avec pagination si une recherche ou la liste des amis dépasse cette taille. La signature historique à deux arguments conserve sa limite de 50 et sert notamment l'aperçu home de six joueurs. Elle n'effectue aucune mutation et ne charge pas toutes les collections dans le navigateur. Les scores reflètent les données au moment de l'ouverture, du changement de page ou du bouton **Refresh scores**. Un éventuel cache agrégé pourra être ajouté si la taille réelle des collections le justifie.

## Classement des parrains

Le bouton **Referrals**, à côté de **Collection**, ouvre le classement des parrains dans les deux présentations. Dans Social, le titre et les onglets restent en place. Ce classement ne requiert aucune carte : seul le nombre de filleuls vérifiés et validés par le système de récompense compte, une fois par relation. Les inscriptions en attente et les filleuls bannis ou supprimés ne comptent pas. Un filleul privé peut contribuer au total sans que son identité soit publiée.

Les comptes publics et actifs avec au moins un filleul éligible sont classés par nombre décroissant. Les égalités partagent leur rang. **Top 100**, recherche au-delà du Top 100, **Friends**, badges d'amis, actualisation et pagination suivent les mêmes principes que le classement des collections, avec positions calculées avant les filtres et blocages. Seuls pseudo, avatar, position et total agrégé sont publics. La RPC `get_referral_leaderboard(integer,integer,text,boolean)` ne renvoie ni code de parrainage, ni identité de filleul, ni email ou donnée Auth. Le compte privé peut consulter son propre total sans entrer au classement public.

Le badge historique dans Settings couvre tous les comptes actifs ; cette nouvelle vue présente les positions dans la population publique éligible, ce qui est indiqué dans les règles de la page. La fonction historique et les récompenses restent inchangées.

## Pseudos et personnalisation

Les deux classements, dans la page indépendante et dans Social, ainsi que le podium et les lignes de la home, réutilisent `StyledPlayerName` : police, couleur, effet, badge Pro et badges décoratifs. Les wrappers SQL ajoutent `profileStyles` uniquement pour les identifiants déjà visibles dans la page bornée. Ils utilisent `billing_profile_cosmetics`, qui vérifie les droits Pro actuels côté serveur ; une expiration ou révocation retire le style sans modifier le score ni la position. Aucune requête supplémentaire par pseudo côté navigateur, ni accès direct aux tables de personnalisation ou de facturation.

## Statistiques des cartes

Les lignes du classement Collection et le récapitulatif personnel affichent le nombre total de cartes **SR**, **SSR** et **LR**, doublons compris, avec leurs badges de rareté. Infinity et Shiny utilisent les logos des cartes et leurs finitions distinctes. Leurs compteurs incluent tous les exemplaires spéciaux et sont déjà compris dans leur rareté de base ; une SSR avec l'ancien flag shiny compte seulement comme Infinity. Ces compteurs descriptifs ne changent pas le calcul du score, qui conserve ses plafonds de doublons. La projection des compteurs se limite aux joueurs déjà visibles sur la page et au joueur connecté pour son récapitulatif privé. Les textes, scores et légendes sont agrandis avec des badges qui reviennent à la ligne sur mobile.

Migrations : `20261027120000_collection_leaderboard.sql`, `20261027130000_collection_leaderboard_search.sql`, `20261027140000_referral_leaderboard.sql`, `20261027150000_leaderboard_profile_styles.sql` et `20261027160000_leaderboard_entry_guards.sql`. La dernière ajoute les compteurs et porte explicitement le garde de bannissement en première instruction des trois points d'entrée volatils. Aucun test de sécurité n'est modifié. Toutes sont appliquées uniquement à Supabase local, pas sur le VPS. Aucun déploiement en production n'est demandé à ce stade.
