import assert from "node:assert/strict";
import test from "node:test";
import { auctionMentionParts } from "./helpers/auction-mentions.mjs";
const players = [
  { userId: "a", pseudo: "Abdou" },
  { userId: "b", pseudo: "Sharks enjoyer" },
  { userId: "c", pseudo: "Étoile" },
  { userId: "d", pseudo: "Abdou.Fan" }
];
const mentions = text =>
  auctionMentionParts(text, players)
    .filter(p => p.player)
    .map(p => [p.text, p.player.userId]);
test("exact known identities, case, accents, spaces and longest name are preserved", () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        mentions("Salut @aBdOu, @Sharks enjoyer ! (@Étoile) @Abdou.Fan.")
      )
    ),
    [
      ["@aBdOu", "a"],
      ["@Sharks enjoyer", "b"],
      ["@Étoile", "c"],
      ["@Abdou.Fan", "d"]
    ]
  );
});
test("emails, unknown names, prefixes and embedded handles stay plain text", () => {
  assert.equal(
    mentions(
      "mail@Abdou.fr @Abdou2 @Abdou_fan @Abdou-fan @@Abdou @Unknown @Abdou.unknown"
    ).length,
    0
  );
});
test("tokenization retains every character including HTML and repeated mentions", () => {
  const text = "<img onerror=bad> @Abdou\n@Abdou & @Unknown";
  assert.equal(
    auctionMentionParts(text, players)
      .map(p => p.text)
      .join(""),
    text
  );
  assert.equal(mentions(text).length, 2);
  assert.equal(
    auctionMentionParts(text, [])
      .map(p => p.text)
      .join(""),
    text
  );
});
