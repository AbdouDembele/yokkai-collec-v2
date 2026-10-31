# PR 5 — i18n EN/FR finale

**non poussé — accès GitHub bloqué**

## Delta initial

Base locale : `wz/i18n-social-market`, commit `33ee26a0`, état PR4 enregistré
après formatage sans correction supplémentaire. Branche de travail : `wz/i18n-final`.
Aucune consultation GitHub, aucun push, aucune PR ou CI distante.

- Déjà traduits : infrastructure, Auth et choix de pseudo, shell/Home, packs,
  collection/catalogue/liste de souhaits, profil/paramètres/mur/modération, puis
  social/marché/échanges/notifications/classements dans l'état local PR4.
- Partage : page publique, 404 et description de métadonnées encore anglaises ;
  conserver canonical/noindex/URL et les images anglaises. `force-dynamic` sur la
  page, résolveur par requête et `private, no-store` dans le proxy i18n ; client
  mémoire de données Supabase indépendant de la langue, pas de cache de HTML local.
  La configuration Cloudflare réelle n'est pas accessible dans cette mission locale.
- Pro : offre, exemples, promotions et Checkout encore partiellement anglais ;
  paramètres d'abonnement déjà traduits. Retirer les horaires fixes du texte,
  localiser les formats de prix et transmettre la locale au Checkout existant.
- Légal/informations : `/terms`, `/privacy`, `/rules`, `/info`, `/rarities` à
  traduire fidèlement, ainsi que leur habillage partagé et leurs métadonnées.
- Auth e-mails : deux modèles existants, confirmation et recovery ; blocs EN puis
  FR à produire avec un seul lien. Ne rien activer dans GoTrue.
- Passe finale : inventorier toutes les routes joueur, réutiliser les clés existantes
  et traiter uniquement les résidus ; admin/design-system exclus.

## Résultat local

PR 5 implémentée sur la base locale PR 4, sans accès GitHub. Aucun push, commande gh,
PR distante, merge, déploiement, modification Coolify, migration appliquée ou modèle
GoTrue activé. Les validations restantes ci-dessous empêchent d'annoncer une recette
complète « zéro anglais sur tout le site » ou une disponibilité de production.

### Changements

- Partage public : textes, 404 et métadonnées selon le visiteur. canonical, noindex,
  identifiant, URL, images OG/PNG et leurs caches inchangés. Pas de préférence du
  propriétaire, de backfill ou de nouvelle couche de cache. Localement : page
  force-dynamic, résolution par requête, proxy private/no-store. Cloudflare externe
  non consulté ; aucune règle locale de cache HTML partagé trouvée.
- Partage connecté : création/copie/téléchargement/suppression, confirmations,
  notices, erreurs et dates localisées. Les consentements, limites UTC, RPC,
  pagination et noms de fichiers téléchargés restent identiques.
- Pro : offre, comparaison, aperçus et accessibles traduits ; prix 4.99 EUR formaté
  avec next-intl. En FR, Basic devient « Gratuit » dans les libellés de comparaison.
  Seule la propriété locale en/fr est ajoutée à la création Stripe Checkout,
  après les validations existantes. Client, montant, devise, prix Stripe, droits,
  quotas, verrouillage, idempotence et URLs inchangés. Une session ouverte réutilisée
  conserve sa langue initiale : le mécanisme de réutilisation n'est pas modifié.
- Légal/informations : traduction fidèle des clauses EN actuelles de /terms,
  /privacy, /rules, /info et /rarities ; aucune clause ajoutée, retirée ou réinterprétée.
  La date de publication conserve le même jour en UTC, formaté selon la locale.
- Passe finale : succès (libellés, catalogue des IDs SQL connus, progression ICU,
  erreurs/toasts et métadonnées), dernier bandeau Auth Decision Pack, chargement
  du profil et textes/aria du reveal. Les noms des succès dans les notifications
  réutilisent les mêmes clés via leur ID SQL, sans toucher aux textes inconnus. Aucun timer, rendu, animation ou calcul modifié.
- E-mails : modèles bilingues EN puis FR et un seul bouton/lien/token partagé.
  Les deux types et URLs GoTrue existants sont conservés. Titres HTML bilingues.

### Différences EN voulues

1. Texte Pro affichant 8:00 PM Paris time : formulation « at the same time each day » ;
   constantes métier Europe/Paris et heure 20 inchangées.
2. Guide raretés : SSR Evolved / LR Evolved remplacés par SSR INFINITY / LR INFINITY.
3. Succès Transcendence : « evolved Shiny SSR » remplacé par « SSR INFINITY »,
   correction de copie conforme au statut SQL actuel, sans modification SQL.
