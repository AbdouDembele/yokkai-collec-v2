# Social — spécification et découpage

Social remplace Friends dans la navigation, avec le même badge de messages privés
non lus et de demandes reçues. Le chantier est livré avec PR5 ; la section contient
trois onglets, dans cet ordre :

- **Feed** (`/social`) : posts de mes amis et les miens, avec le composer.
- **Everyone** (`/social/everyone`) : posts des murs publics, par ordre chronologique.
- **Friends** (`/social/friends`) : recherche et ajout de joueurs, demandes, amis,
  messages privés et joueurs bloqués.

Les posts restent ceux du mur existant (`profile_wall_posts`). Likes, réactions
et réponses ont le même comportement que sur le profil.

Le feed global applique les mêmes règles que la lecture d'un mur : un post n'y
apparaît que si le mur est lisible publiquement. La confidentialité est relue à
chaque lecture, avec les règles de blocage et de visibilité existantes.

Le signalement des posts et réponses, avec leur traitement dans l'administration,
est un prérequis à l'ouverture du feed global.

Le rafraîchissement utilise du polling, suspendu en arrière-plan, comme les autres
surfaces du site.

## Découpage

1. **PR1 — Shell et Friends** : layout partagé, seul l'onglet Friends est visible ;
   `/social` redirige provisoirement vers `/social/friends`. L'ancien `/friends`
   conserve ses paramètres lors de la redirection. Recherche en premier, demandes
   reçues mises en avant, chargement initial explicite. Aucun changement SQL.
2. **PR2 — Feed** : feed des amis et de soi-même, composer et interactions du mur.
3. **PR3 — Signalement des posts** : posts et réponses, traitement administrateur.
4. **PR4 — RPC du feed global** : pagination et règles de visibilité du feed public.
5. **PR5 — Everyone** : ouverture de l'onglet global, une fois ses prérequis livrés.
6. **PR6 — Add friend** : projection des relations et actions d'amitié dans Everyone.

Feed et Everyone ne sont pas affichés avant leur livraison : aucun onglet vide en
production. Les textes destinés aux joueurs sont en anglais.

## Droits actuels sur un post de mur — option C (PR4b)

Lecteurs authentifiés et actifs ; auteur actif, sans blocage bilatéral.
Le propriétaire du mur est l'auteur du post. « Inconnu privé » désigne un lecteur
sans amitié visitant un mur privé. Un blocage bilatéral avec le propriétaire du
post refuse toutes ces actions. Un blocage avec un auteur de réponse masque sa
réponse et ses médias, sans masquer le post des autres joueurs.

| Action                                  | Propriétaire             | Ami accepté | Inconnu, profil public | Inconnu, profil privé | Bloqué |
| --------------------------------------- | ------------------------ | ----------- | ---------------------- | --------------------- | ------ |
| Lire le post                            | Oui                      | Oui         | Oui                    | Non                   | Non    |
| Voir likes et réactions                 | Oui                      | Oui         | Oui                    | Non                   | Non    |
| Liker / déliker                         | Oui                      | Oui         | Oui                    | Non                   | Non    |
| Réagir / retirer sa réaction            | Oui                      | Oui         | Oui                    | Non                   | Non    |
| Lire les réponses (auteur privé inclus) | Oui                      | Oui         | Oui                    | Non                   | Non    |
| Répondre                                | Oui                      | Oui         | Oui                    | Non                   | Non    |
| Signaler le post                        | Non (son propre contenu) | Oui         | Oui                    | Non                   | Non    |
| Signaler une réponse d'autrui           | Oui                      | Oui         | Oui                    | Non                   | Non    |
| Supprimer une réponse d'autrui          | Oui                      | Non         | Non                    | Non                   | Non    |

