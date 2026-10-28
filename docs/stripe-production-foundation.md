# Stripe Pro — socle serveur, vente désactivée

## État de livraison

Branche indépendante créée depuis `origin/master` (`1523ee5`). Ce lot prépare le backend persistant ; il **ne rend pas l’offre commercialisable** et ne remplace pas l’aperçu local de la PR #300. Ne pas activer les achats, merger ou déployer sans finir la checklist ci-dessous. Aucun objet Stripe en mode réel, débit ou accès Pro de production créé pendant le développement.

Migration `20261017000000_stripe_billing_foundation.sql` : **pas appliquée sur le VPS**, aucune base distante modifiée. Avant son application, coordonner avec Walid sur Discord et vérifier l’historique réel avec le script officiel du dépôt. Aucune migration de droits de jeu dans ce lot ; pas de test existant remplacé, assoupli ou ignoré.

## Parcours serveur

- `POST /api/billing/checkout` : compte déduit de la session Auth, Origin exact, corps JSON vide. Prix serveur uniquement : 499 centimes EUR, mensuel récurrent, quantité 1, prix actif et mode concordant. Aucun montant, UUID ou customer Stripe fourni par le navigateur. Pas de coupon ni de période d’essai configurés.
- Correspondance compte/customer persistée **avant** Checkout. Compte Stripe vérifié par `accounts.retrieve(null)` ; portée mode/compte/prix figée sur la ligne DB et indépendante des rotations de clé secrète. Les métadonnées sont informatives, jamais une preuve de propriété.
- Verrou DB clôturé par jeton et échéance de 90 secondes, couvrant plusieurs processus. Un worker périmé ne peut plus écrire ni libérer le verrou de son successeur. Clés d’idempotence stables pour customer et Checkout, session ouverte réutilisée, abonnements non terminés bloquant les doublons. Un ancien Checkout terminé ne bloque pas un réabonnement si son abonnement est confirmé terminé dans Stripe.
- Intention persistée avant les appels de création. Une création incertaine sans correspondance récupérée après 23 heures exige une revue opérateur, au lieu de retenter après l’expiration de la rétention d’idempotence Stripe.
- `GET /api/billing/status` : relecture Stripe et miroir DB ; renvoie seulement état actif/statut/échéance/résiliation/existence du customer, jamais d’identifiant de facturation. Un simple retour `?checkout=returned` ne confère aucun droit.
- `POST /api/billing/portal` : même authentification et protection Origin ; portail du customer enregistré côté serveur. Résiliation et factures doivent être activées dans la configuration du portail Stripe.
- `POST /api/billing/webhook` : corps brut borné à 256 Kio, signature SDK/tolérance de 300 secondes, mode et compte Connect contrôlés. API SDK verrouillée par `package-lock.json` (Stripe 23.0.0 / `2026-09-30.endive`) ; configurer la même version pour la destination webhook.
- Liste exacte des événements dans `lib/billing/subscription.ts` : Checkout, cycle d’abonnement, factures et événements de risque. Événements traités une seule fois après écriture atomique du miroir ; un échec DB/provider n’est pas acquitté comme traité. Les notifications désordonnées relisent l’état Stripe actuel, sans appliquer une vieille projection.
- Remboursement, litige ou alerte fraude : suspension conservatrice et persistante du customer concerné, y compris remboursement partiel ou autre paiement de ce customer. Aucun rétablissement automatique après un ancien événement ou un litige gagné ; revue opérateur obligatoire. Confirmer cette politique avant lancement.
- Pro requiert abonnement `active`, non suspendu, un seul article au bon prix/quantité et facture payée positive du même abonnement, couvrant la période de cet article. `trialing`, `past_due`, `unpaid`, `incomplete`, `paused`, prix/mode différents et réponse provider tronquée ne donnent pas Pro. Annulation en fin de période conserve l’accès payé jusqu’à échéance. Les crédits/coupons entraînant une facture à zéro ne sont pas pris en charge dans cette première offre.

## Droits SQL et fraîcheur

Tables `billing_accounts` et `billing_webhook_events` : RLS activée sans politique joueur, tous droits retirés à PUBLIC/anon/authenticated. Fonctions `SECURITY INVOKER`, `search_path` vide, exécution service_role seulement. Aucun élargissement de l’allowlist SECURITY DEFINER ni écriture de statut Pro par un joueur.

