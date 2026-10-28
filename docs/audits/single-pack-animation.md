# Suppression des anciennes animations de packs et reveals

Référence avant correction : a36e5032. Les lignes « ancien » ci-dessous sont celles de ce commit.

## Cause

`BoosterReveal.flip()` activait `faceUp` avant de choisir la nouvelle cinématique. Le JSX SSR/LR ne consultait aucun flag : il montait ses anciens décors malgré l’ouverture du lecteur en modal. Ce double rendu vient du parent, pas d’un double effet StrictMode. Les anciens chemins de pack étaient encore accessibles derrière un flag.

## Déclencheurs anciens supprimés

- components/boosters.tsx:247 : `setFaceUp(true)` activait aussi les classes SSR/LR/shiny à la ligne 434.
- components/boosters.tsx:267–280 : durée de l’ancien reveal et second spotlight différé.
- components/boosters.tsx:439 : décor SSR (20 poussières, 20 rayons, 36 pétales, 22 pétales ambiants).
- components/boosters.tsx:511 : décor LR (24 poussières, 24 rayons, 48 étincelles, 28 étoiles).
- components/boosters.tsx:824–849 : invocation de secours et surcouche shiny derrière le nouveau lecteur.
- components/boosters.tsx:1181 : ancienne séquence de pack ; lignes 1312 et 1344 : classes de phase et ancienne déchirure.
- lib/ui/pack-opening.ts:19 : ancienne orchestration `runPackOpeningSequence`.
- app/layout.tsx:18 : import global de `styles/pack-tear.css` (fichier supprimé).

Chaque déclaration CSS supprimée qui lançait un effet :

