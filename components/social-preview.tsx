"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar, Button, Karas, Modal, StatusPill } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import type { CollectedCard, Rarity } from "@/lib/data/cards";
import { FriendsPanel, type FriendsPanelAdapter } from "@/components/friends";
import type { Friendships, FriendUser } from "@/lib/data/friends";

const rarities: Rarity[] = ["LR", "SSR", "SR", "R"];
const cards: CollectedCard[] = rarities.map((rarity, index) => ({
  id: `preview-${index}`,
  instanceId: `instance-${index}`,
  name: ["Kuro Kitsune", "Aoi Dragon", "Yuki Frost", "Ren Cyber"][index],
  category: "Anime",
  anime: ["Spirit Realm", "Dragon Legacy", "Winter Saga", "Neo Tokyo"][index],
  rarity,
  image: "/assets/booster-pack.png",
  catalogueImage: "/assets/booster-pack.png",
  customImageUrl: null,
  obtainedAt: new Date().toISOString(),
  shiny: index === 1,
  isEvolved: false,
  isFirstOwner: index === 0,
  folderId: null
}));
function PreviewCards() {
  return (
    <div className="yk-card-grid yk-featured-stage">
      {cards.map(card => (
        <div key={card.id}>
          <YokaiCard {...card} />
        </div>
      ))}
    </div>
  );
}

