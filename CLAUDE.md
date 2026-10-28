# Workflow d'équipe — à lire en premier

Deux devs travaillent en parallèle sur ce repo. Détails complets : [docs/COLLABORATION.md](docs/COLLABORATION.md).

Règles non négociables :

- Aucune PR mergée sans CI GitHub Actions verte sur la branche à jour avec origin/master.

- Lancer npm run format avant tout commit ; ne jamais utiliser --no-verify.

- Ne jamais affaiblir un test existant (assertion supprimée ou assouplie, seuil abaissé, test ignoré) dans la même PR que le code qu'il vérifie. Si un test protège une décision produit (qualité des images, droits SQL, taux de drop…), toute modification doit être signalée explicitement dans la description de la PR et validée par Walid.

- Toujours lancer `git status` et `git fetch origin` avant de commencer une tâche.
- Ne jamais pousser directement sur `master` : partir d'une branche `<initiales>/<description>` créée depuis `origin/master`.
- Ouvrir une Pull Request pour toute tâche, même petite.
- Indiquer dans la PR les migrations Supabase qu'elle contient et si elles sont déjà appliquées sur le VPS ou non.

## CI — GitHub Actions uniquement

- La CI complète est exécutée par GitHub Actions. Les agents ne lancent jamais `npm run verify`, `npm run ci` ni `npm run ci:db` en local, y compris dans les plans des PR de traduction.
- En local : lancer `npm run format` avant chaque commit et laisser le hook pre-push bloquer uniquement les pushes directs sur `master`. Ne jamais contourner les hooks.
- Les triggers `push` et `pull_request` vers `master` de `.github/workflows/ci.yml` restent actifs. Ne jamais les désactiver sans accord explicite de Walid.
- Après le push, ouvrir la PR puis surveiller `gh pr checks`. Lire les logs seulement en cas d'échec (`gh run view <id> --log-failed`, fin utile uniquement), corriger puis repousser. Une PR est prête à merger quand la CI GitHub est verte sur la branche à jour avec `origin/master`.
- Dans la partie validation de la PR, indiquer seulement les checks passés ou la cause de l'échec ; ne jamais coller de sortie de vérification locale.
- Pushes groupés : regrouper les commits puis pousser une version relisible ; repousser uniquement les corrections nécessaires, notamment celles de CI.

@AGENTS.md

## graphify

Graphify is optional: graphify-out/ is a locally generated graph, not shipped with the repository. Install Graphify on PATH and generate a graph to enable its hooks. Without the CLI or graph, use rg/source reads; the hook reports the missing prerequisite and continues.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` when the CLI and local graph are available (AST-only, no API cost).

## Langue du produit : anglais source + français

- Anglais source + fr dans la même PR : tout nouveau texte joueur passe par les catalogues en/fr, jamais de texte construit par concaténation. Cela inclut erreurs, états vides, textes accessibles et métadonnées.
- Les données de cartes, personnages, licences, catégories, images, raretés, Karas et noms Regular Pack / Decision Pack restent inchangés. Les données interpolées passent en paramètres ICU ; les pluriels utilisent ICU.
- Pour un reset ou une échéance (packs, missions, enchères), afficher un compte à rebours plutôt qu'une heure fixe. Jamais « heure de Paris » / « Paris time » dans un texte joueur. UTC en base, fuseau du navigateur à l'affichage, sans divergence d'hydratation.
- Les routes restent anglaises, minuscules et avec tirets ; aucun préfixe de locale. Les fonctions SQL renvoient des codes stables ; la traduction reste dans l'interface.
- Le français reste caché derrière le flag, désactivé par défaut jusqu'au merge des PR 1 et 2 et à la validation de Walid. Relecture du français par Walid, zone par zone.
- PR, commits et documentation interne peuvent rester en français.