| Avant : fichier:ligne    | Sélecteur                              | Animation                                                                                                                                                                 |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| styles/boosters.css:187  | `.yk-opening-tension .yk-opening-pack` | `yk-opening-tension var(--pack-opening-tension-duration) ease-in-out infinite`                                                                                            |
| styles/boosters.css:198  | `.yk-opening-seal::after`              | `yk-flash var(--pack-opening-duration) both`                                                                                                                              |
| styles/boosters.css:201  | `.yk-opening-seal .yk-opening-pack`    | `yk-rumble calc(var(--pack-opening-duration) * 0.67) ease-in-out, yk-vanish calc(var(--pack-opening-duration) * 0.33) calc(var(--pack-opening-duration) * 0.67) forwards` |
| styles/boosters.css:315  | `.yk-reveal-ssr .yk-deck`              | `yk-ssr-deck-charge 3.2s cubic-bezier(0.2, 0.8, 0.2, 1) both`                                                                                                             |
| styles/boosters.css:333  | `.yk-reveal-ssr .yk-face-up .yk-card`  | `yk-ssr-card-glow-pulse 2.2s 1.95s ease-in-out infinite alternate`                                                                                                        |
| styles/boosters.css:341  | `.yk-ssr-callout`                      | `yk-ssr-callout-anim 3.2s ease-out both`                                                                                                                                  |
| styles/boosters.css:366  | `.yk-ssr-backdrop`                     | `yk-ssr-backdrop-fade 3.2s cubic-bezier(0.16, 1, 0.3, 1) both`                                                                                                            |
| styles/boosters.css:383  | `.yk-ssr-nebula`                       | `yk-ssr-nebula-pulse 3.2s ease-in-out infinite alternate`                                                                                                                 |
| styles/boosters.css:400  | `.yk-ssr-cosmic-dust`                  | `yk-ssr-dust-rise 3s calc(var(--dust-i) * 90ms) ease-out infinite`                                                                                                        |
| styles/boosters.css:423  | `.yk-ssr-backlight`                    | `yk-ssr-backlight-swell 3.2s ease-in-out both`                                                                                                                            |
| styles/boosters.css:449  | `.yk-ssr-ribbon-1`                     | `yk-ssr-ribbon-draw1 3.2s cubic-bezier(0.2, 0.8, 0.25, 1) both`                                                                                                           |
| styles/boosters.css:452  | `.yk-ssr-ribbon-2`                     | `yk-ssr-ribbon-draw2 3.2s 0.15s cubic-bezier(0.2, 0.8, 0.25, 1) both`                                                                                                     |
| styles/boosters.css:464  | `.yk-ssr-godrays`                      | `yk-ssr-godrays-spin 10s linear infinite`                                                                                                                                 |
| styles/boosters.css:483  | `.yk-ssr-godray`                       | `yk-ssr-godray-burst 3.2s cubic-bezier(0.12, 0.8, 0.2, 1) both`                                                                                                           |
| styles/boosters.css:516  | `.yk-ssr-flare-core`                   | `yk-ssr-core-flare 1.1s 1.9s cubic-bezier(0.1, 0.9, 0.2, 1) both`                                                                                                         |
| styles/boosters.css:533  | `.yk-ssr-flare-beam`                   | `yk-ssr-beam-flare 1s 1.9s cubic-bezier(0.1, 0.9, 0.2, 1) both`                                                                                                           |
| styles/boosters.css:546  | `.yk-ssr-shockwave`                    | `yk-ssr-shockwave-expand 1.2s 1.92s cubic-bezier(0.1, 0.7, 0.3, 1) both`                                                                                                  |
| styles/boosters.css:574  | `.yk-ssr-petal`                        | `yk-ssr-petal-shoot 1.4s calc(1.95s + var(--p-delay)) cubic-bezier(0.1, 0.85, 0.25, 1) both`                                                                              |
| styles/boosters.css:600  | `.yk-ssr-ambient-petal`                | `yk-ssr-petal-drift 2.8s calc(2.2s + var(--petal-delay)) ease-in-out infinite alternate both`                                                                             |
| styles/boosters.css:615  | `.yk-reveal-lr .yk-deck`               | `yk-lr-deck-charge 4.4s cubic-bezier(0.2, 0.8, 0.2, 1) both`                                                                                                              |
| styles/boosters.css:633  | `.yk-reveal-lr .yk-face-up .yk-card`   | `yk-lr-card-glow-pulse 2.4s 3.7s ease-in-out infinite alternate`                                                                                                          |
| styles/boosters.css:641  | `.yk-lr-callout`                       | `yk-lr-callout-anim 4.4s ease-out both`                                                                                                                                   |
| styles/boosters.css:666  | `.yk-lr-backdrop`                      | `yk-lr-backdrop-fade 4.4s cubic-bezier(0.16, 1, 0.3, 1) both`                                                                                                             |
| styles/boosters.css:683  | `.yk-lr-nebula`                        | `yk-lr-nebula-pulse 4.4s ease-in-out infinite alternate`                                                                                                                  |
| styles/boosters.css:700  | `.yk-lr-cosmic-dust`                   | `yk-lr-dust-rise 3.8s calc(var(--dust-i) * 110ms) ease-out infinite`                                                                                                      |
| styles/boosters.css:723  | `.yk-lr-backlight`                     | `yk-lr-backlight-swell 4.4s ease-in-out both`                                                                                                                             |
| styles/boosters.css:747  | `.yk-lr-bolt-1`                        | `yk-lr-lightning-1 4.4s ease-in-out both`                                                                                                                                 |
| styles/boosters.css:750  | `.yk-lr-bolt-2`                        | `yk-lr-lightning-2 4.4s ease-in-out both`                                                                                                                                 |
| styles/boosters.css:753  | `.yk-lr-bolt-3`                        | `yk-lr-lightning-3 4.4s ease-in-out both`                                                                                                                                 |
| styles/boosters.css:756  | `.yk-lr-bolt-4`                        | `yk-lr-lightning-4 4.4s ease-in-out both`                                                                                                                                 |
| styles/boosters.css:759  | `.yk-lr-bolt-5`                        | `yk-lr-lightning-5 4.4s ease-in-out both`                                                                                                                                 |
| styles/boosters.css:762  | `.yk-lr-bolt-6`                        | `yk-lr-lightning-6 4.4s ease-in-out both`                                                                                                                                 |
| styles/boosters.css:774  | `.yk-lr-godrays`                       | `yk-lr-godrays-spin 12s linear infinite`                                                                                                                                  |
| styles/boosters.css:793  | `.yk-lr-godray`                        | `yk-lr-godray-burst 4.4s cubic-bezier(0.12, 0.8, 0.2, 1) both`                                                                                                            |
| styles/boosters.css:826  | `.yk-lr-flare-core`                    | `yk-lr-core-flare 1.3s 2.95s cubic-bezier(0.1, 0.9, 0.2, 1) both`                                                                                                         |
| styles/boosters.css:843  | `.yk-lr-flare-beam`                    | `yk-lr-beam-flare 1.1s 2.95s cubic-bezier(0.1, 0.9, 0.2, 1) both`                                                                                                         |
| styles/boosters.css:856  | `.yk-lr-shockwave`                     | `yk-lr-shockwave-expand 1.4s 3s cubic-bezier(0.1, 0.7, 0.3, 1) both`                                                                                                      |
| styles/boosters.css:883  | `.yk-lr-spark`                         | `yk-lr-spark-shoot 1.6s calc(3s + var(--p-delay)) cubic-bezier(0.1, 0.85, 0.25, 1) both`                                                                                  |
| styles/boosters.css:909  | `.yk-lr-stardust`                      | `yk-lr-stardust-orbit 3s calc(3.5s + var(--star-delay)) ease-in-out infinite alternate both`                                                                              |
| styles/boosters.css:1525 | `.yk-burst`                            | `yk-burst 0.95s ease-out both`                                                                                                                                            |
| styles/boosters.css:1542 | `.yk-burst::before, .yk-burst::after`  | `yk-light-cut 0.9s ease-out both`                                                                                                                                         |
| styles/boosters.css:1558 | `.yk-shiny-callout`                    | `yk-rise 0.7s var(--ease-yokkai)`                                                                                                                                         |
| styles/boosters.css:1632 | `.yk-reveal-shiny::after`              | `yk-shiny-shift 2.8s ease-in-out infinite alternate`                                                                                                                      |
| styles/boosters.css:1674 | `.yk-invocation::before`               | `yk-invocation-drift 8s ease-in-out infinite alternate`                                                                                                                   |
| styles/boosters.css:1721 | `.yk-invocation-shiny::after`          | `yk-shiny-shift 4s ease-in-out infinite alternate`                                                                                                                        |
| styles/boosters.css:1726 | `.yk-invoked-card`                     | `yk-rise 0.9s var(--ease-yokkai)`                                                                                                                                         |
| styles/pack-tear.css:25  | `.yk-opening-stage .yk-pack-tear`      | `yk-pack-tear-float 4s ease-in-out infinite`                                                                                                                              |
| styles/pack-tear.css:49  | `.yk-pack-tear::before`                | `yk-pack-tear-halo 4.6s ease-in-out infinite`                                                                                                                             |
| styles/pack-tear.css:57  | `.yk-pack-tear::after`                 | `yk-pack-tear-ring 5s ease-in-out infinite`                                                                                                                               |
| styles/pack-tear.css:108 | `.yk-opening-seal .yk-pack-tear-top`   | `yk-pack-tear-strip var(--pack-opening-duration) cubic-bezier(0.2, 0.75, 0.2, 1) both`                                                                                    |
| styles/pack-tear.css:152 | `.yk-opening-seal .yk-pack-tear-glow`  | `yk-pack-tear-seam var(--pack-opening-duration) linear both`                                                                                                              |
| styles/pack-tear.css:169 | `.yk-pack-tear-spark`                  | `yk-pack-tear-twinkle var(--spark-duration) ease-in-out var(--spark-delay) infinite`                                                                                      |

