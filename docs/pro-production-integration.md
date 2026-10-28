# Intégration finale Pro — préparation, pas activation

La présentation ne dépend plus d'un drapeau de laboratoire : `/premium`
présente l'offre et renvoie vers `/settings#subscription` pour toute gestion.
Les mutations et la facturation restent protégées côté serveur.

## Droits et présentation

- `ProAccessProvider` lit uniquement `/api/pro/benefits`, au montage, au retour
  sur l'onglet et toutes les 30 secondes visibles. Une erreur ferme les
  contrôles ; aucun état navigateur ne donne de droits serveur.
- Basic garde ses modifications gratuites et son avatar statique. Les imports
  de bannières, les images de cartes et le style sont verrouillés.
- La vitrine propose 5/10 emplacements selon les droits serveur. Le profil,
  le chat d'enchères et le mur rendent les projections cosmétiques de leur
  auteur, jamais celles du visiteur.
- Les styles sont enregistrés via `/api/pro/profile-style`. Les arrière-plans
  et dos de cartes passent par l'import validant les octets et le propriétaire.
- Les succès supplémentaires restent dans l'offre avec « Coming soon » ; aucune
  récompense ni règle de succès supplémentaire n'est activée.

## Suppression de compte et facturation

Migration : `20261018000005_billing_account_deletion.sql`.
**Non appliquée au VPS.** Elle dépend des migrations des PR #307 et #309.

La clôture suit : barrière de suppression déjà commise → acquisition du verrou
facturation → vérification du compte Stripe et de la correspondance privée →
expiration des Checkout ouverts → résiliation immédiate des abonnements du
tarif configuré, sans nouvelle facture/prorata → reçu SQL → libération du
verrou → nettoyage Storage et Auth existant.

Un compte Basic sans client Stripe, intent de création ni opération en cours
peut être supprimé sans dépendre de Stripe. Un verrou encore actif ou un intent
non résolu reste bloquant, même si aucun identifiant client n'a encore été sauvé.

Un autre tarif, une réponse ambiguë, un intent dont l'identifiant n'a pas été
persisté, une liste tronquée ou une erreur Stripe arrête la suppression. Ne
jamais effacer le rapprochement client pour contourner cette protection.
Les opérations peuvent être reprises par un opérateur après résolution ; la
barrière empêche le compte d'acheter ou de recréer des données entre-temps.
Les outils de restauration appelant le noyau sans adaptateur Stripe s'arrêtent
également sur un compte facturé : résoudre sa facturation avant de poursuivre.

Fermer les nouvelles ventes ne désactive pas la résiliation ; les clés de
gestion et le périmètre Stripe doivent rester configurés tant que des
abonnements existent. Aucun remboursement automatique n'est réalisé.

## Conditions avant ouverture des paiements réels

1. PR de tests séparée #311 puis PR de code : CI verte, branches à jour avec
   `origin/master`, revue des changements produit validés avec Walid.
2. Valider les scénarios Sandbox : authentification 3DS, refus, annulation,
   renouvellement et événements dupliqués. Le challenge 3DS a été terminé
   manuellement le 18 octobre : accès refusé avant authentification, facture
   payée ensuite, webhook signé traité, droits API/SQL actifs et compte jetable
   nettoyé. La suppression d'un abonné jetable
   avec facture Sandbox payée de 4,99 EUR a été vérifiée : résiliation Stripe
   avant suppression Auth, rapprochement privé supprimé ensuite, fixture
   nettoyée. La nouvelle migration a été appliquée uniquement à Docker local.
3. Révoquer toute ancienne clé potentiellement exposée, configurer les secrets
   live uniquement côté serveur et vérifier compte/tarif 4,99 EUR mensuel.
4. Coordonner la migration sur Discord et relire l'historique réel du VPS.
5. Déployer avec nouvelles ventes fermées. Configurer le webhook live et une
   réconciliation au plus toutes les 5 minutes, en suivant les curseurs.
6. Valider l'état du déploiement, activer le périmètre de droits live exact,
   puis ouvrir explicitement les ventes. Contrôler l'activation et la
   résiliation d'un premier abonnement réel autorisé par son titulaire.

Aucune de ces étapes de production n'est exécutée par ce changement de code.

## Réconciliation planifiée

Commande : `node scripts/reconcile-stripe.mjs`, dans le conteneur applicatif.
Planifier toutes les cinq minutes (`*/5 * * * *`), avec un timeout de 270 secondes.
Créer la tâche désactivée, puis l'activer et vérifier une exécution réussie avant
d'ouvrir Checkout. Ne placer aucun secret dans la commande : le programme lit
`STRIPE_RECONCILIATION_SECRET` dans l'environnement runtime.

Le programme refuse une autre origine que `https://yokkai-collec.com` et ne suit
pas les redirections. Il draine les curseurs, y compris ceux d'une page HTTP 503
contenant des comptes en erreur, puis recommence une fois depuis le début pour
réessayer ces comptes. Un curseur invalide, une erreur HTTP/réseau, des échecs
persistants ou le budget total de quatre minutes dépassé font échouer la tâche
avec un code stable, sans journaliser de secret ni de réponse fournisseur.
Si la facturation est explicitement fermée, l'exécution est ignorée.

Activer les notifications d'échec de tâche côté exploitation. Vérifier la durée
avec la charge réelle : un dépassement répété du budget exige une adaptation de
capacité avant ouverture, pas un accès Pro optimiste ni l'assouplissement du
contrôle de fraîcheur SQL.
