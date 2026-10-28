# Supabase — schéma et exploitation

Le jeu utilise Supabase Auth, PostgreSQL 17 auto-hébergé, PostgREST/RPC et Storage.
`migrations/` contient l’historique complet ; les trois migrations initiales ne
suffisent plus pour démarrer l’application actuelle.

## Configuration et authentification

Renseigner les variables publiques de `.env.example` dans `.env.local` ; voir
[le README principal](../README.md#démarrage-local). Les clients SSR et navigateur
sont dans `utils/supabase/`, les actions Auth dans `app/auth/actions.ts`.
Le Proxy renouvelle la session ; les pages de jeu vérifient l’utilisateur.

Activer Email/password dans Supabase Auth. Définir la Site URL et les Redirect
URLs avec la même origine que `NEXT_PUBLIC_SITE_URL`, dont `/auth/confirm`.
Ne pas mélanger `localhost` et `127.0.0.1` en développement.
Le lien email PKCE doit être ouvert dans le navigateur de l’inscription ; pour
la confirmation dans un autre navigateur, le modèle Confirm signup peut utiliser :

```html
<a
  href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup"
  >Confirm email address</a
>
```

Cet exemple reprend [confirmation.html](../public/auth-emails/confirmation.html). Pour les corps et sujets anglais, ainsi que la vérification des modèles réellement actifs, suivre [la checklist Auth](../docs/english-auth-emails.md#checklist-de-vérification-des-modèles-actifs).

La route accepte les deux formats, établit les cookies et redirige vers le jeu.
Les destinations externes ne sont pas suivies. Le trigger d’inscription crée le
profil ; le client ne l’insère pas directement. Le pseudo de navigation est lu
via `get_game_info()`, depuis l’identité du JWT, sans SELECT direct sur
`user_profiles`. Le statut administrateur n’est pas attribuable par un joueur.

## Données et règles SQL

- `cards` est le catalogue ; chaque exemplaire de `user_cards` a son UUID.
  Les doublons de collection sont donc distincts et conservés.
- Les RPC ouvrent les packs et contrôlent les échéances à l’heure de la base.
  Le Decision Pack persiste ses cinq choix jusqu’à la décision finale.
- Les soldes Karas et transferts sont transactionnels. Les primitives de crédit
  et débit ne sont pas exécutables directement par les joueurs.
- Enchères, échanges, relations d’amitié, dossiers, wishlists, notifications et
  succès sont gérés par les migrations et leurs RPC/triggers.
- `settle-expired-auctions` clôture les enchères chaque minute via pg_cron.
  Les lectures du marché ne déclenchent plus le règlement. Un second job purge
  les détails cron de plus de sept jours quotidiennement à 03:00 UTC.
- Les listes paginées ont des curseurs stables ; les anciennes signatures restent
  disponibles pour les clients en cache. L’interface charge encore toutes les pages.

RLS et grants définissent les lectures accessibles ; les tables privées ne sont
pas rouvertes pour contourner une RPC. Les SECURITY DEFINER ont un search_path
fixé et des droits explicites, contrôlés par l’allowlist et la CI.
La vue historique `wishlist` reste référencée par des fonctions internes ; ses
droits clients sont révoqués. Les fonctions trigger-only ne sont pas appelables
par les joueurs mais leurs triggers continuent de fonctionner sous authenticated.

## Migrations sur le VPS

Les migrations s’appliquent uniquement via `scripts/deploy-migrations.sh` depuis
la racine du dépôt. Aucune modification de schéma depuis Studio.
Voir [la procédure complète](../README.md#migrations-en-production) : alias SSH,
aperçu par défaut, contrôle de drift préalable, backup validé, confirmation
interactive et transaction unique sous `postgres` pour migrations et registre.
Coordonner avec l’autre développeur : une seule application à la fois.

L’activation initiale de pg_cron est l’unique opération administrative séparée,
via `scripts/admin/enable-pg-cron.sh`, avec backup, sous `supabase_admin`.
Elle doit précéder les migrations qui planifient les jobs ; celles-ci échouent
explicitement si l’extension manque. Les déploiements ordinaires restent sous postgres.

Ne jamais modifier une migration existante ou réappliquer un fichier isolément.
Les exceptions historiques du registre sont précisément versionnées dans
`migration-registry-exceptions.json`, avec justifications et preuves adjacentes.
`check-prod-drift.sh` compare en lecture seule fonctions, propriétaires publics,
droits, RLS, triggers, contraintes et jobs cron au schéma rejoué.

## Tests du schéma

`npm test` inclut le rejeu complet sur PGlite, les RPC sous les rôles joueurs et
les tests de non-régression des triggers. `scripts/replay-migrations.mjs` contient
le bootstrap Auth/Storage et le stub minimal cron : aucun faux planificateur.
PGlite n’a qu’une connexion ; le job CI PostgreSQL 17 exécute les tests de
concurrence sur la même image que la production, avec deux sessions réelles.
Les données de fixture restent sur des bases jetables.

## Import administratif du catalogue

L’import est une opération distincte des migrations. Le script versionné
`scripts/import-cards.mjs` utilise une clé serveur, jamais une clé du navigateur.
Ne pas lancer d’import pendant un déploiement ou une création d’index.

```sh
# Validation du CSV sans réseau ni écriture
node --env-file-if-exists=.env.local scripts/import-cards.mjs --dry-run
# Import réel, seulement après validation et coordination
npm run import:cards
```

Le script utilise `(source, source_id)` pour les upserts et des chemins Storage
stables dans `card-images`. Un bucket privé existant n’est pas rendu public en
silence. Storage et PostgreSQL n’ont pas de transaction commune : un échec après
upload peut laisser un objet sans ligne catalogue. Les erreurs sont journalisées
localement dans `logs/`, ignoré par Git. Ces commandes ne sont pas exécutées par CI.

La clé serveur reste hors du code client, des commits et des conversations.
Les règles d’URL d’avatar sont fixées par migration ; un changement de domaine
Supabase nécessite leur mise à jour (voir [TODO](../docs/TODO.md)).
