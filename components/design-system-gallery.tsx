"use client";

import { useState } from "react";
import {
  Button,
  Chip,
  Feedback,
  Field,
  Karas,
  Modal,
  Skeleton,
  StatusPill,
  Tabs,
  Toast
} from "@/components/ui";
import { CardShell } from "@/components/card-shell";
import { CardBack, YokaiCard } from "@/components/yokai-card";

const tabItems = [
  { id: "collection", label: "Collection" },
  { id: "catalogue", label: "Catalogue" },
  { id: "locked", label: "Indisponible", disabled: true }
];

const rarity = [
  ["C", "text-rarity-c border-rarity-c/50 bg-rarity-c/10"],
  ["R", "text-rarity-r border-rarity-r/50 bg-rarity-r/10"],
  ["SR", "text-rarity-sr border-rarity-sr/50 bg-rarity-sr/10"],
  ["SSR", "text-rarity-ssr border-rarity-ssr/50 bg-rarity-ssr/10"],
  ["LR", "text-rarity-lr border-rarity-lr/50 bg-rarity-lr/10"]
] as const;

const cardRarities = ["C", "R", "SR", "SSR", "LR"] as const;

function Section({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-panel border border-veil bg-surface p-5 shadow-card sm:p-7">
      <div className="mb-6">
        <p className="eyebrow">Composant</p>
        <h2 className="mt-2 font-display text-xl font-semibold">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function State({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-3 text-[10px] font-semibold tracking-[.16em] text-ink-3 uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

export function DesignSystemGallery() {
  const [tab, setTab] = useState("collection");
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState("");
  return (
    <>
      <section
        id="card-shell"
        className="scroll-mt-6 rounded-panel border border-veil bg-surface p-5 shadow-card sm:p-7"
      >
        <div className="mb-7">
          <p className="eyebrow">Composant · Phase 1.5</p>
          <h2 className="mt-2 font-display text-xl font-semibold">Carte</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">
            Ratio 5:7 conservé. Le shell ajoute uniquement l’élévation, le tilt
            et un reflet extérieur ; la face, ses badges, son cadrage, ses
            textes et ses effets de rareté restent inchangés.
          </p>
        </div>
        <h3 className="yk-section-title">Raretés et variantes</h3>
        <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-7">
          {cardRarities.map(cardRarity => (
            <div key={cardRarity}>
              <CardShell>
                <YokaiCard
                  rarity={cardRarity}
                  name="Kitsune céleste"
                  category="Anime"
                  anime="Spirit Realm"
                  image="/assets/booster-pack.png"
                  animated={false}
                />
              </CardShell>
              <p className="mt-3 text-center text-xs font-semibold text-ink-2">
                {cardRarity}
              </p>
            </div>
          ))}
          <div>
            <CardShell>
              <YokaiCard
                rarity="SSR"
                shiny
                name="Kitsune céleste"
                category="Anime"
                anime="Spirit Realm"
                image="/assets/booster-pack.png"
                animated={false}
              />
            </CardShell>
            <p className="mt-3 text-center text-xs font-semibold text-ink-2">
              SSR Evolved
            </p>
          </div>
          <div>
            <CardShell>
              <YokaiCard
                rarity="LR"
                shiny
                name="Kitsune céleste"
                category="Anime"
                anime="Spirit Realm"
                image="/assets/booster-pack.png"
                animated={false}
              />
            </CardShell>
            <p className="mt-3 text-center text-xs font-semibold text-ink-2">
              LR Shiny
            </p>
          </div>
        </div>
        <h3 className="yk-section-title mt-10">Dos et états du shell</h3>
        <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-5">
          <div>
            <CardShell>
              <CardBack />
            </CardShell>
            <p className="mt-3 text-center text-xs text-ink-2">Dos · 5:7</p>
          </div>
          <div>
            <CardShell>
              <YokaiCard
                rarity="SSR"
                name="Repos"
                category="État"
                anime="Shell"
                image="/assets/booster-pack.png"
                animated={false}
              />
            </CardShell>
            <p className="mt-3 text-center text-xs text-ink-2">Repos</p>
          </div>
          <div>
            <CardShell demoState="hover">
              <YokaiCard
                rarity="SSR"
                name="Survol"
                category="État"
                anime="Shell"
                image="/assets/booster-pack.png"
                animated={false}
              />
            </CardShell>
            <p className="mt-3 text-center text-xs text-ink-2">Hover</p>
          </div>
          <div>
            <CardShell demoState="tilt">
              <YokaiCard
                rarity="SSR"
                name="Tilt"
                category="État"
                anime="Shell"
                image="/assets/booster-pack.png"
                animated={false}
              />
            </CardShell>
            <p className="mt-3 text-center text-xs text-ink-2">Tilt</p>
          </div>
          <div>
            <CardShell demoState="reflection">
              <YokaiCard
                rarity="SSR"
                name="Reflet"
                category="État"
                anime="Shell"
                image="/assets/booster-pack.png"
                animated={false}
              />
            </CardShell>
            <p className="mt-3 text-center text-xs text-ink-2">Reflet</p>
          </div>
        </div>
        <p className="mt-7 rounded-input border border-veil bg-void p-4 text-xs leading-5 text-ink-3">
          Sur appareil tactile, sans capacité de survol, ou avec{" "}
          <code>prefers-reduced-motion</code>, l’élévation, le tilt et le reflet
          sont désactivés. Aucun mouvement de pointeur ne déclenche de rendu
          React.
        </p>
      </section>

      <Section
        title="Boutons"
        description="Primaire, secondaire et danger partagent les mêmes rythmes, rayons et états accessibles."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <State label="Repos">
            <Button>Ouvrir un booster</Button>
          </State>
          <State label="Survol">
            <Button data-demo-state="hover">Ouvrir un booster</Button>
          </State>
          <State label="Pressé">
            <Button data-demo-state="pressed">Ouvrir un booster</Button>
          </State>
          <State label="Focus">
            <Button data-demo-state="focus">Ouvrir un booster</Button>
          </State>
          <State label="Désactivé">
            <Button disabled>Indisponible</Button>
          </State>
          <State label="Chargement">
            <Button disabled aria-busy="true">
              Chargement
            </Button>
          </State>
          <State label="Secondaire">
            <Button variant="secondary">Revenir</Button>
          </State>
          <State label="Danger">
            <Button variant="danger">Détruire</Button>
          </State>
        </div>
      </Section>

      <Section
        title="Champs"
        description="Les états de validation restent visibles sans déplacer le contenu du formulaire."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <State label="Repos">
            <Field
              label="Adresse email"
              placeholder="collectionneur@yokkai.fr"
              hint="Utilisée uniquement pour votre compte."
            />
          </State>
          <State label="Focus">
            <Field
              label="Pseudo"
              defaultValue="KitsuneMaster"
              data-demo-state="focus"
            />
          </State>
          <State label="Erreur">
            <Field
              label="Lien personnalisé"
              defaultValue="imgur.com/invalide"
              error="Utilisez une URL Imgur valide."
            />
          </State>
          <State label="Désactivé">
            <Field label="Identifiant" defaultValue="YK-0042" disabled />
          </State>
          <State label="Chargement">
            <div className="space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-12 w-full" />
            </div>
          </State>
        </div>
      </Section>

      <Section
        title="Navigation et filtres"
        description="Les onglets structurent les vues ; les pastilles filtrent sans concurrencer l’action principale."
      >
        <div className="space-y-7">
          <Tabs items={tabItems} value={tab} onChange={setTab} />
          <div className="flex flex-wrap gap-2">
            <Chip active>Toutes</Chip>
            <Chip>Shiny uniquement</Chip>
            <Chip disabled>Désactivé</Chip>
            {rarity.map(([label, classes]) => (
              <button
                key={label}
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${classes}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="Statuts, Karas et feedbacks"
        description="Les couleurs fonctionnelles restent réservées aux informations qui nécessitent une réaction."
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill>En attente</StatusPill>
          <StatusPill tone="success">Réussi</StatusPill>
          <StatusPill tone="danger">Erreur</StatusPill>
          <StatusPill tone="info">Information</StatusPill>
          <Karas amount={1240} />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Feedback tone="success" title="Carte ajoutée">
            La collection a été mise à jour.
          </Feedback>
          <Feedback tone="error" title="Action impossible">
            Vérifiez votre connexion puis réessayez.
          </Feedback>
        </div>
      </Section>

      <Section
        title="Chargement"
        description="Le skeleton utilise un balayage sobre et devient un fondu court en préférence de mouvement réduit."
      >
        <div className="grid max-w-xl grid-cols-[56px_1fr] gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      </Section>

      <Section
        title="Modale et toast"
        description="Les surfaces élevées utilisent le même backdrop, la même ombre et les mêmes durées centralisées."
      >
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setModal(true)}>Ouvrir la modale</Button>
          <Button
            variant="secondary"
            onClick={() => setToast("Profil mis à jour avec succès.")}
          >
            Afficher le toast
          </Button>
        </div>
      </Section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Confirmer l’action"
      >
        <p className="text-sm leading-6 text-ink-2">
          Cette modale de référence montre le titre, le contenu, le focus et les
          actions.
        </p>
        <div className="mt-7 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setModal(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              setModal(false);
              setToast("Action confirmée.");
            }}
          >
            Confirmer
          </Button>
        </div>
      </Modal>
      <Toast message={toast} onDismiss={() => setToast("")} />
    </>
  );
}
