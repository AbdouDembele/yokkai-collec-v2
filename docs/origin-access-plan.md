# Fermeture de l'origine — plan non exécuté

Préparation du 16 octobre 2026. Aucune règle OVH/hôte/proxy modifiée. Complète [auth-hardening.md](auth-hardening.md) : fermer le contournement Cloudflare avant de faire confiance aux en-têtes IP. Les ports inventoriés dans ce guide ne sont pas une nouvelle mesure réseau de cette mission.

## Prérequis

Inventorier interfaces IPv4/IPv6, ports publiés Docker, règles hôte et règles OVH existantes ; exporter les règles pour retour arrière hors dépôt. Vérifier console KVM/rescue opérationnelle, conserver une session SSH ouverte et tester une seconde connexion **TCP 1022**. Ne jamais réserver SSH aux seules IP Cloudflare. Identifier les accès d'administration et de supervision nécessaires, sans publier leurs adresses dans Git.

Confirmer que l'offre VPS/IP dispose du pare-feu réseau OVH décrit ci-dessous. Sa disponibilité n'a pas été consultée dans le compte. Le [guide officiel OVH Edge Network Firewall](https://docs.ovhcloud.com/en/guides/bare-metal-cloud/dedicated-servers/firewall-network) annonce 20 règles/IP et une couverture des flux externes à OVH ; cela ne remplace pas le filtre hôte, notamment pour les flux venant d'OVH. Vérifier la couverture IPv6 réelle ; ne jamais présumer qu'une règle IPv4 protège IPv6.

## Plages à autoriser

Copie des listes officielles [IPv4](https://www.cloudflare.com/ips-v4) et [IPv6](https://www.cloudflare.com/ips-v6), consultées le 16 octobre. Les relire avant exécution et prévoir leur mise à jour ; ne pas élargir à un super-réseau pour réduire le nombre de règles.

```text
IPv4
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22

IPv6
2400:cb00::/32
2606:4700::/32
2803:f800::/32
2405:b500::/32
2405:8100::/32
2a06:98c0::/29
2c0f:f248::/32
```

## Règles OVH proposées, à adapter à l'inventaire

Variante conservant 20 emplacements maximum : Cloudflare joint uniquement HTTPS à l'origine, en Full (strict). **Prérequis avant cette variante :** redirection HTTP→HTTPS à l'edge et renouvellement TLS ne dépendant pas d'HTTP-01 sur l'origine (DNS-01 ou certificat d'origine géré). Ces paramètres ne sont pas présumés actifs et ne sont pas changés ici. Sinon arrêter et revoir la matrice plutôt que bloquer le renouvellement.

| Priorité | Action                         | Source                                              | Protocole / destination                                    |
| -------- | ------------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| 0        | Autoriser                      | Toutes, comme avant                                 | TCP 1022, préserver SSH                                    |
| 1        | Autoriser                      | Toutes                                              | TCP établi, selon option de suivi des connexions OVH       |
| 2 à 16   | Autoriser, une règle par plage | Les 15 CIDR IPv4 Cloudflare, dans l'ordre ci-dessus | TCP destination 443, nouveaux flux                         |
| 17       | Refuser                        | Toutes                                              | TCP destination 80                                         |
| 18       | Refuser                        | Toutes                                              | TCP destination 443, nouveaux flux non autorisés plus haut |
| 19       | Refuser                        | Toutes                                              | UDP destination 443, pas de QUIC direct                    |

Les priorités doivent être réconciliées avec les règles déjà présentes : ne pas les écraser ni dépasser la capacité. La conservation de TCP établi protège les réponses de connexions sortantes, mais peut laisser subsister une ancienne connexion web directe : la fermeture exige aussi un filtre hôte appliqué au web avant l'acceptation générique des flux établis. SSH doit rester exempté de cette restriction web.

Le port 1022 reste ouvert comme auparavant dans ce premier changement pour éviter tout verrouillage ; une restriction ultérieure à des réseaux d'administration serait une opération séparée. Ne pas créer de refus global qui couperait DNS, SMTP sortant, retours réseau, ICMP nécessaire ou déploiement. Le refus UDP 443 n'empêche pas HTTP/3 entre joueur et Cloudflare.

## Filtre hôte indispensable

Préparer ensuite un jeu de règles dédié, réversible et IPv4/IPv6 : accepter les sources Cloudflare vers les seuls ports web requis (443 dans la variante ci-dessus), refuser les autres sources web, conserver SSH 1022 et les connexions internes nécessaires. Protéger **INPUT et le chemin FORWARD/DNAT Docker** (DOCKER-USER ou équivalent du backend actif, avec ports de destination originaux) ; un filtre INPUT seul ne protège pas les ports Docker publiés.

Fermer aussi l'accès public direct aux ports de gestion inventoriés 8080, 8000, 6001/6002 : accès par tunnel SSH/VPN ou réseaux d'administration validés. Vérifier au préalable les dépendances Coolify et realtime ; ne pas couper leur chemin public nécessaire sans route de remplacement testée. Cette matrice doit couvrir toute autre publication découverte, IPv6 inclus. Le pare-feu OVH ne suffit pas à fermer ces ports.

Une liste Cloudflare autorise aussi des requêtes issues d'autres clients Cloudflare : si la propriété de l'edge doit être authentifiée, prévoir une preuve propre à la zone/origine (mTLS personnalisé ou mécanisme équivalent), distincte de cette restriction réseau. La confiance dans CF-Connecting-IP doit encore respecter la chaîne de proxies décrite dans `auth-hardening.md`.

## Exécution future et tests avant/après

1. Avec autorisation séparée, sauvegarder les règles, préparer restauration automatique temporisée du jeu hôte et accès KVM. Tester une nouvelle connexion SSH 1022 avant toute règle de refus ; maintenir les deux sessions pendant l'opération.
2. **Avant**, depuis un mobile Wi-Fi désactivé : site/API publics et tentative directe HTTPS avec Host/SNI correct vers chaque IP d'origine connue, en IPv4 et IPv6 si disponibles. Un simple accès à l'IP sans SNI ne prouve rien. Garder uniquement date/réseau/statut, sans cookie ni jeton. Aucun contournement d'Auth, aucune rafale.
3. Installer d'abord les autorisations ; poser les refus seulement une fois SSH et route Cloudflare vérifiés. Appliquer la couverture hôte/Docker et OVH par étapes, sous surveillance.
4. **Après**, même mobile : site/API via domaines Cloudflare disponibles ; origine directe avec Host/SNI correct refusée même avec CF-Connecting-IP forgé. Retester ports de gestion, IPv4/IPv6 et nouvelle connexion SSH 1022. Une redirection HTTP à l'edge doit fonctionner ; une origine directement joignable en HTTP ne doit plus répondre. Contrôler aussi sortie SMTP, DNS, certificats et santé Coolify.
5. Refaire le test direct depuis un réseau OVH autorisé à être utilisé pour ce contrôle : le mobile seul ne démontre pas la couverture des flux internes OVH. Ne déclarer la fermeture complète qu'après couverture des deux familles IP et du chemin Docker.

## Retour arrière immédiat

À la première perte de service, arrêter l'application des règles. Depuis la session SSH gardée ouverte ou KVM, restaurer **le jeu hôte sauvegardé** puis les règles OVH antérieures via le Manager ; si OVH est la cause, retirer d'abord ses nouveaux refus. Restaurer aussi les paramètres edge/certificats s'ils avaient été changés. Ne jamais vider tout le pare-feu ou supprimer les règles Docker à l'aveugle. La restauration temporisée assure le secours hôte si la session tombe ; elle n'annule pas les règles OVH, d'où l'accès Manager indépendant indispensable.

Retester immédiatement SSH 1022, site et API depuis le mobile. Le retour peut rouvrir l'origine : garder les fonctions de confiance IP désactivées jusqu'à une nouvelle fermeture prouvée. Annuler la restauration temporisée seulement après tous les tests réussis.
