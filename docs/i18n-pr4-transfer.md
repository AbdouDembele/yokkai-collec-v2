# Transfert i18n PR 4 vers Yokkai Collec v2

## Provenance

Archive reçue : `yokkai-i18n-pr4-transfert-2026-10-30.zip`, base historique `bd752ede15a2fabeddaabc6530ca6ec0399eb1e8`. Les 138 empreintes du manifeste et celle du patch cumulatif ont été vérifiées avant intégration.

L'intégration part de `origin/master` du nouveau dépôt, commit `4fb38da759d1c6189cbf635d2c89c8fd85c4608b`. Les 38 fichiers du transfert ont été comparés avec leur base et leur version actuelle ; les fichiers finaux n'ont pas été recopiés par-dessus le travail récent.

## Périmètre retenu

- Notifications : titres, corps et valeurs de repli via le catalogue existant, mêmes destinations et même contenu anglais.
- Classements collection/parrainage : libellés, états de chargement, erreurs, nombres et résultats EN/FR.
- Fil Social : onglets déjà traduits conservés ; notices, erreurs, états vides, chargement et boutons restants extraits.
- Échanges : sélection, récapitulatif, confirmations, erreurs et libellés accessibles ; ajout de descripteurs stables pour trois erreurs de limite sans changer les quotas.
- Métadonnées restantes des routes Social et classements.

Les états d'erreur des messages et échanges conservent une clé stable. La liste des clés autorisées est construite après l'enregistrement de tous les messages de compatibilité, pour éviter un retour au message générique au rendu suivant. Les erreurs inconnues restent filtrées.

Les traductions déjà présentes dans les espaces `market`, `socialFriends`, `socialTrades`, `privateMessages` et `conversationTrade` sont conservées. Les conversations ancrées, styles d'avatar/pseudo, boutons emoji/GIF, profil depuis une mention, pagination, sauvegarde de tri, modal d'échange et redirection `/trades` vers Social restent ceux du dépôt actuel.

Les données de joueurs, cartes, licences, images et contenus de messages ne sont pas traduits. Aucun provider, package, sélecteur, flag, migration ou paramètre de production ajouté. Aucune modification des règles d'échange, de permissions ou des RPC.

## Tests adaptés

Les tests existants passent le vrai traducteur ICU là où la fonction exige désormais un traducteur ; les assertions sur les routes, identifiants, événements, lecture des messages, refus d'accès, polling et conservation des brouillons sont maintenues.

Les vérifications des textes de notifications et d'annulation visent les catalogues, complétées par des contrôles de rendu. Les attentes des onglets du Marché et de la redirection Trades restent celles du nouveau dépôt.

Un nouveau test fige 30 sorties de notifications produites par le master de référence, avec et sans données optionnelles. Il vérifie l'égalité exacte du titre, du corps, de la destination, du type et de l'état de lecture en anglais. Les signatures intégrales du JSX des cartes et des appels RPC restent identiques à celles du transfert historique, sans réenregistrement des empreintes.

Les adaptations de tests liés au produit sont explicitement signalées dans la PR pour validation de Walid. La relecture française par Walid reste requise.

## Recette et limites

La CI complète s'exécute exclusivement dans GitHub Actions. Les captures et le harnais fournis dans l'archive constituent une aide historique ; leurs résultats ne sont pas revendiqués pour cette intégration.

Une nouvelle recette locale utilise uniquement des fixtures et intercepte les requêtes externes du navigateur. Aucun message, échange, enchère ou migration n'est envoyé à la production. Les aperçus temporaires et identifiants fictifs ne sont pas livrés.

Le compte rendu final des écrans, largeurs, états détaillés, captures et éventuelles différences anglaises figure dans la description de la PR. Une simulation de zoom par réduction de viewport ne remplace pas une vérification native à 200 % ; ne pas la présenter comme telle.

Captures issues de la nouvelle recette locale : [amis, 320 px](i18n/pr4-transfer/friends-fr-320.png), [notifications, 320 px](i18n/pr4-transfer/notifications-fr-320.png), [parrainages, 1440 px](i18n/pr4-transfer/leaderboard-referrals-fr-1440.png). Les comptes, messages et scores de ces écrans sont des fixtures.

La mesure compilée du poids figurant dans l'archive précède ses dernières modifications et ne s'applique pas au nouveau dépôt. Ne pas la reprendre comme mesure finale. Le français reste piloté par le flag existant ; cette PR ne change aucune configuration de production et n'est pas déployée.
