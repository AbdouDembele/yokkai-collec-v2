# Rapport de sécurité Cloudflare post-déploiement

Audit réalisé le 2 novembre 2026 sur le VPS de production Yokkai Collec, sans reboot, sans redémarrage de Docker, sans flush de pare-feu, sans modification PostgreSQL et sans exposition volontaire de secret.

## Executive summary

**Verdict : ACTION REQUISE**

L'origine est effectivement protégée en IPv4 et en IPv6. Les connexions directes vers l'IPv4 `62.83.37.242` et l'IPv6 publique du VPS échouent sur les ports Web testés, alors que le site, l'API, Coolify, TLS, les images publiques et Supabase Realtime fonctionnent derrière Cloudflare.

L'association nftables/iptables-nft/Docker est saine dans l'état observé. Le pare-feu Cloudflare est chargé avant Docker dans une table dédiée et ne remplace pas les chaînes Docker. Le risque résiduel lié à l'unité générique `nftables.service`, dont les actions de démarrage et d'arrêt pouvaient vider l'ensemble du ruleset, a été neutralisé en la masquant sans la démarrer ni la redémarrer.

La chaîne Cloudflare → Traefik → sidecar d'identité → HMAC est opérationnelle et durcie. L'IP brute n'est pas conservée dans le stockage contrôlé. La preuve interne Traefik → sidecar, précédemment exposée pendant l'audit, a été renouvelée de manière ciblée ; la clé HMAC n'a pas été changée.

Le point P0 restant est ACME : Traefik 3.6.25 utilise toujours HTTP-01 alors que l'origine n'accepte TCP/80 que depuis Cloudflare. Les certificats servis sont actuellement valides, mais un futur renouvellement HTTP-01 peut échouer. La migration DNS-01 n'a pas été forcée, car aucun token Cloudflare DNS dédié n'est présent. Retirer HTTP-01 sans preuve DNS-01 aurait été plus dangereux que conserver temporairement l'état actuel.

**ACME DNS-01 : ACTION REQUISE**

## Architecture observée

Le trafic public suit la chaîne réelle suivante :

```text
Utilisateur
  → Cloudflare (DNS proxifié, TLS public, cache/WAF éventuel)
  → pare-feu nftables inet/yokkai_cloudflare sur le VPS
  → Docker DNAT / coolify-proxy
  → Traefik 3.6.25
  → middleware de nettoyage des en-têtes
  → forwardAuth sur yokkai-edge-identity:9080
  → services Yokkai ou Supabase
```

Le sidecar `yokkai-edge-identity` ne publie aucun port. Il est seul sur le réseau Docker interne `yokkai-edge-private`. Traefik lui transmet une preuve interne et l'adresse Cloudflare à valider. Le sidecar produit une identité HMAC versionnée et ne conserve que des agrégats minimaux.

Les domaines publics `.com`, `.fr`, API et Coolify résolvent vers des adresses Cloudflare, pas vers les adresses origine observées.

## Firewall

### nftables

- Backend actif : nftables natif, complété par les règles iptables-nft créées par Docker et le pare-feu historique.
- Table dédiée active : `inet yokkai_cloudflare`.
- Interface publique ciblée : `eth0`.
- TCP/80 et TCP/443 : autorisés uniquement depuis les plages Cloudflare IPv4/IPv6.
- UDP/443 : autorisé uniquement depuis les plages Cloudflare IPv4/IPv6.
- TCP/1022 : conservé pour SSH.
- Les autres flux TCP/UDP entrants non autorisés sont rejetés avant le DNAT Docker.
- Le service `yokkai-cloudflare-firewall.service` est actif, activé au démarrage et ordonné avant `docker.service`.
- Son arrêt supprime uniquement sa propre table ; il ne vide pas le ruleset global.

### iptables

- `iptables v1.8.11 (nf_tables)` ; l'alternative active est `iptables-nft`.
- Docker 29.8.1 programme ses chaînes NAT, FORWARD, DOCKER, DOCKER-FORWARD et DOCKER-USER dans le même backend nftables.
- Le pare-feu historique `yokkai-host-firewall.service` ne vide que ses chaînes INPUT IPv4/IPv6 puis recrée la politique hôte. Il est actif, activé et ordonné avant Docker.
- La règle historique INPUT autorise largement 80/443, mais la chaîne nftables dédiée, placée avant le DNAT Docker, bloque les sources non Cloudflare. Les tests externes confirment ce comportement effectif.
- `netfilter-persistent.service` est masqué et inactif.

