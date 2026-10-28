# Adaptation des contrats de tests d'inscription

PR de tests séparée, **validation de Walid requise avant fusion**.

Le propriétaire demande une acceptation explicite des conditions/règles à
l'inscription et l'interdiction des emojis dans les nouveaux pseudos. Il a confirmé
qu'il prévenait Walid pour la validation des adaptations de tests.

Cette PR ne change aucun code de production :

- Le contrat de palette prépare aussi le bleu **plus foncé** demandé ensuite par
  le propriétaire : boutons `#0d1728`, `#080f1c`, `#101b2e`. La sélection de l'accent
  verrouille toujours une famille complète de tokens ; aucun contrôle de rareté,
  de lisibilité ou d'image n'est supprimé. Changement produit validé avec le lot
  couleurs par le propriétaire, avec confirmation de Walid.

- Le formulaire valide des scénarios Auth existants inclut désormais le champ
  d'acceptation attendu par le prochain contrôle serveur.
- Les exemples de pseudos valides remplacent les emojis par des lettres Unicode :
  accents, écritures non latines et lettre hors BMP répétée 30 fois. Le comptage
  en points de code, les bornes et tous les caractères interdits déjà testés
  restent contrôlés.
- **Changement produit explicite** : les exemples `Yōkai 👺` et 30 emojis ne sont
  plus un contrat de validité. Les tests du code applicatif doivent imposer leur
  refus, ainsi que celui des drapeaux, modificateurs, séquences jointes et keycaps.
- Aucune assertion sur les erreurs, mots de passe, sessions, Captcha, disponibilité
  du pseudo ou confidentialité n'est retirée ni assouplie.

La version publiée prévue est `2026-10-20`. Le propriétaire a fourni le nom
d'éditeur « Yokkai Collec » et demande la publication sans mentions de brouillon.
La validation de Walid des changements de tests est confirmée par le propriétaire.

Ordre de revue : valider/fusionner ce contrat de tests, puis mettre à jour la PR
applicative depuis master et relancer sa CI. Aucun merge sans CI GitHub verte.

**Aucune migration Supabase ; aucune migration appliquée au VPS. Aucun déploiement.**
