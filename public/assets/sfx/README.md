# Sons des packs

`lib/ui/pack-sound.ts` reprend les générateurs Web Audio du prototype
`INTEGRATION/yokkai-ouverture.html` fourni le 28 octobre 2026 : ouverture complète,
souffle neutre de survol, passage de carte et reveals C/R/SR distincts.
Le bruit déterministe est réutilisé ; toutes les sources et leurs nœuds sont libérés.
Le survol ne contient aucun oscillateur musical ni indice de rareté.

À la demande de Walid, les reveals d’entrée SSR et LR prolongent cette palette
(notes de base 493,88 Hz et 659,25 Hz, mêmes enveloppes et progression d’intensité).
Les C/R/SR jouent leur son après le retournement qui rend leur face visible.
Les LR/SSR jouent leur nouveau son d’entrée (`lr-reveal` / `ssr-reveal`), puis
conservent exactement les `LR.mp3` et `SSR.mp3` de la PR #580 à l’arrivée de la
carte, au début de la partie non skippable. Les fichiers et les offsets de lecture
(0,25 / 0,18 s) restent inchangés. Replay rejoue ces deux étapes.
Aucun son ni mouvement de l’éventail ne dépend du tirage.

Les anciens WAV, `clic.mp3` et `reveal.mp3` sont retirés. Changer de carte, quitter
l’écran ou couper le son arrête la lecture précédente, décodage en attente compris.
Les préférences son et la session ambient mobile du site sont conservées.