### Docker

- Docker est actif et activé.
- Aucun `/etc/docker/daemon.json` ne change le backend observé.
- Les chaînes Docker sont présentes et cohérentes ; elles n'ont pas été vidées pendant l'intervention.
- Les ports publiés par le proxy incluent TCP/80, TCP/443, UDP/443 et TCP/8080. Le pare-feu dédié bloque l'accès externe direct non Cloudflare, y compris TCP/8080.
- Aucun redémarrage ou reload Docker n'a été effectué.

### Ordre systemd et persistance

Ordre observé :

```text
network-pre
  → yokkai-host-firewall.service
  → yokkai-cloudflare-firewall.service
  → docker.service
  → conteneurs Coolify / Traefik / Yokkai
```

`fail2ban.service` est actif et protège SSH/1022. L'ordre déclaré garantit que les deux services de pare-feu Yokkai précèdent Docker. La persistance après reboot a été vérifiée statiquement par les unités activées et leurs dépendances ; aucun reboot de production n'a été effectué.

Le fichier `/etc/nftables.conf` contient `flush ruleset`. L'unité générique Debian utilisait également `ExecStop=/usr/sbin/nft flush ruleset`. Bien que cette unité fût inactive et désactivée, un démarrage/reload/stop manuel aurait pu détruire les chaînes Docker. Elle a donc été masquée. Les unités Yokkai restent les seules unités de pare-feu attendues au démarrage.

### IPv4

- Accès normal via Cloudflare : OK.
- Accès direct origine avec Host/SNI correct : timeout.
- TCP/80 direct : timeout.
- TCP/8080 direct : timeout.

### IPv6

- Le VPS possède une IPv6 publique ; sa valeur complète n'est pas reproduite dans ce rapport.
- Traefik/Docker écoutent aussi sur IPv6, ce qui rendait le test obligatoire.
- Les plages Cloudflare IPv6 sont présentes dans la table dédiée.
- Un test réellement externe depuis un second VPS a confirmé des timeouts sur TCP/80, TCP/443 et TCP/8080 vers l'IPv6 origine.
- Aucun bypass IPv6 n'a été trouvé.

## Cloudflare

### Ranges et firewall

Les 15 plages IPv4 et 7 plages IPv6 déployées correspondent exactement aux listes renvoyées par les API officielles Cloudflare au moment de l'audit. Aucune plage tierce, `0.0.0.0/0` ou `::/0` n'est utilisée pour les ports Web.

Le générateur télécharge les listes officielles dans une préparation séparée, exige une réponse valide et non vide, valide les réseaux, puis remplace atomiquement la table dédiée. Une erreur de récupération ne remplace pas la dernière configuration valide. Aucun mécanisme périodique de rafraîchissement automatique n'a cependant été trouvé.

### Pseudo IPv4

L'administrateur a confirmé que Pseudo IPv4 est configuré sur `Off` ou `Add Header`, et non `Overwrite Headers`, pour les zones `.com` et `.fr`. Cette confirmation n'a pas pu être recoupée par API, aucun token d'audit Cloudflare n'étant disponible.

### Cache

- Page applicative, login et signup : `Cache-Control: private, no-store`, `CF-Cache-Status: DYNAMIC`.
- API Auth : non cachée publiquement.
- Coolify : `no-cache, private`.
- Image publique réelle sous `/storage/v1/object/public/card-images/` : HTTP 200, `Cache-Control: max-age=14400`; premier contrôle `REVALIDATED`, second contrôle `HIT` avec `Age` présent.
- La règle d'images existante n'a pas été modifiée.

### WAF et rate limits

Les règles Cloudflare de zone n'ont pas pu être lues ni modifiées sans token API approprié. Aucun rate limit global agressif n'a été ajouté. Le plan recommandé est de cibler séparément : login/signup/reset/OTP, Auth Supabase, opérations Kara, boosters, échanges, marketplace et administration, en combinant compte, session et empreinte d'abus plutôt qu'une sanction fondée uniquement sur l'IP.

