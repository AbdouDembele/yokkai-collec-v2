"use client";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import { useState } from "react";
import { Button, Karas, StatusPill } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { groupCollection } from "@/lib/ui/collection-groups";
import { tradeStatusPresentation, type TradeOffer } from "@/lib/data/trades";
import type { CollectedCard } from "@/lib/data/cards";

function Lot({
  title,
  cards,
  karas
}: {
  title: string;
  cards: CollectedCard[];
  karas: number;
}) {
  return (
    <section className="yk-conversation-trade-lot">
      <h4>{title}</h4>
      {cards.length ? (
        <div className="yk-conversation-trade-cards">
          {groupCollection(cards).map(group => {
            const card =
              group.cards.find(copy => copy.customImageUrl) ??
              group.representative;
            return (
              <div key={group.key}>
                <div className="yk-conversation-trade-art">
                  <YokaiCard
                    {...card}
                    image={card.customImageUrl ?? card.image}
                    fallbackImage={card.catalogueImage}
                    animated={false}
                    imageSizes="120px"
                  />
                </div>
                <strong>
                  {card.name}
                  {card.shiny || card.isEvolved
                    ? ` · ${cardRarityLabel(card.rarity, card.shiny, card.isEvolved)}`
                    : ""}
                  {group.cards.length > 1 ? ` ×${group.cards.length}` : ""}
                </strong>
                {card.customImageUrl && <small>Custom image</small>}
              </div>
            );
          })}
        </div>
      ) : (
        <p>No cards</p>
      )}
      <Karas amount={karas} />
    </section>
  );
}

export function ConversationTrade({
  offer,
  viewerId,
  busy,
  onRespond
}: {
  offer: TradeOffer;
  viewerId: string;
  busy: boolean;
  onRespond: (id: string, action: "accept" | "decline") => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const own = offer.fromUser === viewerId;
  const incoming = offer.toUser === viewerId;
  const actionable = incoming && offer.status === "pending";
  const presentation = tradeStatusPresentation(offer.status);
  return (
    <article
      className={`yk-conversation-trade${own ? " is-own" : ""}`}
      data-trade-id={offer.id}
      aria-label={`${own ? "Sent" : "Received"} trade offer`}
    >
      <header>
        <strong>{offer.parentOfferId ? "Counteroffer" : "Trade offer"}</strong>
        <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
      </header>
      <p>
        {own
          ? `You sent an offer to ${offer.toPseudo}.`
          : `${offer.fromPseudo} sent you an offer.`}
      </p>
      <div className="yk-conversation-trade-lots">
        <Lot
          title="You give"
          cards={own ? offer.offeredCards : offer.requestedCards}
          karas={own ? offer.offeredKaras : offer.requestedKaras}
        />
        <Lot
          title="You receive"
          cards={own ? offer.requestedCards : offer.offeredCards}
          karas={own ? offer.requestedKaras : offer.offeredKaras}
        />
      </div>
      {actionable &&
        (confirming ? (
          <div
            className="yk-conversation-trade-confirm"
            role="group"
            aria-label="Confirm trade acceptance"
          >
            <strong>This can&apos;t be undone</strong>
            <p>
              Accepting transfers these cards and Karas immediately. Custom
              images are kept and transferred cards leave their folders.
            </p>
            <div>
              <Button
                disabled={busy}
                onClick={() => onRespond(offer.id, "accept")}
              >
                {busy ? "Accepting…" : "Confirm trade"}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Go back
              </Button>
            </div>
          </div>
        ) : (
          <footer>
            <Button disabled={busy} onClick={() => setConfirming(true)}>
              Accept
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onRespond(offer.id, "decline")}
            >
              Decline
            </Button>
          </footer>
        ))}
      {own && offer.status === "pending" && (
        <p className="yk-conversation-trade-waiting">
          Waiting for {offer.toPseudo} to respond.
        </p>
      )}
      <time dateTime={offer.createdAt}>
        {new Date(offer.createdAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        })}
      </time>
    </article>
  );
}
