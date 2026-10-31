# Domaines e-mail jetables : protection des nouvelles inscriptions

## Architecture et emplacement du contrôle

Yokkai utilise Next.js 16, React 19, les Server Actions et Supabase Auth/GoTrue 2.196.0. Le formulaire e-mail appelle `signUp` dans `app/auth/actions.ts`. Google et Discord passent par `startOAuth`, puis le callback PKCE de GoTrue. Des clients peuvent aussi appeler directement l’API Auth avec la clé publique ; les validations du formulaire ne constituent donc pas une frontière de sécurité.

Les contrôles existants du pseudo, mot de passe, consentement, parrainage et CAPTCHA conditionnel restent conservés. Cette fonctionnalité n’active ni ne reconfigure CAPTCHA, les proxys IP ou les fournisseurs OAuth.

Le contrôle décisif est `before_auth_user_created_disposable_email`, un trigger **BEFORE INSERT sur `auth.users`**. Il s’applique à toutes les nouvelles lignes, indépendamment de leur producteur : signup, OTP créant un utilisateur, OAuth, invitation ou création administrative. Les déclencheurs existants de profil et de confirmation/parrainage sont conservés. Un refus annule la transaction de création ; il ne laisse pas de compte ou de profil partiel.

Le hook natif [Before User Created](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) a été évalué. Il convient à une politique de signup mais nécessite une configuration supplémentaire du service GoTrue. Le trigger couvre aussi toute insertion SQL et évite ici de modifier/redémarrer Auth. Conséquence assumée : l’API GoTrue directe retourne son erreur générique de base de données lorsqu’elle rencontre ce garde. Le formulaire Yokkai fournit le message spécifique traduit avant d’appeler Auth ; aucune erreur SQL brute n’est affichée.

## Source et normalisation

Source principale : [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains), fichier `disposable_email_blocklist.conf`. L’instantané initial contient **10 093 domaines**, épinglés au commit `271d27d2fb83fc4c809dfd6cb512a6b910719619`. `data/disposable-email-domains.json` enregistre la source, le commit, le SHA-256 du téléchargement, la date et la liste effectivement utilisée. Le projet source déclare cette liste réutilisable, y compris commercialement.

`lib/server/disposable-email.ts` est réservé au serveur. Il charge une seule fois un Set, normalise les espaces de bord, la casse, les formes Unicode compatibles et les domaines IDNA. Les sous-domaines sont comparés par suffixes complets de labels : `sub.yopmail.com` est refusé, `yopmail.com.example` et `notyopmail.com` ne sont pas confondus avec Yopmail. Une adresse invalide reste du ressort du validateur Auth existant, sans exception du filtre.

En SQL, les règles sont dans `public.signup_email_domain_rules`, avec une clé primaire sur `domain`. Le garde fait un nombre borné de recherches indexées, et non un parcours de la liste. Les graphies Unicode des domaines internationalisés sont également enregistrées. Le normaliseur couvre les caractères de format ignorés par IDNA, sans supprimer arbitrairement les joiners contextuels. Chaque entrée, y compris les graphies Unicode, est testée comme effectivement bloquée.

La priorité est : **allowlist exacte, puis blocklist et ses sous-domaines**. `data/disposable-email-allowlist.json` protège Gmail, Googlemail, Outlook, Hotmail, Live, iCloud, Proton et Yahoo. Modifier ce petit fichier puis lancer le script de mise à jour prépare les règles SQL correspondantes.

Ni la table ni les fonctions de contrôle n’accordent d’accès aux rôles `anon`, `authenticated` ou `service_role`. Le trigger et son checker sont des fonctions SECURITY DEFINER avec `search_path` vide et droits réservés au propriétaire. Aucun secret ou nouveau droit Auth d’administration n’est nécessaire dans Next.js.

## Performances et journaux

Une inscription n’ajoute aucune requête GitHub ou autre requête externe. Next.js utilise le Set local ; GoTrue utilise le garde et l’index local PostgreSQL. La liste n’est pas importée dans le formulaire client.

Les refus journalisent `signup_rejected_disposable_email` et uniquement la règle publique correspondante, par exemple `yopmail.com`. Le préfixe de l’adresse et les sous-domaines arbitraires soumis par le client ne sont jamais journalisés par ce code. Aucun mot de passe, token, secret ou adresse complète n’est ajouté aux journaux. Conserver les paramètres SQL désactivés dans les journaux Auth ; ne pas activer une journalisation de valeurs de paramètres pour ce parcours.

## Mise à jour manuelle et hebdomadaire

```sh
npm ci
node scripts/update-disposable-email-domains.mjs
```

Le script récupère le dernier commit de la branche par défaut officielle puis télécharge le fichier à ce commit précis. Il vérifie le statut HTTP, borne le volume et le délai, valide la syntaxe et les suffixes publics avec `tldts`, normalise, trie et déduplique. Une liste vide, trop courte, anormalement différente, contenant des URL, IP ou suffixes publics est refusée. Les principaux marqueurs de cohérence sont vérifiés.

Tous les contenus sont validés avant remplacement atomique du snapshot. Un échec réseau ou de validation conserve la dernière liste locale valide. Une mise à jour valide crée une **nouvelle migration différentielle**, sans réécrire les anciennes migrations. Seules les règles globales de domaines changent ; aucune donnée d’utilisateur n’est lue ou modifiée.