`billing_has_pro(uuid,text)` est un prédicat **interne**, destiné au prochain lot de fonctions de jeu. Il contrôle portée, actif, statut, suspension, échéance et vérification datant de moins de 15 minutes. Il n’est pas encore appelé par les RPC de jeu et n’ajoute aucun avantage dans ce lot.

`POST /api/billing/reconcile?after=<UUID>` : secret Bearer serveur indépendant de 32 caractères minimum, comparaison constante, pagination par UUID et budget de travail d’environ 20 secondes hors dernier appel provider. Retourne `checked`, `failed`, `next`. Le scheduler doit suivre **tous** les curseurs, inspecter les échecs même avec un curseur non nul, puis retenter les comptes en erreur. Sans relecture assez récente, les futurs droits SQL se ferment ; ne pas remplacer la panne Stripe par un accès optimiste.

## Configuration et exploitation à préparer

1. Prix final **confirmé par le produit : 4,99 EUR mensuels, sans essai gratuit**. Identifiant fourni par le propriétaire : `price_1URdBZIuXkg5OZqmJiQZmOr7`, déclaré en mode réel. Montant, récurrence, devise, mode et compte restent **à vérifier par l’API Stripe** avec les secrets installés sur le serveur ; l’identifiant seul ne constitue pas cette vérification. Aucun changement de produit ou prix réel automatisé ici.
2. Déposer les secrets uniquement dans le gestionnaire de secrets du VPS : `STRIPE_SECRET_KEY`, `STRIPE_PRO_WEBHOOK_SECRET`, `STRIPE_RECONCILIATION_SECRET`, clé serveur Supabase existante. Les identifiants `STRIPE_ACCOUNT_ID` et `STRIPE_PRO_PRICE_ID` peuvent être communiqués sans clé secrète. Ne jamais coller les clés dans le chat, les logs, le dépôt ou une variable `NEXT_PUBLIC_`.
3. Copier le modèle `.env.billing.example` hors Git. Par défaut **les deux flags restent false**. Mode test accepté uniquement en développement sur app/DB loopback ; mode live uniquement sur origine exacte `https://yokkai-collec.com`, build production, DB HTTPS non locale. Incohérence ou configuration absente : refus avant Stripe.
4. Installer la destination webhook et ses événements exacts, le portail client et un scheduler de réconciliation au moins toutes les cinq minutes. Ajouter alerte sur erreurs webhook, drift, factures échouées et comptes à risque. Vérifier la pagination avec la charge réelle avant lancement. Maintenance prolongée peut retarder les webhooks : la réconciliation doit restaurer un état frais avant réouverture.
5. Répéter en mode test : 3DS, paiement refusé, abandon, retry, renouvellement, résiliation, échéance, réabonnement, remboursement/litige, notification répétée/désordonnée, coupure réseau et DB. Pas de paiement live « de test » automatisé.

Préparation de la configuration de production, **sans activation** (ne pas charger ces valeurs dans le serveur de développement) :

```dotenv
STRIPE_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
STRIPE_BILLING_MODE=live
STRIPE_ACCOUNT_ID=acct_1UQSidIuXkg5OZqm
STRIPE_PRO_PRICE_ID=price_1URdBZIuXkg5OZqmJiQZmOr7
```

L’identifiant de compte `acct_1UQSidIuXkg5OZqm` a été fourni par le propriétaire, mais reste à vérifier auprès de Stripe, comme le tarif. Les secrets restent hors dépôt. Le modèle `.env.billing.example` conserve son mode test, son compte et son tarif vides pour ne jamais mélanger ces identifiants réels avec une clé de test. Les deux flags ci-dessus restent false jusqu’à la livraison et à la validation de tous les lots obligatoires.

### Vérification serveur sans activation

La variable `STRIPE_SECRET_KEY` accepte une clé restreinte `rk_test_…` / `rk_live_…`, recommandée pour une nouvelle intégration, ou une clé secrète classique du même mode. Les clés publiques `pk_…`, de l’autre mode et d’organisation ne sont pas acceptées. Conserver les mêmes précautions de stockage pour les clés restreintes ; ne jamais les partager dans le chat. Dans Coolify, configurer le secret disponible **au runtime uniquement**, pas comme argument de build, et conserver les deux flags d’activation à false. Ne pas redéployer simplement pour préparer les valeurs.

