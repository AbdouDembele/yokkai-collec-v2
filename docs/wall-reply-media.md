# Images et GIF dans les réponses du mur

Le composant partagé `WallPostInteractions` propose une image ou un GIF par réponse sur Home et sur le profil. Le texte reste limité à 1 000 caractères et devient facultatif avec une pièce jointe. Les uploads JPG, PNG, WebP et GIF utilisent le bucket privé existant, sa limite de 6 Mo et son quota de 100 Mo par joueur.

L'UUID de publication et l'upload sont conservés après un échec pour permettre une reprise sans doublon. L'aperçu est retirable et les suppressions de fichiers échouées proposent une nouvelle tentative. Aucun fichier n'est rendu public : la route `api/profile-wall/reply-media/[id]` vérifie la session, les droits sur le post parent et son auteur, puis les droits Storage du lecteur. Le type réel du fichier est contrôlé par signature et la réponse HTTP n'est jamais mise en cache.

La migration `20261021050000_wall_reply_media.sql` ajoute les champs des réponses, un RPC de publication avec média et un RPC de lecture de chemin limité. Les tables d'interaction restent inaccessibles directement aux joueurs. Les politiques Storage vérifient dynamiquement la visibilité du parent et de l'auteur. Une image ne peut être liée qu'à un seul post ou une seule réponse, pour ne pas mélanger les audiences. Les notifications existantes sont conservées ; l'export STABLE inclut uniquement les contributions du demandeur, sans chemin privé. Les limites de fréquence, de taille d'export et de nombre de réponses restent inchangées.

Home propose aussi `Delete post` en rouge sur les seuls posts du joueur connecté. Une confirmation est obligatoire ; un échec conserve le post et permet une reprise. Le RPC existant vérifie l'auteur côté serveur, supprime les interactions par cascade et renvoie seulement son propre fichier pour nettoyage.

## État de la migration

- Appliquée uniquement au Supabase local pour les essais.
- Non appliquée sur le VPS ; aucune donnée de production modifiée.
- Revue des droits SQL/Storage validée par Walid et créneau VPS confirmé par l'utilisateur le 21 octobre 2026 ; publication en préparation.
- Aucune assertion existante supprimée, assouplie ou ignorée. Les mocks d'interface prennent en charge les nouveaux imports et états ; de nouveaux cas couvrent les médias et la suppression.

## Contrôles ajoutés

- Pièce jointe sans texte, UUID idempotent et rejet des changements de contenu lors d'une reprise.
- Type/taille invalides, URL GIF non autorisée, chemin étranger ou déjà utilisé.
- Confidentialité de l'auteur, blocage, amitié supprimée, suppression et refus anonyme.
- Export, notifications, nettoyage propriétaire et absence de droit SELECT sur les réponses.
- Affichage des médias, aperçu retirable, bouton de suppression réservé à son auteur, confirmation, échec récupérable et protection contre le double clic.

La CI complète reste exclusivement exécutée dans GitHub Actions.
