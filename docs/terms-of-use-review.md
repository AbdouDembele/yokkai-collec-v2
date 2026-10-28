# Conditions et inscription — publication du 20 octobre 2026

Le propriétaire demande la publication des conditions et la suppression des
mentions de prévisualisation. Nom d'éditeur fourni : **Yokkai Collec**.
Contact confirmé : `yokkaicollec@gmail.com`. Version et date d'effet : `2026-10-20`.
La validation de Walid des changements de tests #403 et #405 est confirmée par le
propriétaire. Aucun avis ou certificat de conformité juridique n'est affirmé.

## Périmètre

- Route publique anglaise `/terms`, lien dans le footer partagé, fond bleu nuit.
- Conditions couvrant comptes, mineurs sans interdiction générale, règles,
  objets virtuels, échanges, contenus, abonnements, droits impératifs et contact.
- Acceptation explicite obligatoire lors de l'inscription : case décochée par
  défaut, liens accessibles, contrôle serveur avant tout appel Supabase.
- Pseudos sans emojis ; accents, chiffres, espaces et écritures non latines
  conservés. Aucun renommage ni blocage de connexion des comptes existants.
- Pas de mention de brouillon visible ; métadonnées de publication indexables.

## Limites à conserver dans l'exploitation

- Le nom de l'éditeur est celui fourni par le propriétaire. Ne pas inventer une
  forme sociale, une adresse, un numéro d'immatriculation ou une juridiction.
- Une case de conditions n'est ni une autorisation parentale, ni un consentement
  RGPD. La page ne remplace pas les mécanismes réellement requis pour le service.
- Le contrôle couvre les Server Actions du site, pas l'API Supabase Auth directe.
- La version et l'heure serveur sont envoyées en métadonnées Auth `signup_policies`.
  Ces métadonnées sont modifiables par l'utilisateur : **pas un registre immuable**.
  Un verrouillage global de l'API ou un registre fiable requerrait une évolution
  serveur/SQL séparée, revue et coordonnée.
- Les informations de confidentialité, droits de tiers et obligations propres à
  l'éditeur restent à suivre indépendamment. Aucun faux lien `/privacy` n'est créé.
- Les protections consommateurs ne sont pas supprimées : pas de renonciation
  automatique à la rétractation ni de clause générale « aucun remboursement ».

## Sources de préparation

- [WikiMasters — structure seulement](https://www.wiki-masters.com/terms).
- [CNIL — capacité d'agir des mineurs](https://cnil.fr/fr/recommandation-1-encadrer-la-capacite-dagir-des-mineurs-en-ligne).
- [CNIL — consentement parental](https://cnil.fr/fr/recommandation-4-rechercher-le-consentement-dun-parent-pour-les-mineurs-de-moins-de-15-ans).
- [CNIL — âge et accord parental](https://cnil.fr/fr/recommandation-7-verifier-lage-de-lenfant-et-laccord-des-parents-dans-le-respect-de-sa-vie-privee).
- [Union européenne — achats à distance](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_en.htm).
- [Union européenne — rétractation](https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm).

Ces ressources ne remplacent pas un avis juridique adapté au service.

**Aucune migration Supabase. Aucune migration appliquée au VPS pour ce lot.**