Chacun peut aussi supprimer ses propres réponses tant qu'il a accès au post.
Les réponses et leurs médias héritent de l'audience du post parent, quelle que
soit la confidentialité du profil de leur auteur. `wall_reply_author_visible`
conserve les filtres de bannissement, suppression et blocage bilatéral ; il ne
consulte pas la confidentialité du mur de cet auteur. `wall_actor_visible` reste
inchangé pour les profils, likes et réactions. Un profil de propriétaire du post
devenu privé retire immédiatement aux inconnus la lecture et les interactions.
Everyone reproduit ces mêmes droits et reste limité aux auteurs publics, y
compris pour leurs amis.

**Scénario A/B/C** : A publie sur son mur public, B a un profil privé et n'est
pas son ami, C n'est ami ni de A ni de B. A et C voient la réponse et ses médias ;
A reçoit la notification, peut supprimer et signaler la réponse ; B voit sa
propre réponse. Le mur et la collection de B restent privés. La mention anglaise
sur la visibilité du composer est affichée à B et décrit correctement l'audience
(sous réserve des filtres de bannissement, suppression et blocage).

### PR4b — source SQL et garde-fous

Migration `20261025143000_public_wall_interactions.sql` : **appliquée sur le VPS le 25 octobre 2026**.
Le helper interne `wall_post_interaction_allowed(uuid,uuid)` est sans droit
EXECUTE API et inscrit dans `ownerOnly`. `wall_interaction_owner` le délègue pour
les lecteurs unitaire/groupé, likes, réactions, réponses texte/médias et lecture
privée des médias de réponse. Les validations des signalements et les deux
chemins de notifications l'utilisent aussi. Le filtre interne supplémentaire
`wall_reply_author_visible(uuid)`, également sans EXECUTE API et dans `ownerOnly`,
est partagé par lecteurs de réponses, médias, signalements et notifications.
Les signatures existantes restent
inchangées. `can_read_profile_wall` refuse également les lecteurs/auteurs bannis
pour garder lecture du post et interactions cohérentes.

- **Suppression** : `delete_wall_post_reply` autorise l'auteur de la réponse ou le
  propriétaire du post, et réutilise `delete_wall_content_core`. Le résultat
  `canDelete` pilote le bouton ; l'ancienne base conserve son comportement.
- **Médias supprimés par le propriétaire** : une autorisation privée lie le
  modérateur au chemin et à l'id exact de l'objet retiré. Une action serveur
  authentifiée relit cette autorisation via `authorize_wall_reply_media_cleanup`
  avant nettoyage privilégié. Aucun droit de stockage du navigateur n'est élargi.
  Les fichiers encore liés ou recréés au même chemin sont refusés ; le retry de
  nettoyage existant reste disponible. Cette autorisation n'expose aucun octet.
- **Débit inchangé** : 30 réponses par auteur sur une heure glissante, au moins
  5 secondes entre deux réponses, 500 réponses par post. Le verrou par auteur et
  les retries idempotents restent en place. `WALL_REPLY_RATE_LIMITED` conserve
  son message anglais. Ce plafond existant borne aussi l'arrivée de nouveaux
  participants sur les murs publics sans ajouter une règle concurrente.
- **Notifications** : aucun ajout pour likes/réactions. Les réponses conservent
  une notification par destinataire et post ; un retry n'en crée aucune autre,
  les réponses à son propre post ne notifient pas. Le garde de blocage existant
  couvre `wall_post_reply` à l'insertion et à la mise à jour, dans les deux sens.
- **Compatibilité** : sur un profil public, les interactions sont sondées auprès
  de l'API. Un refus `WALL_POST_UNAVAILABLE` reste silencieux pour un inconnu sur
  l'ancienne base ; les autres erreurs gardent un message anglais. Le champ API
  `publicReplyNotice` ajoute la mention « Your reply will be visible to anyone
  who can see this post. » uniquement au composer d'un inconnu sur un mur public.
  Les amis et propriétaires n'ont pas cette mention. Everyone est ouvert par PR5.

## PR4 — lectures publiques et activité groupée

