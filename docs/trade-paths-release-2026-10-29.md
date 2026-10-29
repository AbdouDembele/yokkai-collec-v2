# Correctif des parcours d'échange — 29 octobre 2026

Les liens ciblant une offre avec un ami ignoraient l'offre initiale. Les anciens liens de collection utilisaient parfois un pseudo là où le filtre attendait un UUID : les offres reçues devenaient invisibles. Le bouton Échanger attendait également la navigation serveur avant d'ouvrir sa fenêtre.

Le panneau résout désormais l'ami avant son filtrage, charge l'offre ciblée indépendamment des inventaires et ouvre immédiatement la fenêtre depuis les amis. Les deux inventaires sont enrichis en un seul lot. Les lectures des offres sont sérialisées et invalidées aux mutations pour qu'une ancienne réponse ne rétablisse pas Pending. Une réponse confirmée reste affichée même si son rafraîchissement échoue. Le refus SQL réussi (false) est normalisé pour les appelants ; une acceptation false reste un échec. Les doubles confirmations sont verrouillées. Un envoi échoué conserve son brouillon.

## Périmètre et sécurité

Aucune migration Supabase, aucun changement des règles d'autorisation, des transactions SQL, des lots, des droits ou des taux de drop. Audit production en lecture seule : 256 migrations, 353 offres dont 12 en attente ; aucune offre masquée par une limite de 100 pour un joueur. Aucun échange réel exécuté pour les vérifications.

## Reproduction et preuves

- Avant/après sur les mêmes fixtures : les liens offre + ami et les anciens liens pseudo échouaient avant le correctif et fonctionnent après. Les chemins notification seule et examen manuel fonctionnaient déjà.
- 53 tests ciblés, dont 8 nouveaux tests de comportement du panneau et de l'adaptateur. Aucun test existant modifié.
- Script reproductible : node scripts/prove-trade-paths.mjs avec le serveur local sur le port 3012. Adapters factices, aucune écriture joueur. Scénarios : notification, ami UUID/pseudo, acceptation, refus, contre-proposition, envoi, annulation, historique, rejet serveur, rafraîchissement échoué EN/FR et acceptation depuis les messages.
- Navigation simulée à 1,8 s et liste d'amis à 5 s : fenêtre/compositeur visibles en environ 100 ms dans la fixture. Ce chiffre n'est pas une mesure de latence production.
- Largeurs 320, 375, 768, 1024 et 1440 px vérifiées sans débordement ; acceptation possible à chacune. Mise en page équivalente à 200 % simulée à 720 CSS px / DPR 2 ; zoom natif du navigateur non vérifié (service de contrôle Windows indisponible).
- L'ancien script complet de messagerie atteint une erreur de fixture GIF sans rapport après son parcours trade. Le test ciblé d'acceptation depuis les messages passe séparément.

La CI complète est exécutée exclusivement sur GitHub Actions. Les fixtures du design system restent interdites en production par le garde existant.