## Système conservé

- components/game.tsx : un seul `Boosters`, une seule requête de récompense ; plus de flag pour choisir un ancien moteur.
- components/boosters.tsx : un seul `BoosterOpening` pour le pack ; un seul `CardCinematic` pour SSR/LR, indexé par instance de carte. Le plateau est démonté pendant la cinématique.
- components/booster-opening.tsx → /api/booster-opening → lib/ui/booster-opening-document.ts → data/booster-opening/reveal.html.
- components/card-cinematic.tsx → components/local-card-cinematic.tsx → /api/card-cinematics → lib/ui/card-cinematic-document.ts → data/card-cinematics/{ssr,lr}.html. Le lecteur local sert aussi la galerie de développement ; ce n’est pas un ancien fallback.
- hooks/use-sfx.ts : appels uniques flip/slide/SR/SSR/LR/shiny/rumble/tear. Sons et PNG conservés car réutilisés par ce parcours et les visuels de sélection.
- Aucun moteur GSAP, Framer Motion ou Lottie installé ; aucun second moteur canvas dans ce chemin. Les particules et confettis des documents isolés appartiennent au nouveau système.

### Points de déclenchement et de nettoyage actuels

- components/boosters.tsx:242 : `if (isLR || isSSR) {`
- components/boosters.tsx:649 : `{spot && <CardCinematic key={spot.instanceId} card={spot} onContinue={() => { setSpot(null); if (!done) setFaceUp(true); }} />}`
- components/boosters.tsx:926 : `function start(kind: "regular" | "decision", trigger?: HTMLElement) {`
- components/boosters.tsx:948 : `void runFinalBoosterOpening({`
- components/boosters.tsx:1069 : `<BoosterOpening`
- components/game.tsx:475 : `<Boosters`
- components/booster-opening.tsx:33 : `const timeout = window.setTimeout(() => {`
- components/booster-opening.tsx:37 : `const receive = (event: MessageEvent) => {`
- components/booster-opening.tsx:60 : `const response = await fetch(/api/booster-opening?kind=${kind}, {`
- components/booster-opening.tsx:75 : `window.removeEventListener("message", receive);`
- components/local-card-cinematic.tsx:36 : `const timeout = window.setTimeout(() => controller.abort(), 10000);`
- components/local-card-cinematic.tsx:47 : `const response = await fetch(`
- components/local-card-cinematic.tsx:73 : `const timeout = window.setTimeout(() => setState("error"), 15000);`
- components/local-card-cinematic.tsx:74 : `const receive = (event: MessageEvent) => {`
- components/local-card-cinematic.tsx:96 : `window.removeEventListener("message", receive);`
- hooks/use-sfx.ts:37 : `const play = useCallback(`
- hooks/use-sfx.ts:42 : `audio = new Audio(/assets/sfx/${name}.wav);`
- hooks/use-sfx.ts:85 : `cache.forEach(audio => {`
- lib/ui/card-cinematic-document.ts:77 : `const optimizeRules=rules=>{`
- lib/ui/card-cinematic-document.ts:96 : `function startPlayback(){`
- lib/ui/card-cinematic-document.ts:131 : `window.addEventListener("pagehide",()=>{`
- lib/ui/booster-opening-document.ts:60 : `  window.addEventListener('pagehide',()=>{`
- lib/ui/booster-opening-document.ts:77 : `const optimizeRules=rules=>{`
- lib/ui/booster-opening-document.ts:124 : `window.addEventListener('pagehide',()=>{`
- lib/ui/booster-opening-document.ts:130 : `async function startBooster(){`

