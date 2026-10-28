# Import des sources de production

Le 28 octobre 2026, ce dépôt privé a été initialisé à partir des sources présentes
dans le conteneur actif du VPS Yokkai Collec.

- Commit de production : `bd752ede15a2fabeddaabc6530ca6ec0399eb1e8`.
- Référence d'origine : [commit déployé](https://github.com/TheGreatToba/yokkai-collec/commit/bd752ede15a2fabeddaabc6530ca6ec0399eb1e8).
- Fichiers récupérés : 1627.
- Tous les fichiers ont été comparés par empreinte au commit déployé ; aucune divergence.
- SHA-256 de l'archive locale : `d5e0cb008dc1964607fc97cf9c1c92ec9c28eac2d4ca270957a8c63ceadc431e`.

L'import contient le code de l'application, les assets suivis, les scripts, les
tests, les catalogues de traduction, la documentation et les migrations SQL.
Il ne contient pas les variables d'environnement réelles, les clés privées,
les comptes des joueurs ni une copie de la base de données. Les fichiers
`.env.example` et `.env.billing.example` restent les modèles de configuration.

Le dépôt démarre un nouvel historique. Les sources applicatives restent celles
de la production, sans intégrer les changements locaux de l'ancien checkout.
Le VPS et son déploiement continuent d'utiliser le dépôt d'origine.

Les migrations sont copiées comme sources historiques : aucune migration n'a
été appliquée au VPS pendant cet import et aucun secret GitHub n'a été copié.
Pour une nouvelle base, suivre les instructions de configuration du projet.

## Adaptation de la CI du dépôt privé

Le premier contrôle GitHub a atteint sa limite de 15 minutes. Le job
`checks` dispose donc de 30 minutes dans ce nouveau dépôt. Seul ce budget
de durée change dans le workflow : mêmes tests, mêmes assertions, mêmes
triggers. Les sources applicatives restent identiques à celles du VPS.
