# Pro : droits serveur après paiement

## Contrat

Les droits dérivent exclusivement du miroir Stripe privé écrit après validation de la signature du webhook et relecture du paiement. Ni le retour Checkout, ni un paramètre client, ni les métadonnées du profil n'accordent Pro.

Un abonnement doit être actif, payé, non suspendu pour risque, non expiré, vérifié depuis moins de 15 minutes et appartenir au compte/tarif/mode configuré dans la base. Un paiement Sandbox ne donne aucun droit dans le périmètre live.

| Droit                                            | Basic      | Pro        |
| ------------------------------------------------ | ---------- | ---------- |
| Regular Pack                                     | 10 minutes | 5 minutes  |
| Decision Pack                                    | 1 par jour | 2 par jour |
| Enchères actives                                 | 3          | 6          |
| Cartes en vitrine                                | 5          | 10         |
| Nouvelle image de carte Imgur/Pinterest          | Non        | Oui        |
| Bannière importée, avatar animé, style de profil | Non        | Oui        |

La réserve Regular reste limitée à cinq packs. Les Decision Packs sont renouvelés pour tous à **20 h, fuseau `Europe/Paris`**, avec prise en compte des changements d'heure : chaque période commence à 20 h Paris et finit au prochain 20 h Paris, même si elle dure 23 ou 25 heures. Basic reçoit un pack et Pro deux packs disponibles ensemble, sans intervalle de 12 heures entre les deux. Les packs non utilisés ne sont pas reportés à la période suivante. Les probabilités de rareté ne changent pas. Les succès Pro restent annoncés mais leur logique et leurs récompenses sont différées.

L'ouverture consomme une unité du quota de la période sous verrou serveur. Reprendre un choix déjà en attente ne consomme pas de nouvelle unité ; un choix en attente à 20 h reste accessible sans être redessiné. Une transition Basic/Pro ne remet pas la consommation à zéro : passer Pro ajoute au maximum une ouverture dans la même période et repasser Basic n'accorde aucun pack supplémentaire.

Les transitions préservent la progression des Regular Packs. Une rétrogradation ne supprime ni cartes, ni ventes déjà actives, ni vitrine existante. Elle refuse les nouvelles actions dépassant Basic et masque le style enregistré, qui reste récupérable.

## Personnalisation

`GET /api/pro/benefits` expose uniquement les droits de l'utilisateur authentifié. `GET/POST /api/pro/profile-style` conserve un style borné et validé en base. Les projections publiques du profil, du chat d'enchères et du mur ajoutent le style actif après leurs contrôles de confidentialité existants.

`POST /api/profile-media` valide les octets (GIF, APNG et WebP animés compris), limite à 4 MiB, réserve un chemin immuable dans le dossier de l'utilisateur authentifié et applique un quota serveur. Basic conserve les avatars statiques. Le navigateur ne peut ni choisir un propriétaire, ni remplacer les octets d'un avatar statique validé par un GIF. Les anciens imports directs restent disponibles uniquement pour Pro.

## Migrations et exploitation

Migration du quota quotidien : `20261019070000_decision_pack_daily_reset.sql`, **non appliquée au VPS à ce stade**. La fenêtre et l'absence de migration parallèle ont été confirmées avec Walid pour ce changement. Vérifier la CI verte sur une branche à jour puis l'historique réel du VPS avant application ; actualiser cet état après déploiement.

### Historique du socle initial

- `20261018000001_pro_game_entitlements.sql`
- `20261018000002_pro_showcase.sql`
- `20261018000003_pro_personalization.sql`
- `20261018000004_pro_export_cleanup.sql`

État lors de la préparation initiale du 18 octobre : appliquées uniquement à Supabase Docker local, jamais au VPS. Les droits étaient fermés par défaut après migration et la branche dépendait de la fondation Stripe (PR #307). Ce récit historique ne décrit pas l'état réel actuel du VPS, à contrôler avant chaque déploiement ; aucun secret ou paiement réel n'est ajouté par le changement de quota quotidien.

Le contrôle historique de bout en bout Sandbox du 18 octobre a créé un compte jetable et une facture fictive payée de 4,99 €. Le serveur Stripe existant a vérifié le paiement et écrit son état : les RPC de jeu ont alors renvoyé 300 secondes, 43 200 secondes et `isPro=true`, selon l'ancien contrat à délai glissant. Ce délai Decision de 12 heures est remplacé par le quota quotidien à 20 h décrit plus haut. L'annulation chez Stripe a ramené les RPC à Basic. Le client, l'abonnement et le compte local jetables ont été nettoyés, puis le périmètre de droits local refermé. Aucun argent réel débité et aucun compte joueur de production modifié.

Après coordination Discord et vérification de l'historique réel des migrations, effectuer la prévalidation serveur et configurer le périmètre avec `node scripts/configure-pro-entitlements.mjs --enable` dans l'environnement cible. Ce script exige les deux indicateurs de paiement fermés et relit le compte/tarif chez Stripe avant d'activer les droits du périmètre exact. Il n'ouvre pas Checkout. Ne jamais passer les secrets en arguments ni les ajouter au dépôt.

Avant ouverture des paiements live : CI verte sur une branche à jour, déploiement de la fondation et de ses migrations, webhook live signé opérationnel, réconciliation planifiée réellement exécutée plus souvent que la fraîcheur maximale de 15 minutes, et cycle paiement/résiliation vérifié. Une panne de synchronisation retire les droits plutôt que de conserver un abonnement inconnu. L'annulation de l'abonnement lors d'une suppression de compte reste un prérequis de lancement de la fondation.

L'intégration visuelle des contrôles du prototype de personnalisation doit consommer ces droits réels ; la présence d'une option grisée dans l'interface ne remplace jamais les gardes SQL/API.

Les contrats historiques d'upload gratuit sont adaptés dans une PR de tests séparée, conformément à la validation de Walid. Les assertions de propriété, de confidentialité, de formats et de taille restent couvertes.