La migration `20261025120000_public_wall_feed.sql` ajoute
`get_public_wall_feed(timestamptz, uuid, integer)` et
`get_wall_posts_activity(uuid[])`. Elle a été appliquée sur le VPS le 25 octobre 2026.
PR5 ouvre Everyone dans la navigation. Le profil conserve sa lecture unitaire.

Le feed public garde le contrat `{items,next}` du feed Home : curseur décroissant
`(created_at,id)`, limite par défaut 10, plafond 20, lecture de `limit+1` lignes.
Il exige un compte actif et relit `is_public`, les exclusions de compte et les
blocages bilatéraux à chaque appel. PR4 n'élargissait pas les interactions ;
l'option C de PR4b ci-dessus met ensuite leur règle à jour.

L'activité groupée renvoie un objet indexé par id de post. Chaque valeur est
exactement le résultat de `get_wall_post_activity(id)` sans curseur : `likes`,
`likedByMe`, `reactions` (compteurs et `reactedByMe`), `replyCount`, les dix premières
réponses `items` (auteur, média/GIF compris) et leur curseur `next`. Le composant
utilise tous ces champs ; les réponses sont chargées même si le fil est fermé.
Un post inaccessible ou inexistant est omis. Une liste vide renvoie `{}` ; plus de
20 ids provoque `WALL_ACTIVITY_LIMIT`. Les deux RPC sont explicitement réservées
à `authenticated` et justifiées dans l'allowlist SECURITY DEFINER.

Le Feed hydrate les nouveaux posts par page avant de les afficher ; une activité
omise affiche une indisponibilité et ne déclenche pas de lecture individuelle.
Les mutations et la pagination des réponses gardent leurs adaptateurs existants.
Comme avant PR4, les activités déjà montées ne sont pas relues au polling de
60 secondes : seule la première page de posts est relue, puis l'activité des
nouveaux ids éventuels, mis en attente derrière « New posts ». Blocage/invalidation
et remontage permettent une nouvelle lecture. Aucun cache persistant n'est ajouté.

Avant migration, seuls `PGRST202` et `42883` déclenchent le repli : activité
unitaire pour chaque post, posts inaccessibles omis ; feed public indisponible,
sans substitution par le feed privé. Les autres erreurs restent des erreurs anglaises
ne révélant pas les détails SQL.

### Requêtes réseau (hors profil, médias et mutations)

| Volume                                        | Avant                      | Après migration    | Avant migration, repli  |
| --------------------------------------------- | -------------------------- | ------------------ | ----------------------- |
| Une page de 20 posts                          | 21 (1 feed + 20 activités) | 2 (1 feed + 1 lot) | 22 (dont 1 RPC absente) |
| Trois pages de 20 posts, après deux Load more | 63                         | 6                  | 66                      |
| Une page actuelle de 10 posts                 | 11                         | 2                  | 12                      |
| Trois pages actuelles de 10 posts             | 33                         | 6                  | 36                      |

Le plafond reste 20, la taille actuelle du Feed reste 10. Le regroupement supprime
le N+1 **réseau** ; côté SQL le lot délègue au lecteur unitaire pour conserver une
seule implémentation des ACL et de la projection. Un polling sans nouveaux ids
reste une seule requête de feed, sans requête d'activité supplémentaire.

### Index et taille

Le 25 octobre 2026, une lecture seule sur le VPS (transactions en lecture seule)
mesure 9 posts : heap 8 192 octets, index 49 152, total 65 536. Les index existants
sont les unicités `id` / `media_path` et `(user_id,created_at DESC,id DESC)` ; ce
dernier ne couvre pas le tri global. La nouvelle migration ajoute uniquement
`profile_wall_posts_timeline(created_at DESC,id DESC)`, avec `lock_timeout=3s`
comme PERF-04. Cet index a été appliqué avec la migration PR4 le 25 octobre 2026.