4. E-mails : ajout du français et du bouton bilingue unique ; leur mise en page
   change nécessairement. Aucun modèle ni sujet n'est activé.

Les replis historiques EN « Sans pseudo », « Suppression… » et
« Suppression indisponible. » du partage sont conservés pour le flag off.

## Validations locales

- Parité des clés/arguments ICU, tutoiement et conservation des données immuables :
  test de parité passé. Onze nouveaux tests dans tests/i18n-pr5.test.mjs : cartes/RPC,
  images/caches protégés, rendu légal anglais exact, partage/métadonnées visiteur,
  erreurs, pluriels/sélecteurs, e-mails, locale Stripe et appels catalogue.
- Tests ciblés finaux : **116 passés / 117, avec le seul échec hérité PR 3 décrit ci-dessous**. Aucun test existant ignoré ou affaibli.
  Les assertions de texte suivent les appels ICU et gardent les valeurs EN attendues ;
  les assertions de sécurité, prix, concurrence et animations restent intactes.
- Échec hérité : test d'estimation gzip PR 3, seuil inchangé de 5 × 1024 octets.
  Sur la base PR 4 33ee26a0, son écart était déjà de 5 152 octets, soit 32 au-dessus
  du seuil. Ce test agrège notamment les nouveaux composants PR 4 par rapport à son
  ancienne référence PR 3. Sa référence et son seuil n'ont pas été modifiés.
- Deux compilations locales isolées réussies, TypeScript compris, sans verify/ci/ci:db.
  Adresses Supabase factices, même réponse de polices de test pour les deux mesures,
  aucune installation ou dépendance ajoutée. Ce contrôle n'est pas une CI distante.
- ESLint sur les sources touchées : aucune erreur ; avertissement img préexistant
  dans community-views, sans modification de l'image.
- Graphe local actualisé par graphify update . ; extraction SQL partielle car
  tree_sitter_sql manque déjà. Aucune dépendance installée, graphe non livré.

### Captures et responsive

106 captures **WebP sans perte** dans [docs/i18n/pr5](docs/i18n/pr5/README.md),
issues des vrais composants sur données fictives, styles/fontes existants et appels
externes bloqués. Les images de joueurs/cartes ne sont pas recréées ; les illustrations
externes indisponibles utilisent leur repli existant. Les animations sont figées
uniquement pour la recette. La conversion PNG → WebP a été vérifiée pixel par pixel.

- EN flag off : avant/après 33ee26a0 à 375 et 1440 px sur dix écrans, 20 paires.
  **16 identiques sans masque** ; quatre écarts limités au texte Pro sans Paris
  et à la correction INFINITY dans /rarities. Partage et cartes identiques après
  gel des animations du navigateur. [Relevé pixels](docs/i18n/pr5/pixels.json).
- FR flag on : /terms, /privacy, /rules, /info, /rarities, /premium, partage valide,
  partage indisponible, 404 globale, erreur de route : 320/375/768/1024/1440 px,
  aucun débordement du document détecté. Repli à 720 × 500 CSS px équivalent au
  reflow à 200 % d'une surface 1440 × 1000. **Zoom natif du navigateur à 200 % non
  vérifié** ; ce relevé ne le remplace pas silencieusement.
- E-mails : rendus HTML statiques et captures 320/375/768 px, sans débordement ;
  un seul lien, SiteURL et TokenHash chacun une fois, mêmes chemins et types.
- [Relevé complet](docs/i18n/pr5/verification.json). Le rendu logiciel (--disable-gpu) est utilisé pour la paire Pro 1440 afin d’éviter
  les artefacts de peinture du navigateur ; aucun style du produit n’est modifié.
  Les captures isolées vérifient
  l'affichage ; elles ne constituent pas une validation d'hydratation connectée.

### Poids

JavaScript client des 12 routes touchées et de leurs imports différés :
**317 165 → 317 701 octets gzip, soit +536 octets** (48 fichiers uniques, gzip 9).
Seuil +5 000 octets respecté, sans compter les catalogues transmis en RSC ;
aucune soustraction favorable d'un éventuel JSON embarqué dans les chunks.
[Mesure compilée et inventaire](docs/i18n/pr5/bundles.json).
L'estimation sur sources transpilées est fournie séparément, sans la présenter
comme une mesure du bundle de production.

## Routes : couverture et réserves

Les pages suivantes ont été parcourues en FR dans Chrome, en lecture seule, sans session.
Le relevé SSR utilise JavaScript désactivé : il vérifie le texte du HTML, y compris
les conteneurs de streaming en attente, **pas les interactions ni toute la visibilité finale**.
Les textes publics listés « FR SSR » ont été relus sans copie anglaise hors données/noms immuables.

