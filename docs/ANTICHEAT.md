# Anti-triche en mode observation

Le dispositif anti-triche journalise les événements économiques sensibles et
les présente aux administrateurs sous forme de signaux explicables. Il ne
bannit, ne sanctionne et ne retire jamais automatiquement des cartes ou des
Karas.

## Événements observés

- création d'un compte ;
- création, acceptation, refus et annulation d'un échange ;
- création, enchère, vente et expiration d'une enchère ;
- attribution d'une récompense de parrainage ;
- association temporaire de comptes à une même identité réseau pseudonyme ;
- échange accepté entre des comptes liés par une identité réseau récente.

Le journal et ses associations sont privés, sans politique de lecture, et
protégés contre les mises à jour et suppressions. Les administrateurs passent
uniquement par deux fonctions DTO bornées qui revérifient leur rôle.

## Signaux explicables

- échange à sens unique ;
- écart important entre les valeurs pondérées des deux lots ;
- transfert d'au moins 5 000 Karas ;
- enchère extrême ;
- rafale de récompenses de parrainage ;
- activité économique d'un compte créé depuis moins de 72 heures ;
- identité réseau partagée (signal faible et contextuel) ;
- échange entre des comptes liés par une identité réseau récente.

Les volumes répétés d'échanges, d'enchères et de ventes restent dans le journal
comme contexte, mais ne donnent plus de points à eux seuls. Jouer beaucoup ne
constitue donc pas un signal de risque.

Chaque événement conserve ses codes de raison et ses points historiques. Le
score affiché aux administrateurs est cependant recalculé sur les 30 derniers
jours, ou depuis la dernière décision « écarté » si elle est plus récente. Les
raisons actives sont plafonnées séparément afin qu'une même activité répétée ne
puisse pas faire croître indéfiniment le score :

| Signal                                   | Points par occurrence | Plafond actif |
| ---------------------------------------- | --------------------: | ------------: |
| Source d'un échange à sens unique        |                     3 |             6 |
| Bénéficiaire d'un échange à sens unique  |                    12 |            24 |
| Fort déséquilibre de valeur              |                     6 |            18 |
| Transfert d'au moins 5 000 Karas         |                     5 |            15 |
| Enchère extrême                          |                     8 |            16 |
| Rafale de parrainages                    |                    10 |            20 |
| Activité économique d'un nouveau compte  |                     8 |            16 |
| Identité réseau partagée                 |                     3 |             9 |
| Échange entre comptes liés par le réseau |                    20 |            60 |

Les sévérités actives sont « à surveiller » sous 20 points, « élevée » à
partir de 20, « haute » à partir de 40 et « critique » à partir de 80. Le score
sert à prioriser la revue humaine, pas à établir seul une fraude.

## Historique et exploitation

La migration importe de manière bornée les échanges acceptés, ventes et
parrainages des 90 derniers jours et les enchères des 30 derniers jours. Les
nouveaux événements sont ensuite ajoutés par des déclencheurs de base de
données, ce qui évite de dépendre du navigateur.

Le tableau `/admin/security` permet de filtrer les dossiers par pseudo,
adresse e-mail et sévérité, puis de consulter le journal récent par joueur ou
type d'événement. Chaque administrateur peut consigner une note immuable et
marquer le dossier ouvert, examiné ou écarté. Une décision « écarté » remet le
score actif à zéro ; seul un nouveau signal pondéré peut rouvrir le dossier.
Les dossiers ouverts dont les anciens points provenaient uniquement du volume
ne sont plus présentés comme dossiers à risque. Les sanctions éventuelles
restent réalisées avec les outils de modération existants après vérification.

Les tables anti-triche sont recensées dans `docs/data-export-inventory.json` pour
une revue manuelle des demandes d'accès impliquant ces éléments de sécurité
et les données de contreparties. Elles ne sont pas ajoutées aux téléchargements
automatiques des joueurs.

## Corrélation réseau pseudonyme

L'origine VPS est fermée au trafic web direct et la chaîne Cloudflare/Traefik
supprime les en-têtes fournis par le navigateur. Une route serveur vérifie la
session puis transmet à Supabase uniquement le HMAC versionné produit par le
proxy. La fonction d'écriture est réservée au `service_role` : un joueur ne peut
pas fabriquer une association par RPC.

La table de rapprochement ne conserve jamais l'adresse brute. Ses observations
sont purgées après sept jours et une même association n'est rafraîchie qu'une
fois toutes les quinze minutes. Le tableau admin expose uniquement le nombre de
comptes rapprochés, jamais le HMAC. Une IP partagée (foyer, école, opérateur ou
VPN) n'est pas une preuve de fraude : le signal seul ne déclenche aucune
sanction automatique.

Un jeton aléatoire `HttpOnly`, propre au navigateur et au site, est conservé au
maximum sept jours. Seul son SHA-256 versionné atteint la base anti-triche ; le
jeton brut n'y est jamais enregistré. Ce rapprochement ne constitue pas une
empreinte matérielle : changer de navigateur le change, et un appareil partagé
peut relier plusieurs personnes. Il sert uniquement à corroborer le réseau et
un échange direct accepté.

## Sanction smurf manuelle