Sur PGlite, une fixture de 10 050 posts mesure heap 942 080 octets, index
2 351 104, total 3 325 952. EXPLAIN de la lecture avec curseur et limite 21 montre
`Limit → Index Only Scan using profile_wall_posts_timeline`, avec condition sur
`ROW(created_at,id)` et sans `Sort`. Comme PERF-04, `enable_seqscan=off` vérifie
l'éligibilité de l'index ; ce n'est pas un benchmark de latence en production.

## PR5 — Everyone livré

Les onglets sont Feed, Everyone, Friends. `SocialFeedProvider` conserve deux
instances indépendantes de `createSocialFeedStore` dans le layout : pages,
curseurs et posts en attente ne sont jamais mélangés. `SocialFeed` sélectionne sa
source amis ou publique ; composer, mur, interactions, médias et modération sont
réutilisés. Aucun changement SQL ni migration dans PR5.

La première page publique sert de sonde de disponibilité et reste dans son store
(activité groupée une fois pour cette page). À l'ouverture d'Everyone, la reprise
relit la première page mais réutilise son activité déjà chargée. L'onglet
n'apparaît qu'après réponse de la RPC, même sur liste vide.
`PGRST202`/`42883` signalent une indisponibilité explicite : onglet masqué et
redirection de `/social/everyone` vers `/social`. Les autres erreurs gardent le
mapping anglais et un bouton de réessai, sans exposer l'erreur SQL.

Après cette sonde, seul le feed affiché relit sa première page toutes les 60 s ;
aucune lecture en arrière-plan, reprise à la visibilité. « New posts » reste
nécessaire pour insérer les nouveaux posts. Blocage et suppression invalident
les deux stores ; publication et signalement déclenchent une relecture du feed
actif, sans insertion automatique des posts d'autrui. Seul le feed actif est relu. Une publication
sur son mur reste immédiate ; si le profil est privé, le composer le précise,
renvoie vers `/settings` et n'insère pas le post dans Everyone.

PR6 ajoute les actions d'amitié aux en-têtes des posts Everyone sans lecture
supplémentaire de relation ; les liens vers les profils sont conservés.

### Suites connues (non implémentées)

- Suppression immédiate des médias de réponses d'autrui en cascade lors d'une
  suppression de compte : voir l'inventaire RGPD ; la purge opérateur les récupère.
- Profil encore sur l'activité unitaire ; seuls les feeds utilisent les lots.

## PR6 — relation dans Everyone

Migration `20261025200000_everyone_relationship.sql` : **appliquée sur le VPS le 25 octobre 2026**.
`get_public_wall_feed` garde sa signature, `{items,next}`, son ACL et sa pagination.
Chaque item ajoute `relationship`, dérivé de `friendship_state(viewer,author)` :

| Valeur             | Sens                                                   |
| ------------------ | ------------------------------------------------------ |
| `self`             | Auteur égal au lecteur ; aucune action                 |
| `friends`          | Amitié acceptée ; aucune action, pour un en-tête sobre |
| `outgoing_pending` | Demande envoyée ; état Request sent et annulation      |
| `incoming_pending` | Demande reçue ; Accept et Decline                      |
| `none`             | Aucun lien ; Add friend                                |

`requestId` contient uniquement l'id de la demande reçue en attente de cet auteur,
sinon `null`. Aucune liste d'amis, aucun autre identifiant de demande ni donnée
privée n'est ajouté. Le feed Friends (`get_home_wall_feed`) reste inchangé.

`FriendAction` accepte cet id directement tout en gardant sa lecture historique
pour les autres surfaces. Après envoi/annulation/acceptation/refus, le store met à
jour tous les posts affichés et en attente du même auteur, sans relire le feed,
et invalide les compteurs sociaux. Une réponse réseau commencée avant l'action
ne peut pas rétablir l'ancien état. Le polling suivant peut relire l'état serveur.
Le repli de conflit d'envoi qui relit les amitiés est désactivé pour Everyone :
les messages anglais existants sont gardés, sans lecture de relation supplémentaire.
Avant migration, l'absence de `relationship` masque simplement l'action.

