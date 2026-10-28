# Feuille de route du panneau social

## Étapes prévues

1. Visibilité de la liste d’amis — réglage de chaque joueur
2. Partage de carte
3. Blocage et signalement
4. Likes de profil
5. Boucle d'échange : doublons à échanger, correspondance avec la wishlist et message dans l'offre
6. Présence en ligne — déjà livrée
7. Plus tard : fil d'activité, classements, invitation et webhook Discord

## Décisions prises

- Tout joueur connecté peut liker un profil, avec un seul like par joueur et un plafond quotidien.
- L'historique des likes n'est visible que par le propriétaire du profil.
- Chaque joueur règle la visibilité de sa liste d’amis. Actuellement ce choix utilise le réglage de profil public : un profil public expose sa liste, un profil privé la réserve au propriétaire, y compris face à un ami.
- Le propriétaire conserve l’accès à sa liste sur son profil et sur /friends.
- Une future PR ajoutera un compteur de likes sur le profil public.
- La présence en ligne est déjà livrée : la RPC ne renvoie les statuts et dernières activités que pour les amitiés acceptées du joueur connecté, sans compteur global.
- Un réglage permet d'« apparaître hors ligne ».
- La page publique d'une carte partagée est visible sans compte.
- Au moment du partage, une option cochée permet d'afficher le pseudo sur cette page.
- La page publique d'une carte partagée publie l'image de l'exemplaire choisi, personnalisée si présente, sinon celle du catalogue.
- La feuille de partage est accessible depuis le détail d'une carte possédée et depuis le reveal
  final des SSR, LR ou Shiny conservées. L'option « Afficher mon pseudo » est décochée par défaut.
  Elle propose le lien, le partage natif et les téléchargements story/carré. La Collection donne
  accès à « Mes liens partagés », avec suppression confirmée et liste réservée au propriétaire.
- Le nom, la franchise, la rareté, le statut Shiny et, avec accord explicite, le pseudo sont figés
  à la création. L’illustration reprend l’image personnalisée de l’exemplaire choisi, ou celle du
  catalogue. Recliquer sur « Partager » actualise l’illustration du lien existant sans nouvelle
  création, y compris lors du retour à l’image du catalogue. Les autres champs restent figés.
- Le plafond est de 10 créations par joueur et par jour UTC, pas de 10 liens actifs.
  Supprimer puis recréer un partage consomme une nouvelle création. La même combinaison
  carte/Shiny/affichage du pseudo réutilise un lien encore existant sans consommer ce plafond.
  Les événements de création sont conservés indépendamment des suppressions ; ceux du joueur
  de plus de 7 jours sont nettoyés dans la fonction de création, sans tâche planifiée.
- La carte partagée se rattache au catalogue `cards`, lisible par `anon`. Le catalogue et ses
  identifiants restent donc récupérables à partir des données publiques.
- La page publique valide l’illustration comme le rendu social : HTTPS, origine Supabase exacte
  et préfixe du bucket `card-images`, ou origine Imgur exacte (`i.imgur.com` / `imgur.com`) pour
  les images personnalisées. Les identifiants dans l’URL et les autres origines sont refusés.
  Sinon, elle montre un cadre avec le nom de la carte. Le rendu social refuse les redirections
  et contrôle le format, la taille et la signature de l’image téléchargée.
- Les images sociales ne sont pas stockées dans Supabase Storage : Next.js les produit avec
  `ImageResponse`, les conserve dans un cache mémoire LRU borné à 32 Mio et mutualise les rendus
  simultanés d'une même image. La clé de ce cache inclut l’illustration : une nouvelle image
  n’est pas masquée par le PNG précédent. Une copie HTTP fraîche peut garder l’ancienne image
  jusqu’à 300 secondes, et les plateformes sociales conservent leurs propres aperçus. Les
  téléchargements depuis la feuille de partage demandent toujours le PNG à jour au serveur.
- Les PNG ont un cache HTTP `public, max-age=300, must-revalidate`, sans `immutable` : cinq
  minutes limitent les requêtes répétées tout en bornant la fraîcheur après suppression.
  Chaque requête d'image atteignant Next.js vérifie le partage par un appel RPC à la base avant
  toute lecture du cache mémoire (un appel SQL par image servie par le serveur). Une réponse
  servie par un cache HTTP ne consulte pas la base. La page est dynamique et sans stockage HTTP
  (`private, no-cache, no-store, max-age=0, must-revalidate`). Les 404 d'image restent `no-store`.
  Les copies reçues avant cette politique peuvent suivre l'ancien en-tête jusqu'à expiration.
- Un joueur peut supprimer ses liens. La prochaine requête d'image au serveur répond alors 404 ;
  une copie HTTP encore fraîche peut rester visible jusqu'à 300 secondes. Discord et WhatsApp
  conservent leur propre copie de l'aperçu après suppression : supprimer le partage n'efface pas
  ces copies et l'application ne contrôle pas leur durée de conservation.
- Limite connue de Next.js 16 : pour un partage inconnu, la page « introuvable » et sa balise
  `noindex` sont bien rendues, mais le shell diffusé avant la vérification conserve le statut HTTP 200. Les routes d'image vérifient l'existence avant tout rendu et répondent, elles, avec un vrai
  statut HTTP 404. Le proxy ne fait volontairement aucune requête supplémentaire à la base.

## Blocage et critères d’acceptation

- Le blocage coupe demandes d’amis, amitié, échanges en attente et notifications d’interaction. Les profils et enchères restent consultables ; les mises restent autorisées.
- Le chat masque côté serveur au bloqueur les messages des joueurs qu’il a bloqués, avant la limite des 100 messages. Les mentions entre joueurs bloqués ne produisent pas de notification.
- Le joueur bloqué peut constater l’amitié retirée et les offres annulées, mais ne reçoit aucune notification ni message nommant le blocage. Débloquer ne restaure rien.
- Présence déjà livrée : après blocage, aucune présence ou dernière activité de l’autre joueur ne doit être accessible par get_friendships ; cette restriction est testée côté serveur.
- Likes de profil à venir : refuser les likes dans les deux sens lorsqu’un blocage existe ; ne produire aucune notification ou erreur révélant le blocage.
- Messages dans les offres d’échange à venir : refuser l’envoi dans les deux sens lorsqu’un blocage existe, appliquer la restriction côté serveur et ne créer aucune notification d’interaction.
