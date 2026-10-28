import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { readRpcPages } from "../lib/data/rpc-pages.mjs";

function tradeApi(locale = "en") {
  const context = {
    document: { documentElement: { lang: locale } },
    exports: {},
    require: name => {
      if (name.startsWith("@/messages/trade-limits/"))
        return {
          __esModule: true,
          default: JSON.parse(
            readFileSync(
              new URL("../" + name.slice(2), import.meta.url),
              "utf8"
            )
          )
        };
      if (name === "@/lib/data/rpc-pages.mjs") return { readRpcPages };
      if (name === "@/utils/supabase/client")
        return { createClient: () => ({}) };
      if (name === "@/lib/data/cards")
        return {
          invalidatePlayerSnapshots() {},
          withLiveCardFranchises: async cards => cards
        };
      assert.fail("Import inattendu: " + name);
    }
  };
  const source = ts.transpileModule(
    readFileSync(new URL("../lib/data/trades.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  vm.runInNewContext(source, context);
  return context.exports;
}

const offer = (status, id = "trade-1") => ({ id, status });

test("une seule transition distante pending vers accepted demande une réconciliation", () => {
  const { hasNewAcceptedTrade } = tradeApi();
  assert.equal(
    hasNewAcceptedTrade([offer("pending")], [offer("accepted")]),
    true
  );
  assert.equal(
    hasNewAcceptedTrade([offer("accepted")], [offer("accepted")]),
    false
  );
  assert.equal(hasNewAcceptedTrade([], [offer("accepted")]), false);
  assert.equal(
    hasNewAcceptedTrade([offer("pending")], [offer("declined")]),
    false
  );
});

test("les onglets répartissent les offres sans mélanger sens et historique", () => {
  const { filterTradeOffers } = tradeApi();
  const offers = [
    { id: "received", incoming: true, status: "pending" },
    { id: "sent", incoming: false, status: "pending" },
    { id: "accepted", incoming: true, status: "accepted" },
    { id: "declined", incoming: false, status: "declined" },
    { id: "countered", incoming: true, status: "countered" },
    { id: "cancelled", incoming: false, status: "cancelled" }
  ];

  assert.deepEqual(
    Array.from(filterTradeOffers(offers, "received"), item => item.id),
    ["received"]
  );
  assert.deepEqual(
    Array.from(filterTradeOffers(offers, "sent"), item => item.id),
    ["sent"]
  );
  assert.deepEqual(
    Array.from(filterTradeOffers(offers, "history"), item => item.id),
    ["accepted", "declined", "countered", "cancelled"]
  );
  assert.ok(
    !filterTradeOffers(offers, "received").some(
      item => !item.incoming || item.status !== "pending"
    )
  );
  assert.ok(
    !filterTradeOffers(offers, "sent").some(
      item => item.incoming || item.status !== "pending"
    )
  );
  assert.ok(
    !filterTradeOffers(offers, "history").some(
      item => item.status === "pending"
    )
  );
});

test("un contexte d’ami obsolète ne peut pas remplacer le choix le plus récent", async () => {
  const { loadTradeContextIfCurrent } = tradeApi();
  const pending = new Map();
  const load = id => new Promise(resolve => pending.set(id, resolve));
  let current = { friendId: "ami-a", requestId: 1 };

  const first = loadTradeContextIfCurrent(load, "ami-a", 1, () => current);
  current = { friendId: "ami-b", requestId: 2 };
  const second = loadTradeContextIfCurrent(load, "ami-b", 2, () => current);
  pending.get("ami-b")({ friend: { id: "ami-b" } });
  assert.equal((await second).friend.id, "ami-b");
  pending.get("ami-a")({ friend: { id: "ami-a" } });
  assert.equal(await first, undefined);

  current = { friendId: "ami-a", requestId: 3 };
  const currentRequest = loadTradeContextIfCurrent(
    async () => ({ friend: { id: "ami-a" } }),
    "ami-a",
    3,
    () => current
  );
  assert.equal((await currentRequest).friend.id, "ami-a");
});

test("la page Échanges poll toutes les 30 s sans chevauchement et se met en pause onglet caché", () => {
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/TRADE_POLL_INTERVAL_MS = 30_000/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /if\(loading\|\|document\.visibilityState==="hidden"\)return/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/loading=true/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/finally\{loading=false;\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /startVisiblePolling\(\(\)=>void refresh\(\),pollIntervalMs\)/
    )
  );
  // Pause and immediate read on return come from the shared PERF-01 helper.
  assert.match(normalizeWhitespace(source), /stop\?\.\(\)/);
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/adapter\.listOffers\(\)/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /invalidatePlayerSnapshots\(\["collection","balance"\]\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /pruneUnavailableSelection\(offeredRef\.current,nextContext\.ownCards\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /pruneUnavailableSelection\(requestedRef\.current,nextContext\.friendCards\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/setSelectionNotice\(/)
  );
});

test("la soumission conserve l’orientation des lots sans inverser les identifiants", () => {
  const { tradeSubmission } = tradeApi();
  const submission = tradeSubmission({
    friendId: "ami",
    offered: new Set(["donne-1", "donne-2"]),
    offeredKaras: "25",
    requested: new Set(["recois-1"]),
    requestedKaras: "40",
    parent: null
  });
  assert.deepEqual(Array.from(submission.offeredCardIds), [
    "donne-1",
    "donne-2"
  ]);
  assert.deepEqual(Array.from(submission.requestedCardIds), ["recois-1"]);
  assert.equal(submission.offeredKaras, 25);
  assert.equal(submission.requestedKaras, 40);
  assert.notDeepEqual(
    Array.from(submission.offeredCardIds),
    Array.from(submission.requestedCardIds)
  );
});

test("le verrou d’envoi refuse un double clic et les lots entièrement vides", () => {
  const { tryStartTradeSubmission } = tradeApi();
  const lock = { current: false };
  assert.equal(tryStartTradeSubmission(lock, false), false);
  assert.equal(lock.current, false);
  assert.equal(tryStartTradeSubmission(lock, true), true);
  assert.equal(lock.current, true);
  assert.equal(tryStartTradeSubmission(lock, true), false);
});

test("deux annulations dans le même tick ne déclenchent qu’un seul appel RPC", async () => {
  const { runTradeCancellation } = tradeApi();
  const lock = { current: false };
  let calls = 0;
  let release;
  const rpc = () => {
    calls++;
    return new Promise(resolve => {
      release = resolve;
    });
  };
  const first = runTradeCancellation(lock, rpc, "offre");
  const second = runTradeCancellation(lock, rpc, "offre");
  assert.equal(await second, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(lock.current, false);

  let unlockedCalls = 0;
  await Promise.all([
    Promise.resolve().then(() => unlockedCalls++),
    Promise.resolve().then(() => unlockedCalls++)
  ]);
  assert.equal(
    unlockedCalls,
    2,
    "contre-preuve : sans verrou, les deux appels partent"
  );
  await assert.rejects(
    runTradeCancellation(
      lock,
      async () => {
        throw new Error("échec");
      },
      "offre"
    ),
    /échec/
  );
  assert.equal(
    lock.current,
    false,
    "le verrou est aussi libéré après exception"
  );
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /runTradeCancellation\(cancellationLock,adapter\.cancel,id\)/
    )
  );
});

test("les erreurs d’échange sont traduites sans exposer le message serveur", () => {
  const { tradeErrorMessage } = tradeApi();
  assert.match(tradeErrorMessage("TRADE_INSUFFICIENT_KARAS"), /friend.*Karas/i);
  assert.match(
    tradeErrorMessage("TRADE_CARD_UNAVAILABLE"),
    /no longer available/i
  );
  assert.match(tradeErrorMessage("CARD_LOCKED"), /locked/i);
  assert.equal(
    tradeErrorMessage("détail SQL sensible"),
    "Couldn't process this trade. Please try again."
  );
});

test("une erreur d’envoi ne déclenche aucun effacement du brouillon", () => {
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  const submit = source.slice(
    source.indexOf("async function submit()"),
    source.indexOf("async function respond")
  );
  const failure = submit.slice(submit.indexOf("catch"));
  assert.doesNotMatch(
    failure,
    /updateOffered\(new Set\(\)\)|updateRequested\(new Set\(\)\)|setOfferedKaras\("0"\)|setRequestedKaras\("0"\)/
  );
});

test("un envoi réussi vide le brouillon et ouvre les propositions envoyées", () => {
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  const submit = source.slice(
    source.indexOf("async function submit()"),
    source.indexOf("async function respond")
  );
  const success = submit.slice(
    submit.indexOf("await reload()"),
    submit.indexOf("catch")
  );
  assert.match(success, /updateOffered\(new Set\(\)\)/);
  assert.match(success, /updateRequested\(new Set\(\)\)/);
  assert.match(success, /setOfferedKaras\("0"\)/);
  assert.match(success, /setRequestedKaras\("0"\)/);
  assert.match(success, /setTab\("sent"\)/);
  assert.doesNotMatch(
    submit,
    /requestedCardIds:\[\.\.\.offered\]|offeredCardIds:\[\.\.\.requested\]/
  );
});

test("une contre-proposition inverse exactement les lots et les Karas", () => {
  const { counterTradeDraft, tradeSubmission } = tradeApi();
  const original = {
    requestedCards: [{ instanceId: "b-1" }, { instanceId: "b-2" }],
    requestedKaras: 30,
    offeredCards: [{ instanceId: "a-1" }],
    offeredKaras: 70
  };
  const context = {
    ownCards: [{ instanceId: "b-1" }, { instanceId: "b-2" }],
    friendCards: [{ instanceId: "a-1" }]
  };
  const draft = counterTradeDraft(original, context);
  assert.deepEqual(Array.from(draft.offered), ["b-1", "b-2"]);
  assert.deepEqual(Array.from(draft.requested), ["a-1"]);
  assert.equal(draft.offeredKaras, "30");
  assert.equal(draft.requestedKaras, "70");
  assert.notDeepEqual(Array.from(draft.offered), ["a-1"]);
  const submitted = tradeSubmission({
    ...draft,
    friendId: "A",
    parent: "offre-A-vers-B"
  });
  assert.equal(submitted.toUser, "A");
  assert.equal(submitted.parentOfferId, "offre-A-vers-B");
  assert.deepEqual(Array.from(submitted.offeredCardIds), ["b-1", "b-2"]);
  assert.deepEqual(Array.from(submitted.requestedCardIds), ["a-1"]);
});

test("le préremplissage retire les instances devenues indisponibles", () => {
  const { counterTradeDraft } = tradeApi();
  const original = {
    requestedCards: [{ instanceId: "b-ok" }, { instanceId: "b-vendue" }],
    requestedKaras: 0,
    offeredCards: [{ instanceId: "a-ok" }, { instanceId: "a-verrouillee" }],
    offeredKaras: 0
  };
  const draft = counterTradeDraft(original, {
    ownCards: [{ instanceId: "b-ok" }],
    friendCards: [{ instanceId: "a-ok" }]
  });
  assert.deepEqual(Array.from(draft.offered), ["b-ok"]);
  assert.deepEqual(Array.from(draft.requested), ["a-ok"]);
  assert.equal(draft.removed, 2);
  assert.ok(
    !draft.offered.has("b-vendue") && !draft.requested.has("a-verrouillee")
  );
});

test("les actions d’examen sont désactivées dès que l’offre change ou disparaît", () => {
  const { tradeOfferIsActionable } = tradeApi();
  assert.equal(
    tradeOfferIsActionable("offre", [{ id: "offre", status: "pending" }]),
    true
  );
  assert.equal(
    tradeOfferIsActionable("offre", [{ id: "offre", status: "accepted" }]),
    false
  );
  assert.equal(
    tradeOfferIsActionable("offre", [{ id: "offre", status: "declined" }]),
    false
  );
  assert.equal(tradeOfferIsActionable("offre", []), false);
  assert.equal(
    tradeOfferIsActionable("offre", [{ id: "autre", status: "pending" }]),
    false
  );
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /setAccepting\(current=>current&&tradeOfferIsActionable\(current.id,history\)/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /const actionable=offer\?\.incoming&&offer.status==="pending"/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/\{actionable&&\(?<>/)
  );
});

test("l’identifiant d’examen survit au passage dans l’historique et résout la liste complète", () => {
  const { resolveTradeReview, filterTradeOffers } = tradeApi();
  const id = "seconde";
  for (const status of [
    "pending",
    "accepted",
    "declined",
    "countered",
    "cancelled"
  ]) {
    const all = [
      { id: "premiere", status: "pending", incoming: true },
      { id, status, incoming: true }
    ];
    assert.equal(resolveTradeReview(id, all).status, status);
    for (const tab of ["received", "sent", "history"]) {
      filterTradeOffers(all, tab);
      assert.equal(resolveTradeReview(id, all).id, id);
    }
    if (status !== "pending")
      assert.equal(
        resolveTradeReview(id, filterTradeOffers(all, "received")),
        undefined
      );
  }
  assert.equal(
    resolveTradeReview("absente", [{ id, status: "pending" }]),
    undefined
  );
});

test("les pastilles reflètent le statut réel sans transformer une réponse en indisponibilité", () => {
  const { tradeStatusPresentation } = tradeApi();
  for (const [status, label, tone] of [
    ["pending", "Pending", "gold"],
    ["accepted", "Accepted", "success"],
    ["declined", "Declined", "danger"],
    ["countered", "Countered", "info"],
    ["cancelled", "Canceled", "neutral"],
    ["expired", "Unavailable", "neutral"],
    [undefined, "Unavailable", "neutral"]
  ]) {
    const presentation = tradeStatusPresentation(status);
    assert.equal(presentation.label, label);
    assert.equal(presentation.tone, tone);
    if (["accepted", "declined", "countered", "cancelled"].includes(status))
      assert.notEqual(presentation.label, "Unavailable");
  }
});

test("l’annulation reste disponible uniquement pour une offre envoyée en attente", () => {
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /const cancellable=offer&&!offer\.incoming&&offer\.status==="pending"/
    )
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/onCancel=\{tab==="sent"\?setCancelling:undefined\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/This offer was canceled/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /disabled=\{busy\} onClick=\{\(\)=>cancelling&&void cancel/
    )
  );
});

test("les six erreurs d’annulation ont un message anglais et aucun détail brut", () => {
  const { tradeErrorMessage } = tradeApi();
  for (const code of [
    "TRADE_NOT_FOUND",
    "TRADE_NOT_AUTHOR",
    "TRADE_ALREADY_ACCEPTED",
    "TRADE_ALREADY_DECLINED",
    "TRADE_ALREADY_CANCELLED",
    "TRADE_ALREADY_COUNTERED"
  ]) {
    const message = tradeErrorMessage(code);
    assert.notEqual(message, "Couldn't process this trade. Please try again.");
    assert.ok(!message.includes(code));
  }
});

test("une acceptation devenue impossible traduit TRADE_NOT_PENDING et recharge l’offre examinée", () => {
  const { tradeErrorMessage } = tradeApi();
  assert.equal(
    tradeErrorMessage("TRADE_NOT_PENDING"),
    "This offer is no longer pending."
  );
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  const respond = source.slice(
    source.indexOf("async function respond"),
    source.indexOf("async function cancel")
  );
  const failure = respond.slice(respond.indexOf("catch"));
  assert.match(
    normalizeWhitespace(failure),
    normalizeWhitespace(
      /setError\(e instanceof Error \? e\.message : "Couldn't complete this action\."\)/
    )
  );
  assert.match(
    normalizeWhitespace(failure),
    normalizeWhitespace(/try\{await reload\(\);\}catch\{\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/resolveTradeReview\(reviewedId,offers\)/)
  );
});

test("le popover dépend uniquement de son ID et les liens conservent ami et carte", () => {
  const source = readFileSync(
    new URL("../components/trades.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/Modal open=\{!!reviewedId\}/)
  );
  assert.match(
    normalizeWhitespace(source),
    normalizeWhitespace(/resolveTradeReview\(reviewedId,offers\)/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(source),
    normalizeWhitespace(
      /resolveTradeReview\(reviewedId,received\)|open=\{!!reviewedOffer\}/
    )
  );
  const route = readFileSync(
    new URL("../components/community-views.tsx", import.meta.url),
    "utf8"
  );
  for (const param of ["offre", "ami", "carte"])
    assert.ok(route.includes(`searchParams.get("${param}")`));
  const modal = readFileSync(
    new URL("../components/ui/index.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/open && !ref.current\?\.open/)
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/event.shiftKey/)
  );
  assert.match(
    normalizeWhitespace(modal),
    normalizeWhitespace(/trigger\?\.isConnected/)
  );
});

test("new trade admission refusals use the dedicated en/fr catalogues without exposing SQL codes", () => {
  for (const locale of ["en", "fr"]) {
    const catalog = JSON.parse(
      readFileSync(
        new URL(
          "../messages/trade-limits/" + locale + ".json",
          import.meta.url
        ),
        "utf8"
      )
    );
    const api = tradeApi(locale);
    for (const [code, message] of Object.entries(catalog)) {
      assert.equal(api.tradeErrorMessage(code), message);
      assert.doesNotMatch(api.tradeErrorMessage(code), /TRADE_[A-Z_]+/);
    }
  }
});
