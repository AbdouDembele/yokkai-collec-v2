# Pastilles sociales — DM et invitations

## Comportement

- **Message** : pastille `+N` des DM non lus provenant de cet ami, texte et GIF compris.
- **Friends** dans la navigation : petit compteur au-dessus à gauche du texte, total des DM non lus et demandes reçues encore en attente ; affichage plafonné à `99+`, sans plafonner le comptage SQL. L'ancrage relatif au texte ne décale pas les liens voisins.
- **Received requests** : pastille des invitations en attente, conservée jusqu'à acceptation ou refus. Ouvrir la page ne répond pas à une invitation.
- La cloche garde son propre état de lecture. Ouvrir la cloche ou marquer une notification comme lue ne lit pas une conversation.
- La conversation visible accuse réception après affichage d'une page chargée avec succès. Une offre de trade ouverte par-dessus suspend cet accusé. Aucun accusé lors d'un échec de chargement ou dans un onglet masqué.

## Synchronisation et sécurité

Flux partagé entre navigation et liste d'amis : notifications Realtime existantes, repli visible toutes les 15 secondes, focus/retour en ligne, invalidation entre onglets sans contenu privé. Les conversations gardent leur polling visible de 5 secondes. Les changements depuis un autre appareil sont rattrapés automatiquement par le polling.

Identité et génération protègent les réponses tardives après déconnexion/changement de compte. Aucun compte, texte ni compteur n'est conservé dans le canal d'invalidation localStorage. La prévisualisation utilise exclusivement des adaptateurs fictifs isolés.

Le serveur compte indépendamment de la limite de la cloche. L'accusé reçoit l'UUID d'un message entrant vérifié pour `auth.uid()` et l'ami, pas un horodatage/compteur fourni par le client. Un ordre de livraison monotone et les verrous sociaux existants empêchent une ancienne page de reculer l'état ou d'acquitter un nouveau message non reçu. Le rattrapage initial ordonne les anciens messages par date/UUID.

Blocage, retrait d'amitié, bannissement et barrière de suppression sont recontrôlés. Les marqueurs de lecture sont privés, sans droits directs pour anon/authenticated, avec cascade lors de la suppression Auth et garde de clôture. La séquence n'accorde aucun droit joueur. Aucune publication Realtime des messages ou marqueurs privés et aucun nouveau droit administrateur global.

## Migration et coordination

`20261019050000_social_unread.sql` : une colonne/séquence d'ordre sur les messages existants, une table privée, deux nouvelles RPC authentifiées explicitement ajoutées à l'allowlist, et métadonnée `readThroughId` dans la pagination existante. Aucun accès existant élargi.

**Non appliquée au VPS.** Le 19 octobre 2026, l'utilisateur a confirmé explicitement la validation des nouveaux droits SQL par Walid et une fenêtre sans migration concurrente. L'utilisateur a aussi confirmé le prévenir du chevauchement Friends avec #352. Recontrôler l'état réel du VPS et de master avant toute application.

Publication demandée et autorisée par l'utilisateur. La PR de livraison doit consigner la CI GitHub et l'état réel d'application : migration officielle avec sauvegarde et contrôle de dérive avant activation du nouveau front, puis merge et suivi du webhook Coolify. Ne pas confondre les tests locaux réussis avec une CI GitHub verte.

## Essai

Avec `PRIVATE_MESSAGES_PORT=3004`, lancer `node scripts/start-private-messages-local.mjs`, puis ouvrir <http://localhost:3004/design-system/private-messages-preview>.

`Add sample conversation` crée des DM fictifs pour vérifier les pastilles. `Add sample friend request` simule une invitation ; ouvrir `Received requests` puis accepter/refuser doit retirer sa pastille sans retirer celle d'un DM. `View as` et deux onglets permettent de simuler les deux joueurs. Aucun joueur réel n'est contacté.

Tests ajoutés : SQL d'isolation/compteurs/lecture monotone, état partagé/réponses tardives/onglets cachés, parcours navigateur desktop/mobile étendant toutes les assertions précédentes. Le mock d'import du test de profil est complété pour les nouveaux modules ; aucune assertion existante retirée ou assouplie.