La RPC `cancel_friend_request(uuid)` est ajoutée faute d'annulation existante :
seul l'émetteur peut supprimer sa demande encore pending, sous le verrou de paire
social existant. Une amitié acceptée ou une demande reçue ne peut pas être
supprimée par cette RPC. EXECUTE est réservé à authenticated, signature justifiée
dans l'allowlist ; aucun droit d'accès direct aux tables n'est ajouté.

**Constat de PR6 avant les garde-fous ci-dessous** : aucun quota temporel d'envoi ni plafond
d'amis dans `send_friend_request`. Authentification, interdiction de soi-même,
existence de cible, blocage bilatéral, verrou par paire et unicité de la paire
étaient les garde-fous. Un refus puis un nouvel envoi étaient possibles immédiatement.

## Garde-fous des demandes d'amitié

Migration `20261026010000_friend_request_limits.sql` : **non appliquée sur le VPS**.

### Notifications : constat avant migration

Le trigger `notify_friend_request` crée une notification à chaque nouvelle
demande. L'unicité `(user_id,type,reference_id)` déduplique seulement le même
id de demande : annuler puis renvoyer crée un autre id et une autre notification.
L'annulation et le refus supprimaient la demande mais gardaient la notification,
dont l'acteur devenait « Deleted player ». Une acceptation gardait la notification
avec le nom de l'émetteur. Le compteur de demandes reçues comptait déjà seulement
les demandes encore pending, d'où un historique de notifications incohérent.

Après migration, un trigger privé retire la notification exacte de la demande
pending résolue par annulation, refus ou acceptation, dans la même transaction.
Les suppressions lors d'un blocage profitent également de ce nettoyage. Les
notifications friend_request historiques sans demande pending sont nettoyées une
fois ; aucun autre type de notification n'est touché. Une nouvelle demande après
expiration du délai produit une seule notification courante.

### Quota et délai retenus

- **30 envois réussis par émetteur sur 24 heures glissantes**. Le seuil laisse
  découvrir un groupe de joueurs, tout en bornant les notifications contrairement
  à un quota par jour civil qui permettrait une rafale à minuit. Annulation,
  refus et acceptation ne remboursent pas ces envois. Les erreurs et doublons ne
  consomment pas de quota. Code `FRIEND_REQUEST_LIMIT`.
- **24 heures avant de renvoyer à la même cible** après annulation de l'émetteur
  ou refus du destinataire. Le délai est directionnel : une autre cible et la
  demande inverse restent indépendantes, sans révéler la trace au destinataire.
  Code `FRIEND_REQUEST_COOLDOWN`.
- Une acceptation mutuelle efface les anciens délais des deux sens, sans effacer
  les envois comptés. Retirer ensuite une amitié acceptée n'ajoute aucun délai.
- Le blocage bilatéral reste prioritaire : `ACTION_UNAVAILABLE`, même si le quota
  ou le délai sont atteints. Aucune limite existante n'est abaissée ailleurs.

Les signatures de `send_friend_request`, `cancel_friend_request` et
`respond_friend_request` sont conservées. Un verrou par émetteur sérialise les
contrôles de quota pour des cibles différentes. Le helper privé
`lock_friend_request_pair` prend d'abord les verrous partagés de suppression des
deux comptes dans un ordre stable, puis le verrou social de paire existant, avant
toute mutation de demande ou de trace. Aucun droit EXECUTE API pour les helpers.

Messages anglais communs à FriendAction (Everyone, profil et recherche) :
« You've sent too many friend requests. Try again later. » et
« You can send a new request to this player later. ». Avant migration, les codes
existants et le comportement du front restent inchangés.

### Trace et intégration au flux de données personnelles

`friend_request_events` ne contient que la paire directionnelle, le type
`sent`/`closed` et la date. Aucun id de demande, texte, motif de refus ou contenu
de notification. RLS activée ; aucun accès direct pour public, anon,
authenticated ou service_role. Les gardes de suppression de compte s'appliquent
aux écritures et références, comme pour les autres tables de données joueur.

