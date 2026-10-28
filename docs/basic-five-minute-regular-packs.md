# Regular Packs : cinq minutes pour tous

Les comptes Basic rechargent désormais un Regular Pack toutes les 300 secondes, comme les comptes Pro. La réserve chronométrée reste limitée à cinq packs pour Basic et dix pour Pro, avec paiement Stripe ou activation manuelle. Les bonus de parrainage restent indépendants de cette limite.

La migration `20261028200000_basic_regular_pack_five_minutes.sql` met le défaut des nouveaux profils à 300 secondes et convertit les anciens compteurs à 600 secondes. Elle conserve les packs acquis et la progression fractionnaire : cinq minutes restantes deviennent deux minutes et demie, deux packs déjà acquis restent deux packs. Un changement de statut Pro ne déplace plus l'échéance des Regular Packs. Les quotas et l'historique des Decision Packs restent inchangés.

La comparaison Pro, les rappels de parrainage et les promotions présentent maintenant la réserve doublée plutôt qu'une recharge plus rapide. Les nouveaux textes sont présents dans les catalogues anglais et français.

Les tests existants conservent toutes leurs assertions de droits, de quotas et de révocation. Leurs attentes produit de 600 secondes sont remplacées par 300 secondes, et les textes attendus décrivent la réserve doublée. Ces adaptations du contrat produit sont à valider par Walid avant fusion, conformément à AGENTS.md. Un test dédié couvre la conversion des compteurs, les bonus, les réserves 5/10, les ouvertures individuelles et par lots, les accès Pro Stripe/manuels/expirés et les droits SQL.

Déploiement : appliquer la migration après coordination Discord et vérification de l'historique et du schéma réels, puis déployer l'application. Les RPC existantes lisent déjà le délai serveur et appliquent les plafonds de réserve.