Le workflow `update-disposable-email-domains.yml` prépare une PR chaque lundi à 06:17 UTC, et peut être déclenché manuellement. Il ne crée pas une deuxième PR si une mise à jour attend déjà une revue. Il utilise le token GitHub du workflow, sans nouveau secret. La création de PR doit être autorisée dans les réglages Actions du dépôt. Le workflow déclenche également la CI complète via `workflow_dispatch` ; selon la politique GitHub, un workflow `pull_request` du bot peut demander une approbation dans l’interface.

Cette automatisation **ne merge ni ne déploie de SQL**. La PR est relue, vérifiée avec la CI GitHub, puis déployée avec la procédure de migration existante. Un échec du job reste visible dans Actions et n’affecte pas le service ni les inscriptions.

## Déploiement et retour arrière

Migration initiale : `20261031170000_disposable_signup_policy.sql`. Elle crée une table globale de règles, trois fonctions internes et le trigger INSERT ; elle ne modifie aucun compte existant. Elle doit être indiquée comme appliquée ou non dans la PR. À la préparation initiale de cette PR, elle est appliquée seulement en local, **pas sur le VPS**.

Procédure : prévenir l’équipe, une seule intervention SQL, sauvegarde validée, contrôle de dérive via `scripts/deploy-migrations.sh --dry-run`, puis `--apply`. Appliquer la migration avant de déployer le front. Aucun réglage GoTrue, aucune clé et aucun redémarrage Auth ne sont nécessaires.

Un retour arrière du garde se prépare dans une **nouvelle migration**, sans réécrire l’historique :

```sql
begin;
drop trigger before_auth_user_created_disposable_email on auth.users;
commit;
```

La table de politique peut rester en place. Aucun utilisateur ni donnée métier n’est supprimé. Redéployer également le front précédent pour retirer le refus anticipé du formulaire. Ne jamais retirer les triggers existants de profil ou de parrainage, ni modifier `auth.users` ou les utilisateurs pour désactiver cette fonctionnalité.

## Vérification

- Tests unitaires : fournisseurs permanents, allowlist prioritaire, domaines de la source, sous-domaines, casse, espaces, IDN et entrée invalide.
- Tests de mise à jour : panne réseau/HTTP, contenu invalide, suffixe public, diminution anormale, conservation exacte de l’ancien fichier et génération d’une migration différentielle.
- Tests SQL : règles cohérentes avec le snapshot, tous les domaines bloqués effectivement refusés, rôles API sans accès, refus des créations e-mail/Google/Discord et des insertions administratives, triggers historiques conservés.
- Tests du vrai Server Action : erreur EN/FR correspondante avant tout appel Supabase, absence de données sensibles dans les logs, signup permanent et login existant préservés.

Une recette supplémentaire utilise le **vrai GoTrue local de même version que la production**, sans SMTP extérieur :

```sh
node --env-file=.env.local scripts/prove-disposable-email-local.mjs --install-local-policy
```

Ce script refuse toute URL Supabase non locale et exige le collecteur SMTP `supabase_inbucket_Kara`. Il applique explicitement la nouvelle politique à la base locale si nécessaire, crée uniquement ses propres comptes de test puis les nettoie. Il vérifie les endpoints signup, OTP, admin-create, invitation et génération de lien, puis signup légitime, login, logout, récupération/réinitialisation, confirmation et login d’un compte local existant portant un domaine jetable. Aucun compte de production ni e-mail réel n’est utilisé.

La CI complète reste exécutée exclusivement par GitHub Actions. Le rapport de PR indique les checks passés et les adaptations de harnais validées par Walid ; aucune assertion historique n’est retirée ou assouplie.

## Limites

Une blocklist n’identifie pas instantanément les nouveaux fournisseurs, les domaines privés ou une adresse fictive sur un domaine absent. Cette politique ne prouve pas la possession d’une boîte mail et ne remplace pas la confirmation, le CAPTCHA ou les autres protections Auth.

Le périmètre est l’insertion d’un **nouveau compte**. Login, renouvellement de session, OTP d’un compte existant, confirmation et récupération restent inchangés. Le changement ultérieur d’e-mail d’un compte existant n’est pas filtré : l’étendre exigerait une décision produit distincte, pour ne pas bloquer les comptes existants. Les opérateurs de base de données restent des administrateurs de confiance capables de modifier la politique.

Les véritables connexions chez Google/Discord ne sont pas automatisées par cette recette ; leur insertion Auth est couverte par les tests SQL. Le zoom navigateur natif à 200 % et les appareils physiques doivent être distingués de l’émulation de zoom lors de la recette UI.

## Fichiers de cette implémentation

- Contrôle serveur et message : `app/auth/actions.ts`, `lib/server/disposable-email.ts`, `i18n/auth-messages.ts`, `messages/en.json`, `messages/fr.json`.
- Données et migration : `data/disposable-email-allowlist.json`, `data/disposable-email-domains.json`, `supabase/migrations/20261031170000_disposable_signup_policy.sql`, `docs/data-export-inventory.json`.
- Maintenance : `scripts/update-disposable-email-domains.mjs`, `scripts/sql/disposable-email-policy.sql`, `.github/workflows/update-disposable-email-domains.yml`, `package.json`, `package-lock.json`.
- Recette : `scripts/prove-disposable-email-local.mjs`, `tests/disposable-email.test.mjs`, `tests/disposable-email-db.test.mjs`, `tests/disposable-email-signup.test.mjs`, `tests/helpers/disposable-email.mjs`.
- Harnais et politique existants, assertions conservées : `tests/auth.test.mjs`, `tests/signup-policy.test.mjs`, `tests/security-definer-allowlist.mjs`.
- Documentation : `docs/disposable-email-signup.md`.