## Origin bypass

Résultats finaux :

| Test                                        | Résultat                          |
| ------------------------------------------- | --------------------------------- |
| `https://yokkai-collec.com/` via Cloudflare | 200                               |
| `/login` via Cloudflare                     | 200                               |
| `/signup` via Cloudflare                    | 200                               |
| `https://yokkai-collec.fr/`                 | 301 attendu                       |
| santé Auth API via Cloudflare               | 401 attendu sans authentification |
| Coolify via Cloudflare                      | 302 attendu                       |
| Origine IPv4 HTTPS avec Host/SNI du domaine | timeout, bloquée                  |
| Origine IPv4 TCP/80                         | timeout, bloquée                  |
| Origine IPv4 TCP/8080                       | timeout, bloquée                  |
| Origine IPv6 TCP/80 depuis un second VPS    | timeout, bloquée                  |
| Origine IPv6 TCP/443 depuis un second VPS   | timeout, bloquée                  |
| Origine IPv6 TCP/8080 depuis un second VPS  | timeout, bloquée                  |

Les tests directs ont conservé le domaine et le SNI ; ils ne se limitent pas à ouvrir une URL contenant l'adresse IP.

## Traefik

- Version : Traefik `3.6.25`, image en bonne santé.
- `forwardedHeaders.trustedIPs` contient exactement les plages Cloudflare observées, en IPv4 et IPv6, sur les entrypoints HTTP et HTTPS.
- `forwardedHeaders.insecure=false`.
- Aucun proxy protocol externe n'a été identifié.
- Le middleware d'entrypoint refuse les sources non Cloudflare, supprime les en-têtes IP et internes falsifiables, puis appelle le sidecar avec `trustForwardHeader=false`.
- Les en-têtes internes de preuve et d'identité sont retirés des réponses publiques.
- Les en-têtes supprimés couvrent notamment `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`, `Client-IP`, `X-Client-IP`, `X-Original-Forwarded-For`, `CF-Connecting-IPv6`, `X-Yokkai-*` et des variantes Envoy/auth.
- Le sidecar rejette les occurrences multiples, listes séparées par virgule, espaces/valeurs non canoniques et adresses invalides selon le contrat inspecté.

## Migration ACME HTTP-01 vers DNS-01

**ACME DNS-01 : ACTION REQUISE**

- État initial et final : HTTP-01 toujours actif.
- Version Traefik : `3.6.25`.
- Resolver initial/final : `letsencrypt`.
- Configuration effective : `acme.httpchallenge=true`, entrypoint `http`, stockage `/traefik/acme.json`.
- Risque : les validateurs Let's Encrypt ne font pas partie des plages Cloudflare autorisées sur TCP/80 ; un renouvellement HTTP-01 futur peut donc échouer.
- Stockage ACME : présent, mode `0600`, propriétaire dédié, non affiché, non supprimé et non modifié.
- Backup ACME : non créé, car aucune modification Traefik/ACME n'a été entreprise. Un backup doit précéder l'activation DNS-01.
- Cloudflare DNS token: missing.
- DNS-01 : non configuré et non testé.
- HTTP-01 : conservé, car DNS-01 n'est pas encore démontré.
- TCP/80 : conservé uniquement depuis Cloudflare pour le trafic HTTP/redirection ; il ne devra plus être une dépendance ACME après migration.
- Aucun reload/recreate Traefik n'a été exécuté.

Certificats ACME origine inventoriés sans lire les clés privées :

| Domaine                     | Expiration observée |
| --------------------------- | ------------------- |
| `yokkai-collec.com`         | 8 janvier 2027      |
| `www.yokkai-collec.com`     | 8 janvier 2027      |
| `yokkai-collec.fr`          | 8 janvier 2027      |
| `www.yokkai-collec.fr`      | 8 janvier 2027      |
| `api.yokkai-collec.com`     | 10 janvier 2027     |
| `coolify.yokkai-collec.com` | 15 janvier 2027     |

Des certificats legacy `sslip.io` expirent le 25 décembre 2026 et doivent être inventoriés avec leurs routers avant suppression éventuelle ; ils n'ont pas été touchés.

Action administrateur requise : créer un **Cloudflare API Token dédié**, jamais une Global API Key, avec uniquement :

