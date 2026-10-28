Spécifications Techniques UI/UX — Yokkai Collec'
Ce document définit les spécifications d'interface, les fiches d'interaction et l'architecture visuelle des modules Collection, Modale de Détail, Variante de Destruction et Catalogue de la plateforme Yokkai Collec'.

1. Topbar Commune
   La Topbar est persistante sur l'ensemble des écrans de l'application. Elle est fixée en haut de fenêtre (position: sticky; top: 0; z-index: 1000;) avec un effet de flou en arrière-plan (backdrop-filter: blur(8px)).
   1.1 Layout Wireframe (ASCII)
   +-----------------------------------------------------------------------------------------------------------------------+

| [LOGO YOKKAI] | Collection Catalogue Marché | [ Q Rechercher un Yokkai... ] | (4920 K) | (🔔 3) | [ (Avatar) v ] |

|---|---|---|---|---|---|+-----------------------------------------------------------------------------------------------------------------------+
1.2 Composants et Interactions
Composant
Élément UI
Description & Interaction
Branding
Logo Yokkai
SVG vectoriel. Clic : Redirige vers le tableau de bord / accueil.
Navigation
Liens principaux
Collection (actif), Catalogue, Marché. Indicateur actif : underline 2px #6366F1.
Recherche
Input Global
Champ avec filtre instantané (debounce 150ms). Raccourci clavier / pour focus.
Économie
Solde Karas
Badges affichant le solde courant (ex: 4 920 K). Hover : Tooltip "Monnaie du jeu".
Notifications
Icône Cloche
Badge numérique rouge #FF3355 si non-lus. Clic : Ouvre le panel d'activités récentes.
Profil
Avatar + Menu
Photo de profil ronde (32x32px). Clic : Menu déroulant (Profil, Paramètres, Déconnexion).

2. Page Collection
   La page Collection présente l'ensemble des Yokkais possédés par l'utilisateur dans une grille ultra-dense optimisée pour l'affichage du premier rang sans défilement sur un écran Standard HD (1920x1080).
   2.1 Wireframe de la Page Collection (ASCII)
   +-----------------------------------------------------------------------------------------------------------------------+

| Ma Collection (142/500) [ Mode Sélection ] [ + Ajouter des Karas ] |

|-----------------------------------------------------------------------------------------------------------------------|

| [Filtre Élément v] [Trier par v] | [R] [SR] [SSR] [UR] | [Toggle Shiny: OFF] | [ Q Filtrer par nom... ] |

|-----------------------------------------------------------------------------------------------------------------------|

| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ |

| | Oni | | Tengu | | Kitsune | | Kappa | | Yuki-Onna| | Tanuki | |

| | [Img] | | [Img] | | [Img] | | [Img] | | [Img] | | [Img] | <-- Premier rang visible sans scroll |

| | SSR #042 | | SR #112 | | UR #001 | | R #204 | | SSR #089 | | R #156 | |

| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ |

| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ |

| | Gashadok.| | Nekomata | | Jorogumo | | Nurarihy.| | Raijin | | Fujin | |

| | [Img] | | [Img] | | [Img] | | [Img] | | [Img] | | [Img] | |

| | UR #003 | | R #301 | | SR #095 | | SSR #012 | | UR #005 | | SR #078 | |

| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ |

+-----------------------------------------------------------------------------------------------------------------------+
2.2 Barre d'Action (Mode Sélection Multi-Cartes)
Lorsque le mode sélection est activé, une barre flottante apparaît en bas au centre de l'écran :+------------------------------------------------------------------------------------+

| [X] 3 cartes sélectionnées | (1 200 K) Valeur totale | [ Vendre ] [ Decomposer ] |

+------------------------------------------------------------------------------------+
2.3 Fiche d'Interaction et États de la Grille
Disposition Grille : grid-template-columns: repeat(6, 1fr); gap: 12px;
États des Cartes :
Repos (Default) : Carte nette, bordure subtile de la couleur de rareté, ombre douce.
Survol (Hover) : Fast Easing (cubic-bezier(0.16, 1, 0.3, 1) - durée 150ms). ÉLévation transform: translateY(-4px), accentuation du halo de rareté.
Chargement (Skeletons) : Cartes grises animées avec gradient balayant de gauche à droite (pulse 1.5s infinite).
Vide (Empty State) : Message centré "Aucun Yokkai ne correspond à vos critères" avec un bouton d'action "Réinitialiser les filtres".
Erreur (Error State) : Message de défaillance réseau avec bouton d'action "Raffraîchir la page".