Le précontrôle ne requiert que la lecture du compte et des tarifs. Pour le service complet, prévoir ensuite les droits minimaux correspondant aux appels SDK : lecture compte/tarifs/abonnements/factures/charges ; écriture customers, sessions Checkout et sessions du portail client. Tester ces permissions en sandbox, puis reproduire uniquement les droits nécessaires en réel. Aucune permission de versement, virement ou remboursement n’est utilisée par ce socle ; ne pas accorder « tout en écriture ». Les futurs parcours de suppression/résiliation nécessiteront une revue distincte des droits.

Références : [clés restreintes Stripe](https://docs.stripe.com/keys/restricted-api-keys) et [portée runtime Coolify](https://coolify.io/docs/applications/configuration/environment-variables).

Après installation des variables dans le gestionnaire de secrets du serveur, et lorsque ce script est disponible dans le conteneur de la branche de préparation, lancer `node scripts/check-stripe-setup.mjs`. Ne pas copier une clé live dans l’environnement local pour cette vérification.

Ce script refuse de démarrer hors `NODE_ENV=production`, avec une autre origine ou si un des flags n’est pas explicitement `false`. Il appelle uniquement `GET /v1/account` et `GET /v1/prices/<id>` via le SDK officiel, vérifie le compte, le mode réel et le tarif actif 499 centimes EUR mensuel récurrent. Aucun client, Checkout, abonnement ou paiement créé, aucune écriture SQL. La sortie ne contient pas la clé, de réponse fournisseur brute ou d’identifiant financier. Un succès confirme ces contrôles uniquement, **pas** la préparation du webhook ou des avantages, ni l’autorisation d’ouvrir les achats.

### Tarif Sandbox fourni — recette isolée locale

Le 17 octobre 2026, le précontrôle API a vérifié le tarif `price_1URcyIIQHbfFctSIkiBvXgIo` : actif, `livemode: false`, 499 centimes EUR mensuel récurrent. Le compte réellement associé à la clé de test est `acct_1UQSisIQHbfFctSI`, **différent du compte réel initialement fourni**. L’écart a été refusé par le premier précontrôle avant correction de la configuration locale. Le tarif réel n’a pas été vérifié par cette recette.

Configuration de préparation locale, séparée de Coolify production :

```dotenv
STRIPE_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
STRIPE_BILLING_MODE=test
STRIPE_ACCOUNT_ID=acct_1UQSisIQHbfFctSI
STRIPE_PRO_PRICE_ID=price_1URcyIIQHbfFctSIkiBvXgIo
STRIPE_SECRET_KEY=
STRIPE_PRO_WEBHOOK_SECRET=
STRIPE_RECONCILIATION_SECRET=
```

Utiliser uniquement une clé restreinte `rk_test_…` de ce même environnement, stockée dans un fichier local ignoré ou un gestionnaire de secrets, jamais dans le chat ou Git. L’application et Supabase de recette doivent être locaux et distincts de la production. Ne remplacer aucune variable live de Coolify par ces valeurs.

Le script `check-stripe-setup.mjs` existant reste réservé au précontrôle **live en lecture seule**, sans changement de ses garde-fous. Un script distinct `scripts/check-stripe-sandbox.mjs` vérifie compte et prix en lecture seule avec `NODE_ENV=development`, origine loopback, clé test et flags explicitement fermés ; il n’accède pas à Supabase et ne crée aucun objet Stripe. Il exige un tarif actif, `livemode: false`, 499 centimes EUR mensuel récurrent. Résultats et erreurs expurgés ; un échec ne doit pas être contourné en activant les flags.

Une fois la clé **test** déposée dans `.env.stripe-sandbox.local` (fichier ignoré par Git, distinct des fichiers chargés par Next.js), lancer depuis cette branche :

```sh
node --env-file=.env.stripe-sandbox.local scripts/check-stripe-sandbox.mjs
```

Ne jamais afficher ce fichier après ajout de la clé. Ce contrôle n’active pas Pro et ne valide pas le parcours d’achat.

### Écoute webhook et Checkout locaux

Stripe CLI **1.54.0 Windows x86_64** est installé uniquement sous `.tools/stripe-cli/1.54.0/`, ignoré par Git, depuis la [release officielle](https://github.com/stripe/stripe-cli/releases/tag/v1.54.0). SHA-256 de l’archive vérifié : `9653307aa5bf56f1fa8b8c1ca981e42b0be39af5d6ef5e5eb3686061450c7e4b`. Le binaire n’est pas livré dans Git ; sur une autre machine, installer cette version à cet emplacement avant lancement.

```sh
npm run billing:sandbox
```

Le lanceur refait le précontrôle puis lit la configuration de Supabase local via sa CLI, en refusant tout hôte distant. Stripe CLI reçoit la clé via son environnement, pas ses arguments, et écoute uniquement les événements snapshot de `BILLING_EVENTS` du compte lui-même (`--events-from @self`). Le secret de signature reste en mémoire et est passé au processus Next.js sans être affiché ni enregistré. Les sorties du lanceur sont bornées à des messages fixes, jamais les logs bruts de Stripe CLI. Pas de destination webhook publique créée dans Stripe.

L’application démarre avec Webpack, liée à `127.0.0.1:3002`, origine `http://localhost:3002`. Les flags restent `false` dans le fichier privé ; le lanceur active les routes **uniquement dans son processus enfant local**, en mode test avec clé test et Supabase loopback. Les deux processus sont arrêtés ensemble si l’un d’eux s’arrête. Le serveur de l’aperçu existant sur le port 3000 n’est pas modifié.

La gestion de l’abonnement est centralisée dans `/settings#subscription`, accessible depuis « Settings » dans le menu profil. Statut et échéance sont vérifiés côté serveur pour l’utilisateur authentifié ; souscription, rafraîchissement et accès au portail Stripe utilisent les mêmes routes protégées. Checkout (succès/abandon) et portail reviennent à cette section. Factures, moyen de paiement et résiliation restent hébergés chez Stripe ; aucune donnée bancaire n’est stockée dans l’application. Le retour navigateur ou ses paramètres ne donnent jamais accès à Pro.

La section conserve la DA des paramètres et se replie sur mobile. Sans facturation activée, aucun achat ne peut être démarré et aucun appel Stripe n’est fait ; si la vérification échoue, elle affiche un statut indisponible, pas un statut Basic/Pro supposé. En Sandbox, une mention explicite rappelle qu’aucun argent réel ni avantage de jeu n’est accordé. Recette sur compte jetable : Basic, Pro actif résilié à échéance, portail et rafraîchissement vérifiés, ainsi que rendu Chrome 1440/390 px sans débordement horizontal. Compte nettoyé, captures sous `artifacts/subscription-settings/` hors Git.

Présentation locale affinée : prix mensuel sans mention d’essai gratuit, indicateur compact « Test mode » uniquement en Sandbox, badge actif vert en haut à droite (pas de badge vert sans statut actif vérifié ou après échec de synchronisation). Le bouton de rafraîchissement est remplacé par une synchronisation au montage, au focus/retour de page, au retour réseau et toutes les 30 secondes quand l’onglet est visible. Pas de requêtes simultanées ni pendant l’ouverture d’une action Stripe ; délai de requête de 10 secondes, annulation et nettoyage à la sortie. Les événements navigateur ne donnent aucun droit : chaque mise à jour provient du endpoint authentifié de statut. Recette Chrome sur compte jetable : changement de résiliation repris par polling, puis par événement focus, sans clic manuel. Le changement du test éditorial imposant l’ancien bouton doit être livré séparément avec validation Walid avant livraison produit.

`/design-system/billing-preview` reste un outil de diagnostic local, avec un lien vers les paramètres. `/premium` conserve uniquement un ancien retour local vers cet outil ; ces deux pages refusent la production et toute configuration hors test explicitement activé. Il ne s’agit pas de la page de vente finale et aucun avantage de jeu n’est activé.

Migration `20261017000000_stripe_billing_foundation.sql` appliquée **uniquement** au conteneur `supabase_db_Kara`, contexte Docker Desktop local vérifié (`npipe:////./pipe/dockerDesktopLinuxEngine`). Tables auparavant absentes ; aucune migration ni donnée du VPS touchée. L’historique de migrations de production n’est pas modifié.

Portail Sandbox créé : `bpc_1URfFDIQHbfFctSIt9k0DO25`, confirmé `livemode: false`, configuration par défaut de cet environnement de test. Factures et modification du moyen de paiement activées ; résiliation en fin de période sans prorata ; changement de prix/quantité désactivé. Aucune configuration du compte réel modifiée.

Contrôle réel local/Sandbox : Auth local jetable, prix forgé refusé (400), Origin tiers refusée (403), Checkout mensuel à 499 centimes créé puis réutilisé au second clic, expiration du Checkout suivie d’un webhook signé réellement traité et enregistré en SQL, aucun accès accordé sans paiement. Le compte Auth et le customer Stripe jetables ont été nettoyés ; aucun débit effectué. Le webhook non signé est refusé et une requête de statut sans session reçoit 401.

Le propriétaire a ensuite finalisé un paiement fictif : vérification API d’une facture Sandbox payée **499 centimes EUR** et d’un abonnement `active` ; vérification SQL locale du miroir `active`, d’un webhook traité et du prédicat interne `billing_has_pro` admissible. Aucun paiement réel ni avantage de jeu de production accordé.

Recette complémentaire sur deux comptes jetables indépendants du compte du propriétaire : moyen de paiement Stripe de test refusé (`card_declined`), facture impayée, abonnement `incomplete`, webhook signé traité, accès refusé par l’API et `billing_has_pro`. Le paiement refusé est provoqué par le SDK Sandbox ; cela ne remplace pas une recette visuelle du formulaire Checkout hébergé.

Sur le second compte, facture fictive de 499 centimes payée, accès activé par webhook et vérifié dans l’API et SQL. Échéance raccourcie à 90 secondes, uniquement pour ce compte Sandbox, via `cancel_at` sans prorata ; accès payé conservé avant l’échéance. Après l’échéance, `billing_has_pro` refuse déjà l’accès même si le miroir conserve temporairement `active` en attendant Stripe : expiration SQL fermée indépendamment de la livraison du webhook. Stripe passe ensuite à `canceled` ; le webhook signé retire l’accès et actualise le miroir SQL **avant** tout rafraîchissement manuel. L’API et `billing_has_pro` refusent ensuite l’accès. Les deux clients Stripe et comptes Auth jetables ont été nettoyés après annulation des seuls abonnements créés pour cette recette ; aucun changement sur le compte du propriétaire ni en production.

Recette avancée réussie sur quatre autres comptes jetables, sans modification du code produit :

- 3DS requis : PaymentIntent Stripe `requires_action`, abonnement `incomplete`, facture impayée et accès refusé par API/SQL après webhook. Cette vérification n’inclut pas encore la validation interactive du challenge.
- Remboursement fictif intégral de 499 centimes : accès d’abord actif après paiement, puis `risk_hold` persistant et accès retiré par webhook. Deux rafraîchissements API successifs ne lèvent pas la suspension ; SQL refuse l’accès.
- Litige Sandbox réellement généré par la carte Stripe dédiée : facture payée, litige observé chez Stripe, suspension par webhook et refus API/SQL. Un rafraîchissement ne supprime pas la suspension conservatrice, dont la politique et la levée par opérateur restent à définir avant vente.
- Renouvellement mensuel : horloge Stripe attachée à un seul client jetable, initialisée 40 jours dans le passé. La première période déjà expirée ne donne aucun accès. Avancer cette horloge produit une nouvelle facture payée de 499 centimes (`subscription_cycle`) couvrant la date réelle, prolonge la période et active le miroir par webhook avant rafraîchissement ; API/SQL accordent alors l’accès. Ni l’heure du serveur ni celle de PostgreSQL n’ont été modifiées. La correspondance du client à son compte SQL est préparée par le harnais local pour ce scénario d’horloge, pas par Checkout.

Les quatre comptes Auth, clients/abonnements Stripe jetables et l’horloge ont été nettoyés. Aucun argent réel, aucune donnée de production, aucun abonnement du propriétaire modifiés.

Un cinquième compte jetable a servi à tenter le challenge sur la facture hébergée Stripe dans Chrome headless isolé. Le harnais n’a pas complété le challenge dans son délai : essai **non validé**, facture restée impayée et accès refusé. Ce cinquième compte/client/abonnement a également été nettoyé. Cet échec de recette ne prouve pas un défaut du parcours utilisateur ; validation manuelle du challenge dans Checkout requise avant vente.

**Restent à tester avant vente** : parcours visuel de refus/3DS dans Checkout hébergé, renouvellement refusé/avec authentification requise et reprise après paiement, remboursements asynchrones/partiels, clôture de litige et revue opérateur. Préparer ces scénarios n’est pas équivalent à les avoir exécutés ; la recette ne couvre pas encore tous les cas de facturation.

## Conditions obligatoires avant vente — lots suivants

État au 18 octobre 2026 : la migration des quotas `20261018000000_billing_request_limits.sql` est appliquée uniquement à `supabase_db_Kara` via le contexte Docker Desktop local vérifié, jamais au VPS. Le propriétaire confirme la coordination Discord avec Walid et l’absence de migration parallèle pour le futur déploiement Stripe ; relire l’historique réel avant toute application. L’alerte GitGuardian historique 38337866 concerne une ancienne valeur factice de test remplacée par génération aléatoire ; le propriétaire du compte GitHub/GitGuardian doit la qualifier. Aucun contournement ni merge avec contrôle rouge.

- Intégrer proprement l’interface commerciale `/premium` des PR #300/#304, retirer ses mentions de prototype **seulement** lorsque tous les bénéfices annoncés sont fonctionnels et vérifiés ; brancher ses actions sur ces routes de facturation. La gestion et les retours Stripe restent dans `/settings#subscription`, indépendamment de la page commerciale.
- Faire contrôler **en SQL**, atomiquement, les limites et délais : Basic/Pro 3/6 enchères, Regular Pack 10/5 minutes, Decision Pack 1/2 par période renouvelée pour tous à 20 h `Europe/Paris` (heure d'été/hiver comprise, deux packs Pro disponibles ensemble, sans report), et vitrine 5/10. Le quota Decision à heure fixe remplace l'ancien délai glissant de 24/12 heures ; les transitions de formule ne réinitialisent pas sa consommation. Ne pas toucher aux probabilités par carte. Définir downgrade/expiration sans suppression arbitraire de cartes, médias ou ventes.
- Persister le style Pro et appliquer les restrictions de personnalisation au serveur/Storage, pas seulement au bouton grisé. Désormais la page locale reste inchangée sur le port 3000 ; son état en mémoire ne devient pas un droit de production.
- Les succès Pro donnant des Karas restent dans l’offre, mais leur implémentation est reportée par le propriétaire le 18 octobre 2026. Les présenter comme « Coming soon » jusqu’à leur livraison, sans inventer d’objectifs ou de récompenses. Ce lot ne bloque pas le lancement des autres avantages, sans prétendre qu’il est déjà disponible.
- Limites de fréquence durables ajoutées aux endpoints authentifiés : Checkout 10/10 minutes, portail 10/5 minutes, statut 30/minute, par utilisateur, périmètre et action. Admission atomique en SQL, stockage non accessible aux joueurs, refus 429 avec Retry-After ; stockage indisponible ou migration absente : refus fermé avant appel Stripe. Le lease reste une protection distincte contre les créations concurrentes. Migration `20261018000000_billing_request_limits.sql` : non appliquée au VPS.
- Adapter la suppression de compte **avant activation** : résilier chez Stripe, gérer les opérations en cours et les règles de conservation des données de facturation. Le FK cascade seul ne résilie pas chez Stripe ; il ne doit jamais être utilisé comme parcours de suppression d’un abonné payant.
- Vérifier CGV, informations de renouvellement/résiliation, TVA et support avec les responsables concernés ; cette PR n’en définit pas la politique. Obtenir le feu vert produit et sécurité, CI verte sur branche à jour, coordonner les migrations, puis seulement activer la vente.

## Références officielles consultées

- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/customer-management/integrate-customer-portal

Graphify a servi à retrouver le parcours et les limites du prototype existant ; les nouvelles protections ont ensuite été vérifiées directement dans les sources et dans PostgreSQL jetable (tests ciblés). La CI complète reste exécutée uniquement sur GitHub Actions.

> Mise à jour d'intégration : les descriptions du laboratoire ci-dessous
> documentent le socle initial. La page `/premium` publique, les droits de jeu
> et la résiliation avant suppression sont maintenant décrits dans
> `docs/pro-production-integration.md` et `docs/pro-server-entitlements.md`.
> Ces travaux ne constituent pas une ouverture des paiements réels.