- `Zone:DNS:Edit` ;
- `Zone:Zone:Read` ;
- ressources limitées aux zones `yokkai-collec.com` et `yokkai-collec.fr`.

Le fournir dans Coolify comme secret du proxy, idéalement via un fichier secret monté en lecture seule compatible avec Traefik/lego (`CF_DNS_API_TOKEN_FILE`), sinon via la variable secrète `CF_DNS_API_TOKEN`. Sa valeur ne doit apparaître ni dans Git, ni dans une PR, ni dans un rapport, ni dans les logs.

Procédure de migration à exécuter après fourniture : backup de la configuration et de `acme.json`, validation Traefik, ajout d'un resolver DNS-01 distinct, test isolé/staging sans remplacer les certificats valides, preuve de création/propagation/nettoyage TXT et émission, bascule cohérente de tous les routers, tests TLS/WebSocket/origin bypass, puis seulement retrait de HTTP-01. Le rollback consiste à restaurer les fichiers sauvegardés et le resolver `letsencrypt` actuel sans supprimer `acme.json`.

## HTTP/3

HTTP/3 est annoncé entre les clients et Cloudflare (`alt-svc`). Traefik publie actuellement UDP/443 et le pare-feu ne l'autorise que depuis Cloudflare. Aucun besoin démontré de HTTP/3 entre Cloudflare et l'origine n'a été établi. La suppression de l'exposition UDP/443 origine est recommandée après vérification explicite de la configuration Cloudflare/Coolify ; elle n'a pas été tentée pendant cet audit afin de ne pas recréer le proxy.

## Identity sidecar

Conteneur : `yokkai-edge-identity`.

- État final : healthy.
- Port publié : aucun.
- Réseau : `yokkai-edge-private`, interne, sans IPv6 Docker.
- Utilisateur : `1000:1000`, non-root.
- Root filesystem : read-only.
- Capabilities : `ALL` supprimées.
- `no-new-privileges:true`.
- Mémoire : 160 MiB.
- CPU : 0,5 CPU.
- PID : 64.
- Healthcheck : présent.
- Restart policy : `unless-stopped`.
- Logs : `json-file`, 1 MiB, 2 fichiers.
- Code et secrets : montés en lecture seule ; seul le répertoire de données est en écriture.

## HMAC

- Algorithme : HMAC-SHA256.
- Format : `v1:<64 caractères hexadécimaux>`.
- Normalisation : IPv4, IPv6 et IPv4-mapped IPv6 sont ramenées à une représentation canonique avant HMAC.
- Valeurs multiples, séparées par virgule ou invalides : rejetées.
- Stockage contrôlé : 26 lignes au moment de l'audit.
- Forme de chaque entrée : uniquement `id`, `firstSeen`, `lastSeen`, `count`.
- Ligne expirée : 0.
- Dépassement du plafond de 100 000 : non.
- Champ supplémentaire ou identifiant invalide : 0.
- IP brute, URL, query string, route, cookie, e-mail, user ID, token ou contenu HTTP détecté dans ce stockage : 0.
- Fichier : mode `0600`, propriétaire du sidecar.
- Rétention : purge des entrées de plus de 7 jours au chargement/enregistrement.
- Capacité : limitation à 100 000 entrées appliquée lors de la persistance.

La version `v1` permet une future rotation vers `v2`. Une rotation future devra accepter temporairement les deux versions ou conserver une table de transition pendant la rétention, puis arrêter `v1`. Aucune rotation HMAC n'a été effectuée.

## Secrets

| Secret                                                   | État                                                 |
| -------------------------------------------------------- | ---------------------------------------------------- |
| Preuve Traefik → sidecar                                 | present, renouvelée après exposition, permissions OK |
| Clé HMAC                                                 | present, non exposée, non renouvelée, permissions OK |
| Version HMAC                                             | present                                              |
| Cloudflare DNS token                                     | absent du proxy, action requise                      |
| `acme.json`                                              | present, permissions OK                              |
| Supabase service role / JWT / PostgreSQL / RustFS / SMTP | non affichés, non modifiés                           |

Aucune valeur secrète n'est reproduite dans ce rapport.

## WebSocket / Realtime

