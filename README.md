# Yokkai Collec’

Jeu de collection de cartes : Regular Packs et Decision Packs, collection,
Karas, enchères, échanges entre amis, profils, succès et partage de cartes.
L’état de jeu est stocké dans Supabase/PostgreSQL ; le navigateur ne fait pas
les tirages et ne détient pas la sauvegarde de référence.

## Architecture

- Next.js 16 (App Router et Proxy), React 19, TypeScript et Tailwind CSS 4.
- `app/` porte les routes et Server Actions ; `components/` l’interface ;
  `lib/data/` les adaptateurs Supabase et caches en mémoire.
- `utils/supabase/` gère les clients navigateur/SSR et le renouvellement des
  cookies. Les mutations de jeu passent par des RPC SQL authentifiées.
- `supabase/migrations/` est la source versionnée du schéma, des droits, des
  règles métier et des jobs cron. PostgreSQL 17 est auto-hébergé sur le VPS.
- Storage héberge les images. Next optimise les images du bucket public
  `card-images` autorisé ; les autres sources conservent leur rendu direct.

Le catalogue et la collection sont paginés. Les listes d’échanges, enchères et
amis utilisent des RPC paginées, puis chargent toutes les pages pour préserver
l’affichage actuel. Le total du catalogue est conservé 30 secondes en mémoire ;
les lignes de chaque page sont relues. Les pollings se suspendent en arrière-plan.
La CSP est actuellement en **Report-Only**, pas encore bloquante.

## Démarrage local

Prérequis : Node.js 22, npm et un projet Supabase configuré (ou Docker pour
Supabase local). Depuis un clone, installer les dépendances puis renseigner
`.env.local` à partir de `.env.example` :

```sh
npm ci
npm run dev
```

`npm ci` active également le hook qui refuse les pushes directs sur `master`.
Ouvrir http://localhost:3000 ; les pages de jeu nécessitent une session.
Les aperçus `/design-system` sont réservés au développement (404 en production).

Variables :

| Variable                                             | Usage                                                     |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                           | URL de l’API Supabase                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`               | Clé publique, avec RLS et droits RPC                      |
| `NEXT_PUBLIC_SITE_URL`                               | Origine du front pour les confirmations email             |
| `NEXT_PUBLIC_GIPHY_API_KEY`                          | Clé publique GIPHY pour le sélecteur du chat, si utilisé  |
| `MAINTENANCE_MODE`                                   | Page statique 503 quand `true`                            |
| `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` | Serveur (suppression de compte) et scripts administratifs |

Une clé serveur ne doit jamais porter le préfixe `NEXT_PUBLIC_`, être envoyée au
navigateur, publiée dans Git ou copiée dans une conversation. `.env.local` reste
ignoré. Pour une instance locale déjà démarrée avec `npx supabase start`,
`npm run local:configure` écrit sa configuration locale uniquement.
Voir [Supabase](supabase/README.md) pour Auth, RPC et import du catalogue.
Connexion Google/Discord : [mise en production OAuth](docs/oauth-setup.md).

## Migrations en production

Les migrations s'appliquent uniquement via `scripts/deploy-migrations.sh`.
Aucune modification de schéma depuis Studio.
Avec Node.js 22, `npm ci`, Bash et une clé SSH configurée (port 1022) :

```sh
PROD_SSH_ALIAS=mon-alias PROD_DB_CONTAINER=mon-conteneur bash scripts/deploy-migrations.sh
PROD_SSH_ALIAS=mon-alias PROD_DB_CONTAINER=mon-conteneur bash scripts/deploy-migrations.sh --apply
```

L'aperçu n'écrit rien sur le VPS ; `--apply` exige la saisie interactive de `APPLY`.
Le script utilise uniquement `postgres`, vérifie le drift contre les migrations
déjà appliquées et refuse les doublons, registres incohérents et SQL incompatible
avec une transaction. Le rejeu PGlite doit réussir (extensions indisponibles refusées).
Le rejeu peut partir d'un cluster PGlite vide en cache
(`node_modules/.cache/yokkai-pglite/`, clé = version de PGlite, jamais de
migration ni de donnée) ; `YOKKAI_PGLITE_CACHE=off` le désactive, et `--apply`
le désactive par défaut (initdb à froid pour chaque contrôle de drift).
Une archive UTC complète est validée (taille + `pg_restore --list`) sur le VPS dans
`/var/backups/yokkai-migrations` ; seuls les dix derniers backups de ce script restent.
`PROD_BACKUP_DIR` permet un répertoire dédié root, mode 700 (créé ainsi par défaut).
L'alias doit autoriser `sudo -n docker` et `sudo -n bash`, sans mot de passe transmis.
Migrations et registre sont appliqués dans une transaction unique, puis le drift
est vérifié ; une erreur après `COMMIT` exige une investigation, sans rollback
automatique. Les sauvegardes hors VPS feront l'objet d'un chantier séparé.

### Activation unique de pg_cron

Avant la migration `20261009000004_auction_server_settlement.sql`, un administrateur
VPS (toi ou ton collègue, après coordination) lance **une seule fois** le script
ci-dessous. C'est l'exception administrative pour installer l'extension, hors du
registre de migrations : backup complet validé, puis `CREATE EXTENSION IF NOT EXISTS`
sous `supabase_admin` et vérification des droits de planification de `postgres`.
Les migrations suivantes continuent exclusivement sous `postgres`.

```sh
PROD_SSH_ALIAS=mon-alias PROD_DB_CONTAINER=mon-conteneur bash scripts/admin/enable-pg-cron.sh
PROD_SSH_ALIAS=mon-alias PROD_DB_CONTAINER=mon-conteneur bash scripts/admin/enable-pg-cron.sh --apply
```

Le premier appel affiche seulement le plan ; le second exige `ENABLE-PG-CRON`.
Le backup reste sur le VPS dans `/var/backups/yokkai-pg-cron` (surcharge possible
via `PROD_BACKUP_DIR`). Le script ne programme aucun job ; la migration le fait
sous `postgres`, chaque minute. Elle échoue explicitement si pg_cron manque.
PGlite utilise un stub qui enregistre le job sans exécuter de planificateur.

Ordre sûr : **activation pg_cron → migration via deploy-migrations.sh → front**.
Coolify redéploie automatiquement `master` (configuration vérifiée le 09/10/2026).
Pour respecter strictement cet ordre, coordonner le merge/redéploiement avec
l'application SQL. Si le front arrive avant la migration, les anciennes lectures
SQL continuent de clôturer les enchères ; la migration crée le job et retire ces
effets de bord dans la même transaction. Après migration, une clôture peut prendre
jusqu'au prochain passage du job (une minute, hors surcharge/échec).
Vérifier ensuite les exécutions dans `cron.job_run_details` et le drift.

## Vérifications

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
node tests/design-system-production.mjs
npm audit --omit=dev --audit-level=high
```

