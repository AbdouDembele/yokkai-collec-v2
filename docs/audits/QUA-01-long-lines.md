# QUA-01 — lignes applicatives longues

Base : `origin/master` après merge de #352, `ba69d3c5`.
L’audit du 18 octobre comptait 49 lignes ; la branche à jour en contient 51.
49 lignes sont découpées sans changement fonctionnel. Deux restent figées sur instruction de Walid.

## Exceptions ciblées

Les deux lignes `yk-deck` et `yk-deck-button` de `components/boosters.tsx` appartiennent au bloc protégé par l’empreinte de `tests/card-sharing-client.test.mjs`.
Ce test reste inchangé. Un commentaire ajouté dans le bloc modifierait aussi son empreinte : la règle `max-len` les exempte donc par deux correspondances de texte exactes, documentées dans `eslint.config.mjs`.
Le test ajouté vérifie que ces deux lignes seulement sont exemptées et qu’un espace ajouté ne correspond plus à l’exception.
Le reste de `app`, `components`, `lib` et `hooks` reste limité à 300 caractères par lint.

## Preuve avant/après

Le test de lint échoue sur la base : une ligne de plus de 300 caractères n’est pas rejetée. Après correction, le lint la rejette et aucune ligne applicative non exemptée ne dépasse la limite.

Captures de `/design-system/boosters-preview`, qui utilise le composant Packs réel avec données simulées, sans consommer de pack ni écrire en base. Même Chrome isolé, dimensions, médias réduits et polices chargées. L’indicateur de développement Next est masqué uniquement dans la capture. Comparaison RGB : zéro pixel différent aux trois tailles.

| Taille      | Avant                                           | Après                                          |
| ----------- | ----------------------------------------------- | ---------------------------------------------- |
| 1440 × 1100 | [Avant](../../artifacts/qua-01-before/1440.png) | [Après](../../artifacts/qua-01-after/1440.png) |
| 768 × 1100  | [Avant](../../artifacts/qua-01-before/768.png)  | [Après](../../artifacts/qua-01-after/768.png)  |
| 390 × 1476  | [Avant](../../artifacts/qua-01-before/390.png)  | [Après](../../artifacts/qua-01-after/390.png)  |

Les contrôles navigateur confirment les deux panneaux, l’absence de débordement, l’alignement desktop, l’empilement mobile, le dialogue de probabilités et les mouvements réduits. Ils ne certifient pas une session authentifiée en production.

## Périmètre et risques

Découpage de types, requêtes, JSX et chemin SVG uniquement ; aucune migration Supabase, aucune application sur le VPS.
Aucun test existant modifié. Les avertissements lint préexistants restent hors périmètre.
Le risque principal est une dérive d’espacement JSX : les espaces originaux sont conservés explicitement ; l’empreinte d’animation et les captures restent inchangées.
