# Routes anglaises — wz/en-routes

## Mapping livré

Base initiale : origin/master 8eac19b9, après #275 et #276 ; rebase sur 3edea27d incluant #279/#281/#282. Leurs ajouts de bannières et animations sont conservés. Inventaire historique : [english-migration.md, section 9](english-migration.md#9-toutes-les-routes-actuelles-et-propositions). Les paramètres dynamiques et identifiants restent identiques. 13 dossiers renommés, **16 routes** concernées ; aucune redirection ni alias vers les anciens chemins.

| Ancienne route               | Nouvelle route             | Fichier actuel                         |
| ---------------------------- | -------------------------- | -------------------------------------- |
| /connexion                   | /login                     | app/(auth)/login/page.tsx              |
| /inscription                 | /signup                    | app/(auth)/signup/page.tsx             |
| /mot-de-passe-oublie         | /forgot-password           | app/(auth)/forgot-password/page.tsx    |
| /amis                        | /friends                   | app/friends/page.tsx                   |
| /compte-supprime             | /account-deleted           | app/account-deleted/page.tsx           |
| /echanges                    | /trades                    | app/trades/page.tsx                    |
| /marche                      | /market                    | app/market/page.tsx                    |
| /marche/[id]                 | /market/[id]               | app/market/[id]/page.tsx               |
| /parametres                  | /settings                  | app/settings/page.tsx                  |
| /partage/[id]                | /share/[id]                | app/share/[id]/page.tsx                |
| /partage/[id]/image/[format] | /share/[id]/image/[format] | app/share/[id]/image/[format]/route.ts |
| /profil                      | /profile                   | app/profile/page.tsx                   |
| /profil/[id]                 | /profile/[id]              | app/profile/[id]/page.tsx              |
| /recherche                   | /catalog                   | app/catalog/page.tsx                   |
| /reinitialiser-mot-de-passe  | /reset-password            | app/reset-password/page.tsx            |
| /succes                      | /achievements              | app/achievements/page.tsx              |

Choix de nom : **signup** (au lieu de sign-up proposé initialement, conformément à l’exemple validé), **catalog** (plutôt que catalogue/search, cohérent avec les libellés du produit). /boosters est déjà un chemin anglais et reste inchangé ; pas de nouvelle route /packs. /, /collection, /wishlist, /auth/confirm, /api/data-export et /api/profile-wall/media/[id] restent stables. Toutes les routes admin et design-system restent stables, notamment /design-system/catalogue-preview et /design-system/market-preview/enchere. Aucune page légale créée : aucun contenu/placeholder reçu dans cette mission.

Les clés de query string restent techniques et inchangées : carte, ami, offre, edition, mot-de-passe, lien, confirmation, ainsi que les codes erreur/service/modifie. Le fragment chat-enchere reste identique. Seules les valeurs de chemins changent, y compris next=/reset-password. Les noms de modules métier profile, catalogue, les RPC, enums et clés de stockage ne sont pas renommés.

## Références mises à jour

Liens Link/href, redirections et imports de routes, revalidatePath, liens de profil/catalogue/enchères/échanges, onglets et notifications dans Topbar, liens de partage et images OG/story/square, proxy public du partage, sitemap, scripts et documentation opératoire. Les liens vers les routes joueur depuis les composants admin/preview sont actualisés, sans changer leurs propres chemins de route.

Les deux fichiers public/auth-emails/_.html utilisent déjà ConfirmationURL : ils restent inchangés, comme leurs URLs et variables MAILER__. Le code Auth construit toujours /auth/confirm pour la confirmation ; le retour de récupération devient /auth/confirm?next=/reset-password. Aucun hôte, template GoTrue, délai, token ou contrôle de sécurité modifié.

/share est exclu du sitemap et interdit dans robots.txt. Ses métadonnées gardent robots index=false/follow=false ; canonical, og:url et l’image OG utilisent /share/[id]. Un en-tête X-Robots-Tag: noindex, nofollow couvre /share/:path*, images et 404 comprises. Le proxy conserve l’accès public sans rafraîchissement de session pour les mêmes identifiants opaques et formats d’image.

## Recherche en base (lecture seule)

Instance : **Supabase auto-hébergé sur yokkai-vps**, conteneur supabase-db-gawq4yyxiise96wens0dt1ex, base postgres ; pas Supabase Cloud. Audit du 16 octobre 2026, transaction READ ONLY puis ROLLBACK, uniquement schéma et décomptes ; aucune identité ni contenu joueur affiché.

