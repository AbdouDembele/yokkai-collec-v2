import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("partage client : consentement explicite, erreurs sûres et URL absolue", async () => {
  const calls = [];
  let failure;
  const context = {
    exports: {},
    URL,
    process: { env: { NEXT_PUBLIC_SITE_URL: "https://yokkai.example" } },
    require: () => ({
      createClient: () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: "a".repeat(32), error: failure };
        }
      })
    })
  };
  vm.runInNewContext(
    ts.transpileModule(read("lib/data/card-shares.ts"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    context
  );
  const api = context.exports;
  await api.createCardShare("owned-instance", false);
  assert.equal(calls[0].args.p_show_pseudo, false);
  assert.equal(calls[0].args.p_instance_id, "owned-instance");
  assert.equal(
    api.cardShareUrl("a".repeat(32)),
    `https://yokkai.example/share/${"a".repeat(32)}`
  );
  assert.throws(() => api.cardShareUrl("bad"));
  failure = { message: "private SQL details" };
  await assert.rejects(api.listCardShares(), /temporarily unavailable/);
  failure = { message: "CARD_SHARE_DAILY_LIMIT" };
  await assert.rejects(
    api.createCardShare("owned-instance", false),
    /10 new links per UTC day/
  );
});

test("reveal : partage uniquement final et animation LR intacte", () => {
  const current = read("components/boosters.tsx");
  const animation = source =>
    source
      .slice(
        source.indexOf("    {!done &&"),
        source.indexOf("    <ol className={`yk-reveal-grid")
      )
      .replaceAll("\r\n", "\n");
  // Only these three exact UI substitutions are canonicalized. Their complete
  // current bytes are checked before restoring the original animation fingerprint.
  const uiTextSubstitutions = [
    [
      '        <button type="button" ref={next} onClick={flip} aria-disabled={revealLocked} aria-label={revealLocked ? tp("revealingCard", { name: current.name }) : faceUp ? tp("placeCard", { name: current.name }) : tp("revealCard", { index: revealed + 1, total: cards.length })} className={`yk-deck-button ${faceUp ? "yk-face-up" : ""}`}><span className="yk-flip"><span className="yk-flip-back" aria-hidden="true"><CardBack /></span><span className="yk-flip-front" aria-hidden="true">{faceUp && <YokaiCard {...current} />}</span></span></button>',
      '        <button type="button" ref={next} onClick={flip} aria-disabled={revealLocked} aria-label={revealLocked ? `Revealing ${current.name} in progress` : faceUp ? `Place ${current.name}` : `Reveal card ${revealed + 1} of ${cards.length}`} className={`yk-deck-button ${faceUp ? "yk-face-up" : ""}`}><span className="yk-flip"><span className="yk-flip-back" aria-hidden="true"><CardBack /></span><span className="yk-flip-front" aria-hidden="true">{faceUp && <YokaiCard {...current} />}</span></span></button>'
    ],
    [
      '      <p className="mt-8 text-center text-xs text-ink-3">{revealLocked ? tp("theEnergyIsBuilding") : faceUp ? tp("tapToPlaceTheCard") : tp("tapThePackToRevealACard")}</p>',
      '      <p className="mt-8 text-center text-xs text-ink-3">{revealLocked ? "The energy is building…" : faceUp ? "Tap to place the card" : "Tap the pack to reveal a card"}</p>'
    ],
    [
      '    {choosing && <div className="yk-decision-banner"><p className="font-display text-lg text-karas">{tp(\n  "chooseYourCard")}</p><p className="mt-1 text-sm text-ink-2">{tp(\n  "decisionLossPrefix")}{cards.length - 1} {cards.length - 1 === 1 ? tp(\n  "countPluralOneCardWillOtherCardsWill", { count: cards.length - 1 }) : tp(\n  "countPluralOneCardWillOtherCardsWill", { count: cards.length - 1 })} {tp(\n  "decisionLossSuffix", { count: cards.length - 1 })}</p></div>}',
      '    {choosing && <div className="yk-decision-banner"><p className="font-display text-lg text-karas">Choose your card</p><p className="mt-1 text-sm text-ink-2">Only one will join your collection — the other {cards.length - 1} {cards.length - 1 === 1 ? "card will" : "cards will"} be lost.</p></div>}'
    ]
  ];
  let canonical = current.replaceAll("\r\n", "\n");
  for (const [translated, original] of uiTextSubstitutions) {
    assert.equal(canonical.split(translated).length - 1, 1);
    canonical = canonical.replace(translated, original);
  }
  // Lock the single-player reveal structure after removal of the legacy SSR/LR effects.
  assert.equal(
    createHash("sha256").update(animation(canonical)).digest("hex"),
    "7851982725528cd39c6074bc631e3ac0f6f2effca5363cd2f2bf4ad76336e4c4"
  );
  assert.match(
    normalizeWhitespace(current),
    normalizeWhitespace(
      /done&&!choosing&&!lost&&!selecting&&!auctioned\.has\(card\.instanceId\)&&\(card\.rarity==="SSR"\|\|card\.rarity==="LR"\|\|card\.shiny\)/
    )
  );
  const collection = read("components/collection.tsx");
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/!readOnly&&\(?<MyCardShares/)
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/!readOnly&&\(?<CardShareButton/)
  );
});
