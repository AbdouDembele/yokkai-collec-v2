# Audit V4 du tri des licences ANIME/MANGA — avant application

Les correspondances restantes ont été déterminées et les nouvelles décisions utilisateur intégrées. Cette PR conserve uniquement une synthèse sans données de joueur. Aucun SQL de nettoyage, migration ni déploiement n'est inclus dans cette PR.

## Décisions intégrées

Le plan comporte 80 KEEP, 65 MERGE et 1 660 DELETE sur les 1 805 lignes du classeur. Les 72 changements de MERGE vers DELETE ont été expressément demandés. L'Excel original reste intact.

- Aria AA rejoint Aria the Scarlet Ammo : ses six cartes sont préservées, sans duplication d'association.
- Les fausses fusions vers Uma Musume, Super Sonico et les deux homonymes distincts validés passent en DELETE. Sonic des jeux vidéo et les véritables franchises principales sont conservés.
- Pour les 17 anciennes cibles génériques non résolues, seules les petites sources MERGE de l'Excel deviennent DELETE. Les séries principales et leurs autres cartes ne font pas partie de cette décision.
- Les anciennes sources ont été recoupées avec les identités historiques. Les entrées désormais hors ANIME/MANGA sont exclues ; les identités déjà absentes ne sont pas remplacées par un homonyme.
- DELETE inclut les cartes catalogue exactement identifiées, leurs exemplaires possédés et les seules dépendances nécessaires. Aucun compte, profil, objet Storage ni fichier image n'est supprimé.

## Portée exacte

Le plan contient 9 053 cartes candidates identifiées individuellement. Le contrôle final a retiré 177 cartes supplémentaires appartenant aux parents plus larges de petites sources déjà regroupées. Aucun conflit entre les candidats et les cartes KEEP/MERGE identifiées n'est présent. Aucune correspondance active ne reste à deviner.

Les noms exacts, alias exacts uniques, UUID historiques et associations physiques sont distingués. Un alias de franchise n'autorise jamais la suppression ou le déplacement de tout son classeur parent. La PR #17 ajoute le support technique des fusions par association catégorie/source ; elle ne contient aucune décision éditoriale ni suppression.

## Sauvegarde et répétition

Une sauvegarde cohérente de la base entière a été restaurée réellement dans un conteneur isolé, sans réseau ni port publié et sans tâches planifiées actives. Tous les compteurs de contrôle correspondent au même snapshot source. Les fichiers binaires Storage restent intacts et hors du dump SQL.

L'application du périmètre exact et son retour arrière sélectif ont réussi sur ce clone. Les empreintes des 19 tables contrôlées retrouvent exactement leur état initial. Une modification concomitante de profil sans rapport avec le nettoyage est préservée par la restauration des seules colonnes modifiées.

Les packs pending concernés ont été exercés avec la fonction réelle de conservation d'une carte, puis les effets du test annulés. Deux fixtures isolées prouvent l'exclusion d'une carte sous séquestre et de la dernière récompense valide d'un pack. Ces tests ne créent aucune opération de joueur en production.

## Application contrôlée

Avant toute application, une nouvelle sauvegarde, le recalcul des dépendances et la coordination SQL du §6 de docs/COLLABORATION.md restent obligatoires. Les dépendances sont revérifiées sous verrou dans la transaction.

Les enchères actives sans séquestre et les échanges pending concernés sont arrêtés proprement. Les historiques terminés sont préservés ; seuls les snapshots historiques manquants nécessaires sont complétés avant retrait de leurs références techniques. Les options de packs ne sont retirées que si une récompense valide demeure. Les autres cartes, possessions, profils et objets Storage sont contrôlés avant COMMIT. Tout écart déclenche un rollback.

Les scripts privés journalisent les lignes et colonnes modifiées pour permettre un retour arrière sélectif, sans écraser les opérations postérieures d'une production active.

## Livrables privés

Le rapport détaillé V4, la copie Excel corrigée, les UUID, snapshots, journaux SQL et archives restent privés, hors Git. Aucun identifiant de production, détail de possession, lien d'image, archive ou secret n'est publié dans cette PR.

La PR #15 des fonctionnalités de classeurs reste séparée, en brouillon et sans déploiement.