Un handshake réel vers `wss://api.yokkai-collec.com/realtime/v1/websocket` a obtenu :

```text
HTTP/1.1 101 Switching Protocols
```

La clé publique nécessaire au test a été lue uniquement en mémoire sur le VPS et n'a pas été affichée. Aucune donnée métier n'a été créée.

## Coolify

- `coolify.yokkai-collec.com` passe bien par Cloudflare et retourne le 302 attendu.
- L'origine directe reste bloquée.
- Les réponses sont privées/non cachées.
- Cloudflare Access/Zero Trust n'a pas été activé : la liste des identités administratrices autorisées nécessite une décision humaine.
- Recommandation : créer une application Access dédiée à Coolify, limiter aux identités administratrices nommées, conserver un accès SSH de secours et tester une session distincte avant enforcement.
- Authenticated Origin Pulls apporterait une seconde preuve mTLS en plus de l'allowlist. Son activation doit être préparée avec le certificat d'origine Cloudflare/CA adéquat, la validation mTLS côté Traefik, un router de test et un rollback documenté ; elle n'a pas été activée automatiquement.

## Headers HTTP

Les pages contrôlées exposent :

- HSTS `max-age=31536000` ;
- CSP avec `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` et les sources nécessaires à Supabase/Cloudflare ;
- `X-Content-Type-Options: nosniff` ;
- `X-Frame-Options: DENY` ;
- `Referrer-Policy: strict-origin-when-cross-origin` ;
- Permissions-Policy désactivant caméra, microphone, géolocalisation, paiement et USB.

Aucune CSP plus restrictive n'a été déployée aveuglément.

## Tests effectués

- Inspection des unités et de l'ordre systemd : nftables, deux pare-feu Yokkai, Docker, fail2ban, netfilter-persistent.
- Inspection statique de `/etc/nftables.conf`, recherche de `flush ruleset` et analyse des chemins start/reload/stop.
- Inspection `iptables -S`, NAT, FORWARD, DOCKER-USER et ruleset nftables complet.
- Inspection Docker, réseaux, ports publiés et sockets d'écoute.
- Comparaison exacte des plages déployées avec les API officielles Cloudflare IPv4/IPv6.
- Inspection Traefik effective, routers, middlewares, trusted IPs et certificats ACME sans afficher de secret.
- Inspection du sidecar, montages, droits, limites et stockage HMAC.
- Tests HTTP publics `/`, `/login`, `/signup`, API Auth et Coolify.
- Tests TLS 1.3, hostname, autorité et expiration.
- Test origine IPv4 avec Host/SNI correct, plus TCP/80 et TCP/8080.
- Test origine IPv6 depuis un second VPS sur TCP/80, TCP/443 et TCP/8080.
- Test d'une image publique deux fois : `REVALIDATED`, puis `HIT`.
- Handshake Supabase Realtime : 101.
- Contrôle final : pare-feu dédié présent, SSH/1022 en écoute, Docker actif, sidecar healthy, zéro unité systemd en échec.
- Aucun test CI local interdit n'a été lancé.

## Modifications effectuées

1. Renouvellement ciblé de la preuve interne Traefik → sidecar après son exposition accidentelle :
   - backup créé sous `/data/yokkai-edge/security-audit-backup-20261102T024852Z` ;
   - rollback automatique temporaire préparé ;
   - seul le sidecar a été recréé ;
   - clé HMAC inchangée ;
   - validation publique, TLS, IPv4, IPv6, WebSocket, pare-feu et SSH ;
   - rollback automatique annulé après succès.
2. Masquage de `nftables.service` générique, auparavant inactif/désactivé, pour empêcher un `flush ruleset` accidentel :
   - état et rollback sauvegardés sous `/data/yokkai-edge/security-audit-nftables-20261102T025536Z` ;
   - aucune unité démarrée ou redémarrée ;
   - Docker, pare-feu dédié et sidecar revalidés ;
   - tests publics finaux réussis.
3. Création du présent rapport dans une branche dédiée du dépôt. Aucune migration Supabase n'est incluse ou appliquée.

## Modifications non effectuées

