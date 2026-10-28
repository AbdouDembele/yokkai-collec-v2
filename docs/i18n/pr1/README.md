# PR 1 — corrections de revue et preuves EN/FR

Base : origin/master 9015e68. PR [#545](https://github.com/TheGreatToba/yokkai-collec/pull/545), conservée en brouillon. Flag off. Migration **20261027001000_profile_locale.sql non appliquée au VPS**. Aucun merge, déploiement ou changement Coolify.

## Correction supplémentaire : statuts Decision Pack

[Rapport, diff limité et captures EN/FR desktop + 375 px](decision-review/README.md). Treizième fichier mixte : components/boosters.tsx, seulement trois statuts. Exception EN flag off autorisée : PERDUE devient LOST ; le reste reste pour PR 2.

## Les sept corrections

| Point              | Correction                                                                                                                                                                                                                                                                                                                                                                       | Validation                                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Performance    | Aucun get_my_locale dans le proxy Supabase partagé, revenu au code de master. Le résolveur retourne directement le cookie valide. Profil lu seulement aux connexions/confirmations ou pour récupérer une préférence absente/invalide d’un utilisateur connecté ; ce repli écrit le cookie avant le rendu. Déconnexion sans lecture profil ; choix connecté : profil puis cookie. | Tests de rendu connecté avec cookies manuels/auto : zéro client Supabase et zéro RPC locale dans le résolveur ; zéro RPC locale dans les proxies. Assertions Auth, cache, HttpOnly et durée conservées dans le scénario sans cookie. |
| 2 — Migration      | CREATE OR REPLACE complet et explicite du builder privé d’export ; seul le champ locale est ajouté. Aucun pg_get_functiondef/replace dynamique.                                                                                                                                                                                                                                  | Même corps vérifié contre l’original ; droits, snapshot, réservation, limites et isolation testés en bases mémoire éphémères. Les tests d’export ne sont pas modifiés par cette revue.                                               |
| 3 — Home FR        | La Home réelle utilisait déjà les clés ; l’aperçu photographié avait deux libellés en dur. Aperçu, libellés accessibles du fil et nouveaux textes OAuth/classement catalogués.                                                                                                                                                                                                   | « Tes derniers tirages » et « Voir la collection » visibles ; audit des libellés rendus sans résidu anglais ni clé manquante. [Capture](home-latest-fr-375-review.png), [recette](browser-checks.json).                              |
| 4 — Packs          | Pack/packs partout dans les catalogues FR ; noms Regular Pack et Decision Pack conservés.                                                                                                                                                                                                                                                                                        | Test de glossaire ; données de cartes et raretés inchangées.                                                                                                                                                                         |
| 5 — Tutoiement     | Tu/ton/ta/tes dans tous les catalogues FR ; « Content de te revoir », « Ta collection t’attend ».                                                                                                                                                                                                                                                                                | Test lexical et relecture des accords ; règle permanente dans [le glossaire](../../i18n.md#glossaire-et-ton-commun-aux-cinq-pr).                                                                                                     |
| 6 — Sélecteur Auth | Petit select natif dans l’en-tête ; label visuellement masqué, nom accessible conservé, cible de 44 px. CSS limitée à la présence du sélecteur : aucun effet flag off.                                                                                                                                                                                                           | Largeur mesurée 102 px à 375 px ; responsive 320/375/768/1024/1440 et zoom 200 %, sans débordement.                                                                                                                                  |
| 7 — Flag           | Documentation explicite : NEXT_PUBLIC_I18N_ENABLED est figé au build.                                                                                                                                                                                                                                                                                                            | L’activation exige reconstruction et redéploiement après validation des PR 1+2. Aucun déploiement réalisé.                                                                                                                           |

Les noms, publications de joueurs et contenus fictifs des aperçus restent des données. Ils ne sont pas traduits, comme les noms de cartes, licences, raretés et packs. Les autonymes English/Français et l’action Switch to English sont intentionnels. Les autres pages liées restent rattachées aux PR 2–5 dans [le plan](../../i18n.md). Les derniers merges OAuth, Privacy et classement sont conservés.

## Nouvelles captures 375 px

| Page                  | EN                                     | FR                                     |
| --------------------- | -------------------------------------- | -------------------------------------- |
| Connexion             | [EN](login-en-375-review.png)          | [FR](login-fr-375-review.png)          |
| Inscription           | [EN](signup-en-375-review.png)         | [FR](signup-fr-375-review.png)         |
| Nouveau mot de passe  | [EN](reset-password-en-375-review.png) | [FR](reset-password-fr-375-review.png) |
| Derniers tirages Home | —                                      | [FR](home-latest-fr-375-review.png)    |

Écran connexion entier flag off : [avant](auth-mobile-before-en.png), [après](auth-mobile-after-en.png), **0 pixel différent**.

## Fichiers mixtes : données, structure et EN flag off

Uniquement chaînes d’interface vers t(), imports et initialisations. Structure JSX, classes, styles, props de cartes, images, animations et données conservés. Les valeurs insérées sont des paramètres ICU non modifiés. Contrats AST : [card-boundary.json](card-boundary.json).

| Fichier                                 | Diff                                            | EN avant                                        | EN après                                       | Pixels différents |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ----------------- |
| components/auth-card-customization.tsx  | [diff](diffs/auth-card-customization.tsx.diff)  | [avant](auth-card-customization-before-en.png)  | [après](auth-card-customization-after-en.png)  | 0                 |
| components/auth-decision-preview.tsx    | [diff](diffs/auth-decision-preview.tsx.diff)    | [avant](auth-decision-preview-before-en.png)    | [après](auth-decision-preview-after-en.png)    | 0                 |
| components/auth-showcase.tsx            | [diff](diffs/auth-showcase.tsx.diff)            | [avant](auth-showcase-before-en.png)            | [après](auth-showcase-after-en.png)            | 0                 |
| components/auth-binder-showcase.tsx     | [diff](diffs/auth-binder-showcase.tsx.diff)     | [avant](auth-binder-showcase-before-en.png)     | [après](auth-binder-showcase-after-en.png)     | 0                 |
| components/auth-market-showcase.tsx     | [diff](diffs/auth-market-showcase.tsx.diff)     | [avant](auth-market-showcase-before-en.png)     | [après](auth-market-showcase-after-en.png)     | 0                 |
| components/auth-card-carousel.tsx       | [diff](diffs/auth-card-carousel.tsx.diff)       | [avant](auth-card-carousel-before-en.png)       | [après](auth-card-carousel-after-en.png)       | 0                 |
| components/home-content.tsx             | [diff](diffs/home-content.tsx.diff)             | [avant](home-content-before-en.png)             | [après](home-content-after-en.png)             | 0                 |
| components/home-live.tsx                | [diff](diffs/home-live.tsx.diff)                | [avant](home-live-before-en.png)                | [après](home-live-after-en.png)                | 0                 |
| components/home-dashboard.tsx           | [diff](diffs/home-dashboard.tsx.diff)           | [avant](home-dashboard-before-en.png)           | [après](home-dashboard-after-en.png)           | 0                 |
| components/ui/index.tsx                 | [diff](diffs/index.tsx.diff)                    | [avant](ui-modal-before-en.png)                 | [après](ui-modal-after-en.png)                 | 0                 |
| app/design-system/home-preview/page.tsx | [diff](diffs/page.tsx.diff)                     | [avant](home-preview-before-en.png)             | [après](home-preview-after-en.png)             | 0                 |
| components/home-friend-feed-preview.tsx | [diff](diffs/home-friend-feed-preview.tsx.diff) | [avant](home-friend-feed-preview-before-en.png) | [après](home-friend-feed-preview-after-en.png) | 0                 |

Captures dans Chrome, 1440 px CSS ; carrousel à densité 2× pour stabiliser l’anticrénelage des coins, autres zones à 1×. Même polices et mêmes octets d’images, fichiers animés figés à la première frame ; animations/ transitions CSS figées uniquement dans le navigateur de test. Aucun asset ou code d’animation modifié. Zones représentatives, pas tous les états possibles.

## Validation et poids

- Types et construction de production réussis ; contrôles ciblés de locale/Auth, composants OAuth FR/EN, glossaire et corps SQL explicite passés.
- Droits SQL, bans et export vérifiés dans des bases mémoire jetables, sans connexion Supabase ou VPS.
- Recette : premier HTML FR, cookie un an, bannière persistante, bascule sans navigation document ni perte de saisie, pays non fiable ignoré, navigateur prioritaire, flag off en anglais, aucun résidu UI anglais/clé manquante/hydratation divergente dans les parcours audités.
- Auth réel, délivrabilité email et Turnstile réel non sollicités contre la production. Secours global-error anglais si le fournisseur racine échoue, comme documenté.
- /login : 290798 → 308753 octets gzip de scripts après hydratation, soit +17955 ; préchargements RSC exclus. Catalogue client actif séparé : EN 6841, FR 7658 octets gzip. [Mesure](paired-gzip.json).

## Fichiers de la PR

- `.env.example`
- `AGENTS.md`
- `CLAUDE.md`
- `app/(auth)/forgot-password/page.tsx`
- `app/(auth)/layout.tsx`
- `app/(auth)/login/page.tsx`
- `app/(auth)/signup/page.tsx`
- `app/account-deleted/page.tsx`
- `app/auth/actions.ts`
- `app/auth/callback/route.ts`
- `app/auth/confirm/route.ts`
- `app/auth/oauth-actions.ts`
- `app/choose-username/page.tsx`
- `app/design-system/home-preview/page.tsx`
- `app/error.tsx`
- `app/global-error.tsx`
- `app/layout.tsx`
- `app/loading.tsx`
- `app/locale-actions.ts`
- `app/not-found.tsx`
- `app/page.tsx`
- `app/reset-password/page.tsx`
- `app/settings/page.tsx`
- `components/account-menu.tsx`
- `components/auth-binder-showcase.tsx`
- `components/auth-card-carousel.tsx`
- `components/auth-card-customization.tsx`
- `components/auth-decision-preview.tsx`
- `components/auth-experience.tsx`
- `components/auth-form.tsx`
- `components/auth-market-showcase.tsx`
- `components/auth-showcase.tsx`
- `components/auth-turnstile.tsx`
- `components/choose-username-form.tsx`
- `components/confirmation-resend-form.tsx`
- `components/discord-promo.tsx`
- `components/home-content.tsx`
- `components/home-dashboard.tsx`
- `components/home-friend-feed-preview.tsx`
- `components/home-friend-feed.tsx`
- `components/home-leaderboard.tsx`
- `components/home-live.tsx`
- `components/linked-account-notice.tsx`
- `components/locale-controls.tsx`
- `components/locale-provider.tsx`
- `components/oauth-buttons.tsx`
- `components/password-reset-forms.tsx`
- `components/pro-promotion.tsx`
- `components/referral-reminder.tsx`
- `components/sign-out-button.tsx`
- `components/site-footer.tsx`
- `components/topbar.tsx`
- `components/ui/index.tsx`
- `docs/COLLABORATION.md`
- `docs/i18n.md`
- `docs/i18n/pr1/README.md`
- `docs/i18n/pr1/auth-binder-showcase-after-en.png`
- `docs/i18n/pr1/auth-binder-showcase-before-en.png`
- `docs/i18n/pr1/auth-card-carousel-after-en.png`
- `docs/i18n/pr1/auth-card-carousel-before-en.png`
- `docs/i18n/pr1/auth-card-customization-after-en.png`
- `docs/i18n/pr1/auth-card-customization-before-en.png`
- `docs/i18n/pr1/auth-decision-preview-after-en.png`
- `docs/i18n/pr1/auth-decision-preview-before-en.png`
- `docs/i18n/pr1/auth-market-showcase-after-en.png`
- `docs/i18n/pr1/auth-market-showcase-before-en.png`
- `docs/i18n/pr1/auth-mobile-after-en.png`
- `docs/i18n/pr1/auth-mobile-before-en.png`
- `docs/i18n/pr1/auth-mobile-pixel-comparison.json`
- `docs/i18n/pr1/auth-pixel-comparison.json`
- `docs/i18n/pr1/auth-showcase-after-en.png`
- `docs/i18n/pr1/auth-showcase-before-en.png`
- `docs/i18n/pr1/browser-checks.json`
- `docs/i18n/pr1/card-boundary.json`
- `docs/i18n/pr1/catalogue-gzip.json`
- `docs/i18n/pr1/diffs/auth-binder-showcase.tsx.diff`
- `docs/i18n/pr1/diffs/auth-card-carousel.tsx.diff`
- `docs/i18n/pr1/diffs/auth-card-customization.tsx.diff`
- `docs/i18n/pr1/diffs/auth-decision-preview.tsx.diff`
- `docs/i18n/pr1/diffs/auth-market-showcase.tsx.diff`
- `docs/i18n/pr1/diffs/auth-showcase.tsx.diff`
- `docs/i18n/pr1/diffs/home-content.tsx.diff`
- `docs/i18n/pr1/diffs/home-dashboard.tsx.diff`
- `docs/i18n/pr1/diffs/home-friend-feed-preview.tsx.diff`
- `docs/i18n/pr1/diffs/home-live.tsx.diff`
- `docs/i18n/pr1/diffs/index.tsx.diff`
- `docs/i18n/pr1/diffs/page.tsx.diff`
- `docs/i18n/pr1/historical-fr.json`
- `docs/i18n/pr1/home-content-after-en.png`
- `docs/i18n/pr1/home-content-before-en.png`
- `docs/i18n/pr1/home-dashboard-after-en.png`
- `docs/i18n/pr1/home-dashboard-before-en.png`
- `docs/i18n/pr1/home-fr-375-final.png`
- `docs/i18n/pr1/home-fr-zoom200.png`
- `docs/i18n/pr1/home-friend-feed-preview-after-en.png`
- `docs/i18n/pr1/home-friend-feed-preview-before-en.png`
- `docs/i18n/pr1/home-latest-fr-375-review.png`
- `docs/i18n/pr1/home-live-after-en.png`
- `docs/i18n/pr1/home-live-before-en.png`
- `docs/i18n/pr1/home-pixel-comparison.json`
- `docs/i18n/pr1/home-preview-after-en.png`
- `docs/i18n/pr1/home-preview-before-en.png`
- `docs/i18n/pr1/login-en-375-final.png`
- `docs/i18n/pr1/login-en-375-review.png`
- `docs/i18n/pr1/login-fr-375-final.png`
- `docs/i18n/pr1/login-fr-375-review.png`
- `docs/i18n/pr1/pack-state.json`
- `docs/i18n/pr1/paired-gzip.json`
- `docs/i18n/pr1/reset-password-en-375-review.png`
- `docs/i18n/pr1/reset-password-fr-375-review.png`
- `docs/i18n/pr1/signup-en-375-review.png`
- `docs/i18n/pr1/signup-fr-375-review.png`
- `docs/i18n/pr1/ui-modal-after-en.png`
- `docs/i18n/pr1/ui-modal-before-en.png`
- `docs/i18n/pr1/ui-pixel-comparison.json`
- `i18n/auth-messages.ts`
- `i18n/locale.ts`
- `i18n/request.ts`
- `i18n/server.ts`
- `lib/auth/forms.ts`
- `messages/en.json`
- `messages/fr.json`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `proxy.ts`
- `styles/locale.css`
- `supabase/migrations/20261027001000_profile_locale.sql`
- `tests/auth-home.test.mjs`
- `tests/auth.test.mjs`
- `tests/banned-account-client.test.mjs`
- `tests/boosters-referral-reminder.test.mjs`
- `tests/card-image-performance.test.mjs`
- `tests/csp.test.mjs`
- `tests/data-export-db.test.mjs`
- `tests/design-system-access.test.mjs`
- `tests/discord-promotion.test.mjs`
- `tests/english-routes.test.mjs`
- `tests/friend-feed-ui.test.mjs`
- `tests/helpers/i18n.mjs`
- `tests/helpers/locale-proxy.mjs`
- `tests/home-feed-delete.test.mjs`
- `tests/home-own-posts-ui.test.mjs`
- `tests/i18n-home-ranking.test.mjs`
- `tests/i18n-locale-db.test.mjs`
- `tests/i18n-oauth-ui.test.mjs`
- `tests/i18n-proxy.test.mjs`
- `tests/i18n-server.test.mjs`
- `tests/i18n.test.mjs`
- `tests/ice-retro-logo.test.mjs`
- `tests/karas-gold.test.mjs`
- `tests/local-network-dev.test.mjs`
- `tests/locale-actions.test.mjs`
- `tests/maintenance-mode.test.mjs`
- `tests/oauth.test.mjs`
- `tests/privacy-page.test.mjs`
- `tests/pro-promotion.test.mjs`
- `tests/referrals-ui.test.mjs`
- `tests/security-definer-allowlist.mjs`
- `tests/signup-policy.test.mjs`
- `tests/site-footer-info-pages.test.mjs`
- `tests/social-feed.test.mjs`
- `tests/social-unread-ui.test.mjs`
- `tests/stripe-settings.test.mjs`
- `tests/supabase-proxy.test.mjs`
- `tests/terms-page.test.mjs`
- `tests/ui-presentation.test.mjs`
