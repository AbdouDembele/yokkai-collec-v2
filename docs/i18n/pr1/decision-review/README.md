# Decision Pack — trois statuts uniquement

PR #545, base complémentaire master 262aa8a. EN : **LOST / DESTROYED / KEPT**. FR : **PERDUE / DÉTRUITE / GARDÉE**. Majuscules directement dans `boosters.decision`, sans changement CSS. Les autres textes de boosters.tsx restent pour PR 2.

Le composant change uniquement l’import et l’initialisation de useTranslations, puis les trois textes vers t(). [Diff intégral](boosters.tsx.diff) ; [contrat par empreinte du source restauré](scope-contract.json). Classes, JSX, StatusPill, props, cartes, raretés, images et animations inchangés. Namespace ajouté au fournisseur client. Cinq tests existants reçoivent seulement le mock i18n anglais : aucune assertion supprimée ou assouplie. Deux nouveaux tests utilisent le vrai composant et les catalogues EN/FR, sans modifier les données de cartes.

Exception EN flag off autorisée : seulement **PERDUE → LOST** ; DESTROYED et KEPT inchangés. Le cookie FR est ignoré dans l’aperçu EN après avec flag off. À 1440 et 375 px, la comparaison des pixels hors des trois tampons PERDUE → LOST ne détecte **aucune autre différence** : [résultats](off-pixel-comparison.json).

## Captures du vrai BoosterReveal

| Vue             | Avant EN flag off                        | Après EN flag off                 | Avant FR                             | Après FR                            |
| --------------- | ---------------------------------------- | --------------------------------- | ------------------------------------ | ----------------------------------- |
| Desktop 1440 px | [avant](decision-before-off-en-1440.png) | [après](decision-off-en-1440.png) | [avant](decision-before-fr-1440.png) | [après](decision-after-fr-1440.png) |
| Mobile 375 px   | [avant](decision-before-off-en-375.png)  | [après](decision-off-en-375.png)  | [avant](decision-before-fr-375.png)  | [après](decision-after-fr-375.png)  |

Aperçu local du composant réel : cinq cartes existantes des fixtures Auth, une détruite, trois perdues et une gardée, mêmes données avant/après. Aucune RPC de jeu ni pack consommé. Route de recette temporaire supprimée avant commit ; aucune nouvelle route livrée. Les autres textes anglais visibles restent volontairement pour PR 2.

Chrome, polices du produit chargées, inclinaison habituelle conservée. Animations/transitions figées dans le navigateur de capture uniquement ; images animées figées à leur première frame. Comparaison EN off à densité 2× pour stabiliser l’anticrénelage des coins des cartes ; captures FR et EN on à 1×. Aucun style produit modifié.

## Place et validation

« DÉTRUITE » tient sans débordement ni coupure : inspection visuelle desktop/375 px, rectangle du texte contenu dans le tampon et scrollWidth ≤ clientWidth à 320, 375, 768, 1024 et 1440 px ; contrôle à 720 px CSS correspondant à la mise en page à 200 % sur 1440 px. Aucun débordement horizontal. [Mesures](checks.json).

457 tests liés aux zones modifiées et les deux tests dédiés EN/FR passent. CI complète sur GitHub Actions. Migration de locale toujours non appliquée au VPS ; aucun déploiement ou merge.
