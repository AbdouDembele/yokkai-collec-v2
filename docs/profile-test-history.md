# Transition des tests du profil

L’utilisateur a demandé le retrait des vues et de l’onglet Wishlist après la PR #241, puis confirmé la validation de Walid pour adapter les attentes dans une PR séparée. Cette PR ne contient ni code produit ni migration.

Le contrat historique des vues conserve intégralement ses assertions et rejoue le schéma jusqu’à `20261015000000_profile_active_auctions.sql`. Le nouveau retrait et les likes doivent être testés sur le schéma courant dans la PR produit suivante.

Deux contrôles statiques UI suivent désormais le compteur Wishlist lorsqu’il existe : bouton ouvrant le dialogue, respect de la confidentialité, grille conservée et absence d’onglet Wishlist. Sur la version précédente, leurs assertions d’origine restent exécutées. Les tests de filtres et de liens de `FriendWishlist` restent inchangés et lisent toujours le code actuel. Aucun test ne lit de fixture à la place du code.

Le script `scripts/browser-proof-profile.mjs` est conservé intact comme preuve de l’interface #241 (vues et onglet Wishlist). La nouvelle version dispose d’une preuve navigateur distincte couvrant les nouveaux accès et l’absence d’écriture de vues, plus les régressions conservées du profil.