L'administrateur choisit explicitement le compte smurf et le compte principal,
puis consulte un aperçu avant toute mutation. Le bouton reste désactivé sans
les trois éléments concordants des sept derniers jours : réseau pseudonyme
partagé, jeton navigateur partagé et échange direct accepté. Les comptes admin
ne peuvent pas être ciblés, un smurf déjà banni n'est pas éligible et une
sanction déjà appliquée ne peut pas être rejouée.

L'aperçu reconstruit l'historique complet des échanges directs acceptés entre
les deux comptes. Il suit chaque instance de carte reçue du smurf et toutes les
enchères vendues par le compte principal avec ces instances. Les identifiants
des échanges et des ventes, les cartes encore présentes, les Karas reçus
directement et les recettes de revente sont conservés dans le reçu.

L'application est atomique : elle bannit le smurf, annule ses échanges encore
en attente, rend au smurf banni les instances de cartes directement transférées
qui se trouvent encore sur le compte principal et restitue tous les Karas nets
reçus directement, plus les recettes des ventes de ces cartes. Une carte
verrouillée bloque l'opération ; une carte déjà sortie du compte principal
reste chez son acheteur innocent et seule la recette de sa vente est retirée au
principal. Un solde insuffisant bloque également l'opération. La décision, la
note, les échanges, les ventes et les actifs exacts sont conservés dans des
journaux immuables. Aucun score ni signal ne lance cette sanction
automatiquement.

Les filtres du journal acceptent tous les types proposés par l'interface, y
compris `network_identity_shared` et `trade_shared_network_identity`. Les
lectures restent réservées aux administrateurs et bornées à 100 événements.

## Récupération après suppression d'un smurf

La suppression détache les identités dans les échanges et efface les profils.
Elle ne permet donc pas de retrouver automatiquement un ancien pseudo ni de
prouver qu'un don anonyme provenait d'un smurf. Les identifiants conservés dans
le journal anti-triche peuvent corroborer un ancien lien, mais leur absence
n'est jamais remplacée par une attribution supposée.

Depuis le dossier du compte principal, l'admin peut ouvrir « Gains de smurfs
supprimés ». L'outil liste au plus 100 échanges acceptés encore disponibles,
avec un participant détaché et le principal toujours présent. L'admin choisit
les transferts dont il a vérifié indépendamment le caractère abusif, consigne
la référence des preuves et sa décision, puis confirme l'aperçu exact.
Ni la suppression ni un échange à sens unique ne constituent une preuve.

La transaction retire les instances encore présentes sur le principal, débite
les Karas nets des échanges sélectionnés et les recettes de leurs reventes
traçables. Elle ne recrée jamais l'identité supprimée et ne crédite aucun compte
fantôme. Les acheteurs tiers conservent leurs cartes. Les cartes indisponibles
ou un solde insuffisant bloquent l'action ; les recettes perdues ou impossibles
à relier ne sont pas estimées. Les comptes administrateurs sont protégés.

Un reçu immuable conserve l'historique précis, la note et la référence des
preuves. Chaque échange et vente est réclamé une seule fois, y compris par
rapport aux sanctions smurf précédentes. Les récupérations déjà appliquées
quittent la liste pour permettre le traitement des échanges plus anciens.

## Parcours admin unifié et décision manuelle

Le dossier propose un seul bouton « Sanctionner », avec deux modes dans le même
espace : compte smurf existant et gains de smurfs supprimés. Les historiques
affichent les noms de cartes conservés dans le catalogue ou les instantanés
d'échanges. Un nom perdu n'est jamais deviné ; les nouveaux reçus conservent
ces noms avant la récupération.

Les nouvelles RPC `admin_preview_sanction` / `admin_apply_sanction` autorisent
une décision **manuelle** documentée par un administrateur sans exiger les
signaux réseau/navigateur. Une note et une confirmation explicite restent
obligatoires ; la référence documentaire supplémentaire est facultative.
Le smurf existant peut être banni même sans gain à récupérer, après un échange
direct accepté. Les anciens RPC de corroboration gardent leur contrat strict.
Les admins ne sont pas sanctionnables et les gains déjà récupérés ne sont pas
débités à nouveau. Un solde insuffisant bloque toujours le débit atomique.

Une carte verrouillée ne bloque plus ce parcours manuel : les enchères actives
sur les cartes récupérées sont expirées et leurs fonds bloqués remboursés une
seule fois au gagnant courant, les offres en attente sont annulées, puis les
cartes déverrouillées. Les enchères et tous leurs bids restent dans l'historique.
Ces préparations et remboursements sont journalisés, avec la décision et les
actifs exacts. Un échec annule toute l'opération.
L'application exige également l'empreinte de l'aperçu affiché : si l'historique
ou les actifs ont changé entre la lecture et la confirmation, il faut relire
le nouvel aperçu avant de confirmer.

« Connexion Internet commune détectée » signifie que la même empreinte d'IP
publique a été observée pour plusieurs comptes au cours des sept derniers jours.
La RPC admin bornée `admin_list_anticheat_connections` affiche les pseudos liés,
la dernière date de rapprochement, la présence éventuelle du même jeton
navigateur et les échanges directs acceptés. Elle ne renvoie ni IP ni HMAC ni
jeton navigateur. Une connexion commune peut correspondre à un foyer, Wi-Fi,
réseau mobile ou VPN ; elle ne prouve ni le même appareil ni la même personne.
