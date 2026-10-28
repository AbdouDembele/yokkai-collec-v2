// Read-only snapshot of the local catalogue; this example never edits a card.
export const PREMIUM_CARD_ARTWORK_EXAMPLE = {
  card: {
    id: "60c0cdbe-2ed5-43f9-aac3-c2bdfa5e4867",
    name: "SATORU GOJOU",
    category: "ANIME/MANGA",
    anime: "JUJUTSU KAISEN",
    rarity: "LR",
    image: "/assets/premium-examples/gojo-original.png"
  },
  customGif: "/assets/premium-examples/gojo-custom.gif",
  still: "/assets/premium-examples/gojo-custom-still.webp"
} as const;
