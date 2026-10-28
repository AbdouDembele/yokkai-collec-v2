# Modération des DM et des médias du mur (#379, C1)

## Signalement

- `report_user(..., 'private_message', <id message>)` : seul le destinataire d'une conversation encore visible (amis acceptés, aucun blocage, comptes actifs) peut signaler un message reçu, non masqué, écrit par le joueur signalé. Snapshot : `{ message, gifUrl }`, rien d'autre.
- Les médias du mur (image ou GIF) se signalent avec le post ou la réponse (`wall_post`, `wall_reply`, #496). Le snapshot du mur ne garde toujours pas le chemin de l'image (décision de #496) ; l'admin voit l'image **actuelle** via `/api/admin/reports/<report>/media`.
- Limites existantes, communes à tous les contextes : un signalement par joueur et par contenu (`REPORT_DUPLICATE`), 10 par jour UTC (`REPORT_LIMIT`). Aucune nouvelle limite.

## Retrait admin (`admin_moderate_reported_content`)

- DM : texte et GIF effacés en base, `moderated_at` renseigné ; les deux joueurs voient « Message removed by moderation. ». Journal `private_message.moderate`.
- Mur : seul le média est retiré (image ou GIF), le texte reste. Un post ou une réponse sans texte est refusé (`MODERATION_TEXT_REQUIRED`) : utiliser « Delete content ». Journal `wall_media.moderate`.
- Codes stables : `ADMIN_REQUIRED`, `REPORT_INVALID`, `MODERATION_TEXT_REQUIRED`. Le snapshot du signalement est conservé comme preuve.

## Caches : ce qui sert encore un média retiré

- **Images du mur** : bucket Storage privé `profile-wall-media`, lu seulement par les routes authentifiées `/api/profile-wall/...` avec `Cache-Control: private, no-store` et `Vary: Cookie` ; pas de `next/image`. Le retrait supprime l'objet Storage (reçu de nettoyage puis suppression serveur, comme « Delete content ») : la route répond 404 dès la requête suivante. Si la suppression du fichier échoue, l'action admin le signale et peut être relancée.
- **GIF (DM et mur)** : chargés directement depuis GIPHY, jamais servis ni mis en cache par nos serveurs. Le retrait efface l'URL en base ; le fichier reste chez GIPHY, mais n'est plus affiché. Un onglet déjà ouvert le garde jusqu'au prochain rafraîchissement (3 s pour un DM ouvert).
- **Cloudflare** : rien à purger tant qu'aucune règle ne force la mise en cache des réponses `private, no-store`. À vérifier une fois à la main dans le tableau de bord (Caching → Cache Rules) : aucune règle « Cache Everything » ne doit couvrir `/api/*`. Si une telle règle existe, la retirer ; une purge par URL (`/api/profile-wall/media/<id>`, `/api/profile-wall/reply-media/<id>`) demande alors un jeton Cloudflare et reste une action manuelle, non automatisée ici.

## Déploiement

1. Appliquer `20261028100000_dm_wall_media_reports.sql` via `scripts/deploy-migrations.sh`.
2. Déployer le front. Avant la migration, le bouton « Report » d'un DM répond « Reporting this content isn't available yet. » et la liste DM n'affiche aucun message masqué ; l'admin n'a aucun signalement DM à traiter.

# Rating GIF imposé côté serveur (#379, C2)

## Fonctionnement

- Le rating d'un GIF n'est pas dans son URL. Quand un joueur choisit un GIF, le sélecteur appelle `POST /api/gifs/verify` (joueur connecté). La route interroge `api.giphy.com/v1/gifs/<id>` avec `GIPHY_API_KEY` (à défaut `NEXT_PUBLIC_GIPHY_API_KEY`) et enregistre le rating via `record_giphy_gif_rating` (service_role uniquement) dans `giphy_gif_ratings`.
- Le trigger `guard_gif_rating` sur `private_messages`, `profile_wall_posts`, `wall_post_replies` et `auction_chat_messages` refuse toute écriture de GIF par un joueur dont l'identifiant (segment avant le nom de fichier) n'est pas enregistré avec `g`, `pg` ou `pg-13` : code `GIF_RATING_REJECTED`. `y`, `r` et tout rating inconnu sont refusés.
- Avant tout appel à GIPHY, la route exécute `consume_gif_verification` avec la session du joueur : compte banni refusé (403), au plus 20 vérifications par minute et 200 par jour et par joueur (429, `GIF_VERIFY_RATE_LIMITED`). Un rating vérifié depuis moins de 7 jours est réutilisé sans appel GIPHY. Seul l'identifiant validé (`[A-Za-z0-9_-]{1,64}`) part vers l'URL fixe `api.giphy.com/v1/gifs/<id>`.
- Côté client, le sélecteur ne montre que les résultats `g`, `pg` ou `pg-13` (en plus du paramètre `rating=pg-13` de la recherche) et refuse un GIF que la route juge interdit.

## GIF déjà publiés au-dessus de pg-13

- Rien n'est supprimé ni masqué automatiquement : le trigger ne vérifie que les nouvelles écritures de joueurs. Les lignes existantes restent affichées, et les modifier sans toucher au GIF reste possible.
- Ils se signalent et se retirent avec les outils de C1 (« Hide message », « Remove media »).
- Inventaire en lecture seule, si besoin (à vérifier ensuite un par un avec l'API GIPHY, hors production) :
  `select gif_url from public.private_messages where gif_url is not null union select gif_url from public.profile_wall_posts where gif_url is not null union select gif_url from public.wall_post_replies where gif_url is not null union select gif_url from public.auction_chat_messages where gif_url is not null;`

## Caches

Aucun cache supplémentaire : un GIF refusé n'est jamais écrit, et les GIF sont chargés directement depuis GIPHY. La purge des médias retirés reste celle décrite plus haut (C1) ; la seule action manuelle est la vérification Cloudflare des règles sur `/api/*`.

## Déploiement

1. Déployer le front d'abord : avant la migration, la route vérifie et filtre sans pouvoir enregistrer (la RPC n'existe pas encore), et les envois de GIF marchent comme avant.
2. Appliquer `20261028130000_gif_rating_pg13.sql`. Dans l'ordre inverse, l'ancien front n'appelle pas la route : tous les GIF seraient refusés jusqu'au déploiement du front.
