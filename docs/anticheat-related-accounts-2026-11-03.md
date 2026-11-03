# Vue commune des comptes liés

La préparation d’une sanction présente les comptes existants, bannis et
supprimés dans une même liste recherchable. Les deux onglets de type de compte
et le sélecteur natif de destinataire sont supprimés. Les anciens liens avec
`mode=active` ou `mode=deleted` restent acceptés pour les aperçus existants.

Chaque fiche contient le pseudo, l’e-mail autorisé, les statuts du compte et de
la sanction, le nombre d’échanges acceptés et de ventes finalisées, les volumes
de cartes/Karas dans chaque sens par rapport au dossier, ainsi que les
rapprochements réseau/navigateur observés sur les sept derniers jours. Les
volumes historiques ne sont pas présentés comme les gains récupérables.

Un compte existant s’examine individuellement. La récupération groupée de
jusqu’à 20 comptes supprimés reste disponible. Les fonctions d’application,
leurs confirmations de rôles, les notes obligatoires, les aperçus et les
verrous contre les doubles récupérations restent inchangés. L’interface ne
qualifie pas automatiquement les comptes liés de smurfs avérés.

Le filtre d’archives complètes conserve la recherche d’anciens comptes sans
lien économique connu. Ces archives ne sont sélectionnables que si les règles
existantes trouvent des transferts traçables non traités avec le principal.
Les comptes partageant seulement un réseau ou un navigateur sont consultables
comme contexte. Une suppression en cours ne peut pas devenir une récupération
sur un compte encore en cours de clôture.

Le choix d’un principal vivant pour un dossier déjà supprimé redirige vers le
parcours de récupération historique, avec les UUID dans le bon sens : le
compte survivant devient le principal et le dossier supprimé devient la source.

## Migration et droits

`20261103210000_anticheat_related_accounts.sql` ajoute un seul lecteur admin :
`admin_list_anticheat_related_accounts(uuid,text,text,integer,integer)`.
Il est `STABLE`, limité à 50 résultats par page, avec filtre et pagination en
base. Son droit `authenticated` est suivi des contrôles ban/admin existants.
Les rôles `anon` et `service_role` ne peuvent pas l’exécuter. Il ne renvoie
aucune IP, empreinte réseau ni jeton navigateur. Les identités archivées ne
sont lisibles que dans leur fenêtre de conservation de 90 jours.

Les transferts courants et archivés sont dédupliqués par type/UUID avant leur
agrégation. Le lecteur remplace les anciens appels de liste dans le parcours ;
il ne modifie aucune fonction de sanction et ne crée aucune sanction.

Walid a validé dans le chat l’ajout exact à l’allowlist SQL stricte et
l’extension de la fixture d’interface. Les assertions existantes de rôles,
confirmation, destinations et conséquences restent conservées ; des assertions
supplémentaires exigent la liste mixte et l’absence du sélecteur natif/onglets.
L’équipe a confirmé être prévenue sur Discord et qu’aucune autre intervention
SQL n’est en cours. La PR indique l’état réel d’application sur le VPS.

## Vérifications

Les tests dédiés vérifient les comptes actifs/bannis/supprimés, les liens
économiques et de contexte, les deux sens des volumes, les doublons
courant/archive, la recherche, la pagination, les droits, l’expiration des
identités et la consultation sans mutation. Les tests de sanctions et de
confirmations existants restent passants.

La simulation `/design-system/related-accounts-preview` emploie le vrai
composant de liste avec des données fictives, sans sanction réelle. Les tests
navigateur redirigent uniquement les GET locaux de navigation vers cette
simulation : choix de source supprimée, aperçu, pagination, recherche, choix
d’un compte existant et conservation correcte des paramètres. Aucun POST de
sanction n’est effectué. La simulation reste bloquée en production.

Responsive : 320, 375, 768, 1024 et 1440 px, ainsi que 1024 et 1440 px au zoom
200 %, dans Chrome en EN/FR. Les e-mails et pseudos longs restent lisibles sans
débordement horizontal.