function ProfilePreview() {
  const [edit, setEdit] = useState(false);
  return (
    <>
      <div className="yk-profile-banner">
        <span className="yk-profile-banner-label">
          <strong>Kuro Kitsune</strong>
          <small>Spirit Realm</small>
        </span>
      </div>
      <div className="relative -mt-14 flex flex-wrap items-end justify-between gap-5 px-6">
        <div>
          <Avatar name="Kitsune" size={112} />
          <h2 className="mt-5 font-display text-3xl">Kitsune</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-2">
            Collectionneur de légendes japonaises, toujours à la recherche de la
            prochaine carte rare.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEdit(true)}>
          Modifier le profil
        </Button>
      </div>
      <div className="my-8 grid grid-cols-3 gap-3">
        <div className="rounded-panel border border-veil bg-surface p-5">
          <p className="text-xs text-ink-3">Cartes</p>
          <p className="mt-3 font-display text-2xl">746</p>
        </div>
        <div className="rounded-panel border border-veil bg-surface p-5">
          <p className="text-xs text-ink-3">Différentes</p>
          <p className="mt-3 font-display text-2xl">312</p>
        </div>
        <div className="rounded-panel border border-veil bg-surface p-5">
          <p className="text-xs text-ink-3">Amis</p>
          <p className="mt-3 font-display text-2xl">24</p>
        </div>
      </div>
      <div className="yk-profile-columns">
        <section>
          <h3 className="yk-section-title">Cartes mises en avant</h3>
          <PreviewCards />
        </section>
        <aside className="h-fit rounded-panel border border-veil bg-surface p-5">
          <h3 className="yk-section-title">Amis</h3>
          <div className="mt-5 space-y-3">
            {["Mochi", "Akuma", "Yuna"].map(name => (
              <Link
                key={name}
                href="/design-system/social-preview?screen=public"
                className="flex items-center gap-3 rounded-input p-2 hover:bg-veil"
              >
                <Avatar name={name} />
                <span className="font-display">{name}</span>
              </Link>
            ))}
          </div>
        </aside>
      </div>
      <Modal
        open={edit}
        onClose={() => setEdit(false)}
        title="Modifier mon profil"
        className="max-w-4xl"
      >
        <div className="yk-profile-editor">
          <div className="yk-avatar-editor">
            <Avatar name="Kitsune" size={80} />
            <div>
              <strong>Photo de profil</strong>
              <p>JPG, PNG, WebP or GIF · Up to 4 MB</p>
              <Button variant="secondary" className="mt-3">
                Changer la photo
              </Button>
            </div>
          </div>
          <label className="block text-sm text-ink-2">
            Bio
            <textarea
              className="auth-input mt-2 min-h-28 resize-y py-3"
              maxLength={300}
              defaultValue="Collectionneur de légendes japonaises."
            />
            <span className="mt-1 block text-right text-xs text-ink-3">
              45/300
            </span>
          </label>
          <h3 className="font-display text-lg">Cartes en vitrine · 4/4</h3>
          <PreviewCards />
          <div className="yk-editor-actions">
            <Button variant="secondary" onClick={() => setEdit(false)}>
              Annuler
            </Button>
            <Button onClick={() => setEdit(false)}>
              Enregistrer les modifications
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
function PublicPreview() {
  return (
    <>
      <div className="yk-profile-banner" />
      <div className="relative -mt-14 flex flex-wrap items-end justify-between gap-5 px-6">
        <div>
          <Avatar name="Mochi" size={112} />
          <h2 className="mt-5 font-display text-3xl">Mochi</h2>
          <p className="mt-3 max-w-2xl text-sm text-ink-2">
            Passionné de manga et de cartes Shiny.
          </p>
        </div>
        <div className="yk-friend-action-buttons">
          <Button>Accepter</Button>
          <Button variant="secondary">Refuser</Button>
        </div>
      </div>
      <div className="my-8 grid grid-cols-2 gap-3">
        <div className="rounded-panel border border-veil bg-surface p-5">
          <p className="text-xs text-ink-3">Cartes</p>
          <p className="mt-3 font-display text-2xl">418</p>
        </div>
        <div className="rounded-panel border border-veil bg-surface p-5">
          <p className="text-xs text-ink-3">Différentes</p>
          <p className="mt-3 font-display text-2xl">205</p>
        </div>
      </div>
      <h3 className="yk-section-title">Cartes mises en avant</h3>
      <PreviewCards />
    </>
  );
}
const person = (
  pseudo: string,
  index: number,
  status?: FriendUser["status"]
): FriendUser => ({
  id: `user-${pseudo}`,
  pseudo,
  status,
  requestId: `request-${index}-${pseudo}`
});
// Local-only adapter: the real FriendsPanel markup, with simulated friendships, search and answers.
function previewFriendsAdapter(): FriendsPanelAdapter {
  let state: Friendships = {
    friends: ["Mochi", "Akuma_LeCollectionneurDeLegendes", "Yuna"].map(
      (name, index) => person(name, index, "accepted")
    ),
    incoming: ["Hikari", "Ren_ChasseurDeShinyNocturne"].map((name, index) =>
      person(name, index, "incoming")
    ),
    outgoing: ["Sora"].map((name, index) => person(name, index, "outgoing"))
  };
  return {
    moderation: {
      list: async () => [],
      block: async () => undefined,
      unblock: async () => undefined,
      report: async () => undefined
    },
    friendships: async () => state,
    search: async query =>
      ["Mochi", "Mochizuki_GardienDuSanctuaireCeleste", "Momo"]
        .filter(name => name.toLowerCase().includes(query.toLowerCase()))
        .map((name, index) =>
          person(name, index, index === 0 ? "accepted" : "none")
        ),
    respond: async (requestId, accept) => {
      const request = state.incoming.find(item => item.requestId === requestId);
      state = {
        ...state,
        incoming: state.incoming.filter(item => item.requestId !== requestId),
        friends:
          accept && request
            ? [...state.friends, { ...request, status: "accepted" }]
            : state.friends
      };
    },
    remove: async friendId => {
      state = {
        ...state,
        friends: state.friends.filter(item => item.id !== friendId)
      };
    },
    action: {
      send: async () => undefined,
      friendships: async () => state,
      respond: async () => undefined
    }
  };
}
function FriendsPreview() {
  const [adapter] = useState(previewFriendsAdapter);
  return <FriendsPanel adapter={adapter} />;
}
function TradesPreview() {
  return (
    <div className="yk-social-stack">
      <section className="yk-trade-incoming">
        <div>
          <p className="eyebrow">Proposition reçue</p>
          <h2>Mochi veut échanger</h2>
          <p>Consultez les cartes proposées avant de répondre.</p>
        </div>
        <div className="yk-friend-action-buttons">
          <Button variant="secondary">Refuser</Button>
          <Button>Accepter</Button>
        </div>
      </section>
      <section className="yk-social-panel">
        <div className="yk-trade-heading">
          <div>
            <p className="eyebrow">Nouvelle proposition</p>
            <h2 className="yk-section-title mt-2">Choisir un ami</h2>
          </div>
          <StatusPill tone="info">Échange avec Mochi</StatusPill>
        </div>
        <div className="yk-friend-choices">
          <Button variant="secondary">Mochi</Button>
          <Button variant="secondary">Akuma</Button>
        </div>
        <div className="yk-trade-composer">
          <div className="yk-trade-columns">
            <section className="yk-trade-side">
              <header>
                <span className="yk-trade-side-index">01</span>
                <div>
                  <p>Tu proposes</p>
                  <small>Ta collection</small>
                </div>
              </header>
              <div className="yk-trade-drop">
                <strong>{cards[0].name}</strong>
              </div>
              <div className="yk-trade-picker">
                {cards.slice(0, 2).map(card => (
                  <button className="yk-trade-pick" key={card.id}>
                    <span className="w-16">
                      <YokaiCard {...card} animated={false} />
                    </span>
                    <strong>{card.name}</strong>
                  </button>
                ))}
              </div>
              <label className="yk-trade-karas">
                Karas optionnels <Karas amount={4920} />
                <input
                  className="auth-input"
                  type="number"
                  defaultValue="500"
                />
              </label>
            </section>
            <section className="yk-trade-side">
              <header>
                <span className="yk-trade-side-index">02</span>
                <div>
                  <p>Tu demandes</p>
                  <small>Collection de Mochi</small>
                </div>
              </header>
              <div className="yk-trade-drop">
                <strong>{cards[1].name}</strong>
              </div>
              <div className="yk-trade-picker">
                {cards.slice(2).map(card => (
                  <button className="yk-trade-pick" key={card.id}>
                    <span className="w-16">
                      <YokaiCard {...card} animated={false} />
                    </span>
                    <strong>{card.name}</strong>
                  </button>
                ))}
              </div>
              <label className="yk-trade-karas">
                Karas optionnels
                <input className="auth-input" type="number" defaultValue="0" />
              </label>
            </section>
          </div>
          <footer className="yk-trade-submit">
            <p>
              Les possessions seront revérifiées au moment de l’acceptation.
            </p>
            <Button>Envoyer la proposition</Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
export function SocialPreview({
  screen
}: {
  screen: "profile" | "public" | "friends" | "trades";
}) {
  return screen === "profile" ? (
    <ProfilePreview />
  ) : screen === "public" ? (
    <PublicPreview />
  ) : screen === "friends" ? (
    <FriendsPreview />
  ) : (
    <TradesPreview />
  );
}
