# Boosters : résilience du chargement

## Comportement et limites

- Chaque statut est publié indépendamment ; les infos joueur ont leur propre erreur et reprise.
- Priorité (a) : statuts Régulier/Décisif et infos joueur. (b) : collection/dossiers/enchères après les statuts, ou après 1 s. (c) : notifications/profile/admin/présence après le lancement de (b), ou après 2 s.
- Les lectures HTTP initiales sont annulées après 15 s par requête. L’attente locale de session des lectures est également bornée ; le SDK Auth ne fournit pas de signal d’annulation pour cette attente. Aucune limite globale ne couvre la collection paginée.
- Les pages reçues restent dans un checkpoint privé. Réessayer reprend le curseur de la page échouée ; aucune collection partielle n’est publiée. Les invalidations et changements de compte effacent ces checkpoints.
- `PGRST_DB_MAX_ROWS=1000` vérifié en lecture seule sur le conteneur `supabase-rest-gawq4yyxiise96wens0dt1ex`. Pages conservées à 500 ; fin immédiate lorsque la réponse contient moins de 500 lignes.
- TTL inchangés : collection 10 s, infos joueur 60 s. Une invalidation pendant une lecture provoque une revalidation séquentielle avant publication, sans lancer deux requêtes simultanées.
- Admin : résultat mémoire 5 minutes, promesse partagée, effacement au changement de compte et à la déconnexion. Le lien Admin est conditionné par `isAdmin === true` ; les contrôles serveur/RLS restent indépendants.
- NEW/Doublon : snapshot pris une seule fois au clic d’ouverture, uniquement depuis une collection entière. Si elle est absente, partielle ou arrive plus tard, les mentions restent absentes pour ce pack.
- Ouvertures : aucun timeout ni retry automatique de mutation. RPC, probabilités, séquence de reveal, reduced-motion et verrous de double clic conservés.

## Preuve sans consommer de pack

Preview de développement : `/design-system/boosters-load-preview` (bloquée en production comme les autres previews).

```powershell
node node_modules/next/dist/bin/next dev --port 3017
node scripts/prove-boosters-load.mjs
```

Variables publiques factices suffisantes ; aucun compte de production nécessaire. La couche simulée utilise les helpers de délai/pagination/cache et le composant Game réels. Les lectures secondaires sont simulées ; les notifications utilisent le hook réel. Le navigateur vérifie l’absence d’appels Supabase. Le résultat est dans [boosters-load-proof.json](boosters-load-proof.json).

Les contrôles distinguent Régulier, Décisif, infos joueur, seconde page de collection et notifications : 0 ms, 800 ms, 3 s, sans réponse. Les contrôles « Prochains… » changent la latence du prochain essai sans interrompre celui en cours. Le mode ancien reproduit le `Promise.all` global sans délai maximal.

Vérifications : statuts disponibles sans collection ; statuts et infos indépendants ; aucune mention fausse après arrivée tardive ; erreur et reprise après 15 s ; une seule lecture de la première page même après retry de la deuxième ; notification retry libéré ; zéro doublon simultané ; contre-preuve ancienne bloquée après 15 s.

Les tests unitaires couvrent aussi les TTL, le changement de compte, le cache admin, l’invalidation pendant une lecture et les collections vide/partielle/tardive pour les mentions. Les tests existants d’ouverture restent exécutés.

## Autres lectures sans délai maximal — constat seulement

