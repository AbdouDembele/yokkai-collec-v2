# Connexion OAuth Google et Discord

Doc interne de mise en production. Sources vérifiées : GoTrue `v2.196.0` (image
du VPS, voir `docs/auth-hardening.md`), fichiers `internal/conf/configuration.go`,
`internal/models/linking.go`, `internal/api/external.go`, `internal/api/provider/{google,discord}.go`.

## Parcours

1. `/login` ou `/signup` : bouton « Continue with Google/Discord » → Server Action
   `startOAuth` (`app/auth/oauth-actions.ts`).
   - lit `GET /auth/v1/settings` ; fournisseur désactivé → message propre, aucune
     redirection vers la page JSON brute de GoTrue ;
   - `signInWithOAuth` en PKCE (`@supabase/ssr`) : le code verifier est posé en
     cookie, `redirectTo = <NEXT_PUBLIC_SITE_URL>/auth/callback` ;
   - code parrain (`/signup?ref=…`) → cookie httpOnly `yk-oauth-referral`, 30 min.
2. Fournisseur → `https://<API Supabase>/auth/v1/callback` → `/auth/callback`
   (`app/auth/callback/route.ts`) : `exchangeCodeForSession`, puis paramètre `next`
   interne uniquement (`safeNextPath`), sinon la home `/` (connexion). Un nouveau compte est retenu par le proxy sur `/choose-username`, puis envoyé sur `/boosters` comme une inscription email. Erreur → `/login?oauth=denied|verify-email|error|service`.
3. Nouveau compte OAuth : le trigger `handle_new_user_profile` crée un profil
   `player-<16 hex>` et une ligne dans `oauth_pseudo_pending` (migration
   `20261027010000_oauth_username_step.sql`). Le proxy redirige toutes les pages de
   jeu vers `/choose-username` tant que `is_pseudo_required()` vaut true.
4. `/choose-username` : mêmes règles que l'inscription (`pseudoValidationError`,
   `is_pseudo_available` pendant la saisie, CGU), RPC `choose_pseudo(pseudo, code)` :
   pseudo définitif, parrainage enregistré comme à l'inscription email, récompense si
   l'email est vérifié. Le pseudo est copié dans `user_metadata` pour que le proxy
   n'interroge plus la base.

Discord : GoTrue demande toujours exactement les scopes `email identify`
(`provider/discord.go`) ; le front ne les répète pas (ils seraient dupliqués).

## Liaison de comptes (comportement GoTrue par défaut)

`DetermineAccountLinking` : à la première connexion OAuth, GoTrue cherche un compte
existant avec la **même adresse vérifiée** et, s'il y en a exactement un, lui ajoute
l'identité Google/Discord. Le joueur inscrit par email retrouve donc son compte,
son pseudo et son `user_metadata` (fusion des données du fournisseur).
Au retour, `/auth/callback` détecte cette liaison (identité Google/Discord créée à
l'instant sur un compte plus ancien, `newlyLinkedProvider`) et pose un cookie flash
`yk-oauth-linked` (2 min) : le bandeau `LinkedAccountNotice` annonce une fois
« Your Google account is now linked to your existing Yokkai account ». Choix
produit : liaison automatique annoncée, pas de proposition préalable (GoTrue lie
avant que le front ne reprenne la main ; une proposition exigerait de désactiver
la liaison via `GOTRUE_EXPERIMENTAL_PROVIDER_LINKING_DOMAINS` et une liaison
manuelle depuis les réglages). Plusieurs
comptes candidats → erreur, aucun compte créé.

Une adresse est « vérifiée » si le fournisseur l'indique (`email_verified` /
`verified_email` chez Google, `verified` chez Discord) **ou si
`GOTRUE_MAILER_AUTOCONFIRM=true`**. Dans ce dernier cas GoTrue lierait aussi une
adresse non vérifiée par le fournisseur : **ne jamais activer OAuth avec
`GOTRUE_MAILER_AUTOCONFIRM=true`**. Garder aussi
`GOTRUE_MAILER_ALLOW_UNVERIFIED_EMAIL_SIGN_INS=false` : une adresse Discord non
vérifiée reçoit un email de confirmation et revient sur `/login?oauth=verify-email`.

Si le compte email existant n'est pas confirmé, GoTrue supprime ses autres
identités et son mot de passe avant de le confirmer par l'identité OAuth
(`RemoveUnconfirmedIdentities`) : protection contre la pré-création d'un compte par
un tiers.

