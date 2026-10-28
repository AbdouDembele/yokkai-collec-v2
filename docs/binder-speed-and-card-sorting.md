# Chargement et tri des cartes de classeurs

Le sélecteur de tri de la collection n'était pas transmis au RPC des classeurs : le serveur classait toujours les cartes par nom. La migration `20261025130000_fast_binders_and_rarity_sort` ajoute une surcharge bornée prenant le tri demandé. Le client transmet ce choix pour sa collection et les collections de profils ; un changement de tri revient à la première page du classeur.

Le tri par défaut est **LR, SSR, SR, R, C**, puis nom et UUID pour un ordre stable. Le tri est calculé avant pagination sur tout le classeur. Les choix par nom, plus récent et plus ancien restent utilisables. Les tris chronologiques utilisent respectivement la dernière et la première obtention d'un exemplaire possédé ; les cartes manquantes viennent ensuite. L'ancien RPC à huit arguments reste compatible et utilise le tri par rareté.

La rareté reste celle de la carte du catalogue, comme dans l'affichage existant. Aucune rareté, date d'obtention, carte, source, préférence ou donnée joueur n'est modifiée. Les filtres conservent leurs règles existantes.

Le chargement de la liste des classeurs calcule une seule projection pour les compteurs, les favoris, les conflits et la recherche. Les titres de recherche sont dédupliqués avant agrégation. L'ouverture d'un classeur cherche d'abord ses cartes candidates par licences et médias indexés, puis vérifie leur appartenance avec la projection canonique ; cela conserve les exclusions, exceptions, licences secondaires et preuves sans relire tout le catalogue pour chaque ouverture.

Les contrôles du classeur peuvent revenir à la ligne lorsque la largeur est insuffisante, notamment sur tablette avec le bouton wishlist ajouté précédemment. Les filtres repliés de Walid sont conservés.

Les règles de visibilité et limites de pagination restent inchangées. La nouvelle surcharge est réservée à `authenticated`, avec le même contrôle propriétaire/ami que l'ancienne. La liste de sécurité documente précisément cette signature supplémentaire ; aucune assertion existante n'est supprimée ou assouplie. Les limites SQL restent à trois secondes pour les requêtes publiques et huit secondes pour les joueurs.

La recette compare les résultats des classeurs avant/après, y compris les favoris historiques et explicites, les ambiguïtés, la recherche, les filtres de catégories et le mode précédent. Le tri est vérifié sur 85 cartes réparties sur plusieurs pages, avec des noms contraires à l'ordre des raretés et des exemplaires possédés en plusieurs dates. Le catalogue complet et les 51 favoris historiques font également l'objet d'une recette PostgreSQL isolée.
