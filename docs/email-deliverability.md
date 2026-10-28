# Délivrabilité des e-mails Auth — diagnostic et procédure

État au 16 octobre 2026, base `origin/master` `8570de42`. Documentation seulement : aucune écriture DNS, Coolify, GoTrue, pare-feu ou base ; aucun e-mail envoyé. Les essais ci-dessous sont à autoriser et exécuter ultérieurement. Aucun secret SMTP n'a été consulté ou reproduit.

## Diagnostic réel

Lecture ciblée de l'environnement du conteneur Auth en production :

| Paramètre                   | Valeur observée                                           |
| --------------------------- | --------------------------------------------------------- |
| `GOTRUE_SMTP_HOST`          | `smtp.mail.ovh.net`                                       |
| `GOTRUE_SMTP_PORT`          | `587`                                                     |
| `GOTRUE_SMTP_ADMIN_EMAIL`   | `no-reply@yokkai-collec.com`                              |
| `GOTRUE_MAILER_AUTOCONFIRM` | `true`                                                    |
| Modèle confirmation         | `https://yokkai-collec.com/auth-emails/confirmation.html` |
| Modèle récupération         | `https://yokkai-collec.com/auth-emails/recovery.html`     |

Le fournisseur est **OVHcloud, offre MX Plan 1 (un compte)**, précisé par Walid pendant la mission. **DKIM est déjà actif selon le diagnostic OVH rapporté par Walid.** Aucune activation ni migration n'est à préparer. Le sélecteur et l'authentification du message reçu restent à recouper avec les en-têtes Gmail, non encore transmis dans le message de précision.