## Déclaration chez les fournisseurs

URL de redirection, identique pour les deux et égale à `API_EXTERNAL_URL` + `/callback` :

```
https://<domaine API Supabase>/auth/v1/callback
```

- Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web
  application) → Authorized redirect URIs. Écran de consentement : scopes `openid`,
  `email`, `profile` (défauts GoTrue).
- Discord Developer Portal → Application → OAuth2 → Redirects.

## Variables GoTrue (service auth dans Coolify)

Préfixe `GOTRUE_` + champs `External.Google|Discord` de `OAuthProviderConfiguration` :

| Variable                               | Valeur                                            |
| -------------------------------------- | ------------------------------------------------- |
| `GOTRUE_EXTERNAL_GOOGLE_ENABLED`       | `true`                                            |
| `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`     | client ID Google (hors dépôt)                     |
| `GOTRUE_EXTERNAL_GOOGLE_SECRET`        | secret Google (hors dépôt, gestionnaire sécurisé) |
| `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI`  | `https://<domaine API Supabase>/auth/v1/callback` |
| `GOTRUE_EXTERNAL_DISCORD_ENABLED`      | `true`                                            |
| `GOTRUE_EXTERNAL_DISCORD_CLIENT_ID`    | client ID Discord (hors dépôt)                    |
| `GOTRUE_EXTERNAL_DISCORD_SECRET`       | secret Discord (hors dépôt)                       |
| `GOTRUE_EXTERNAL_DISCORD_REDIRECT_URI` | `https://<domaine API Supabase>/auth/v1/callback` |
| `GOTRUE_URI_ALLOW_LIST`                | liste existante + `https://<site>/auth/callback`  |
| `GOTRUE_MAILER_AUTOCONFIRM`            | `false` (prérequis, voir liaison de comptes)      |

Le secret Google se nomme bien `..._SECRET` (pas `..._CLIENT_SECRET`) ; sans
`ENABLED`, `CLIENT_ID`, `SECRET` et `REDIRECT_URI`, GoTrue répond « provider is not
enabled » ou « missing … ». Dans le compose Supabase auto-hébergé,
`GOTRUE_URI_ALLOW_LIST` est souvent alimentée par `ADDITIONAL_REDIRECT_URLS` :
modifier la variable réellement injectée (vérifier dans le conteneur, voir
`docs/auth-hardening.md`). GoTrue accepte déjà les URL du même hôte que
`GOTRUE_SITE_URL` ; l'entrée explicite reste nécessaire si le site n'est pas sur cet
hôte. Ne pas ajouter localhost ni de domaine de prévisualisation en production.

Aucune nouvelle variable côté Next : `NEXT_PUBLIC_SITE_URL` (déjà présente) fixe
l'origine du `redirectTo`. CSP : inchangée (`form-action 'self'` suffit, la sortie
vers le fournisseur est une navigation `window.location`, pas une soumission de
formulaire ; le retour est une navigation de premier niveau).

## Ordre de mise en production

1. Créer les applications OAuth Google et Discord avec l'URL de redirection ci-dessus.
2. Vérifier `GOTRUE_MAILER_AUTOCONFIRM=false`, puis poser les variables du tableau
   dans Coolify (service auth), une à une, secrets hors dépôt.
3. Recréer/redémarrer le service auth (un simple restart ne recharge pas un
   environnement Docker modifié), vérifier `/health` puis `GET /auth/v1/settings`
   (`external.google` / `external.discord` à `true`).
4. Appliquer `20261027010000_oauth_username_step.sql` via
   `scripts/deploy-migrations.sh` (aperçu puis `--apply`). **Avant** cette migration,
   une inscription OAuth échoue (« Database error saving new user ») : le trigger
   exige un pseudo.
5. Merger le front (Coolify redéploie `master`). Le front reste compatible avant
   l'étape 3 : boutons affichés, message « … sign-in isn't available yet ».
6. Tester avec des comptes jetables : nouveau compte Google et Discord (étape
   pseudo, lien de parrainage), connexion Google d'un compte email existant (même
   compte retrouvé), refus du consentement (`/login?oauth=denied`), suppression de
   compte après reconnexion OAuth. Nettoyer les comptes de test.

Retour arrière : `GOTRUE_EXTERNAL_*_ENABLED=false` puis recréer le service auth ;
les boutons affichent alors le message « not available yet ».