- notifications contient id, user_id, type, reference_id, read_at, created_at, achievement_id, actor_user_id : **aucune colonne URL/chemin**. list_notifications renvoie les références ; notificationItem construit les nouveaux chemins à l’affichage. Les anciennes notifications bénéficient donc des nouveaux liens sans UPDATE.
- card_shares stocke un identifiant opaque et une URL d’illustration, pas une URL /partage ; cardShareUrl reconstruit /share avec le même identifiant. Les liens déjà copiés hors du site restent anciens et peuvent casser, comme décidé.
- account_deletion_log et card_share_creations n’ont aucun champ URL/chemin.
- **25 colonnes texte/JSON contrôlées, zéro ligne contenant un ancien préfixe de route** : admin_audit_logs (action, card_snapshot, metadata), auctions.card_snapshot, card_reports.snapshot, trade_offers (offered_cards_snapshot, requested_cards_snapshot), user_reports.snapshot, notifications (type, achievement_id), card_shares (id, card_name, franchise, display_pseudo, catalogue_image_url), cards.image_url, user_cards.custom_image_url, auction_chat_messages.gif_url, profile_wall_posts (media_path, gif_url), user_profiles (avatar_url, banner_url, banner_frame, interests, profile_widgets).
- Les bios et corps de chat/publications ne sont pas audités ni réécrits : contenu créé par les joueurs. La recherche des préfixes porte sur les emplacements structurels ci-dessus, pas sur toute la prose utilisateur.

### Proposition de migration séparée des notifications — non applicable actuellement

**Aucun fichier de migration ajouté.** Il n’existe pas de colonne de lien à réécrire dans le schéma constaté. Ne pas inventer un champ href ni modifier type/reference_id. Si une autre instance ou un futur schéma stocke effectivement des liens, suspendre cette partie et préparer une PR séparée après inventaire exact : champ constaté, décompte par ancien préfixe, UPDATE idempotent ciblant seulement les liens système (chemin complet, conservation query/fragment/identifiant), backup id→ancienne URL et rollback de ces valeurs. Ne jamais faire un replace global dans les messages/snapshots de joueurs. Cette proposition n’est ni une migration exécutable ni une migration appliquée.

## Configuration externe observée et points à vérifier par Walid

Lecture seule de GoTrue au 16 octobre 2026 :

| Réglage                               | Valeur active sans secret    | Source réelle                                                       |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| Site URL / GOTRUE_SITE_URL            | https://yokkai-collec.com/   | valeur explicite dans le docker-compose Coolify et conteneur Auth   |
| Redirect URLs / GOTRUE_URI_ALLOW_LIST | https://yokkai-collec.com/** | variable Coolify ADDITIONAL_REDIRECT_URLS, transmise par le compose |

