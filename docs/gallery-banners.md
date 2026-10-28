# Bannières depuis la galerie

Importer un JPG, PNG, WebP ou GIF (4 Mio maximum) dans Modifier le profil.
Le cadrage existant conserve position, zoom et rotation ; le fichier original,
y compris l'animation GIF, est conservé. Les cartes possédées restent disponibles.

## Sécurité

Les fichiers passent par le bucket avatars existant et ses politiques owner-only.
La RPC n'accepte que les URL HTTPS du domaine Storage de production, dans le
répertoire de l'utilisateur connecté, nommées banner.jpg/jpeg/png/webp/gif.
Les URL externes, les fichiers d'autres joueurs et les sources ambiguës
(carte + import) sont refusés. Aucun élargissement des grants ou des politiques.

Migration : 20261016000002_restore_gallery_banners.sql, pas encore appliquée.
Elle remplace uniquement update_profile_appearance. Le cadrage atomique, les
protections contre les comptes supprimés et les restrictions de cartes possédées
restent inchangés. Aucun effacement ou changement des bannières existantes.

Contrat de tests séparé : PR #281, validée avec Walid par Abdou.
