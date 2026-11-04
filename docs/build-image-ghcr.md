# Image du front construite par GitHub Actions

Audit de prod du 3/11, point P. Jusqu'ici, Coolify construisait l'image du front
sur le serveur de jeu à chaque merge : la charge passait de 4-7 à 15-21 pendant
environ cinq minutes, en même temps que les joueurs. Le workflow
`.github/workflows/image.yml` construit désormais l'image sur un runner hébergé
par GitHub et la publie sur GHCR. Coolify n'a plus qu'à la récupérer.

Le `Dockerfile` reproduit exactement `railpack.json` : Node 22,
`npm ci --include=dev`, `npm run build` (Webpack), `npm run start`.

## Ce que fait le workflow

- **PR qui touche au Dockerfile, à `.dockerignore`, au workflow ou aux dépendances** :
  construit l'image avec des valeurs factices, sans la publier ni déployer.
- **Push sur `master`** : vérifie les variables de build, construit, publie
  `ghcr.io/yokkai-collec/yokkai-collec-v2:<sha>` et `:latest`, puis demande à
  Coolify de déployer si son webhook est configuré. Tant que les variables
  obligatoires manquent, le job affiche un avertissement et ne publie rien,
  sans échouer.
- **Manuel** (`workflow_dispatch`) : même chose que sur `master`.

Le build tourne sur `ubuntu-latest`, jamais sur le serveur de prod ni sur un
runner auto-hébergé installé dessus.

## 1. Variables GitHub (Settings → Secrets and variables → Actions → Variables)

Ces valeurs sont **intégrées dans l'image à la compilation** et visibles par le
navigateur : ce ne sont pas des secrets. Reprendre exactement les valeurs
actuelles de Coolify.

| Variable                               | Obligatoire |
| -------------------------------------- | ----------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | oui         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | oui         |
| `NEXT_PUBLIC_SITE_URL`                 | oui         |
| `NEXT_PUBLIC_CONTACT_EMAIL`            | si utilisée |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | si utilisée |
| `NEXT_PUBLIC_GIPHY_API_KEY`            | si utilisée |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`       | si utilisée |
| `NEXT_PUBLIC_AUTH_SUPPORT_URL`         | si utilisée |
| `NEXT_PUBLIC_STABLE_BINDERS_ENABLED`   | si utilisée |
| `NEXT_PUBLIC_I18N_ENABLED`             | si utilisée |
| `CSP_ENFORCE`                          | si utilisée |

Les secrets serveur (clé secrète Supabase, clé privée VAPID, Stripe,
`PUSH_DISPATCH_SECRET`, GIPHY serveur, Discord…) **restent uniquement dans
Coolify** : ils sont lus à l'exécution et ne doivent jamais devenir des
variables de build.

Après une rotation des clés Supabase (secret JWT), mettre à jour
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ici aussi, puis relancer le workflow.

## 2. Vérifier la première image

Après le premier merge sur `master`, l'onglet Actions doit montrer le job
« Front image » en vert et le paquet doit apparaître dans
`github.com/orgs/Yokkai-Collec/packages`. Tant que Coolify n'est pas basculé,
rien ne change en prod.

## 3. Basculer Coolify sur l'image

1. Accès au registre : si le paquet GHCR est privé, créer un token GitHub
   (classic) limité à `read:packages`, puis sur le serveur :
   `docker login ghcr.io -u <compte> --password-stdin`. Ne jamais coller ce
   token dans une PR, un ticket ou Discord.
2. Dans Coolify, créer une ressource **Docker Image** avec
   `ghcr.io/yokkai-collec/yokkai-collec-v2:latest`, port 3000, mêmes domaines
   et **mêmes variables d'environnement** que l'application actuelle (copier
   aussi les secrets serveur). Garder l'ancienne ressource arrêtée, pas
   supprimée, pour le retour arrière.
3. Désactiver le déploiement automatique depuis Git de l'ancienne ressource,
   sinon les deux builds tourneraient encore.
4. Récupérer l'URL **Deploy Webhook** de la nouvelle ressource et créer un
   token API Coolify. Les ajouter dans GitHub comme **secrets** :
   `COOLIFY_DEPLOY_WEBHOOK` et `COOLIFY_API_TOKEN`.
5. Basculer les domaines vers la nouvelle ressource en heure creuse, puis
   vérifier : accueil, connexion, ouverture de pack, marché, collection,
   images de cartes, en-têtes de sécurité (CSP) servis derrière Cloudflare.

## Retour arrière

- **Mauvaise version** : redéployer dans Coolify un tag précédent
  `ghcr.io/yokkai-collec/yokkai-collec-v2:<sha>` (chaque merge garde le sien).
- **Problème avec l'image elle-même** : rebasculer les domaines sur l'ancienne
  ressource Railpack et réactiver son déploiement automatique.

## Coût

Environ 5 à 8 minutes d'Actions par merge sur `master` (moins avec le cache
`type=gha`). Sur un dépôt public, les runners hébergés sont gratuits ; s'il
passe en privé, ces minutes comptent dans le quota de l'organisation (voir
`docs/ci-budget.md`).