## Performance et nettoyage

Suppression de 98 éléments décoratifs SSR et 124 éléments LR (hors conteneurs) par reveal, et de toutes leurs boucles CSS. Les keyframes des documents conservés sont limitées à transform/opacity à leur chargement via CSSOM ; l’art et les templates source restent inchangés. Suppression des will-change déclarés sur les particules. Nettoyage explicite du rAF, des temporisateurs et des listeners lors de la sortie des documents ; abort et nettoyage des attentes côté parent. Les lecteurs annulent déjà leurs fetchs, délais et listeners au démontage. Aucun fallback ancien sur erreur.

## Tests produit

Walid a autorisé dans ce chat le remplacement des tests imposant l’ancienne animation. Les contrôles obsolètes (déclarations CSS, durées, fingerprint du vieux plateau) sont remplacés par l’absence des anciens renderers et la présence du lecteur unique ; les empreintes des images et des templates source restent inchangées.

## Coordination

La PR #440 touche aussi boosters.tsx, game.tsx et booster-opening-document.ts : synchroniser ces changements avant merge. Aucune migration Supabase dans cette correction, rien à appliquer au VPS.

## Validation navigateur

Chrome isolé, données de packs simulées (aucun RPC de récompense), un pack d’initialisation puis cinq packs dans la même page sans rechargement. Chaque pack contient C/R/SR/SSR/LR. Un seul iframe par reveal rare, zéro ancienne couche et zéro iframe restant au résumé.

Largeurs vérifiées : 320, 375, 600, 768, 900, 1024 et 1440 px pour le pack ; 320, 375, 768, 1024 et 1440 px pour les reveals SSR/LR. Zoom 200 % simulé avec dimensions CSS divisées par deux et densité multipliée par deux. Aucun débordement constaté. La transition du parent est désormais neutralisée aussi pendant le pack, car elle reprenait au pack suivant.

Après GC, sur les cinq packs mesurés :

| Pack | Documents | Nœuds DOM | Listeners JS | Mémoire JS (Mo décimaux) |
| ---- | --------- | --------- | ------------ | ------------------------ |
| 1    | 1         | 626       | 760          | 20,41                    |
| 2    | 1         | 626       | 760          | 20,47                    |
| 3    | 1         | 664       | 763          | 20,52                    |
| 4    | 1         | 626       | 760          | 20,63                    |
| 5    | 1         | 626       | 760          | 20,65                    |

Pas d’accumulation de DOM/listeners ; faible variation mémoire (~1,2 %) de l’application en mode développement, sans preuve d’une fuite d’effets. Zéro exception, erreur ou warning de console dans ce scénario. Le statut Pro est simulé inactif dans le test : sans ce fixture, `/api/pro/benefits` renvoie un 401 attendu sur cette page sans session ; ce point préexistant n’est pas modifié par la PR. Les templates et assets réels sont servis par les routes locales.

Contrôles ciblés d’orchestration, player, sécurité des documents, image et non-régression passés. TypeScript et lint passés (13 warnings préexistants dans le dépôt). Le build complet est confié à GitHub Actions, conformément aux règles du projet.
