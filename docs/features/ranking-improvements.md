# Classements : objectifs, navigation et suivi — local

Les pages PowerRanking, J’aime et Licences affichent un objectif personnel. Points et J’aime indiquent l’écart pour dépasser le joueur le plus proche parmi les résultats visibles, sans divulguer les joueurs masqués. Une première place reçoit un message de maintien ; un joueur non classé est guidé vers la collection ou le social. Pour une licence, l’objectif utilise son nombre réel de cartes distinctes manquantes. Le mode global propose un classeur incomplet parmi la page personnelle bornée de 72 candidats, puis permet d’en choisir un autre.

Les menus de catégories restent alphabétiques. Le menu des licences utilise désormais un lecteur dédié : A–Z est appliqué avant la pagination SQL, indépendamment de la popularité des classeurs dans la découverte. Les pages contiennent au plus 72 métadonnées de catalogue, conservent la catégorie et le filtre de recherche et prennent en charge le préfixe clavier pour un nom non chargé. Aucun inventaire de joueur n’est renvoyé par ce lecteur.

Un clic normal sur un joueur ouvre le profil compact existant : identité, vitrine, classeurs et Message pour un ami autorisé. Les clics modifiés gardent la navigation native du lien. Le classement reste ouvert ; la fermeture restaure le focus. Le Home suspend son cycle pendant l’aperçu.

Le Home conserve un cadre de lecture de hauteur identique entre les trois vues, adapté à l’écran. Sur ordinateur, podium et suivants sont côte à côte ; sur écran étroit, le contenu défile dans le cadre. Les contrôles restent accessibles au clavier et au toucher. La rotation conserve cinq secondes, sans bouton pause, ainsi que les arrêts au survol, au focus, hors écran et avec une préférence de mouvement réduit. Une vue sans J’aime propose de découvrir la communauté.

## Historique réel, sans rangs inventés

Les lecteurs autorisés enregistrent une observation quotidienne UTC des seuls joueurs déjà présents dans leur réponse et du demandeur public classé. Une relecture le même jour actualise l’observation de ce jour, sans écrire si le rang est inchangé. Il n’y a ni reconstitution antérieure, ni capture exhaustive quotidienne : la couverture dépend des consultations réelles.

L’interface compare à l’observation la plus récente vieille d’au moins sept jours si elle existe ; sinon à la première observation d’un jour antérieur. La date de référence est affichée. Sans référence, le suivi indique qu’il commence. Le détail montre au plus huit jours observés ; les observations de plus de 35 jours sont purgées lors des lectures. Aucun historique d’un profil devenu privé ou bloqué ne se retrouve dans une réponse non autorisée. Les comptes supprimés sont purgés par cascade.

## Migration et validation

- Migration : `20261030233000_ranking_navigation_and_history.sql`.
- Appliquée uniquement à Supabase local ; **pas appliquée sur le VPS**.
- Nouvelle table avec RLS, sans droit API ; helper propriétaire uniquement.
- Nouveau lecteur A–Z accessible uniquement aux comptes connectés non bannis, avec profil existant. Les lecteurs de classement conservent leurs projections et règles métier.
- Adaptation de `tests/security-definer-allowlist.mjs` : ajout exact du lecteur et du helper interne, validé par Walid dans la conversation. Aucune assertion retirée ou assouplie ; nouveaux tests SQL de droits, confidentialité, ordre, pagination et calcul d’historique.
- Recette navigateur locale FR/EN : objectifs, listes A–Z et saut vers Z hors page initiale, profil compact sans navigation, largeur 320/375/768/1024/1440/720, absence de débordement, stabilité des hauteurs et cycle de cinq secondes. Les exemples d’évolution sont injectés dans le navigateur de test uniquement ; le calcul réel est vérifié en base isolée.
- Zoom CSS à 200 % contrôlé ; zoom natif du navigateur à 200 % non vérifié.
- CI complète réservée à GitHub Actions ; aucun déploiement de cette évolution demandé.

## Retour arrière

Restaurer d’abord la version précédente de l’application, puis exécuter le SQL de `docs/rollback/ranking-navigation-and-history.sql` après coordination SQL. Les observations sont conservées en table verrouillée pour permettre une reprise ; le lecteur A–Z et l’enrichissement des réponses sont retirés. Ne pas appliquer cette migration de retour arrière en même temps qu’une autre intervention SQL.
