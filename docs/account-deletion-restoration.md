# Réappliquer les suppressions après restauration

Outil administratif manuel uniquement : `scripts/reapply-account-deletions.mjs`.
Il utilise la clé privée `SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`),
chargée dans l’environnement serveur, jamais en argument, dans Git ou dans une conversation.
`SUPABASE_URL` désigne l’origine HTTPS du même projet. Aucun secret n’est imprimé.

## Avant la restauration

1. Arrêter le jeu et toutes les écritures (y compris les tâches qui pourraient recréer des données).
2. **Avant d’écraser la base**, exporter le journal courant dans un fichier privé indépendant
   du backup qui va être restauré :

   ```sh
   node scripts/reapply-account-deletions.mjs --export /var/backups/private/deletions-before-restore.json
   ```

   Le fichier est créé sans écrasement, avec permissions `0600` sous Unix. Sous Windows,
   utiliser un dossier dont les ACL n’autorisent que l’administrateur. Le fichier contient
   uniquement les UUID/date du journal, son horodatage d’export et l’origine du projet.
   Les lectures sont paginées ; les écritures doivent rester arrêtées pendant l’export.
   Garder une copie séparée de la base restaurée. **Le journal restauré depuis un ancien
   backup ne contient pas les suppressions survenues depuis ce backup.** En cas de perte
   complète du VPS et sans copie extérieure récente de ce journal, cette procédure ne
   permet pas de garantir leur réapplication : les backups hors VPS restent un chantier distinct.

3. Restaurer le backup, remettre toutes les migrations requises via la procédure de déploiement,
   et maintenir le front ainsi que les tâches d’écriture arrêtés.

## Après la restauration

```sh
node scripts/reapply-account-deletions.mjs --journal /var/backups/private/deletions-before-restore.json
node scripts/reapply-account-deletions.mjs --journal /var/backups/private/deletions-before-restore.json --apply
```

Le premier appel est un **dry-run sans écriture ni appel de suppression**. Il affiche
la cible, le nombre d’entrées et le SHA256 du fichier. Vérifier les UUID/date dans le
fichier privé et sa provenance avant d’autoriser l’opération. Une cible différente,
un UUID/date invalide ou des doublons sont refusés. `--apply` exige un terminal et
la confirmation `REAPPLY <nombre>` ; aucun flag ne la contourne.

Si la préparation SQL exige une annulation de facturation, le script charge le même
adaptateur Stripe que la Server Action, uniquement après `--apply` et la confirmation
interactive. Il nécessite **Node.js 22.15 ou plus récent dans la branche 22** pour le
chargement contrôlé des trois modules TypeScript de facturation (API natives Node,
aucune dépendance ajoutée). Le dry-run et le mode export ne chargent pas cet adaptateur.

Charger dans les variables serveur les paramètres habituels : `NODE_ENV`,
`NEXT_PUBLIC_SITE_URL`, `STRIPE_BILLING_MODE`, `STRIPE_SECRET_KEY`,
`STRIPE_ACCOUNT_ID`, `STRIPE_PRO_PRICE_ID` et `STRIPE_PRO_WEBHOOK_SECRET`.
Conserver le compte Stripe, le mode et le prix correspondant aux lignes restaurées.
Le magasin de facturation utilise la même origine Supabase validée que la
restauration (`SUPABASE_URL` prioritaire, sinon `NEXT_PUBLIC_SUPABASE_URL`) et
la même clé privée. La fermeture des nouvelles ventes ne désactive pas cette
annulation : le serveur force uniquement la facturation active et le checkout fermé.
Les autres validations de configuration restent intégralement actives.

Le serveur expire les checkouts ouverts, recherche et annule immédiatement les
abonnements concernés sans prorata ni nouvelle facture, puis confirme en base
avant de reprendre la préparation SQL. Un client sans abonnement peut être
confirmé après vérification ; un compte sans billing ne contacte pas Stripe.
Une erreur Stripe, une configuration absente, un état ambigu, un périmètre incohérent
ou une liste tronquée bloque la suppression avant Storage/Auth. Le verrou reste actif,
la liste cesse sans retry automatique et aucun détail fournisseur ne sera imprimé.
Inspecter Stripe et les étapes déjà terminées avant toute reprise manuelle ;
ne jamais contourner le verrou ni effacer les mappings pour débloquer la procédure.

La suppression réutilise exactement la routine serveur : clôture/remboursement des
ventes, retrait des mises et prolongation éventuelle, annulation des échanges,
effacement SQL, suppression des avatars via Storage, puis suppression **définitive**
de l’identité par Auth Admin. Une identité déjà absente est acceptée ; les autres
échecs arrêtent la liste au premier UUID, sans nouvelle tentative automatique.
La date originale du journal exporté est conservée (la date la plus ancienne gagne).
Le verrou de suppression reste actif en cas d’échec partiel ; contrôler cet UUID
avant une reprise explicite. Les réexécutions n’effectuent pas deux remboursements.

Avant de rouvrir : vérifier l’absence des identités, profils, collections et avatars
concernés, les références anonymes « Joueur supprimé », le journal, puis lancer
`check-prod-drift.sh`. Le script ne restaure rien, n’applique aucune migration,
ne réactive aucun service et n’est jamais exécuté automatiquement.