Limites officielles : **200 e-mails/heure/compte et 300 e-mails/heure/IP**, selon le [diagnostic SMTP OVH](https://docs.ovhcloud.com/en/guides/web-cloud/email-and-collaborative-solutions/troubleshooting/diagnostic-advanced). Le [guide SMTP automatisé](https://docs.ovhcloud.com/en/guides/web-cloud/web-hosting/mail-function-script-records) parle d'environ 200/h pour MX Plan ; le plafond IP peut être partagé avec d'autres expéditeurs. Ce sont des plafonds, pas un débit garanti ni une invitation à les tester. Le quota par IP du mutualisé ne doit pas être présenté comme un budget réservé au VPS. Avec un seul compte, le plafond de compte reste 200/h, tous usages confondus ; ne pas augmenter GoTrue dans cette mission.

Les paramètres `GOTRUE_RATE_LIMIT_EMAIL_SENT`, `GOTRUE_SMTP_MAX_FREQUENCY`, `GOTRUE_MAILER_OTP_EXP` ne sont pas explicitement présents. Les défauts de la version inventoriée dans [auth-hardening.md](auth-hardening.md) sont 30 e-mails/h, 60 secondes par adresse et 86400 secondes d'expiration. Ne pas confondre quota GoTrue et quota contractuel OVH.

Le reset anglais reçu est une preuve fournie par Walid, pas un nouvel essai de cette mission. Une réception seule ne démontre pas SPF/DKIM/DMARC ; aucun original ni premier message réel de confirmation n'a été inspecté ici. Le document `english-auth-emails.md` décrit encore l'état antérieur du 15 octobre : les URLs de modèles ci-dessus sont désormais définies.

## DNS constaté

Requêtes publiques via `1.1.1.1` ; SPF OVH recoupé via `8.8.8.8`. TTL observé à la racine : 300 s. Serveurs autoritatifs : `bella.ns.cloudflare.com`, `dax.ns.cloudflare.com`.

| Nom / type                                            | Réponse                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `yokkai-collec.com` TXT SPF                           | `v=spf1 include:mx.ovh.com -all` — **un seul** enregistrement SPF                           |
| Autre TXT racine                                      | `1\|www.yokkai-collec.com` — n'est pas un second SPF                                        |
| `mx.ovh.com` TXT                                      | `v=spf1 ptr:mail-out.ovh.net ptr:mail.ovh.net ip4:8.33.137.105/32 ip4:192.99.77.81/32 ?all` |
| `_dmarc.yokkai-collec.com` TXT                        | NXDOMAIN : **absent**                                                                       |
| `ovhmo-selector-1._domainkey.yokkai-collec.com` CNAME | NXDOMAIN                                                                                    |
| `ovhmo-selector-2._domainkey.yokkai-collec.com` CNAME | NXDOMAIN                                                                                    |
| MX racine, priorité 1                                 | `mx1.mail.ovh.net`                                                                          |
| MX racine, priorité 5                                 | `mx2.mail.ovh.net`                                                                          |
| MX racine, priorité 100                               | `mx3.mail.ovh.net`                                                                          |

SPF : syntaxe cohérente, pas de boucle ni d'autre include/redirect dans l'expansion observée. Au maximum **3 mécanismes consommant le budget DNS** : un include et deux ptr, sous la limite de 10. Ce budget ne désigne pas le nombre brut de paquets DNS : les PTR ont aussi leurs propres bornes de validation directe. Les ip4 et all ne consomment pas ce budget. `ptr` est déconseillé par la RFC mais appartient ici au SPF maintenu par OVH ; ne pas aplatir ses IP à la main. Le `?all` de l'include ne donne pas PASS aux autres sources : elles atteignent le `-all` du domaine. Aucun PASS pour un message réel n'est démontré sans son IP d'envoi et son MAIL FROM.

**DKIM actif selon le diagnostic OVH communiqué par Walid ; PASS Gmail et sélecteur exact encore à relever.** Le sélecteur propre à ce service n'a pas été obtenu. DNS ne fournit pas de liste publique exhaustive des sélecteurs ; tester des noms génériques n'est pas une découverte fiable.

## Sélecteur DKIM : relever, ne pas activer

La [documentation officielle OVH DKIM](https://docs.ovhcloud.com/en/guides/web-cloud/domains/dns-zone-dkim) montre pour MX Plan la forme `ovhmo…-selector1` / `ovhmo…-selector2`, avec un identifiant propre au service. Les noms génériques testés plus haut ne correspondent donc pas nécessairement à ses clés.

Lire `s=` et `d=` dans la signature du vrai message Gmail fourni par Walid, puis interroger TXT et CNAME à `s._domainkey.d`. Pour la seconde clé de rotation, lire uniquement le diagnostic OVH ou `GET /email/domain/yokkai-collec.com/dkim`. Aucun appel d'activation, génération ou changement de sélecteur. Si DKIM est actif et les CNAME corrects, **aucun ajout DKIM n'est nécessaire**. Les valeurs exactes non obtenues restent à relever ; ne pas inventer les cibles à partir de la documentation.

## DNS Cloudflare à préparer, sans l'appliquer

Dans la zone `yokkai-collec.com`, les noms ci-dessous sont relatifs. TTL cible : 300 s. Tous les enregistrements de messagerie sont DNS only : proxy désactivé pour les CNAME ; TXT/MX n'ont pas de proxy. Conserver les MX existants, ne pas ajouter un second SPF.

| Action                                         | Type  | Nom                                            | Valeur                                                                  |
| ---------------------------------------------- | ----- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| Conserver                                      | TXT   | `@`                                            | `v=spf1 include:mx.ovh.com -all`                                        |
| Créer après validation de la boîte de rapports | TXT   | `_dmarc`                                       | `v=DMARC1; p=none; rua=mailto:dmarc@yokkai-collec.com; adkim=r; aspf=r` |
| Contrôler uniquement depuis OVH                | CNAME | Nom exact du sélecteur 1, sans suffixe de zone | Cible exacte retournée par OVH                                          |
| Contrôler uniquement depuis OVH                | CNAME | Nom exact du sélecteur 2, sans suffixe de zone | Cible exacte retournée par OVH                                          |

`dmarc@yokkai-collec.com` est l'adresse de rapports proposée **dans notre domaine**, à configurer comme redirection OVH vers la boîte de suivi choisie. Ne pas créer un deuxième compte payant MX Plan 1 pour cet usage et ne pas mettre une adresse Gmail dans `rua`. Valider la réception de cette redirection avant publication ; sa création n'est pas effectuée ici. Les rapports agrégés peuvent contenir des adresses IP et nécessitent un accès limité ; aucun rapport brut dans Git.

Calendrier proposé, relatif à J0 = publication autorisée avec boîte fonctionnelle :

- J0–J14 : `p=none`, analyser les rapports chaque jour et inventorier tous les expéditeurs légitimes du domaine.
- Au plus tôt J15 : si tous les flux légitimes sont alignés et aucune anomalie inexpliquée ne subsiste, remplacer uniquement `p=none` par `p=quarantine`.
- Au plus tôt J29, après 14 jours stables : remplacer par `p=reject` avec les mêmes paramètres. Sinon prolonger l'observation ; le calendrier n'est pas une bascule automatique.
- En cas de messages légitimes affectés : revenir immédiatement à `p=none`, conserver les signatures et corriger le flux fautif. Attendre la propagation DNS ; ce retour n'est pas instantané chez tous les destinataires.

## Alignement et preuve de réception

Comparer le domaine du `From:` visible (`yokkai-collec.com`) au `smtp.mailfrom` / Return-Path pour SPF, et au `d=` de `DKIM-Signature` pour DKIM. Avec `aspf=r; adkim=r`, un sous-domaine du même domaine organisationnel est aligné. Une signature `d=ovh.net` ne serait pas alignée. Lire `s=` puis résoudre TXT/CNAME à `s._domainkey.d` ; vérifier aussi la seconde clé destinée à la rotation.

DMARC requiert au moins un PASS **aligné** (SPF ou DKIM) ; notre critère d'acceptation est plus exigeant : **SPF, DKIM et DMARC tous PASS** et signature DKIM alignée. Ne pas déduire DMARC de trois enregistrements DNS présents. Voir [RFC SPF, limites DNS](https://www.rfc-editor.org/rfc/rfc7208#section-4.6.4) et [RFC DMARC, alignement](https://www.rfc-editor.org/rfc/rfc7489#section-3.1).

Test ultérieur borné, aucun envoi pendant cette mission :

1. Après validation DKIM et publication DMARC autorisées, envoyer un seul reset vers une boîte Gmail de test contrôlée déjà associée à un compte autorisé. Cela teste le transport sans désactiver autoconfirm en production.
2. Gmail → message → menu à trois points → **Afficher l'original**. Relever date, SPF PASS avec smtp.mailfrom, DKIM PASS avec d=/s=, DMARC PASS avec header.from, et réception inbox/spam. Conserver uniquement ces résultats expurgés, jamais l'original complet contenant lien/jeton, destinataire ou identifiants de message.
3. Pour prouver le parcours confirmation, créer d'abord un environnement Auth **isolé** : le projet n'en possède pas actuellement. Après autorisation, y mettre `GOTRUE_MAILER_AUTOCONFIRM=false`, recréer Auth et s'inscrire avec une adresse Gmail jetable contrôlée. Ne pas simplement pointer un environnement Next de test sur la base Auth de production.
4. Vérifier attente, renvoi après 60 s, lien, session et arrivée sur `/`. Tester aussi expiration/réemploi, et erreur temporaire distincte. Vérifier dans ce message les trois PASS comme au point 2. La réussite du reset ne remplace pas ce test du premier e-mail de confirmation.
5. Conserver autoconfirm=true en production tant que livraison ET parcours confirmation ne sont pas prouvés. Une future bascule de production doit être autorisée séparément, puis contrôlée avec un seul nouveau compte de test.

Retour arrière d'une future bascule : remettre **`GOTRUE_MAILER_AUTOCONFIRM=true` via la variable Coolify correspondante**, puis recréer Auth (un restart seul ne recharge pas l'environnement Docker) et contrôler l'inscription. Ne toucher ni DNS ni comptes existants pour ce retour. Cela ne confirme pas rétroactivement les comptes créés en attente : prévoir leur renvoi/confirmation et l'assistance, sans modification massive de la base. Ne pas supprimer les comptes de test sans autorisation.

## Code : parcours présent, validation réelle manquante

Inspection statique sur la base ci-dessus ; aucun changement applicatif et aucun test réel effectué.

| Étape                              | Chemin et comportement                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inscription sans session           | `app/auth/actions.ts`, `signUp` : transmet pseudo et redirection publique ; si GoTrue renvoie session=null, retourne success + retryAfter=60 plutôt que rediriger vers le jeu                                |
| Attente                            | `components/auth-form.tsx` : **Check your inbox**, spam, lien de connexion, renvoi prérempli ; message volontairement neutre                                                                                 |
| Renvoi                             | `components/confirmation-resend-form.tsx` + `resendConfirmation` : `type=signup`, délai visuel 60 s après inscription/envoi/erreur, captcha si configuré, erreurs SMTP/quota exposées sans détails sensibles |
| Connexion avant confirmation       | `lib/auth/forms.ts` : **Confirm your email address before signing in.** ; renvoi accessible sur la page login                                                                                                |
| Validation                         | `app/auth/confirm/route.ts` : accepte token_hash + type signup/email ou code PKCE, établit la session et redirige sur `/` ; récupération vers `/reset-password`                                              |
| Lien expiré, invalide ou réutilisé | redirection `/login?confirmation=erreur` ; message anglais explicite, formulaire de renvoi disponible ; panne serveur séparée via `confirmation=service`                                                     |
| Modèle                             | `public/auth-emails/confirmation.html` utilise `/auth/confirm` et le hash ; modèle anglais configuré dans Auth, réception non prouvée                                                                        |

**Aucun maillon requis manquant identifié dans le code lu.** Restent bloquants : premier envoi réel de confirmation et preuve DNS/alignement, environnement isolé. Le quota OVH documenté est connu mais le budget restant partagé n'a pas été mesuré. Le délai UI est fixé à 60 s, pas synchronisé sur un futur réglage serveur : si celui-ci augmente, l'interface permettra une tentative encore refusée côté GoTrue. Le compteur navigateur est contournable ; il n'est pas une protection serveur. Le quota effectif et les protections IP restent à valider selon `auth-hardening.md`. Un lien PKCE par défaut peut dépendre du navigateur d'origine ; tester le modèle token_hash configuré aussi sur un autre appareil.

Pour le joueur : plus d'accès immédiat après inscription, attente de l'e-mail et vérification des spams ; renvoi avec délai et possibles refus temporaires ; clic obligatoire pour ouvrir la session ; nouveau lien si expiré. Les comptes déjà confirmés et leurs sessions ne sont pas rétroactivement soumis à confirmation ; autoconfirm historique ne prouve pas la possession de leurs boîtes et aucune mise à jour de ces comptes n'est proposée.

## Décisions attendues de Walid

1. Transmettre les résultats Gmail expurgés (Authentication-Results, Received-SPF, d=/s=) pour prouver le PASS et relever le sélecteur exact, puis les CNAME publics du diagnostic OVH si nécessaires. Offre MX Plan 1 et DKIM actif déjà confirmés par Walid ; aucune activation à demander.
2. Vers quelle boîte de suivi rediriger `dmarc@yokkai-collec.com` via OVH ? Le rua restera dans notre domaine.
3. Quel environnement Auth isolé utiliser et quand autoriser les essais bornés ?
4. Valider séparément le [plan de fermeture de l'origine](origin-access-plan.md), notamment accès de secours et maintenance des certificats.
