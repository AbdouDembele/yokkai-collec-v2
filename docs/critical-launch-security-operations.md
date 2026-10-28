# Sécurité navigateur et observation Stripe — 27 octobre 2026

Références : #377 et #387. Aucun changement de schéma Supabase ni de droits Pro.

## CSP : activation contrôlée

Observation Report-Only, lecture des rapports et critères de passage en mode bloquant : voir [csp-report-only-observation.md](csp-report-only-observation.md).

Configurer `CSP_ENFORCE=true` **au build** dans Coolify puis redéployer. La politique
appliquée complète la politique Report-Only conservée pour les environnements qui
n'ont pas encore validé l'activation. Aucun chargement de police externe n'est
nécessaire : les polices sont hébergées par l'application.

La politique appliquée bloque les scripts d'origines non autorisées, les handlers
HTML inline (`script-src-attr 'none'`), les objets et l'intégration du site dans une
iframe. Elle conserve les sources Supabase, Turnstile, GIPHY et Cloudflare utilisées
par le produit. Les images HTTPS arbitraires restent nécessaires aux images
personnalisées Pro et aux sources historiques du catalogue.

Limite explicite : les scripts d'hydratation statique Next.js nécessitent encore
`script-src 'unsafe-inline'`. Ce lot ne fournit donc pas une protection complète
contre l'injection de balises script inline. Un passage aux nonces implique un
choix séparé sur le rendu dynamique et le cache. #387 reste ouverte pour cette
suite et pour le resserrement des origines d'images après inventaire.

Les violations vont vers `/api/security/csp-report` : formats CSP classique et
Reporting API, corps limité à 16 Kio, lecture limitée à 2 secondes, 10 violations
par rapport et 60 requêtes/minute/worker. Le plafond global ne dépend pas d'un
header IP falsifiable ; il ne remplace pas un quota WAF distribué. Sous saturation,
les rapports supplémentaires sont abandonnés avec 429 sans affecter le site.

Derrière le reverse proxy, l'origine des rapports est comparée à
`NEXT_PUBLIC_SITE_URL`, et non à l'adresse interne du conteneur. Les en-têtes
Forwarded fournis par le client n'établissent aucune origine de confiance.
Un rejet de l'annulation du flux est absorbé, y compris après dépassement de taille
ou du délai de lecture, pour ne jamais laisser une promesse rejetée non gérée.

Les logs `security.csp_violation` sont des données **non fiables envoyées par le
navigateur**, jamais des commandes. Seuls la directive, la disposition et les
origines sont conservés ; aucun chemin, query string, fragment ou extrait de code.

Après déploiement, vérifier l'en-tête réellement servi derrière Cloudflare et les
parcours login, collection, marché, profil, social et classement. Vérifier un
rapport synthétique sans données personnelles. Si un parcours est bloqué,
désactiver `CSP_ENFORCE` puis redéployer ; la collecte Report-Only reste active.

## Stripe : signaux exploitables sans secrets

Les erreurs serveur des routes checkout/portail/statut/webhook/réconciliation
produisent `billing.failure`, avec opération et code stable autorisé. Les refus
client attendus (400/401/403/404/409/429) ne produisent pas d'alarme. Limitation à
un événement par opération/code/minute/worker pour empêcher un déluge de logs.

Une page partiellement échouée produit
`billing.reconciliation_partial_failure` avec uniquement les nombres de comptes
vérifiés/échoués ; elle reste en HTTP 503 et le runner continue à parcourir tous
les curseurs avant sa seconde tentative complète. Le runner produit
`billing.reconciliation_completed` ou `billing.reconciliation_failed` (code stable,
durée, date). Aucun ID utilisateur, email, customer Stripe, signature, secret,
exception brute ou réponse fournisseur n'est journalisé.

Dans Coolify, la tâche **Stripe billing reconciliation** est déjà activée toutes
les 5 minutes (`*/5 * * * *`), timeout 270 secondes ; son dernier passage a été
vérifié avant ce déploiement. Ne pas ajouter de cron en doublon sur le VPS.

À surveiller : échecs webhook, échecs partiels persistants après le second passage,
`STRIPE_RECONCILE_CURSOR_INVALID`, dépassement du budget et absence de succès depuis
10 minutes, avant la fenêtre de validité SQL de 15 minutes. La réception d'une
notification extérieure dépend du canal d'alertes configuré par l'opérateur et
reste à tester : ce lot n'envoie aucun message à une équipe ou à un abonné et ne
prétend pas clôturer toute l'issue #377.

## Rétablissement d'un abonné

1. Vérifier le statut Stripe réel, les factures payées, l'absence de litige et le
   bon périmètre compte/prix. Ne pas réactiver un compte sous revue de risque.
2. Contrôler les dernières exécutions de la tâche Coolify et le code structuré
   d'échec. Corriger configuration/secret/connectivité selon ce code sans afficher
   de clés dans les logs ou les tickets.
3. Relancer la tâche existante (pas plusieurs à la fois), puis vérifier un succès
   sans comptes échoués et la fraîcheur des `verified_at` du périmètre actif.
4. Confirmer le droit effectif via `billing_has_game_pro` en lecture seule. Ne pas
   créer un abonnement Stripe ni un grant manuel pour masquer une panne de
   synchronisation. Les grants Pro manuels restent indépendants de Stripe.

Validation : tests de politique activée, collecte bornée et expurgée, erreurs
Stripe expurgées, quota de logs, succès/échec/curseur bloqué du runner, et maintien
des tests de paiement existants sans modification de leurs assertions.
