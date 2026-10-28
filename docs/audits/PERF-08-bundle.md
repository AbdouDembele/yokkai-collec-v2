# PERF-08 — bundles par route

Mesure du 19/10/2026 (Africa/Casablanca). Référence avant correction : master **6ab6ca7216bce487c965efeae5d77aa84354229f**. Comparaison historique des sources avec **c775b92**. Même environnement Windows, Node 22.15.0, Next 16.3.8 et dépendances du lockfile actuel pour toutes les références ; paramètres Supabase factices.

## Cause et trois contributions principales

L'analyseur Next fournit des fragments de modules et leur fichier de sortie pour chaque route. Dédupliquer un fragment partagé entre routes, puis additionner les **copies distinctes émises** d'un même module, donne ce classement des hausses depuis c775b92 (octets JS bruts). Prendre seulement la plus grande copie classerait plutôt profil/collection/admin et masquerait la duplication.

| Contribution                          | c775b92 | master avant | Hausse | Après | Gain vs master |
| ------------------------------------- | ------: | -----------: | -----: | ----: | -------------: |
| lib/data/cards.ts                     |    8207 |        45644 | +37437 | 11411 |         -34233 |
| next/dist/shared/lib/get-img-props.js |       0 |        29241 | +29241 | 24354 |          -4887 |
| components/ui/index.tsx               |   17259 |        43495 | +26236 | 17497 |         -25998 |

Les imports statiques du jeu faisaient entrer les deux vues packs/collection dans le même graphe. Le profil entraînait la collection même hors ouverture de la collection d'un ami ; communauté → profil → ventes/détail du catalogue → communauté formait un cycle. Les frontières dynamiques retirent les vues secondaires du graphe initial et permettent au bundler de partager autrement ces modules. Aucun remplacement de next/image, aucune modification des images, des données ou des validations.

## Reproduction

Sur chaque référence, utiliser les mêmes dépendances et les variables publiques factices de la CI. Conserver les sorties hors de .next avant la commande suivante : un build nettoie les données de l'analyseur.

```sh
node node_modules/next/dist/bin/next experimental-analyze --output
node scripts/measure-route-bundles.mjs --analyzer .next/diagnostics/analyze/data > analyzer.json
# Copier .next/diagnostics/analyze pour conserver les données et l'interface Next.
node node_modules/next/dist/bin/next build --webpack
node scripts/measure-route-bundles.mjs > routes.json
```

Le lecteur de données de l'analyseur est limité au format installé de Next 16.3.8 ; le vérifier après une mise à jour Next. Pour les sources historiques, ouvrir une archive de c775b92 avec le même node_modules, puis comparer les noms de modules après retrait du préfixe du dossier de l'archive. Aucun changement de dépendance dans cette PR.

## Charge statique initiale par route

Union des chunks JS des références client et du runtime racine du build Webpack, chaque fichier compté une seule fois par route. Exclut les imports dynamiques, le préchargement, RSC, CSS, polices et le polyfill nomodule destiné aux anciens navigateurs. Gzip : chaque fichier comprimé séparément avec gzipSync par défaut ; ce sont des tailles calculées, pas une capture réseau. Les routes API sans page sont exclues.

| Route            | Brut avant | Brut après | Gzip avant | Gzip après |
| ---------------- | ---------: | ---------: | ---------: | ---------: |
| /                |     760492 |     762111 |     221312 |     221973 |
| /account-deleted |     760695 |     762314 |     221487 |     222148 |
| /achievements    |     817410 |     819029 |     241717 |     242364 |
| /boosters        |     921558 |     830752 |     272995 |     247004 |
| /catalog         |    1063787 |     956060 |     311136 |     283023 |
| /collection      |     921558 |     830752 |     272995 |     247004 |
| /friends         |    1063787 |     956060 |     311136 |     283023 |
| /market          |    1063787 |     956060 |     311136 |     283023 |
| /premium         |     774617 |     776236 |     226445 |     227106 |
| /profile         |    1063787 |     956060 |     311136 |     283023 |
| /reset-password  |     772414 |     774033 |     225533 |     226194 |
| /settings        |     835082 |     836701 |     247086 |     247733 |
| /trades          |    1063787 |     956060 |     311136 |     283023 |
| /wishlist        |    1063787 |     956060 |     311136 |     283023 |
| /_global-error   |     760492 |     762111 |     221312 |     221973 |
| /_not-found      |     760492 |     762111 |     221312 |     221973 |
| /forgot-password |     772554 |     774173 |     225689 |     226350 |
| /login           |     776053 |     777672 |     226935 |     227596 |
| /signup          |     776053 |     777672 |     226935 |     227596 |
| /admin/cards     |     829220 |     830839 |     244474 |     245121 |
| /admin/players   |     887024 |     888715 |     261814 |     262134 |
| /admin/reports   |     895340 |     897031 |     264018 |     264336 |
| /market/[id]     |    1063787 |     956060 |     311136 |     283023 |
| /profile/[id]    |    1063787 |     956060 |     311136 |     283023 |
| /share/[id]      |     760695 |     762314 |     221487 |     222148 |