| Zone                                                                                           | Verrou et appels                                                                                                         | Conséquence d’une absence de réponse                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Marché / détail d’enchère, `components/community-views.tsx`, effet de polling de CommunityView | `loading`, `getAuctions()` ou `getAuction()`, toutes les 3 s                                                             | Le `finally` ne s’exécute pas tant que la lecture reste en attente ; polling bloqué.                                                        |
| Échanges, `components/trades.tsx`, effet de TradesPanel                                        | `loading` dès le chargement initial `friendships/listOffers`, puis `listOffers` et éventuellement le contexte des cartes | L’appel initial ou le polling peut conserver le verrou indéfiniment.                                                                        |
| Chat des enchères, `AuctionChatPanel` dans `components/community-views.tsx`                    | Aucun verrou de lecture `loading/inFlight` ; `adapter.get()` toutes les 3 s                                              | Les requêtes peuvent se superposer ; chargement initial sans borne. `busy` concerne l’envoi, pas la lecture.                                |
| Présence, `components/presence-heartbeat.tsx`                                                  | Pas de verrou `inFlight` ; throttle `lastPulseAt` de 30 s autour de `touchPresence()`                                    | Pas de blocage de l’interface, mais une requête pendante peut coexister avec le pulse suivant. Seul le démarrage est différé dans cette PR. |

Ces délais/verrous n’ont pas été modifiés dans cette PR.

## Hors périmètre / Supabase Envoy et Cloudflare

CORS : une pré-vérification OPTIONS sans clé sur `get_regular_pack_status` a répondu `200`, `Server: envoy`, `Access-Control-Max-Age: 3600`, pour `Origin: http://localhost:3000`. Il n’est donc pas établi que ce cache manque en production. Une trace navigateur réelle reste nécessaire pour quantifier les OPTIONS et la réutilisation des connexions.

Le fichier monté vérifié sur le VPS est :
`/data/coolify/services/gawq4yyxiise96wens0dt1ex/volumes/api/envoy/lds.template.yaml`, monté dans `/etc/envoy/lds.template.yaml`. La politique CORS du listener utilise `max_age: "3600"` pour annoncer une heure de cache. La valeur est déjà observée ; aucune configuration n’a été changée. Voir la [documentation officielle Supabase](https://supabase.com/docs/guides/self-hosting/self-hosted-envoy).

Deux PR/audits séparés :

- Charger l’état initial dans le composant serveur pour livrer la page avec ses données via Cloudflare, sans appel initial du navigateur.
- Évaluer une route API sur le domaine principal, routée par le proxy Coolify vers Envoy, dans l’audit Cloudflare : supprimer les pré-vérifications cross-origin et faire passer l’API par Cloudflare. Aucune modification d’adresse ou de proxy dans cette PR.

Migrations : aucune ; rien à appliquer sur le VPS.

## Validation locale

Suite complète : 403 tests réussis, aucun échec, un test PostgreSQL optionnel ignoré. Lint sans erreur (7 avertissements préexistants), types et build vérifiés. Preconnect dans le HTML servi de `/login` : `https://build-supabase.example.invalid`, même avec une origine différente au démarrage du serveur ; il provient donc bien du build.

## Mise à jour après fusion de #167

Rebase sur `origin/master` (`d4886497`), intégrant #166 et #167. Un seul conflit : `components/game.tsx`. Les lecteurs Panini paginés de #167 et la suppression du chargement global catalogue/totaux sont conservés ; les lectures indépendantes, priorités, erreurs et reprises de #168 restent en place. Les types/fonctions Panini de `cards.ts`, le composant Collection et les tests Panini sont conservés intégralement.

Validation après résolution : 403 tests réussis, aucun échec, un test PostgreSQL optionnel ignoré ; tests Panini compris. Lint sans erreur, TypeScript et build réussis. La preuve navigateur a été rejouée : les sept garanties et la contre-preuve passent, zéro doublon simultané, aucune exception navigateur, zéro requête Supabase. Une première exécution pendant une recompilation de la preview a échoué sur l’attente des erreurs ; l’exécution stabilisée a réussi sans changement de la logique.

Invalidations inchangées : ouverture Régulier invalide la collection même si la réponse est perdue ; conservation Décisif et destruction invalident collection et solde. Le double clic reste verrouillé dans Game (`runPackOpeningOnce`) et dans Boosters (`openingLock`), avec libération dans `finally`. Les mutations n’ont ni timeout ni retry automatique. Preconnect revérifié dans le HTML servi avec une origine de démarrage différente de celle du build.

Aucune migration propre à #168 ; la migration Panini appartient à #167 déjà fusionnée. Aucune migration appliquée sur le VPS pendant cette mise à jour.