| Route               | Vérification obtenue                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| /terms              | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /privacy            | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /rules              | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /info               | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /rarities           | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /premium            | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /share/not-a-share  | Route non validée (contenu différé absent du relevé) ; composant de partage indisponible vérifié sur fixture |
| /missing-i18n-pr5   | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /                   | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /login              | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /signup             | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /forgot-password    | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /reset-password     | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /account-deleted    | FR SSR, sans copie anglaise hors données et noms conservés                                                   |
| /choose-username    | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /boosters           | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /collection         | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /catalog            | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /wishlist           | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /profile            | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /profile/[id]       | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /settings           | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /market             | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /market/[id]        | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /trades             | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /social             | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /social/friends     | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /social/everyone    | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /social/leaderboard | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /leaderboard        | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /friends            | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /achievements       | Redirection vers /login FR uniquement ; contenu connecté non vérifié                                         |
| /share/[id] valide  | Fixture des vrais composants : FR aux cinq largeurs ; aucune lecture de carte réelle en base                 |
| Erreur de route     | Composant app/error.tsx sur fixture FR ; bouton retry non exercé contre une panne réelle                     |
| global-error        | Exception anglaise de secours conservée, pas de panne racine provoquée                                       |
| /discord            | Redirection technique auditée dans le code ; destination externe non parcourue                               |

Aucune page 500/maintenance autonome supplémentaire trouvée parmi les routes suivies.
[Traces SSR par route](docs/i18n/pr5/routes-ssr.json).

Les routes authentifiées redirigées vers /login ne sont pas considérées comme
vérifiées dans leur contenu connecté. La recette des états vides, erreurs, toasts,
modales et contenus réels de ces écrans reste à refaire avec un compte local de test.
Les captures/tests hérités des PR 1–4 sont conservés, sans être présentés comme
une nouvelle recette intégrale PR 5. Admin, design-system et les fichiers locaux
préexistants non suivis ne sont pas embarqués.

Le premier parcours JavaScript sur le serveur de développement a rencontré des
ChunkLoadError / erreurs de flux et de rechargement. Les traces de tentative sont
conservées dans routes.json et routes-isolated.json. Les compilations de production
passent ; aucune correction d'infrastructure n'a été introduite pour masquer ces
problèmes. La recette interactive/hydratation de tout le site n'est donc pas déclarée
verte. Le parcours SSR isolé est documenté séparément dans routes-ssr.json.

### Anglais conservé et raisons

- Noms de cartes/personnages/licences, catégories, raretés, Shiny/INFINITY, Karas,
  Regular Pack / Decision Pack ; pseudos et contenus des joueurs : données intactes.
- Images de partage de carte et OG Home/signup/Twitter : anglaises, inchangées.
  Textes incorporés dans les images d'exemple Pro conservés avec leurs assets.
- Marques Yokkai Collec', Yokkai Pro, Stripe, Discord, GIPHY et formats GIF/PNG : noms.
- global-error : secours anglais déterministe prévu par docs/i18n.md lorsque le
  layout/résolveur racine échoue. Erreur de route et 404 ordinaires localisées.
- Aperçus techniques et administration : hors périmètre. Pas de nouvelle page
  « mentions légales » inventée : les pages locales existantes ont été traduites.

## E-mails Auth et relecture juridique

Modèles existants : public/auth-emails/confirmation.html et recovery.html uniquement.
Rendus de test : [confirmation](docs/i18n/pr5/email-confirmation.html) et
[récupération](docs/i18n/pr5/email-recovery.html), URL example.test et token fictif.

Sujets proposés, à saisir manuellement après relecture :

- Confirmation : **Confirm your account / Confirme ton compte — Yokkai**
- Recovery : **Reset your password / Réinitialise ton mot de passe — Yokkai**

Termes à faire relire : responsable du traitement, exécution du contrat, intérêt
légitime, droit légal de rétractation, consentement exprès et reconnaissance,
protections impératives des consommateurs, clauses contractuelles types,
cadres de certification. Traduction fidèle, sans validation juridique revendiquée.

Points du texte source à arbitrer séparément, sans réécrire ses clauses dans cette PR :

- /privacy décrit un seul cookie alors que le cookie de locale existe désormais.
- /privacy limite les données Stripe à l'ID/plan alors que la locale est aussi
  transmise lors de la création de Checkout.
- Les CGU évoquent les mineurs selon les exigences locales et /privacy fixe 16 ans ;
  aucune harmonisation juridique inventée. Constantes de durée non validées toujours null.

## Glossaire complet