Le build utilise les variables publiques ; des valeurs factices suffisent en CI.
Le contrôle design-system démarre le build production et vérifie les 404 des aperçus.
Les tests couvrent les adaptateurs, l’isolation des joueurs, les RPC, les packs,
les triggers, les enchères et les migrations. Ils ne font pas d’import en prod.

La CI rejoue toutes les migrations sur PGlite avec les droits par défaut Supabase
et bloque les numéros en double ainsi que les SECURITY DEFINER ouvertes sans
justification dans `tests/security-definer-allowlist.mjs`. Le bootstrap cron
PGlite enregistre les jobs sans les exécuter ; les commandes sont testées
séparément. Un autre job rejoue le schéma sur `supabase/postgres:17.6.1.136`
(PostgreSQL 17.6) et vérifie 50 surenchères croisées avec deux sessions réelles.

## Travail en équipe et suivi

Créer une branche depuis `origin/master` à jour, ouvrir une PR et attendre une
CI verte. Coolify redéploie le front au merge ; une évolution doit rester
compatible avec la base tant que sa migration n’est pas appliquée.
Les migrations existantes ne s’éditent pas : ajouter une nouvelle version unique.
Les anciennes sauvegardes localStorage ne sont ni lues ni importées dans le jeu.
Les taux et délais sont définis côté SQL et exposés par les RPC, pas par ce README.

Voir [le workflow d’équipe](docs/COLLABORATION.md), [l’audit](AUDIT.md) et
[les chantiers différés](docs/TODO.md). `v0.1-mvp.md` et `spec-complete-vision.md`
sont des documents historiques/de conception, pas le descriptif de la production.

## Effacements après restauration

Avant de restaurer un ancien backup, exporter le journal privé des suppressions ;
après restauration, réappliquer les effacements avant de rouvrir le jeu.
Voir [la procédure et son script](docs/account-deletion-restoration.md).

## Runtime du front

Le dépôt fixe Node.js 22.x dans `package.json` et Node 22 dans `railpack.json`.
Coolify utilise Railpack (vérifié en lecture seule). Le plan installe le lockfile
avec `npm ci --include=dev`, construit avec `npm run build` en forçant Webpack,
puis démarre avec `npm run start` (port fourni par l’hébergement). Webpack est
conservé tant que Turbopack 16.4.2 échoue, sur l’hébergeur et sous Windows, à
résoudre les modules virtuels de `next/font/google` utilisés par la coque. Sora
est auto-hébergée depuis #391 ; Cinzel et Noto Serif JP passent encore par
`next/font/google`. Le build Turbopack réussit en CI Linux, mais cela ne prouve
rien pour l’hébergeur : repasser à Turbopack demande un build d’essai Coolify ou
l’auto-hébergement de ces deux polices. Les couches et caches générés par le
fournisseur Node sont conservés. Les variables Supabase restent dans la
configuration privée de l’hébergeur. Vérifier les éventuelles surcharges
Coolify avant adoption ; le build du front n’applique jamais les migrations.
Source : [configuration officielle Railpack](https://railpack.com/config/file/).