Fichiers de la stack : /data/coolify/services/gawq4yyxiise96wens0dt1ex/.env et docker-compose.yml. **Ne pas les éditer dans cette PR.** Passer par l’interface Coolify lors de l’intervention autorisée. Le wildcard actif couvre déjà les deux chemins ; il n’est ni supprimé ni resserré ici. La [documentation Supabase](https://supabase.com/docs/guides/auth/redirect-urls) distingue Site URL et allowlist et décrit ces wildcards.

**Chemins externes anciens constatés :** /opt/yokkai-ops/current/ops/storage_maintenance.py:263 contrôle encore /connexion et /inscription sur le VPS ; release active /opt/yokkai-ops/revisions/1f5163ef85568928b35263632f93695fc83986cb. La version suivie dans cette PR contrôle désormais /login et /signup, mais la copie installée n’est pas modifiée. Walid devra coordonner sa mise à jour avec la bascule applicative ; ne pas lancer le contrôle aux nouvelles URLs avant que l’application soit disponible. Le timer ne doit pas déclencher une intervention sur la seule disparition prévue des anciennes routes. Préparer cette mise à jour et sa restauration avant le déploiement, sans la réaliser ici.

Aucune liste complète des règles Cloudflare/Turnstile/Search Console/liens externes n’est accessible dans cette session. Ne pas en deviner les valeurs ; Walid doit relever toute référence d’ancien format et la valider avant la bascule.

- Supabase auto-hébergé / GoTrue : Site URL reste https://yokkai-collec.com/ ; vérifier Redirect URLs dans la stack active. Un éventuel dashboard Supabase Cloud n’est pas l’instance à modifier pour ce site.
- Turnstile : vérifier yokkai-collec.com dans les hôtes autorisés ; les hôtes n’incluent pas de chemin selon la [documentation Cloudflare](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/). Si une règle WAF/challenge séparée cible /connexion ou /inscription, la relever et l’adapter à /login et /signup au déploiement. Aucun sitekey/secret modifié.
- Cloudflare : règles WAF, cache/bypass, Workers, Page Rules, Transform Rules mentionnant les anciens chemins ; vérifier surtout Auth, /share/* et ses images. Purger les réponses HTML/caches de navigation concernés au déploiement autorisé. Ne pas mettre en cache une session ou une action Auth.
- Search Console : soumettre de nouveau /sitemap.xml et vérifier ses nouvelles URLs publiques. Ne pas soumettre /share ; noindex reste actif. Mettre à jour les liens externes contrôlés (site, réseaux, favoris, messages épinglés), sans promettre de redirection des liens copiés auparavant.

## Ordre de déploiement (à exécuter par Walid sur signal)

### Avant l’application

1. Sauvegarder les seules valeurs de configuration concernées et le tag de l’image application précédente ; aucune migration requise. Relever les éventuelles règles externes mentionnant les anciens chemins.
2. Dans Coolify, **ADDITIONAL_REDIRECT_URLS → GOTRUE_URI_ALLOW_LIST**, conserver toutes les entrées actuelles et l’ancienne URL de récupération, et ajouter la nouvelle URL ci-dessous avant de déployer l’application. Si l’ancienne entrée n’est représentée que par le wildcard actuellement actif, garder ce wildcard et noter que les deux URLs y sont déjà autorisées ; des entrées explicites peuvent être ajoutées sans le retirer.

   Ancienne récupération : https://yokkai-collec.com/auth/confirm?next=/reinitialiser-mot-de-passe

   Nouvelle récupération : **https://yokkai-collec.com/auth/confirm?next=/reset-password**

   Confirmation/renvoi : https://yokkai-collec.com/auth/confirm (inchangée).

3. **Redéployer Auth uniquement**, attendre son état sain et vérifier la valeur effective de GOTRUE_URI_ALLOW_LIST sans exposer d’autre variable. Un restart seul ne recharge pas la configuration du conteneur. Site URL et les quatre variables MAILER_* restent inchangées.
4. Confirmer les règles externes et l’allowlist préparées. **Seulement alors**, autoriser le merge/déploiement de l’application wz/en-routes. Cette PR ne déploie rien elle-même.

### Après l’application

1. Vérifier les nouveaux chemins, le 404 des anciens chemins (aucune redirection attendue), noindex du partage et les parcours ci-dessous.
2. Conserver l’ancienne entrée Auth jusqu’à expiration des liens déjà envoyés, d’après les durées réelles de cette instance et la dernière émission avant bascule. Ne pas inventer un délai. Les anciens liens d’interface/partage peuvent casser ; un ancien e-mail de récupération peut nécessiter une nouvelle demande après la bascule.
3. Après tests et fin de cette fenêtre, retirer l’ancienne entrée explicite, puis redéployer Auth uniquement. La retirer ne la bloque pas tant que le wildcard historique reste actif : son resserrement éventuel relève d’un changement de sécurité séparé, à valider par Walid.

## Plan de test au déploiement

Sur un compte jetable approuvé et une boîte contrôlée par Walid :

1. /signup → inscription → e-mail anglais → /auth/confirm → session/accueil. Renvoi de confirmation aussi ; lien expiré affiche une erreur sûre à /login?confirmation=… .
2. /login → connexion et déconnexion, retour /login ; refus d’une destination next externe conservé.
3. /forgot-password → réception du mail → GoTrue → /auth/confirm?next=/reset-password → /reset-password ; définir le nouveau mot de passe, vérifier connexion avec celui-ci et contre-test ancien mot de passe. Lien expiré vers /forgot-password?lien=… .
4. Créer un partage depuis une carte possédée : URL /share/[id], ouvrir hors session, contrôler canonical/OG/PNG story/square, noindex. Supprimer le partage puis contre-test 404, sans assouplir le cache ni les contrôles des images.
5. Ouvrir le panneau des notifications existantes : amis → /friends, échanges → /trades?offre=…, enchère → /market/[id], succès → /achievements#…. Aucun UPDATE requis.
6. Ouvrir une enchère et son lien #chat-enchere, voir la carte dans /catalog?carte=…, son propriétaire dans /profile/[id], puis collection/profil/paramètres.
7. Admin et design-system : routes conservées ; design-system toujours 404 en production.

## Retour arrière

Suspendre la bascule si Auth ne redémarre pas sainement ou si l’allowlist/règle externe n’est pas vérifiée ; l’ancienne application reste servie. Après bascule, remettre l’image application précédente (master avant cette PR), revenir aux règles/cache externes sauvegardés, conserver les deux entrées Auth pendant le retour puis restaurer la valeur exacte sauvegardée d’ADDITIONAL_REDIRECT_URLS et recréer Auth si nécessaire. Site URL et MAILER_* n’ont pas changé. Aucun rollback SQL, aucune donnée à restaurer. Les liens /share ou /reset-password envoyés pendant la nouvelle version peuvent demander une nouvelle émission après rollback ; aucune redirection n’est ajoutée.

## Preuves et grep

Parcours E2E réels dans le navigateur sur Next local (localhost:3002) et une API Auth/partage simulée isolée :

- /signup → formulaire soumis → « Check your inbox » ; callback envoyé à /auth/confirm ; retour de confirmation token-hash → accueil avec session.
- Déconnexion → /login ; connexion via le formulaire → accueil avec session.
- /forgot-password → demande de récupération → « Check your inbox » ; callback observé exactement /auth/confirm?next=/reset-password ; retour recovery → /reset-password et formulaire « Choose a new password ».
- Contre-test sans session avec token expiré → /forgot-password?lien=erreur et message anglais sûr. Aucun nouveau mot de passe réel défini, aucun SMTP/boîte/CAPTCHA de production testé ; ces contrôles restent dans la recette autorisée par Walid au déploiement.
- Depuis la collection, création du lien → /share/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ; ouverture après déconnexion → carte publique et lien /signup. canonical, og:url et image OG sous /share, robots noindex/nofollow observés dans le DOM.
- Les trois images sans pseudo (og, story, square) répondent **200 image/png** ; X-Robots-Tag noindex/nofollow présent. Les anciens /connexion et /partage/[id] répondent **404 sans redirection** en HTTP local. sitemap.xml contient accueil/login/signup et robots.txt exclut /share/.

**Défaut préexistant relevé hors périmètre :** avec un pseudo affiché, le moteur PNG inchangé renvoie 204 ; diagnostic reproduit : Satori exige display explicite sur le div à plusieurs enfants du bloc « Shared by … » (lib/server/card-share-image.tsx, bloc card.pseudo). Ce fichier et le gestionnaire/cache de rendu sont strictement identiques à origin/master. Le partage sans pseudo passe ; le cas avec pseudo doit être corrigé dans une PR distincte et revalidé avant de considérer la recette complète. Aucun correctif de rendu ni instrumentation temporaire conservé dans cette PR.

Un titre résiduel du partage, « Partager … », constaté pendant ce parcours, devient « Share … » ; constante d’interface uniquement. Le rebase conserve intégralement les nouveaux écrans et animations de master.

CI GitHub verte sur le premier commit, puis relancée après rebase et documentation des preuves ; seul le vert du dernier commit fait foi avant sortie du brouillon. Les tests Auth/partage existants sont adaptés aux chemins anglais ; un test couvre les 16 fichiers renommés, l’absence d’alias, les deux exceptions design-system, sitemap/robots et noindex. Les métadonnées de partage et liens de notification ont des assertions ciblées supplémentaires. Aucune assertion de sécurité, droits SQL, taux de drop ou qualité d’image affaiblie.

Grep final exécuté sur les fichiers suivis du code, tests, scripts et documentation :

```powershell
rg -n '/(connexion|inscription|mot-de-passe-oublie|reinitialiser-mot-de-passe|compte-supprime|marche|echanges|amis|parametres|profil|recherche|succes|partage)\b' app components lib hooks utils proxy.ts tests scripts ops docs
```

Résultat : **aucun ancien chemin dans le code applicatif, les scripts ou les docs opératoires**. Seuls docs/english-routes.md, docs/english-migration.md, docs/english-sweep.md et tests/english-routes.test.mjs restent, pour les exceptions ci-dessous. Les références à une route admin/design-system conservée ne sont pas des anciens chemins joueur à remplacer.

Les anciens chemins restent volontairement dans ce document (mapping/rollback), dans docs/english-migration.md et docs/english-sweep.md (preuves historiques avec références de commit), ainsi que dans le test qui vérifie leur absence. Les anciennes migrations restent strictement intactes. Les routes design-system contenant catalogue-preview et enchere restent inchangées. Les clés de query et codes français restent des valeurs techniques, pas des chemins à renommer.

**Aucune migration. Aucune configuration Coolify modifiée. Aucun merge ni déploiement.**
