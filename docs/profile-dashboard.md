# Profil avec tableau et onglets

L’identité, la date d’inscription et les statistiques occupent un panneau à gauche sur ordinateur et passent au-dessus sur mobile. Les onglets à droite sont dans l’ordre : Tableau, Mur, Activité, puis Amis si visible. La Wishlist est accessible via son compteur à gauche, et non via un onglet. La page atteint 1440 px sur grand écran et le panneau gauche mesure de 360 à 440 px selon la largeur disponible ; sa bannière atteint 190 px et ses textes sont agrandis sur ordinateur, sans réduire l’espace du contenu à droite.

Dans l’onglet Tableau, la vitrine « Cartes mises en avant » apparaît en premier, puis « Complétion » avec la progression des classeurs favoris. Cet ordre est identique dans le DOM, sur ordinateur et sur mobile. Les deux colonnes partagent la même hauteur sur ordinateur : le bas de la fiche profil reste aligné avec celui du contenu à droite. La grille s’adapte au contenu sans hauteur fixe. Les compteurs Cartes/Différentes/Wishlist/Likes apparaissent juste sous les actions, suivis des boosters et LR/SSR. La date « Membre depuis » termine la fiche et reste ancrée en bas dans le Tableau. Les autres onglets conservent leur panneau sticky ; le mobile garde deux blocs superposés de hauteur naturelle. Le nombre d’amis reste dans son onglet.

Le compteur Wishlist est un bouton avec le même contour doré au survol/focus que Cartes. Il ouvre l’ancienne modale complète des amis (`FriendWishlist`) pour le propriétaire et les visiteurs autorisés : recherche, rareté, catégorie, réinitialisation, compteur de résultats et liens vers le catalogue conservés. Une wishlist vide ouvre le message existant. Pour un profil privé non autorisé, le compteur affiche « Privée », reste désactivé et la modale ne peut pas s’ouvrir. La page Wishlist globale du site n’est pas supprimée.

Un clic normal sur une carte de cette wishlist ouvre `CatalogueCardModal` par-dessus la liste, sans navigation : valeur de marché, possesseurs, ajout/retrait de sa propre wishlist et signalement. Fermer le détail restaure le focus sur la carte et conserve les filtres de la liste. Les clics modifiés gardent le lien vers le catalogue pour ouvrir un nouvel onglet. Les actions et permissions du catalogue sont réutilisées, sans édition des exemplaires d’un autre joueur.

Dans la collection d’un joueur consulté, ses classeurs favoris précèdent les autres, avant pagination. La migration `20261015000002_friend_album_favorites.sql` utilise le propriétaire consulté, jamais les favoris du visiteur, et conserve le tri de progression à l’intérieur des groupes. Les licences secondaires, la recherche, la catégorie, la limite de 72 classeurs et la confidentialité restent inchangées. Cette migration de lecture n’est PAS appliquée sur le VPS ; elle ne modifie aucun favori enregistré.

## Ventes dans Activité

L’onglet Activité commence par les cartes actuellement en vente du joueur, puis conserve l’historique des acquisitions/achats/ventes. Les ventes sont chargées uniquement à l’ouverture de l’onglet, par pages de 20, filtrées par vendeur côté serveur et limitées aux enchères actives non échues. Le bouton Actualiser recharge la première page ; Voir plus utilise un curseur immuable date de création/ID.

Un clic ouvre une modale compacte sur place réutilisant `AuctionView` : prix, temps restant, mise rapide ou montant libre, solde, suivi, historique et chat. Les RPC du marché restent inchangés et seuls responsables des fonds, des droits et de l’anti-sniping. Le vendeur ne peut pas miser sur sa propre carte ; il peut confirmer son retrait si aucune offre n’existe. Une vente terminée devient non enchérissable. La modale actualise ses données toutes les trois secondes seulement quand la page est visible et arrête ses lectures à la fermeture. Les écritures sont verrouillées et un échec de relecture après une mise réussie n’est pas présenté comme un échec de mise.

Le flux vendeur respecte la confidentialité de la collection, les amis acceptés, les blocages bilatéraux et les gardes de suppression de compte. Aucun historique privé ni solde du vendeur n’est exposé. Migration `20261015000000_profile_active_auctions.sql` : nouvelle RPC de lecture uniquement, authenticated ; NON appliquée sur le VPS. L’aperçu local simule toutes les ventes, mises, suivis, retraits et messages sans écriture en production (`salesEmpty=1`, `salesError=1`, `auctionClosed=1`, `auctionError=1` pour les cas limites).

## Likes et retrait des vues

Sur le profil d’un autre joueur, le menu « … » se trouve à droite du pseudo, sur ordinateur comme sur mobile. Ses actions Signaler et Bloquer sont conservées ; le bouton d’amitié reste sous la biographie.

Le compteur « Voir la collection » retrouve un contour doré au survol, ainsi qu’un repère de focus clavier, sans modifier l’alignement des compteurs.

Le nombre de boosters ouverts apparaît sous son libellé, aligné à gauche comme les compteurs LR/SSR. Après transmission réussie d’un signalement, la notification partagée des paramètres apparaît en bas à droite : « Merci, ton signalement a été transmis. ». Une erreur conserve la modale et n’affiche pas de confirmation.

