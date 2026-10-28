# Mur du profil

L’onglet Mur remplace l’ancien onglet Complétion. La complétion des classeurs favoris reste dans le Tableau, sous la vitrine. Seul le propriétaire publie sur son mur et supprime ses propres publications ; les visiteurs n’ont aucun formulaire d’écriture.

Une publication contient jusqu’à 3 000 caractères et une pièce jointe facultative : image JPG/PNG/WebP/GIF importée (6 Mo maximum) ou GIF choisi avec le sélecteur GIPHY existant. Aucun HTML n’est interprété. Le brouillon reste présent après une erreur. Une clé de requête empêche un retry de créer deux publications ; les doubles clics sont verrouillés côté client. L’auteur peut supprimer une publication après confirmation.

## Confidentialité

Les profils restent dans l’espace authentifié existant : public = tous les joueurs connectés ; privé = propriétaire et amis acceptés uniquement. La visibilité est évaluée à chaque requête, sans copier un indicateur public/privé dans chaque publication. Les blocages bilatéraux et les comptes en cours de suppression sont exclus. Les RPC et la lecture directe RLS appliquent la même règle ; les droits anon ne sont pas élargis.

Le bucket `profile-wall-media` est privé. Les images ne réutilisent ni le bucket public des avatars, ni des URL publiques ou signées durables. `/api/profile-wall/media/[id]` utilise la session du demandeur, contrôle le post via RLS puis télécharge le fichier via RLS, sans clé service-role. La réponse est `private, no-store`, avec `Vary: Cookie`, `nosniff` et des signatures raster vérifiées. Un changement de confidentialité retire l’accès aux prochaines requêtes, y compris sur une URL déjà connue. Comme pour tout contenu consulté, cela ne peut pas retirer les fichiers déjà téléchargés par une personne précédemment autorisée.

Les fichiers sont immuables et ne peuvent pas être retirés tant qu’un post les référence. Un brouillon abandonné après upload échoué peut rester privé : il compte dans le quota et est nettoyé lors d’un changement de pièce jointe ou de la suppression du compte. Un échec de nettoyage est visible et relançable dans l’interface.

## Limites et cycle de vie

- Pages de 20 posts, curseur date/ID et limite serveur, sans chargement de tout le mur.
- 500 publications conservées maximum par utilisateur ; 30 publications par heure, espacées d’au moins 5 secondes. Le calcul et l’écriture sont sérialisés par auteur.
- Budget de stockage privé de 100 Mio par utilisateur, brouillons inclus, avec uploads sérialisés. Une marge de 6 Mio est réservée avant chaque nouveau fichier.
- Les posts sont inclus dans l’export personnel ; l’export de fichiers contient leurs métadonnées, sans chemins internes ni URL d’accès.
- La suppression du compte inclut posts et fichiers du mur. Le manifeste reste limité aux buckets personnels `avatars` et `profile-wall-media` et au préfixe exact du propriétaire ; les assets du catalogue restent refusés. Les gardes/tombstones et le nettoyage par les API Storage/Auth sont conservés.

## Validation locale

L’aperçu `/design-system/profile-preview` utilise exclusivement des données et écritures mockées pour le mur. `?visitor=1` simule un visiteur, `?visitor=1&private=1` un visiteur non autorisé, `?visitor=1&private=1&friend=1` un ami autorisé, `?wallError=1` un échec de publication. Aucun post, upload ou appel RPC du mur n’est envoyé à la production pendant ces essais.

Les tests jetables couvrent confidentialité public/privé, amitié retirée, blocages, médias privés, immutabilité, écriture/suppression uniquement par l’auteur, idempotence, bornes/rate limit/quota, pagination, export, gardes de suppression et cascade. Les tests HTTP couvrent réponses interdites, absence de cache et refus SVG/HTML déguisés. La preuve navigateur couvre texte échappé, image, GIF importé, suppression, brouillon conservé et mobile.

Migration : `20261014000007_profile_wall.sql`, dépendante du dashboard `20261014000006_profile_dashboard.sql`. Aucune des deux n’est appliquée sur le VPS dans ce travail local.
