# Réponses aux commentaires — 3 novembre 2026

Les commentaires du fil et des murs de profils disposent d’un bouton Répondre. Le formulaire s’ouvre sous le commentaire visé, indique son auteur et permet d’annuler la cible en conservant le brouillon. Les réponses sont regroupées sous leur parent, avec un retrait borné sur téléphone et ordinateur. Les images et GIF existants restent disponibles.

Une réponse à un commentaire notifie uniquement son auteur, sans notification à soi-même ni doublon sur un nouvel essai d’envoi. Une réponse directe au post garde la notification existante. La notification ne contient aucun texte du post ou du commentaire ; son lien charge le bon post et la bonne réponse, même au-delà de la première page. L’accès est revalidé lors de la lecture et de l’envoi push.

Les mêmes règles d’accès s’appliquent : compte actif, audience du post, blocages bilatéraux, limites de fréquence et de nombre, image privée appartenant à l’auteur, GIF autorisé. Un parent d’un autre post, supprimé ou inaccessible est refusé. Un parent supprimé détache ses réponses sans supprimer celles des autres joueurs. Les ancêtres visibles nécessaires accompagnent la pagination pour conserver le contexte ; les auteurs bloqués/bannis ne sont pas exposés. L’export conserve seulement l’identifiant parent des propres contributions du demandeur, avec les réservations et limites existantes.

La lecture d’une conversation privée synchronise aussi la notification de la cloche, uniquement si tous les messages entrants sont couverts par le dernier identifiant réellement affiché. Un nouveau message arrivé entre-temps reste non lu. Les notifications historiques de messages déjà lus sont réparées sur la même preuve, et les autres conversations/alertes restent intactes. La cloche se rafraîchit après confirmation, avec un rafraîchissement différé si une ancienne lecture réseau est encore en cours. Les autres onglets sont invalidés sans partager de contenu.

## Migration et droits SQL

`20261103060000_threaded_wall_replies.sql` : non appliquée au VPS lors de la préparation de la PR.

Walid a explicitement validé l’unique ajout `public.publish_wall_post_reply_to(uuid, uuid, uuid, text, text, text)` à l’allowlist stricte. Seul `authenticated` peut l’appeler ; l’auteur est dérivé de `auth.uid()`. Aucun test ni aucune assertion existants ne sont supprimés ou assouplis. Les signatures et droits des fonctions existantes restent inchangés.

L’utilisateur confirme que l’équipe est prévenue sur Discord et qu’aucune autre intervention SQL n’est en cours. L’application attend la CI GitHub verte, la vérification de divergence et une sauvegarde validée.

## Validation

- 56 tests ciblés passants : droits SQL, export, anciennes notifications, audience des murs publics/privés, médias, modération et protection des comptes bannis.
- 28 scénarios Chrome, fil normal et fenêtre compacte, EN/FR, 320/375/768/1024/1440 px et zoom 200 % sur ordinateur : réponse sous la bonne cible, ordre parent/enfant, brouillon conservé, aucune erreur navigateur ni débordement horizontal.
- Un échec simulé conserve le brouillon et permet d’annuler la cible.
- Deux scénarios de lien de notification : ouverture automatique et focus du bon commentaire, focus du formulaire après Répondre, fil normal et compact.
- Prévisualisation locale sans écriture en production : `/design-system/threaded-replies-preview` ; inaccessible en production.