3. Modale de Détail (Carte Possédée)
   La modale s'ouvre au clic sur une carte de la collection. Elle est structurée en layout 2 colonnes avec une forte hiérarchie visuelle.
   3.1 Layout Wireframe (ASCII)
   +---------------------------------------------------------------------------------------------------+

| DÉTAIL DU YOKKAI [X] |

|---------------------------------------------------------------------------------------------------|

| +-----------------------+ | KITSUNE CELESTE [UR - ULTRA RARE] |

| | | | ID: #001-A | Obtention: Pack Alpha | Date: 12/10/2023 |

| | | |-------------------------------------------------------------------|

| | | | Description: Esprit Renard aux neuf queues gardien des temples. |

| | ILLUSTRATION | |-------------------------------------------------------------------|

| | DE LA | | VALEUR ESTIMÉE : 4 500 Karas |

| | CARTE | | PROGRES SHINY : [██████████████████......] 2/3 SSR Requis |

| | | |-------------------------------------------------------------------|

| | | | [ Mettre aux Enchères ] [ Évoluer en Shiny (Locked) ] |

| | | | [ Lien Imgur Custom ] [ Ajouter à la Wishlist ] |

| | | |-------------------------------------------------------------------|

| +-----------------------+ | [⚠️ DÉTRUIRE LA CARTE (CONVERTIR EN KARAS) ] |

