# CSP : semaine d'observation en Report-Only (#387, G)

La CSP reste en **Report-Only**. Cette PR ne touche pas à `CSP_ENFORCE` ; la politique bloquante n'est servie que si `CSP_ENFORCE=true` est configuré **au build** dans Coolify. **À vérifier une fois** : cette variable ne doit pas être définie, sinon la production bloque déjà (voir `docs/critical-launch-security-operations.md`).

## Collecte

- `report-uri /api/security/csp-report` (Firefox, Safari) et `report-to csp-endpoint` avec l'en-tête `Reporting-Endpoints: csp-endpoint="<NEXT_PUBLIC_SITE_URL>/api/security/csp-report"` (navigateurs Chromium, Reporting API). Chromium ignore `report-uri` quand `report-to` est présent.
- La route accepte seulement `application/csp-report` et `application/reports+json`, une origine égale à `NEXT_PUBLIC_SITE_URL`, 16 Kio au plus, lus en 2 s au plus, 10 violations par requête, 60 requêtes par minute et par worker (429 au-delà).
- Conservé : la directive violée, la disposition (`report`/`enforce`), l'origine du document et l'origine bloquée (ou `inline`, `eval`, `data`, `blob`). Chemins, query strings, fragments, extraits de code et en-têtes ne sont jamais conservés ni journalisés. Rien n'est stocké en base.
- Journalisation agrégée par worker et fenêtre de 60 s :
  - `security.csp_violation` : première occurrence d'un rapport donné dans la fenêtre ;
  - `security.csp_violation_repeats` : à la fin de la fenêtre, nombre de rapports identiques supplémentaires (`repeats`) ;
  - `security.csp_violation_overflow` : au-delà de 100 rapports distincts par fenêtre, nombre de rapports non détaillés.

## Où lire les rapports

Logs du conteneur de l'application dans Coolify (Application → Logs), sortie d'erreur (`console.warn`). Chaque ligne est un objet JSON ; filtrer sur `security.csp_violation`. Exemple :

```json
{"event":"security.csp_violation","directive":"script-src-elem","disposition":"report","documentOrigin":"https://yokkai-collec.com","blockedOrigin":"https://js.example"}
{"event":"security.csp_violation_repeats","directive":"script-src-elem","disposition":"report","documentOrigin":"https://yokkai-collec.com","blockedOrigin":"https://js.example","repeats":24,"windowSeconds":60}
```

Juste après le déploiement, ouvrir une page dans Chrome avec la console et vérifier qu'une violation volontaire (par exemple charger `https://js.stripe.com/v3/` depuis la console) produit une ligne en quelques minutes. Si rien n'arrive depuis Chromium mais que Firefox journalise bien, retirer `report-to` pour revenir à `report-uri` seul.

## Ce qui serait bloqué aujourd'hui en mode bloquant

Navigation réelle du build de production (`next build` puis `next start`, `CSP_ENFORCE=true`, Chromium) le 27/10/2026 :

- **Pages publiques sans session**, aucune violation : `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/info`, `/rules`, `/rarities`, `/premium`, `/terms`, `/privacy`, `/share/<id>`, 404.
- **Pages connectées** (boosters, collection, catalogue, marché, social, amis, échanges, paramètres, profil, admin) : redirigées vers `/login` faute de session ; **non parcourues**. Les sources tierces qu'elles utilisent ont été sondées depuis une page de production réelle :

| Source                                                                             | Mode bloquant                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Supabase API (`fetch` REST/RPC), Storage (upload), Realtime (`wss:`)               | autorisé                                                           |
| GIPHY recherche (`api.giphy.com`) et médias (`media*.giphy.com`, `img-src https:`) | autorisé                                                           |
| Turnstile (script et iframe `challenges.cloudflare.com`)                           | autorisé                                                           |
| Cloudflare Web Analytics (script et beacon)                                        | autorisé                                                           |
| `next/image` (`/_next/image`), images Storage publiques                            | autorisé                                                           |
| Polices (`next/font`, servies par l'application)                                   | autorisé                                                           |
| Stripe Checkout et Portal (redirection `window.location`)                          | non concerné par la CSP                                            |
| Stripe.js, iframe Checkout, `api.stripe.com`                                       | **bloqué**, non utilisé par l'application                          |
| Feuilles Google Fonts (`fonts.googleapis.com`)                                     | **bloqué** en mode bloquant (autorisé en Report-Only), non utilisé |
| Workers `blob:`                                                                    | **bloqué**, non utilisé                                            |

Limites : pas de parcours connecté réel ; Cloudflare peut injecter en production des scripts absents en local (Rocket Loader, Zaraz, obfuscation des e-mails) ; les extensions des joueurs produisent aussi des rapports.

## Décider du passage en mode bloquant (dans une semaine)

1. Extraire sur 7 jours les couples distincts `directive` + `blockedOrigin` avec `disposition: "report"`, en additionnant `repeats`.
2. Classer chaque couple :
   - **service du produit** (Supabase, GIPHY, Turnstile, Cloudflare, une nouvelle intégration) : l'ajouter à la politique dans une PR, puis recommencer l'observation pour cette source ;
   - **bruit** : `blockedOrigin` nul (extensions `chrome-extension:` et assimilées), traducteurs, outils injectés hors de notre code : ignorer ;
   - **inconnu sur un parcours du produit** : enquêter avant tout passage.
3. Passer en mode bloquant seulement si, sur la semaine, il ne reste aucun couple de la première ou de la troisième catégorie et que les parcours login, boosters, collection, marché, social, profil, échanges et Premium ont été faits à la main en production.
4. Passage : `CSP_ENFORCE=true` au build dans Coolify, redéployer, surveiller les lignes `disposition: "enforce"` pendant 24 h. Retour arrière : retirer la variable et redéployer ; la collecte Report-Only reste active.