- Migration ACME DNS-01 : bloquée par l'absence d'un token Cloudflare DNS dédié ; HTTP-01 conservé jusqu'à preuve DNS-01.
- Redémarrage/recreate Traefik : inutile tant que DNS-01 n'est pas préparé.
- Fermeture UDP/443 origine : recommandée, mais nécessite une validation Cloudflare/Coolify et un recreate ciblé du proxy.
- WAF/rate limits Cloudflare : accès API de zone absent ; aucun réglage supposé.
- Cloudflare Access pour Coolify : nécessite la liste des identités autorisées.
- Authenticated Origin Pulls : nécessite une phase mTLS testée et un rollback dédié.
- Rafraîchissement périodique des plages Cloudflare : mécanisme actuel fail-safe, mais pas de timer déployé pendant cette intervention.
- Reboot : interdit et non nécessaire ; la persistance a été vérifiée statiquement.
- Toute modification Docker, Supabase, PostgreSQL, réseau ou HMAC : non nécessaire et non effectuée.

## Rollback

Les commandes suivantes annulent uniquement les changements de cette intervention. Elles sont à exécuter avec privilèges administrateur sur le VPS, une à la fois, après vérification du chemin de backup.

### Annuler le masquage préventif de l'unité générique

```bash
sudo systemctl unmask nftables.service
```

Ne pas démarrer ni redémarrer cette unité tant que `/etc/nftables.conf` et son `ExecStop=... flush ruleset` n'ont pas été remplacés par une politique compatible Docker.

### Restaurer l'ancienne preuve interne

Cette action n'est nécessaire qu'en cas de panne démontrée de la preuve renouvelée :

```bash
sudo cp /data/yokkai-edge/security-audit-backup-20261102T024852Z/proxy-proof /data/yokkai-edge/secrets/proxy-proof
sudo cp /data/yokkai-edge/security-audit-backup-20261102T024852Z/middleware.yaml /data/yokkai-edge/middleware.yaml
sudo cp /data/yokkai-edge/security-audit-backup-20261102T024852Z/dynamic-yokkai-edge.yaml /data/coolify/proxy/dynamic/yokkai-edge.yaml
sudo docker compose -f /data/yokkai-edge/compose.json up -d --force-recreate
```

Ce rollback ne redémarre pas Docker ni Supabase ; il recrée uniquement le sidecar. L'ancienne preuve ayant été exposée, son rétablissement ne doit être qu'une mesure d'urgence temporaire, suivie d'un nouveau renouvellement contrôlé.

Le rapport seul peut être annulé par le revert du commit de documentation correspondant.

## Recommandations restantes

### P0

1. Créer et fournir le token Cloudflare DNS dédié décrit plus haut.
2. Migrer tous les routers concernés vers DNS-01 selon la procédure avec backup, validation, preuve d'émission et rollback.
3. Retirer HTTP-01 uniquement après preuve DNS-01 et avant l'échéance la plus proche des certificats utiles.
4. Inventorier les routers utilisant encore les certificats legacy `sslip.io` avant leur échéance du 25 décembre 2026.

### P1

1. Donner à l'audit un token Cloudflare lecture seule afin de vérifier automatiquement Pseudo IPv4 et les règles de zone.
2. Ajouter une alerte sur absence/expiration de certificat, échec ACME, disparition de la table `yokkai_cloudflare`, exposition du sidecar et stockage HMAC hors limites.
3. Ajouter un timer fail-safe de rafraîchissement des plages Cloudflare, conservant impérativement la dernière liste valide en cas d'échec.

### P2

1. Vérifier puis retirer UDP/443 de l'origine si aucun besoin Cloudflare → origine n'est démontré.
2. Déployer des règles WAF/rate limiting ciblées par surface sensible, sans dépendre uniquement de l'IP.
3. Protéger Coolify avec Cloudflare Access après validation des identités administratrices et d'un accès de secours.
4. Étudier Authenticated Origin Pulls avec un router pilote et rollback mTLS.

### P3

1. Automatiser depuis une sonde externe distincte les tests IPv4/IPv6 de bypass origine et Realtime 101.
2. Ajouter une procédure de revue trimestrielle des plages Cloudflare, certificats, secrets, règles WAF et droits Coolify.
3. Conserver les backups de cette intervention selon la politique de rétention opérationnelle, puis les supprimer de manière contrôlée après validation de la migration DNS-01.