+---------------------------------------------------------------------------------------------------+
3.2 Composants Métadonnées et Actions
Visuel Gauche : Illustration full-bleed avec glow/halo dynamique calculé selon la rareté :
Rare (R) : Glow bleu (#3B82F6)
Super Rare (SR) : Glow violet (#A855F7)
Super Super Rare (SSR) : Glow dore (#F59E0B)
Ultra Rare (UR) : Glow iridescent / rouge-rubis (#EF4444)
Métadonnées Droite : Titre, badge de rareté, identifiant unique, provenance, date d'acquisition et lore.
Évolution Shiny : Barre de progression des doublons (ex: 2/3). Si 3/3 est atteint, le bouton s'active avec une animation d'impulsion dorée.
Intégration Imgur : Input permettant d'associer un lien d'image personnalisé qui remplace l'illustration standard si désiré.
Bouton Danger : Placé tout en bas, stylisé en contour neutre se transformant en rouge intense au survol.

4. Variante : Confirmation de Destruction
   Lorsque l'utilisateur clique sur "Détruire la carte", le panneau de droite de la modale transite vers l'écran de confirmation critique.
   4.1 Layout Wireframe (ASCII)
   +---------------------------------------------------------------------------------------------------+

| CONFIRMATION DE DESTRUCTION [X] |

|---------------------------------------------------------------------------------------------------|

| +-----------------------+ | ----------------------------------------------------------------- |

| | | | ⚠️ ATTENTION : ACTION IRRÉVERSIBLE |

| | | | ----------------------------------------------------------------- |

| | | | Vous êtes sur le point de détruire la carte "Kitsune Céleste #001".|

| | ILLUSTRATION | | Cette carte sera définitivement supprimée de votre compte. |

| | DE LA | | |

| | CARTE | | CALCUL DE LA RÉCOMPENSE : |

| | (OPACITÉ | | + Valeur de base (UR) : 4 000 K |

| | 50%) | | + Bonus de niveau : 500 K |

| | | | TOTAL À RECEVOIR : 4 500 Karas |

| | | | |

| +-----------------------+ | [ ANNULER ] [ 💥 CONFIRMER LA DESTRUCTION ] |

+---------------------------------------------------------------------------------------------------+
4.2 Spécifications d'Interaction & Micro-Animations
Avertissement Visuel : Le panneau droit applique un fond d'alerte #FF3355 à 10% d'opacité avec une bordure de 2px en #FF3355.
Action de Validation : Clic sur "Confirmer la destruction".
Feedback Animé (Crédit de Karas) :
La modale se ferme en fondu rapide (100ms).
Une pluie de pièces/étincelles dorées jaillit de l'emplacement de la carte vers la Topbar (Badges Karas).
Le compteur de Karas dans la Topbar effectue un roll-up numérique rapide incrementant la valeur (+4 500 K) accompagné d'un effet de scale (transform: scale(1.25)) temporaire sur le badge.

5. Page Catalogue
   Le Catalogue liste l'intégralité du Bestiaire Yokkai (cartes existantes sur le jeu) indépendamment du fait que l'utilisateur les possède ou non.
   5.1 Wireframe de la Page Catalogue (ASCII)
   +-----------------------------------------------------------------------------------------------------------------------+

| Catalogue Officiel des Yokkais [ Avancement Total: 64% ] |

|-----------------------------------------------------------------------------------------------------------------------|

| [Filtre Rareté v] [Tri par ID v] | [ R ] [ SR ] [ SSR ] [ UR ] | [ Q Rechercher dans le catalogue... ] |

|-----------------------------------------------------------------------------------------------------------------------|

| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ |

| | Oni | | Tengu | | Kitsune | | Kappa | | Yuki-Onna| | Tanuki | |

| | [Img] | | [Img] | | [Grisé] | | [Img] | | [Grisé] | | [Img] | |

| | x2 | | x1 | | x0 | | x5 | | x0 | | x1 | |

| +----------+ +----------+ +----------+ +----------+ +----------+ +----------+ |

+-----------------------------------------------------------------------------------------------------------------------+
5.2 Modale de Détail (Catalogue - Lecture Seule)
Contrairement à la modale de collection, cet écran ne permet aucune action de gestion d'inventaire.+---------------------------------------------------------------------------------------------------+

| FICHE CATALOGUE - KITSUNE CELESTE [X] |

|---------------------------------------------------------------------------------------------------|

| +-----------------------+ | KITSUNE CELESTE [UR - ULTRA RARE] |

| | | | ID: #001 | Taux d'obtention: 0.5% |

| | | |-------------------------------------------------------------------|

| | | | STATUS : Possédé (x2 exemplaires en collection) |

| | ILLUSTRATION | |-------------------------------------------------------------------|

| | DE LA | | LISTE DES POSSESSEURS (Top Holders) : |

| | CARTE | | - PlayerOne (x4) |

| | | | - ShadowMaster (x2) |

| | | | - YukiFan (x1) |

| | | |-------------------------------------------------------------------|

| | | | [ ⭐ Ajouter à ma Wishlist ] |

| +-----------------------+ | |

+---------------------------------------------------------------------------------------------------+

6. Guide des Styles Visuels & Design System
   6.1 Spécifications Typographiques et Couleurs
   Scale Typographique (Minor Second - Base 10pt) :

- Base Text : 10pt (Inter Regular)

- Subtitles : 12pt (Inter Medium)

- Headings : 15pt (Inter SemiBold)

- Title Page : 22pt (Inter Bold)

Palette Couleurs :

- Surface Primary : #FFFFFF

- Surface Secondary : #F8FAFC

- Text Primary : #0F172A

- Text Secondary : #64748B

- Primary Accent : #6366F1 (Indigo)

- Danger Red : #FF3355 (Destruction / Alerte)

- Gold / Karas : #F59E0B (Économie / Shiny)
  6.2 Tableau de Synthèse des Écrans
  Écran / Modale
  Layout principal
  Éléments clés
  Actions Utilisateur
  Collection
  Grille 6 colonnes ultra-dense
  Filtres 1 ligne, compteur global, cartes interactives
  Filtrer, trier, mode sélection, clic pour détail
  Modale Détail
  2 colonnes (Image / Infos)
  Visualiseur Halo, jauge Shiny 3/3, Custom Imgur
  Vendre, Évoluer, Intégrer Imgur, Détruire
  Confirmation Destruction
  2 colonnes avec alerte rouge
  Calculateur Karas, message d'avertissement irreversibilité
  Confirmer la destruction, Annuler
  Catalogue
  Grille 6 colonnes (Grisée x0)
  Compteur de possession xN/x0, avancement %
  Consulter possesseurs, ajouter à la Wishlist
