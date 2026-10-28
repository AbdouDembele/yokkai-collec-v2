# Vérification locale manuelle (facultative)

`npm run verify` reste disponible pour un lancement manuel facultatif ; aucune CI complète locale n’est exigée avant un push ou un merge. Aucune PR mergée sans CI GitHub Actions verte sur la branche à jour avec origin/master. Lire `gh pr checks <PR>` pour vérifier les résultats sur le dernier commit.

Un échec local du téléchargement des polices Google pour cause réseau ne bloque ni le push ni l'ouverture de la PR. Exécuter les contrôles disponibles (formatage, lint, TypeScript, tests unitaires et hook pre-push), mentionner la limitation réseau dans la PR et attendre la CI GitHub Actions verte avant de déclarer la PR prête à merger.

La commande exécute audit prod (high), lint, TypeScript, format, tous les tests suivis par Git, build production, contrôle des routes design-system, puis le test existant de rejeu complet des migrations sur base vierge avec droits Supabase par défaut, SECURITY DEFINER et unicité des numéros. Le test de migration-security est exécuté une fois dans sa phase dédiée, sans être doublé dans la suite complète. Les fichiers locaux non suivis ne sont ni exécutés ni modifiés.

Le build reçoit uniquement une configuration publique factice, sans session joueur. Sur Windows, Next.js utilise Webpack pour le build de production (la version installée de Turbopack a un problème local de chargement des polices) ; sur Linux, le build habituel reste utilisé. Aucun fichier de police ou de configuration produit n’est changé.

Si Docker local répond, le script existant crée un conteneur PostgreSQL17.6.1.136 jetable sans port exposé et y rejoue toutes les migrations sous postgres NOSUPERUSER, puis exécute les50 surenchères croisées et les tests de clôture des écritures lors d’une suppression. Il retire seulement ce conteneur à la fin. Docker distant est refusé. Si Docker est absent/inaccessible : avertissement explicite « PostgreSQL17 et concurrence NON EXECUTES » et résumé « OK AVEC AVERTISSEMENT DOCKER » ; le test n’est jamais annoncé réussi. Avec Docker disponible, toute erreur échoue le verify.

Le hook pre-push bloque uniquement les pushes directs sur master : il ne lance ni verify:quick ni aucune suite de tests. Le pre-commit conserve uniquement le formatage.

Les scripts `npm run ci`, `npm run ci:db`, `npm run verify` et `npm run verify:quick` restent disponibles pour un lancement manuel, sans obligation. GitHub Actions exécute automatiquement ci.yml pour les PR vers master et les pushes sur master ; workflow_dispatch reste disponible.
