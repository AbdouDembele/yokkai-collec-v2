# Messagerie privée — livraison

## Produit

- **Message** dans /friends ouvre une conversation avec cet ami accepté.
- Texte jusqu'à 2 000 caractères et GIF du sélecteur **GIPHY uniquement**. Aucun import de galerie, fichier personnel ou nouveau bucket Storage.
- GIF avec ou sans légende, retrait du brouillon avant envoi ; Entrée envoie, Maj + Entrée ajoute une ligne. Brouillon et UUID d'envoi conservés après échec, sans doublon à la reprise.
- **Trade** verrouille le destinataire sur cet ami, sans sélecteur et avec historique limité à cette relation. La page Trades classique reste libre.
- Blocage/signalement via les actions de joueur existantes dans la conversation. Aucun nouvel accès administratif global au texte privé.

## Notifications

Chaque insertion crée ou réarme une notification **private_message_received**, regroupée par auteur. Une nouvelle tentative identique ne notifie pas à nouveau. La cloche affiche seulement le nom de l'auteur, jamais le texte/GIF privé.

Le clic ouvre /friends?message=<sender>. Seul un ami accepté est résolu ; un destinataire devenu indisponible produit une erreur anglaise. Fermer la conversation nettoie le paramètre. Blocage bilatéral, retrait d'amitié, bannissement et clôture masquent les notifications concernées.

Supabase Realtime publie uniquement **notifications**, avec RLS de destinataire conservée, jamais la table de messages privés. INSERT/UPDATE filtrés sur l'utilisateur authentifié réveillent la lecture protégée. Le polling visible existant de 30 secondes et le retour à l'onglet restent les replis ; la conversation se relit aussi toutes les cinq secondes visibles et au signal de notification.

Référence : https://supabase.com/docs/guides/realtime/postgres-changes

## Données et droits

- Table sans accès direct anon/authenticated, RLS ; trois RPC authentifiées explicitement autorisées. Identité auth.uid(), amitié, blocs, bans et barrière de clôture contrôlés au serveur.
- Verrous partagés avec les mutations sociales et la clôture. Une seconde entre envois, maximum 30/minute/auteur tous destinataires confondus.
- URL GIF HTTPS sur les domaines médias GIPHY exacts, format GIF contrôlé côté SQL/interface ; pas de data:, blob:, SVG ou hôte ressemblant.
- Pagination date/UUID, 40 messages/page, borne serveur 100.
- Historique conservé tant que les comptes existent ; retrait d'amitié/blocage ferme l'accès sans purge automatique. Suppression Auth : cascade sur les messages envoyés/reçus. La barrière de clôture interdit les lectures/envois intermédiaires.
- Export personnel : seulement les messages rédigés par le demandeur, GIF, date et pseudo destinataire ; pas le contenu rédigé par un autre joueur ni son UUID. Instantané SQL unique, permissions service-only et plafonds globaux inchangés.

## Migrations

Après la correction PERF/ENG de #353 :

- 20261019040000_private_messages.sql
- 20261019040001_private_message_gifs.sql
- 20261019040002_private_message_notifications.sql
- 20261019040003_private_message_export.sql

Ces versions remplacent les anciennes versions **locales uniquement** 20261019010000 à 20261019010003, jamais appliquées au VPS. Le registre local est aligné. Aucun historique appliqué en production n'est renommé. L'état réel d'application est consigné dans la PR de livraison.

Validation des droits SQL et fenêtre sans migration concurrente confirmées par l'utilisateur avec Walid le 19 octobre. Ordre coordonné : #353 puis #351 avant #352. CI verte sur branche à jour, script officiel de déploiement SQL avec sauvegarde validée, transaction lot/registre et dérive après commit, puis contrôle du déploiement applicatif.

## Essai local

Commande : node scripts/start-private-messages-local.mjs ; http://localhost:3002. Supabase local uniquement, seule la clé publique GIPHY peut être reprise du checkout principal.

La route /design-system/private-messages-preview propose View as, historique partagé entre onglets, cloche simulée, Add sample conversation et Fail the next send. Aucun joueur réel contacté, aucun échange réel envoyé. Les routes design-system restent interdites en production.

Les tests ciblés couvrent SQL, GIF, notifications, export, polling et permissions. Le script scripts/prove-private-messages-local.mjs vérifie aussi une vraie réception Realtime puis nettoie ses trois comptes jetables. scripts/browser-proof-private-messages.mjs vérifie desktop/mobile, cloche et destinataire verrouillé ; il refuse un hôte distant.
