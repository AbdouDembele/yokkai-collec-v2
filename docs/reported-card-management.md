# Gestion d�une carte depuis un signalement

Le bouton � Manage card � de chaque signalement ouvre `/admin/cards/[id]`.
Le r�le admin est v�rifi� avant toute lecture. L�identifiant doit �tre un UUID
valide et la requ�te cible exactement cet identifiant, sans recherche par nom.

La page r�utilise `CardRow`, le formulaire existant d�administration : nouvelle
image par URL ou fichier, nom, cat�gories, licences et raret� ; suppression avec
la m�me confirmation et les m�mes cons�quences document�es pour les copies,
les ench�res et les �changes. Les actions rev�rifient le r�le c�t� serveur et
conservent leur journalisation. Aucun changement de droits SQL ni migration.

Un retour vers les signalements est propos�. Si la carte est d�j� supprim�e,
la page affiche un �tat explicite sans �diteur. Une modification ou suppression
r�actualise la page de carte et la liste des signalements. Les nouveaux libell�s
et m�tadonn�es figurent dans les catalogues anglais et fran�ais existants.