| Anglais                              | Français joueur                                                |
| ------------------------------------ | -------------------------------------------------------------- |
| pack                                 | pack (jamais booster)                                          |
| pull                                 | tirage                                                         |
| binder / folder                      | classeur / dossier                                             |
| wishlist                             | liste de souhaits                                              |
| evolve                               | faire évoluer                                                  |
| listed                               | aux enchères                                                   |
| auction / bid / outbid               | enchère / mise, miser / surenchérir (« Tu as été surenchéri ») |
| offer / counter-offer / trade        | offre / contre-offre / échange                                 |
| friend / friend request              | ami / demande d'ami                                            |
| block / report                       | bloquer / signaler                                             |
| feed / private message / mention     | fil / message privé / mention                                  |
| watched auctions                     | enchères suivies                                               |
| subscription / membership / benefits | abonnement / abonnement / avantages                            |
| share / shared link                  | partager / lien partagé                                        |
| achievement / claim reward           | succès / récupérer une récompense                              |
| Terms of Use                         | conditions d'utilisation                                       |
| Privacy Policy                       | politique de confidentialité                                   |
| community rules                      | règles de la communauté                                        |
| data controller / personal data      | responsable du traitement / données personnelles               |
| cancel subscription                  | résilier l'abonnement                                          |

Tutoiement conservé. « Gratuit » traduit Basic dans la comparaison et le message de limite d’enchères, sans modifier l’offre.

## Activation du français — checklist manuelle

- [ ] Rétablir GitHub ; intégrer PR 4 puis PR 5 et rebaser sur master à jour.
- [ ] Garder les deux côtés des conflits de catalogue sans réordonner ; obtenir
      la CI GitHub Actions verte. Aucun merge autorisé par cette mission.
- [ ] Relecture FR et juridique par Walid ; terminer les réserves de recette ci-dessus.
- [ ] Vérifier que 20261027001000_profile_locale.sql est réellement appliquée en prod ;
      sinon application séparée par Walid via la procédure habituelle. Non appliquée ici.
- [ ] NEXT_PUBLIC_I18N_ENABLED=true disponible **au build**, reconstruire et redéployer.
- [ ] Vérifier préférence profil/cookie, EN/FR, partage et absence de cache HTML
      partagé forcé côté Cloudflare, métadonnées et Checkout de test autorisé.
- [ ] Basculer manuellement les deux modèles GoTrue et leurs sujets bilingues ;
      conserver le lien/token unique et les types signup/recovery.

## Fichiers touchés et livraison

- app/achievements/page.tsx
- app/api/billing/checkout/route.ts
- app/info/page.tsx
- app/layout.tsx
- app/premium/page.tsx
- app/privacy/page.tsx
- app/rarities/page.tsx
- app/rules/page.tsx
- app/share/[id]/not-found.tsx
- app/share/[id]/page.tsx
- app/terms/page.tsx
- components/achievements.tsx
- components/auth-decision-preview.tsx
- components/card-sharing.tsx
- components/community-views.tsx
- components/lr-card-reveal.tsx
- components/premium-banner-preview.tsx
- components/premium-card-artwork-preview.tsx
- components/premium-checkout.tsx
- components/premium-offer.tsx
- components/premium-profile-embed.tsx
- components/topbar.tsx
- components/public-info-page.tsx
- docs/i18n.md
- i18n/game-messages.ts
- lib/billing/server.ts
- lib/data/achievements.ts
- lib/data/card-shares.ts
- lib/premium/offer.ts
- messages/en.json
- messages/fr.json
- public/auth-emails/confirmation.html
- public/auth-emails/recovery.html
- tests/card-sharing-http.test.mjs
- tests/helpers/i18n.mjs
- tests/lr-card-reveal.test.mjs
- tests/premium-checkout.test.mjs
- tests/premium-comparison-redesign.test.mjs
- tests/premium-hero-membership.test.mjs
- tests/premium-profile-balance.test.mjs
- tests/premium-profile-customization.test.mjs
- tests/privacy-page.test.mjs
- tests/site-footer-info-pages.test.mjs
- tests/stripe-billing.test.mjs
- tests/i18n-pr5.test.mjs
- rapport-pr5.md
- docs/i18n/pr5/ : captures, rendus statiques et relevés de recette.

Branche de base conservée : wz/i18n-social-market (33ee26a0).
Patch PR 5 : i18n-pr5-complet.patch, produit avec git format-patch --binary
pour wz/i18n-social-market..wz/i18n-final. Il nécessite la base PR 4 locale,
qui n'est pas mergée. Ne pas appliquer ce patch seul sur un ancien master.
Chevauchements voulus avec PR 4 : catalogues, Topbar, community-views et layout,
traités sur sa branche locale complète ; aucun merge ni état GitHub supposé.
Aucune migration dans cette PR. **non poussé — accès GitHub bloqué**.
