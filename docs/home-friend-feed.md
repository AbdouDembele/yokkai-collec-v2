# Fil des murs d'amis sur Home

Fil chronologique en lecture seule des publications existantes de ses amis
acceptés, quel que soit le sens de la demande. Les profils publics non amis et
les demandes en attente n'y apparaissent pas. Les publications restent sur le
mur de leur auteur ; les liens ouvrent directement l'onglet Wall.

Le RPC `get_friend_wall_feed(timestamptz, uuid, integer)` utilise exclusivement
`auth.uid()` et conserve `can_read_profile_wall`, les blocages bilatéraux,
les barrières de suppression et l'exclusion des comptes bannis. Pages de 10
publications, plafond serveur 20, curseur stable `(created_at,id)` décroissant.
Les chemins de stockage ne sont pas exposés : les images utilisent toujours
`/api/profile-wall/media/<post-id>` et ses contrôles RLS sans service-role.

Actualisation au retour sur l'onglet et lors d'un blocage local. Une erreur
retire les données affichées avant de proposer une nouvelle lecture. Les médias
sont chargés à la demande. Aucun like, commentaire ou republication fictif.

Les interactions persistantes (likes et réponses) sont décrites dans
[wall-post-interactions.md](wall-post-interactions.md). Elles sont disponibles
dans le fil et sur le mur du profil pour l'auteur ou ses amis acceptés.

Home intègre également `ProfileWall` en mode `composerOnly` au-dessus du fil :
même texte, image/GIF, quotas, idempotence et conservation du brouillon après
erreur que sur le profil. Ce mode ne charge pas la liste du mur. Le profil
de l'auteur provient du RPC `get_profile` existant avec `p_identifier=null`,
et doit correspondre à l'identité déjà authentifiée de Home. Aucune lecture
directe de `user_profiles` ni extension de ses droits. Le RPC d'écriture utilise
toujours `auth.uid()` ; aucun nouveau droit ni migration pour le composeur.
Après publication, la confirmation est affichée et le post se trouve sur son
mur, pas dans le fil réservé aux amis.

## Migrations / publication

- `20261020230000_home_friend_feed.sql` : nouvelle lecture bornée uniquement.
- Appliquée uniquement au Supabase local (`supabase_db_Kara`, port 54322).
- Non appliquée en production ; validation ACL par Walid requise avant déploiement.
- Développement local au-dessus de l'essai Inter (PR #413), sans fusion de ce lot.
- Aperçu : `/design-system/home-preview` (échantillons, pagination, vide, erreur).
