# Home : intérêt des joueurs et activité des amis

Le Market du Home affiche les six enchères qui intéressent le plus de joueurs
distincts : une personne ayant misé et/ou suivant l'enchère compte une seule
fois. Le vendeur ne compte pas. Le prix, les favoris importés du catalogue et
la rareté n'ajoutent aucun point. La fin la plus proche départage les égalités.
La sélection initiale et son actualisation après expiration utilisent le même
tri SQL avant la limite de six. Le Market complet conserve la priorité des
enchères suivies par le joueur.

Les amis acceptés sont triés avant pagination : connectés en premier, puis
dernière activité décroissante, puis pseudo et identifiant pour départager les
égalités. Une présence active datant de plus de dix minutes est considérée
hors ligne, comme auparavant. Les amis sans activité connue viennent en
dernier. Les demandes reçues et envoyées gardent leur ordre chronologique et
ne dévoilent aucune donnée de présence.

À l'ouverture de Friends, l'onglet My friends est sélectionné par défaut.

Migration : `20261028170000_home_interest_friend_activity.sql`. Elle remplace
trois définitions existantes sans nouveau droit, table ni changement de donnée.
Elle n'est pas appliquée en production lors de la préparation de cette PR.
