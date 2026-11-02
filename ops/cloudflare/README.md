# Origine Cloudflare et identités réseau

Cette configuration ferme les entrées web IPv4/IPv6 de l'origine, nettoie les
en-têtes IP et produit une identité réseau HMAC. Elle ne sanctionne personne.
Une IP partagée n'est pas une preuve de multi-compte.

## Chaîne de confiance

1. Table nftables dédiée `inet yokkai_cloudflare`, avant le DNAT Docker : seuls
   les CIDR officiels Cloudflare accèdent à TCP 80/443 et UDP 443. SSH reste ouvert
   sur son port actuel. Les autres nouvelles connexions TCP/UDP extérieures sont
   bloquées. Les connexions sortantes et ICMP restent utilisables.
2. Middleware Traefik global aux entrypoints web : `ipAllowList` évalue le pair
   TCP, sans stratégie X-Forwarded-For. `forwardedHeaders.trustedIPs` contient
   uniquement les CIDR Cloudflare et `insecure` reste désactivé.
3. Les en-têtes IP fournis par un client, y compris les identités internes,
   sont supprimés. Une preuve privée est écrasée par Traefik, jamais reprise du
   navigateur. Seul `CF-Connecting-IP`, réécrit par Cloudflare, sert d'entrée.
4. Le service ForwardAuth privé exige cette preuve, rejette IP invalides,
   listes, doublons, ports et zones IPv6, puis canonicalise IPv4/IPv6. Les IPv4
   représentées en IPv6 mapped produisent le même HMAC que l'IPv4 correspondante.
5. Le proxy transmet l'adresse canonique en mémoire aux services et le HMAC dans
   `X-Yokkai-IP-HMAC`. La preuve interne est retirée avant les applications.
   Les en-têtes d'identité ne sont jamais retournés au navigateur.

Le service n'a aucun port publié, utilise un réseau Docker interne dédié avec
Traefik, un système de fichiers en lecture seule, un utilisateur non privilégié,
aucune capability, des limites mémoire/PID et aucun accès au socket Docker.
Le healthcheck Traefik utilise un entrypoint interne distinct non publié.

## Conservation et limites

`ip-observations.json` conserve uniquement : HMAC versionné, première/dernière
observation en millisecondes UTC et compteur. Aucun compte, chemin, cookie,
Authorization, IP brute ou corps n'est enregistré. Purge après sept jours sans
observation, toutes les trente secondes et au démarrage ; capacité maximale
100 000 identités. Au-delà, la validation continue mais les nouvelles identités
ne sont plus enregistrées. Les dernières trente secondes peuvent être perdues
en cas d'arrêt brutal. Ce fichier ne doit pas être intégré aux sauvegardes
longue durée ; une restauration doit appliquer la même purge.

Les deux secrets indépendants sont générés sur le VPS avec 32 octets aléatoires,
hors Git : `secrets/proxy-proof`, `secrets/ip-hmac`, plus `secrets/key-version`.
Le HMAC est SHA-256 avec séparation de domaine. Un HMAC reste une donnée
pseudonyme, pas anonyme. Une rotation remplace la clé et incrémente la version,
redémarre le service et supprime les anciennes observations : les anciennes et
nouvelles identités ne sont volontairement pas corrélées.

Ce socle ne relie pas encore les HMAC aux joueurs dans la PR anti-triche #31.
Le branchement doit utiliser exclusivement l'en-tête interne après cette chaîne,
sur une session serveur vérifiée. Les appels serveur via l'API publique reflètent
l'IP du serveur, pas celle du joueur : ne pas les attribuer à un joueur.
Le limiteur Auth interne existant reste désactivé et inchangé.

La configuration ne supprime pas les journaux historiques d'autres services.
Ne pas activer les access logs contenant IP/en-têtes ; vérifier séparément
les politiques de rétention de Cloudflare, Auth, Envoy et de la plateforme.

## Déploiement contrôlé

- Vérifier DNS proxifié pour **tous** les domaines, y compris Coolify ; sinon
  prévoir explicitement un accès Coolify par tunnel SSH. Garder une session SSH.
- Désactiver Cloudflare Pseudo IPv4 `Overwrite Headers` : conserver l'adresse
  IPv6 réelle dans `CF-Connecting-IP`. Ne pas accepter une IPv6 secondaire
  librement fournie par le client pour corriger une configuration incertaine.
- Sauvegarder le compose du proxy et ses réseaux Docker ; conserver tous les
  réseaux attachés lors de sa recréation. Ne pas recopier les secrets dans la PR.
- Charger les CIDR via `https://api.cloudflare.com/client/v4/ips`, vérifier
  `success`, valider avec `validateRanges`, puis générer les fichiers avec
  `configure.mjs`. Ne jamais remplacer des règles existantes par une liste vide.
- Démarrer le service privé avec une image Node 22 épinglée par digest/ID.
  Vérifier santé et refus d'une requête sans preuve.
- Installer le fichier dynamique `middleware.json` dans le répertoire Traefik.
  Ajouter `yokkai-edge@file` comme middleware des deux entrypoints publics.
  Activer trustedIPs uniquement pour Cloudflare. Déplacer ping vers un
  entrypoint privé non publié avant d'activer la chaîne.
- Valider le compose. Programmer un retour arrière automatique avant la bascule.
  Recréer le proxy et vérifier site, API, WebSockets, panneau et SSH.
- Valider `nft -c -f firewall.nft` puis charger la table dédiée. Pour une mise à
  jour, supprimer/recréer **uniquement cette table** dans une transaction nft.
  Ne jamais utiliser `flush ruleset`. Persister avec une unité systemd dédiée.
- Tester l'origine directe avec Host/SNI corrects et des en-têtes CF forgés :
  refus attendu. Tester un passage Cloudflare avec des XFF/identités forgés :
  seule l'identité réelle calculée doit atteindre les applications.
- Annuler le retour arrière uniquement après preuves positives. Surveiller
  erreurs, ressources et renouvellement ACME via Cloudflare. Mettre à jour les
  plages périodiquement avec la même validation et un contrôle de disponibilité.

Retour arrière : restaurer le compose/réseaux du proxy, recréer Traefik puis
retirer son fichier dynamique. Supprimer uniquement `inet yokkai_cloudflare`
si nécessaire ; désactiver son unité persistante. Arrêter le service privé
seulement après avoir retiré sa dépendance dans Traefik. Les applications,
comptes et la base SQL ne sont pas modifiés par cette procédure.

## Références

- [Cloudflare : en-têtes](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- [Cloudflare : plages](https://www.cloudflare.com/ips/)
- [Traefik : IPAllowList](https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/http/middlewares/ipallowlist/)
- [Traefik : ForwardAuth](https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/http/middlewares/forwardauth/)