Un utilisateur connecté peut aimer le profil d’un autre joueur et retirer son like. Il ne peut pas aimer son propre profil ; une contrainte unique par paire empêche les likes multiples. Les écritures sont refusées entre utilisateurs bloqués, dans les deux sens. Les règles, verrous et gardes de suppression des likes sont inchangés.

Le profil ne compte plus les vues : aucun appel d’enregistrement à l’ouverture, aucun identifiant de visite et aucun compteur côté navigateur. `get_profile_engagement` ne retourne que likes et likedByMe. La migration `20261015000001_retire_profile_views.sql` retire le RPC `record_profile_view`, sans CASCADE. Les reçus historiques restent dans leur table privée, inaccessible aux joueurs et sans nouveau suivi ; une destruction définitive nécessiterait une autorisation séparée. Leurs gardes et la suppression par cascade lors de la fermeture du compte sont conservées. L’export personnel reste inchangé : chacun peut toujours récupérer ses données historiques conservées, sans exposer celles des autres. Les likes, verrous et permissions sont préservés. Cette migration n’est PAS appliquée sur le VPS dans ce travail local.

Le Tableau affiche la vitrine de cinq cartes puis la complétion des classeurs favoris de l’utilisateur : cartes distinctes possédées / total, pourcentage, barre de progression et nombre de favoris complétés. Les anciens widgets personnalisables et leur bouton d’édition sont retirés du profil. Les données déjà enregistrées ne sont pas supprimées.

Les anciennes préférences, RPC et protections d’export restent conservées pour compatibilité, ainsi que tous leurs tests. Leur éditeur n’est disponible que dans le harness de tests mocké `?catalogue=demo&widgets=1`, jamais activé par l’adaptateur du profil réel.

L’éditeur du profil propose aussi l’import d’une bannière JPG/PNG/WebP/GIF de 2 Mo maximum, depuis un ordinateur ou un téléphone, avec aperçu et suppression. Elle remplace le personnage de bannière, qui reste disponible comme alternative. Les fichiers utilisent le dossier du propriétaire dans le bucket `avatars`, ses règles existantes et son nettoyage lors de la suppression du compte. Le RPC d’apparence réutilise les validations existantes du profil et enregistre les changements atomiquement. Aucune URL externe de bannière n’est acceptée ; seul le fichier raster `banner` du compte connecté sur l’API est autorisé.

`get_profile_details` appelle d’abord `get_profile`. Les comptes dont la collection est privée conservent les restrictions existantes pour les statistiques, l’activité et les classeurs favoris ; la liste d’amis et les amis en commun suivent `friendsVisible`. Aucune permission directe supplémentaire sur les tables n’est accordée.

Le nombre de boosters combine le compteur des boosters réguliers et les ouvertures enregistrées de boosters décisifs. LR et SSR comptent les exemplaires actuellement possédés, y compris Shiny. La complétion compte les cartes distinctes, toutes licences secondaires comprises.

L’activité présente jusqu’à vingt acquisitions encore dans la collection et achats/ventes terminés enregistrés. Les prix ne sont pas affichés pour les acquisitions ordinaires. La date des ventes est celle de fin d’enchère. Les cartes détruites ne fournissent pas d’historique d’acquisition ; cette refonte ne crée pas de faux historique pour celles-ci.

## Test local

`/design-system/profile-preview` fournit un profil de démonstration sans écriture réelle. `?visitor=1` montre le profil visité et les amis en commun ; `?visitor=1&private=1` vérifie l’affichage privé. `?favorites=empty` vérifie les favoris vides. La bannière peut être modifiée temporairement pendant la session ; les fichiers importés utilisent des URL locales libérées à la fermeture. Le mode normal n’affiche aucun widget. `?catalogue=demo&widgets=1` est réservé aux tests de compatibilité de l’ancien éditeur et ne lit ni n’écrit le catalogue réel.

Migrations historiques déjà déployées : `20261014000006_profile_dashboard.sql`, `20261014000007_profile_wall.sql`, `20261015000000_profile_active_auctions.sql`. Nouvelle migration requise pour retirer les vues : `20261015000001_retire_profile_views.sql`, NON appliquée sur le VPS. Le mur et ses permissions sont détaillés dans [profile-wall.md](profile-wall.md).

La preuve actuelle est `node scripts/browser-proof-profile-wishlist.mjs` (données et écritures mockées). Le script `browser-proof-profile.mjs` conserve le contrat navigateur antérieur de la PR #241. Les adaptations de tests obsolètes sont isolées dans la PR #243, validées par Walid via confirmation de l’utilisateur ; la PR produit ne modifie pas ces assertions et dépend de cette préparation avant merge.

La preuve actuelle couvre aussi les détails de carte sur ordinateur/mobile, la pagination des possesseurs, le signalement simulé, l’ajout/retrait personnel sans modifier la wishlist visitée, le retour à la liste, les erreurs de chargement et les favoris du joueur dans le classeur. Les nouveaux tests `profile-wishlist-details` exécutent les clics du composant réel ; `friend-album-favorites-db` vérifie le tri et les permissions sur une base jetable. Les tests de pagination existants gardent leurs assertions strictes et vérifient en plus le nouveau champ `favorite: false`.
