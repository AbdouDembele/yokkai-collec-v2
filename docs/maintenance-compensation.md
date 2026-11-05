# Compensation maintenance du 5 novembre 2026

Chaque joueur actif existant au 5 novembre 2026 à 22:31:38 UTC reçoit 25 Regular Packs bonus et 1 Decision Pack bonus, sans expiration. Les comptes bannis ou supprimés au moment du crédit sont exclus. Aucun abonnement PRO n'est accordé.

La migration `20261105230000_maintenance_pack_compensation.sql` prépare le stock et les ouvertures ; elle ne crédite personne. Après CI verte, sauvegarde vérifiée et migration enregistrée, l'opérateur exécute `scripts/sql/grant-maintenance-20261105.sql`. Ce crédit est transactionnel et possède un reçu unique par joueur : un nouvel essai ne recrédite pas les packs consommés. La date limite d'inscription est fixe pour exclure les créations après l'annonce.

Les Regular Packs bonus sont consommés avant les autres bonus, sans déplacer l'échéance de la réserve temporisée. Leur provenance est enregistrée dans `regular_pack_openings`. Le Decision Pack bonus est consommé avant le quota quotidien ; reprendre un choix en attente ne consomme rien de plus. Les taux de tirage et les protections de compte restent inchangés.

Un pop-up à l'accueil informe les bénéficiaires après crédit. Sa fermeture est enregistrée côté serveur pour le seul compte connecté. Le reçu opérationnel et son état de consommation sont privés, disponibles pour revue manuelle des données du compte et exclus de l'export autonome existant.

Contrôler après exécution le nombre de reçus et les totaux crédités. Ne pas ouvrir les packs des joueurs pour vérifier. Une annulation après consommation nécessite une revue manuelle ; ne pas relancer une écriture soustrayant aveuglément 25 packs.

État initial : migration et crédit non appliqués en production.