La fenêtre utile est de 24 h. Les envois nettoient les traces expirées de leur
émetteur ; le job horaire `purge-friend-request-events` purge toutes les traces
expirées (normalement dans l'heure suivante). Aucun historique à long terme.
La migration reprend les envois récents dont la ligne friendships existe encore ;
les demandes déjà annulées/refusées avant migration ne sont pas reconstituables.

Les deux clés étrangères ciblent les profils avec ON DELETE CASCADE : la
préparation de suppression retire toutes les traces impliquant le joueur dès
qu'elle supprime son profil, avant la suppression Auth. Une suppression Auth
cascade aussi. Aucun changement du protocole de suppression de compte n'est
nécessaire, et aucune trace d'une relation à un compte supprimé n'est conservée.

L'export existant, réservé au serveur et soumis à réservation, ajoute uniquement
les événements récents dont le demandeur est l'émetteur : type, date et pseudo
du destinataire, sans UUID d'autre joueur. Il n'expose pas au destinataire les
quotas/délais d'un autre émetteur. Même snapshot et plafonds de 100 000 lignes et
25 Mio pour le fichier complet. L'inventaire d'export classe explicitement cette
nouvelle table ; aucun nouvel endpoint ou droit de lecture API n'est ajouté.

## Nettoyage RGPD des médias du mur

### Inventaire avant cette PR

| Chemin                                        | Suppression des octets et responsable                                                                                                                                                       | Échec ou interruption                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post supprimé par son auteur                  | SQL supprime le post et ses réponses ; navigateur `ProfileWall` puis `liveWall.discard` : seulement le média du post. Les médias des réponses en cascade restent.                           | Retry en mémoire pour le fichier du post ; perdu à la fermeture de page.                                                                                                         |
| Réponse supprimée par son auteur              | SQL renvoie `deletedMediaPath` ; navigateur `WallPostInteractions` puis Storage avec la policy propriétaire.                                                                                | Retry file cleanup en mémoire ; fermeture de page peut laisser le fichier.                                                                                                       |
| Réponse supprimée par le propriétaire du post | Reçu privé chemin + id exact ; action serveur `discardModeratedReplyMedia`, API Storage avec clé serveur.                                                                                   | Reçu persistant et retry dans le composant monté.                                                                                                                                |
| Suppression admin                             | RPC collecte les fichiers du post et des réponses ; Server Action et API Storage serveur.                                                                                                   | Audit conserve les chemins pour retry. Avant cette PR, pas de revalidation de l'id exact lors du retry.                                                                          |
| Remplacement ou abandon de brouillon          | Upload seulement lors d'une tentative de publication. Après échec, remplacer/retirer le fichier appelle Storage depuis le navigateur. Choisir un fichier sans publier n'envoie aucun octet. | Retry en mémoire ; fermeture après upload sans publication laisse un orphelin.                                                                                                   |
| Blocage                                       | Ne supprime ni post, ni réponse, ni fichier ; modifie la lisibilité.                                                                                                                        | Aucun nettoyage : le contenu existe toujours.                                                                                                                                    |
| Suppression de compte                         | Serveur : fence, manifeste SQL, API Storage par lots de 100 puis Auth. Tous les fichiers du compte, brouillons compris, sont retirés.                                                       | Échec Storage bloque Auth et reste réessayable. Les fichiers des réponses d'autres joueurs supprimées avec le mur ne figurent pas dans le manifeste limité au préfixe du compte. |

### Correction et garanties

Migration `20261026110000_wall_orphan_media.sql` : **non appliquée sur le VPS**.
Aucune migration existante modifiée. `delete_profile_wall_post(uuid)` garde sa
signature et son retour `text`, désormais un JSON sérialisé contenant
`mediaPath`, `mediaPaths`, `alreadyDeleted`, et `authorId` à la première suppression.
Les retries ne retournent que les chemins autorisés au demandeur. Post et réponses
sont verrouillés avant capture et suppression. `deleteWallPost` reçoit uniquement
l'id, appelle SQL avec la session du joueur, puis autorise chaque objet exact
avant nettoyage privilégié. Avant migration, le retour scalaire reste traité avec
le client Storage authentifié et sa policy existante, sans privilège serveur.

`delete_wall_content_core` crée les reçus privés pour les suppressions de post,
réponse et admin. La table existante `wall_reply_media_cleanup` ajoute contexte
et date ; `user_id` peut être NULL pour une réservation opérateur. RLS et absence
d'accès API restent en place, sans nouvelle table ni droit Storage navigateur.
`removeWallMedia` factorise validation et suppression par API Storage, par lots
de 100, pour auteur, propriétaire, admin et script. Un admin peut finir le nettoyage autorisé par un autre admin. L'admin revalide
le reçu exact : un ancien audit ne permet pas d'effacer un objet recréé.

Même id de post pour réessayer après échec : le manifeste reste disponible.
Un objet absent est déjà nettoyé. Le dialogue du post reste ouvert si le nettoyage
échoue ; après fermeture de page, la purge opérateur prend le relais. Les chemins
UUID autorisés sont à usage unique : le garde de liaison/upload interdit leur
réutilisation, y compris après suppression, pour éviter une course entre deux
nettoyages. Les reçus minimaux ne contiennent aucun octet/contenu et ceux des
joueurs gardent leur cascade Auth. Les réservations opérateur n'ont aucune
identité joueur ; ces capacités internes ne sont pas exportées.

### Purge opérateur (aucune tâche créée)

`get_orphan_wall_media(text,boolean)`, réservée à `service_role` dans l'allowlist,
page par nom à raison de 1 000 objets. `guard_wall_media_cleanup()` est dans
`ownerOnly`. La RPC exclut les références de posts/réponses, les objets de moins
de **24 h** et les reçus exacts actifs de moins de **24 h**. Sans `p_claim`,
aucune écriture. En application, elle recontrôle et réserve chaque objet sous le
verrou de liaison et le verrou d'objet : un brouillon publié depuis l'aperçu
n'est pas supprimé. Les fichiers sans date/id exploitable sont conservés ; une
taille inconnue compte pour zéro dans le total des métadonnées disponibles.

Configurer dans l'environnement `NEXT_PUBLIC_SUPABASE_URL` et
`SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`), jamais dans les arguments
ou les journaux. Depuis la racine :

