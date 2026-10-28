# Intégration des classeurs Anime/Manga après la revue V3

## État et décisions à reprendre

Ce document prépare l'intégration. Il n'installe aucun schéma, ne branche aucun écran et n'autorise aucune activation. La V3 d'origine reste une référence immuable. La revue finale produit un candidat distinct avec deux séparations de séries indépendantes et cinq corrections de noms affichés. Aucune nouvelle fusion n'est recherchée.

Les amendements publics sont dans `data/editorial/anime-series-v3-quality-amendments.json`. La fonction pure `applyQualityAmendments` prépare un manifeste désactivé. Elle refuse une base approuvée/activée, une dérive d'identité, une carte protégée dans les affectations ou une modification de provenance. Les titres sources et preuves d'import ne sont jamais réécrits. Les exports complets et les identifiants de cartes restent privés.

Corrections à faire valider sur le candidat avant intégration :

- `197179`, spécial de **ONE PIECE in LOVE**, rejoint l'identité `188668` de la comédie lycéenne. Il ne rejoint pas la série de pirates. Le [site officiel](https://one-piece.com/news/74335/index.html) rattache ce spécial à cette autre adaptation, dont les [protagonistes sont distincts](https://one-piece.com/news/71702/index.html).
- **RILAKKUMA** `183231`, nouvelle production TV de [Production I.G](https://www.production-ig.co.jp/works/rilakkuma/), est séparé de `99230`/`125440`, le cycle [Netflix en stop-motion](https://media.netflix.com/en/only-on-netflix/80196883). Le seul lien de personnages communs ne prouve pas une saison. Le classeur existant de `99230` conserve sa clé et prend le nom `Rilakkuma and Kaoru`.
- Les noms globaux `Beyblade Burst`, `Initial D`, `Fate/strange Fake` et `Mobile Suit Gundam Wing` remplacent les noms d'une seule saison, d'un prologue ou d'un film. Leurs clés stables restent identiques.

Choix du propriétaire déjà acquis : Tokyo Ghoul/√A reste distinct de Tokyo Ghoul:re et sa seconde saison ; les parties majeures de JoJo et les séries Yu-Gi-Oh restent distinctes. Fate/Grand Order narratif, Mononoke TV/films et GREAT PRETENDER/razbliuto restent réunis. Pendant cette revue, le propriétaire a confirmé **un seul Galaxy Express 999**, TV et cycle cinéma `1491/1301/1302/3602`, malgré les différentes adaptations. Cette exception ne s'étend pas à Harlock, Maetel Legend ou aux autres séries de cet univers.

Le film Tenchi `1101` reste sans rattachement suffisamment établi. L'intégration n'a pas à lui inventer une continuité.

## Ordre des travaux et livrables

| Lot                               | Travail concret                                                                                                                                          | Livrable vérifiable avant le lot suivant                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Contrat et référence           | Fixer le manifeste candidat validé, sa version et son SHA-256 ; relire le catalogue en lecture seule et mesurer la dérive depuis l'instantané de l'audit | Diff éditorial et par carte, toutes les exceptions, aucune carte protégée déplacée                             |
| 2. Schéma et RPC inactives        | Préparer des migrations additives, une projection unique et les nouvelles RPC par clé stable, derrière un indicateur désactivé                           | Replay des migrations, tests RLS/droits et recette PostgreSQL complète, sources et joueurs inchangés           |
| 3. Préférences                    | Préparer les correspondances des favoris, classeurs de profils et anciens liens, sans effacer les valeurs historiques                                    | Rapport des correspondances uniques, des noms ambigus et des identifiants absorbés/séparés                     |
| 4. Application                    | Adapter ensemble classeurs personnels/amis, recherche, filtres, progression, profils et caches                                                           | Recette fonctionnelle cohérente sur une seule version de contrat                                               |
| 5. Imports                        | Écrire la provenance complète à l'import, consulter uniquement les règles approuvées et mettre les nouveaux médias en revue                              | Cas d'import connu/nouvelle saison/manual/inconnu/édition locale rejoués sans réécriture des cartes existantes |
| 6. Recette de bout en bout        | Valider les parcours et les tailles demandées sur une URL locale explicite, puis en recette isolée                                                       | Captures et résultats fonctionnels, CI GitHub verte sur une branche à jour avec `origin/master`                |
| 7. Proposition de mise en service | Présenter le diff final, le backup vérifié, les risques résiduels et le rollback                                                                         | Autorisation explicite distincte avant toute migration ou activation de production                             |

Chaque lot passe par une PR et les contrôles GitHub existants. Ne pas remplacer la CI par un lancement local de `verify`, `ci` ou `ci:db`. Ne pas réduire les assertions existantes pour rendre le nouveau modèle vert. Le présent travail ne réalise que la revue et la préparation.

## Contrat de lecture unique

La recette `supabase/recipes/anime_series_projection.sql` démontre une présentation par lien source exact. Elle ne constitue pas une migration produit prête à activer. Éviter la cohabitation avec l'ancien moteur global de franchises : la recette refuse déjà sa présence. Avant toute future installation, contrôler en lecture seule l'état réel du schéma et des migrations, notamment la conservation des licences secondaires. Le précédent instantané d'audit contient `20261024160000_preserve_secondary_card_franchises` ; ce constat daté ne remplace pas le contrôle au moment de l'intégration.

Une projection produit doit fournir au minimum :

```ts
type BinderSummary = {
  key: string; // series:<uuid> ou source:<empreinte catégorie + licence>
  displayName: string;
  origin: "series" | "source";
  category: string;
  total: number;
  owned: number;
  percent: number;
  favorite: boolean;
};

type BinderCardLink = {
  binderKey: string;
  cardId: string;
  sourceLicense: string;
  displayName: string;
};
```

La clé ne doit jamais être reconstruite à partir du nom affiché. Deux classeurs peuvent afficher le même nom tout en ayant des clés différentes, parce que l'un contient des cartes protégées. Les distinguer par une indication d'origine accessible en anglais, par exemple `Original binder`, sans renommer les titres sources. Les clés déjà publiées restent stables lors d'un changement de titre. Les affectations d'une carte ne portent que sur son lien primaire prouvé ; aucun média n'est déduit pour un lien secondaire.

Conserver `Card.anime`/la franchise de carte comme information source. Ajouter les champs de présentation de classeur séparément. Ne pas remplacer la franchise renvoyée par `withLiveCardFranchises` par le nom global : cela modifierait aussi les cartes possédées, les offres, les échanges et d'autres parcours qui ne sont pas des pages de classeurs.

Le schéma d'intégration devra exposer seulement les champs utiles à la lecture. Le registre d'import et les instantanés de preuve restent internes. Reprendre les vérifications d'authentification, de blocage et `can_view_collection` des RPC existantes ; aucune nouvelle RPC `SECURITY DEFINER` ne doit contourner ces conditions. Préférer `SECURITY INVOKER` quand les RLS suffisent, sinon fixer `search_path`, les droits et la portée des lectures explicitement. Aucun joueur ne peut approuver une règle ni écrire une preuve de provenance.

## Recherche, filtres et pagination

Points d'entrée actuels : `getPaniniAlbumsPage`, `getPaniniAlbumCardsPage`, `searchCards` et `getCataloguePage` dans `lib/data/cards.ts`, puis `components/collection.tsx`. Les callbacks et la sélection utilisent aujourd'hui `license: string`. Ils doivent transporter la clé stable et le nom séparément. Prévoir des RPC versionnées pour éviter de casser un ancien client pendant la transition, par exemple une lecture de classeurs et une lecture de cartes acceptant `p_binder_key`.

La recherche de classeurs doit indexer le nom de série, les noms sources réellement présents et les alias anglais/romaji vérifiés. Un alias aide à retrouver une clé ; il ne crée aucune affectation de carte. Les résultats regroupent les correspondances par clé stable avant pagination. Une recherche sur √A retrouve Tokyo Ghoul, une recherche sur :re retrouve le second classeur ; `Yu-Gi-Oh` peut renvoyer plusieurs séries distinctes. `One Piece` peut aussi trouver la parodie, mais celle-ci reste un résultat distinct. Une recherche sous un nom ambigu ne choisit pas silencieusement entre un classeur source protégé et un classeur série.

Dans un classeur, le filtre cherche les cartes appartenant à cette clé exacte, avec leurs noms et titres sources. Catégorie, rareté, possédées, favoris et pagination s'appliquent côté serveur avant offset/limit ; la navigation arrière conserve ces paramètres. Le dénominateur de progression du classeur reste son catalogue complet, tandis que le nombre de résultats filtrés est un champ distinct. Les résultats et le total de la liste doivent utiliser le même instantané logique et le même prédicat.

Mettre à jour les clés de cache avec la version du mapping, le propriétaire du classeur, la clé stable, la catégorie et les filtres. Une recherche partielle ou une réponse d'un ancien classeur ne doit pas remplacer la page active. Invalider les totaux après un nouvel import ou une modification de règle approuvée. Ne pas mettre en cache des données privées d'un autre joueur sous une clé commune.

## Favoris et anciens liens

`setPaniniAlbumFavorite` écrit actuellement dans `panini_album_favorites(user_id, license)`. Les RPC personnelles/amis et les profils lisent ces noms. Préparer un stockage parallèle par clé stable, avec l'unicité `(user_id, binder_key)` et les mêmes règles d'accès. Garder la préférence historique brute, son utilisateur, sa valeur et la version de la correspondance. Une sauvegarde ne suffit pas à autoriser une suppression : aucun reset n'est nécessaire à cette architecture.

Cas à traiter explicitement :

- Plusieurs anciens fragments convergent vers une seule série : dédupliquer uniquement les références de favori dans la nouvelle couche, avec OR des préférences, sans toucher aux collections.
- Un nom source mène à une seule clé : préparer une correspondance traçable et idempotente.
- Un ancien nom mène à plusieurs clés, notamment avec une source protégée, ou un ancien classeur est séparé par la revue : conserver la valeur brute et présenter un choix de résolution. Ne pas dupliquer automatiquement ce favori vers toutes les séries, ni l'attribuer à l'une arbitrairement.
- Le classeur V3 RILAKKUMA est séparé : la clé historique reste attachée au cycle Netflix. Conserver l'historique de sa composition pour que les préférences antérieures puissent être examinées ; ne pas interpréter automatiquement un ancien choix global comme une préférence pour la nouvelle adaptation.
- Les liens utilisant seulement un nom doivent rester lisibles. S'il existe plusieurs cibles, proposer une sélection accessible ; une redirection n'est automatique que pour une cible unique. Préférer une clé dans les nouveaux paramètres d'URL et conserver les libellés sources comme alias de recherche.

Reprendre les correspondances V1/V2/V3 déjà livrées, puis y ajouter le diff de cette revue. Un reset de favoris resterait une opération distincte, soumise à sauvegarde et autorisation explicites.

## Progression et collections

`lib/ui/license-progress.ts` et `getLicenseCatalogueTotals` regroupent actuellement par texte. Les remplacer dans les parcours de classeurs par le même contrat de lecture que les RPC. `collectionGroupKey` dans `lib/ui/collection-groups.ts` gère les exemplaires et raretés : ne pas changer ce mécanisme pour regrouper des séries.

Pour une clé de classeur :

- `total = COUNT(DISTINCT card_id)` dans son catalogue de liens projetés.
- `owned = COUNT(DISTINCT card_id)` parmi les cartes de ce catalogue possédées par le joueur autorisé.
- Le pourcentage suit le même arrondi et la même borne qu'actuellement. Plusieurs exemplaires, raretés ou versions d'une carte ne multiplient pas le numérateur. Deux UUID de cartes existants ne sont pas fusionnés parce qu'ils représentent un même personnage.
- Les liens secondaires sont conservés. Une carte peut appartenir légitimement à plusieurs classeurs sources, sans être comptée deux fois à l'intérieur d'une même clé.

Tester séparément progression complète et compteur de résultats filtrés. La catégorie primaire/les catégories secondaires doivent conserver leur sémantique : vérifier aussi les cartes qui auraient une catégorie Anime/Manga secondaire lors de futurs imports. Les autres catégories gardent leur classement existant.

## Profils et classeurs d'amis

`lib/data/profile.ts` expose les RPC `get_friend_panini_albums_page`, `get_friend_panini_album_cards_page`, `get_profile_widget_licenses` et la modification des widgets. `components/profile.tsx` et le sélecteur `profile-license-picker.tsx` stockent/affichent encore des noms, y compris comme clés React.

Transporter et enregistrer les clés stables dans une nouvelle version du contrat des widgets, tout en conservant la configuration brute actuelle. Reprendre les limites existantes, dont les douze entrées par catégorie. Valider que chaque clé proposée existe dans la catégorie, sans accepter un texte arbitraire. Ne pas transformer les centres d'intérêt libres ou les cartes mises en vitrine en références de classeurs par proximité de nom.

Les favoris affichés chez un ami sont ceux du propriétaire du profil. Conserver les restrictions de collection privée, les blocages et la portée de l'utilisateur connecté. Le nom de série peut changer sans casser la clé React, le widget ou un lien enregistré. Un profil utilisant le libellé `Fate/strange Fake` peut avoir une source protégée et une série vérifiée : rendre ce choix visible, sans déplacer les cartes de la source.

## Futurs imports AniList

Points à adapter : `data/anilist_par_anime.py`, `data/clean_and_assign_rarity.py`, `scripts/import-cards.mjs` et le normaliseur historique. `cards.source_id` est un **ID de personnage**, pas un média. Le rapprochement historique avec le média le plus populaire ne doit pas décider à nouveau de l'identité de toutes les cartes existantes.

Écrire un registre vérifiable par lot : espace source, ID personnage, ID média exact de l'import, titres reçus intacts, horodatage, version du collecteur et empreinte de la preuve. Ne pas inventer un média unique si la preuve n'en désigne pas un. Une source manuelle, une identité incomplète ou une édition locale ultérieure reste hors projection.

Un média déjà connu, approuvé et toujours corroboré peut retrouver sa clé stable. Un nouveau média lié par SEQUEL/PREQUEL ne reçoit pas automatiquement une approbation : préparer sa revue avec l'identité, le format et les frontières existantes. Une saison sans carte peut être enregistrée dans les preuves de continuité ; cela ne crée aucune carte fictive ni licence physique. Le premier Beyblade Burst `21236`, absent du catalogue de cartes audité, ne doit pas faire renuméroter la clé existante lors d'un futur import.

Le contrôle des relations doit pouvoir passer par un OVA/spécial non représenté. Il ne ferme jamais tout un composant de franchise. Appliquer les interdictions entre Tokyo Ghoul/:re, parties JoJo et grandes séries Yu-Gi-Oh, même indirectement. Le cas d'un média JoJo couvrant plusieurs arcs demande une preuve au niveau de l'apparition du personnage ; l'ID média seul ne suffit pas. Les cartes JoJo manuelles existantes restent intouchables.

Limiter les requêtes AniList aux identités nécessaires, réutiliser le cache borné et les contrôles d'usage existants. Le registre de provenance d'import ne doit pas devenir un miroir du catalogue AniList. À l'installation future, revérifier les conditions d'usage et le statut commercial effectif.

## Recette d'intégration requise

| Parcours / propriété                               | Vérification attendue                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Projection désactivée                              | Noms, clés sources, cartes et préférences identiques au comportement précédent                                                 |
| Grand classeur et saisons sans carte intermédiaire | Totaux exacts, même identité des saisons représentées, aucun épisode fictif ajouté                                             |
| Source partagée entre manuel/incertain et AniList  | Tous les liens et noms des cartes protégées restent identiques, même texte affiché sur deux clés distinctes                    |
| Deux corrections de qualité                        | Parodie One Piece et TV RILAKKUMA séparées ; les sources et les preuves restent intactes                                       |
| Exceptions                                         | Deux Tokyo Ghoul, parties JoJo et séries Yu-Gi-Oh séparées, quatre choix du propriétaire réunis comme documenté                |
| Recherche                                          | Titres sources, alias anglais/romaji, ponctuation, plusieurs mots et noms ambigus ; aucun regroupement par similarité          |
| Filtres                                            | Rareté, possédées, favoris, catégorie, filtres combinés, pagination et retour recherche ; total filtré cohérent                |
| Favoris                                            | Convergence de fragments, nom ambigu, nouveau favori par clé, retrait, annulation et conservation des valeurs brutes           |
| Progression                                        | Copies multiples, raretés, cartes à liens secondaires, zéro carte possédée et collection complète                              |
| Profils                                            | Personnel/ami/public/privé/bloqué, favoris du propriétaire, widgets par clé, ancien widget ambigu                              |
| Import                                             | Média approuvé, nouvelle saison, ID personnage confondu avec ID média, manuel/inconnu, provenance incomplète et édition locale |
| Droits et données                                  | Tests RLS, exécution des RPC, pas d'approbation joueur, empreintes des cartes/collections/preferences avant-après              |
| Rollback                                           | Désactivation de présentation et retour des clés sources sans restaurer une ancienne copie des collections                     |

Configurer explicitement l'URL locale du serveur de recette et vérifier qu'elle correspond à l'application attendue avant les tests. Tester les pages de classeurs personnels et d'amis, les profils, modales et sélecteurs à **320, 375, 768, 1024 et 1440 px**, avec largeurs intermédiaires utiles et **zoom 200 %**. Couvrir les titres longs, les listes de résultats et les deux classeurs de même nom ; aucun débordement de page, commande inaccessible ou interaction uniquement au survol. Tous les nouveaux textes joueurs, erreurs, indications d'origine et libellés accessibles sont en anglais.

Cette recette visuelle n'est pas réalisée par la revue éditoriale. Les tests de mapping et de projection locale fournis ne prouvent pas le bon fonctionnement d'un client qui n'est pas encore intégré.

## Mise en service et retour arrière

Avant une éventuelle demande d'autorisation : sauvegarde cohérente privée des sources, liens, collections, favoris et widgets, contrôle de restauration en environnement isolé, manifeste validé identifié par son empreinte, migrations précisément listées et état VPS vérifié en lecture seule. Mesurer le coût des nouveaux index et des RPC sur le catalogue réel, contrôler les plans de requête et la pagination, puis comparer les résultats anciens/nouveaux dans une recette sans utilisateurs réels.

Présenter alors le changement concret et ses écarts au propriétaire. **Aucune migration ni activation de production sans son autorisation explicite.** Déploiement de code et activation du mapping sont deux opérations à décrire séparément. Une fois l'autorisation obtenue, suivre l'ordre compatible client/RPC, avec l'indicateur toujours désactivé jusqu'au contrôle final.

Le rollback doit pouvoir désactiver la présentation immédiatement et servir les sources intactes. Garder les préférences par clé et leurs anciennes valeurs pour une reprise ultérieure ; ne pas supprimer des tables ni restaurer des collections anciennes pour revenir en arrière. Suspendre seulement la nouvelle affectation des imports pendant une désactivation : leur provenance et leurs cartes restent conservées. Le runbook de production précis sera préparé avec les migrations d'intégration, pas déduit des recettes locales de cet audit.