## Contenu principal inclus

Un composant dynamique rendu tout de suite doit aussi être téléchargé. Pour éviter de compter ce simple report comme une économie, ajouter à l'union initiale les fichiers JS de l'entrée correspondante dans .next/react-loadable-manifest.json : game → boosters pour /boosters, game → collection pour /collection et community-views → profile pour /profile. Les modules secondaires restent disponibles à leur ouverture.

| Route                        | Brut avant | Brut après | Gzip avant | Gzip après |
| ---------------------------- | ---------: | ---------: | ---------: | ---------: |
| /boosters + vue principale   |     921558 |     873635 |     272995 |     259995 |
| /collection + vue principale |     921558 |     897284 |     272995 |     266483 |
| /profile + vue principale    |    1063787 |    1011655 |     311136 |     298813 |

## Limites et risques

- Tous les fichiers JS générés, y compris les chunks différés, legacy, Pages runtime et les prévisualisations compilées : **106 → 111 fichiers ; 1868412 → 2019151 octets bruts ; 589920 → 643963 gzip**. Le total disque augmente avec les variantes de chunks ; cette PR réduit la charge des routes ciblées, pas le poids de tous les parcours cumulés. Les valeurs ~1,48/~2,03 Mo de l'audit sont du contexte, pas une comparaison directe avec ce build Webpack Windows.
- L'analyseur Turbopack inclut tous les fragments atteignables, même asynchrones et legacy : /boosters et /collection **1025423 → 1039683** octets, routes communautaires **1168341 → 1174076**, /admin/cards **935736 → 935839**. Ce modèle n'est pas le transfert initial Webpack : ne pas comparer leurs valeurs absolues.
- Sur les routes non ciblées, le runtime de découpage ajoute généralement **1619 octets bruts / 661 gzip**. La première ouverture d'une vue ou d'un détail différé peut attendre un téléchargement ; les vues principales ont un message de chargement anglais accessible.
- Aucun relevé réseau authentifié ou RUM en production ; les gains de latence et de Core Web Vitals ne sont pas établis.
- Essai abandonné : découper l'éditeur/suppression admin ; faible gain brut, gzip initial légèrement supérieur. Extraction entièrement retirée. Aucune assertion existante modifiée.
- Hors périmètre : administration, duplication restante next/image et fichier community-views monolithique. Le formatage #356 est intégré ; le conflit a été résolu uniquement sur l'import de boosters.tsx, son JSX cinématique est conservé.

## Preuves et migrations

Les deux tests bundle-boundaries échouent sur master 6ab6ca72 avant correction et passent après. Les 103 tests ciblés (frontières, présentation, partage/empreinte d'animation, profil/wishlist, ouverture et polling marché) passent. Build production et vérification TypeScript réussis. Prévisualisations locales packs (ouverture, déchirure, révélation) et profil/wishlist parcourues sans erreur console observée. Le premier run CI a relevé six échecs du harnais de polling : il cherchait next/dynamic dans xt/dynamic.ts. Le chargeur accepte désormais les modules installés via createRequire ; aucune assertion, aucun seuil ou scénario n’a changé. Ces six tests passent après correction. La CI complète est réservée à GitHub Actions.

Migrations Supabase : aucune. Statut VPS : **non appliquée sur le VPS** (sans objet).