```sh
node --env-file-if-exists=.env.local scripts/admin/purge-orphan-wall-media.mjs
node --env-file-if-exists=.env.local scripts/admin/purge-orphan-wall-media.mjs --apply
```

La première liste les chemins, le nombre et la taille totale, sans contenu.
La seconde exige un terminal et la saisie exacte **PURGE**, puis refait
l'inventaire avant suppression via **l'API Storage uniquement**, jamais par
suppression directe de `storage.objects`. Les secrets et erreurs brutes ne sont
pas journalisés. Après échec, relancer l'aperçu ; une réservation interrompue
redevient récupérable après 24 h.

Coolify peut planifier le **dry-run** avec ces variables et surveiller les totaux.
L'application non interactive est volontairement refusée : son automatisation
nécessiterait un mode opérateur séparément autorisé et supervisé. Aucune tâche
ni exécution du script contre le VPS dans cette PR.

### Suites identifiées

Le manifeste de suppression de compte et son garde de préfixe forment un autre
protocole que la suppression de contenu. Une suite doit y intégrer un manifeste
persistant d'objets tiers autorisés, réessayable après retrait du profil, pour
supprimer immédiatement les fichiers des réponses d'autrui en cascade. Cette PR
ne change pas ce protocole : la purge les retire après le délai de grâce quand
un opérateur l'exécute. Les brouillons abandonnés et les échecs après fermeture
de page sont aussi couverts par la purge, sans nettoyage automatique tant
qu'elle n'est pas exécutée. Le profil reste sur l'activité unitaire.
