# Échanges et création d'enchères — protections ciblées

Références : #375 (spam d'offres/notifications) et #557 (règlement inline).

## Échanges

Chaque joueur peut créer 10 offres par fenêtre fixe de 10 minutes, garder au plus
20 offres sortantes en attente et au plus 5 vers le même destinataire. Les comptes
Pro et admin suivent ces mêmes protections anti-spam. Les offres déjà présentes ne
sont pas supprimées ; le plafond bloque uniquement les créations supplémentaires.

Un trigger privé protège tous les appels à `create_trade_offer`, y compris les
contre-propositions. Le compteur transactionnel est sérialisé par joueur : des
appels concurrents ne peuvent pas prendre la même dernière place. Seules les
créations réussies consomment le quota ; annuler ensuite ne le rembourse pas.
Un refus annule intégralement l'opération, notamment le changement d'état du
parent d'une contre-proposition, sans nouvelle notification ni mouvement d'actifs.

Les imports opérateur sans identité joueur restent possibles. Les joueurs ne
peuvent ni lire ni modifier la table de compteurs ou exécuter la fonction trigger.
Le compteur est supprimé en cascade avec le compte. Aucun email ou historique de
messages supplémentaire n'est enregistré.

Les messages des trois refus sont dans les sous-catalogues
`messages/trade-limits/en.json` et `fr.json`. Ce découpage évite un recoupement
avec les catalogues centraux de la PR de modération parallèle. La langue déjà
fixée sur le document est utilisée après l'action cliente ; le flag français
existant reste inchangé. Les harnais de tests chargent ces catalogues réels sans
modifier leurs assertions antérieures.

## Enchères

Créer une enchère n'appelle plus `settle_expired_auctions` et ne prend donc pas les
verrous de profils/cartes de ventes expirées sans rapport avec le vendeur. Le cron
de règlement chaque minute conserve cette responsabilité. Les enchères dont le
délai est écoulé ne consomment plus de place, même avant ce règlement.

Les contrôles de propriété, carte verrouillée/déjà vendue, bannissement, prix,
durée et concurrence du plafond restent identiques : Basic 3, Pro actif 6,
admin avec Pro actif sans plafond.

## Vérification et limites

Tests jetables : 100 comptes contrôlés, 500 offres/notifications bornées au total,
annulations, réouverture de fenêtre, plafonds, refus de contre-offre atomique et
droits SQL. Sur PostgreSQL 17 en CI : deux sessions sur la dernière place du quota,
et création pendant le verrouillage du profil d'un vendeur expiré indépendant.
Une contre-preuve restaure le règlement inline et doit échouer à cet invariant.

Ces corrections ne clôturent pas entièrement #375 ou #557. Restent notamment les
plafonds de transferts économiques, le wash trading, la trace des parrainages après
suppression et les autres ordres de verrous administratifs/dossiers. Aucun de ces
travaux n'est présenté comme réalisé dans ce lot.

Migrations : `20261028120000_auction_creation_without_inline_settlement.sql` et
`20261028121000_trade_offer_submission_limits.sql`. Leur application exige la
coordination prévue au §6 de `docs/COLLABORATION.md` et une CI verte sur master à jour.
