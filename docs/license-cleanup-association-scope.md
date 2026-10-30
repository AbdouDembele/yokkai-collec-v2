# Nettoyage des licences : portée exacte des associations

Une petite entrée de l'Excel peut déjà partager un classeur avec d'autres titres. Rediriger la clé de ce classeur déplacerait aussi des cartes hors du périmètre demandé. Les regroupements complets existants restent conservés ; une nouvelle règle exacte par couple catégorie/licence source peut diriger seulement l'association concernée.

La migration `20261029203000_association_scoped_binder_merges.sql` crée une table privée sous RLS. Les rôles anon et authenticated ne peuvent ni la lire ni l'écrire. Seul le rôle d'administration service_role possède les droits de maintenance. La vue existante applique la règle d'association en priorité, puis conserve son ancien comportement si aucune règle active ne correspond. Aucun nouveau RPC ni fonction security definer n'est ajouté.

La migration ne contient aucune décision éditoriale, aucun UUID de production, aucune suppression ni donnée de possession. La table est vide à son installation : les classeurs existants gardent exactement leur projection tant qu'aucune règle de maintenance n'y est ajoutée. Les fichiers Storage et les champs sources des cartes ne sont pas modifiés.

La recette opérationnelle privée doit vérifier les ensembles d'UUID attendus par association, les collisions, les cartes KEEP/MERGE protégées et les autres catégories. Les décisions DELETE validées sont traitées séparément avec sauvegarde cohérente, répétition de l'application et du rollback sur un clone isolé, gardes sur les séquestres et packs pending, et assertions avant COMMIT. Les nouvelles règles doivent aussi être restaurables indépendamment des données supprimées.

La migration n'est pas encore appliquée au VPS. Aucun nettoyage de production n'est exécuté par cette PR. La PR des fonctionnalités de classeurs reste séparée.

Le nouveau test couvre le classeur parent partagé, une autre catégorie portant le même nom source, les associations secondaires, le repli sur un ancien regroupement, un groupe désactivé et les droits des rôles joueurs. Aucun test existant n'est modifié.
