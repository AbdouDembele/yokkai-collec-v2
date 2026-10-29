import { auctionMentionParts } from "./helpers/auction-mentions.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { intl, gameMessages } from "./helpers/i18n.mjs";

// Run the actual component and its keyboard handlers without a backend or timers.
function chatHarness() {
  const source = readFileSync(
    new URL("../components/community-views.tsx", import.meta.url),
    "utf8"
  );
  const component = source.slice(
    source.indexOf("export function AuctionChatPanel"),
    source.indexOf("export function AuctionView")
  );
  const participants = ["Alice", "Bob", "Charlie"].map(pseudo => ({
    userId: pseudo,
    pseudo,
    mine: false
  }));
  const slots = [];
  let cursor = 0;
  let tree;
  let listener;
  const effects = [];
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const textarea = {
    addEventListener: (_, callback) => {
      listener = callback;
    },
    removeEventListener: (_, callback) => {
      if (listener === callback) listener = undefined;
    }
  };
  const exports = {};
  const sent = [];
  const context = {
    useTranslations: intl.useTranslations,
    useFormatter: intl.useFormatter,
    Intl,
    auctionMentionParts,
    AuctionMessageText: "message-text",
    gameErrorKey: gameMessages.gameErrorKey,
    exports,
    require: () => jsx,
    liveAuctionChat: {},
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] =
          i === 1 ? { participants, messages: [], canPost: true } : initial;
      return [
        slots[i],
        value => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        }
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useMemo(callback, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: callback() };
      return slots[i].value;
    },
    useCallback(callback, deps) {
      return context.useMemo(() => callback, deps);
    },
    useEffect(callback, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) {
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: callback() };
        });
      }
    },
    window: {
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      setInterval: () => 1,
      clearInterval() {}
    },
    document: {
      getElementById: () => textarea,
      querySelectorAll: () => participants.map(() => ({ setAttribute() {} }))
    },
    HTMLTextAreaElement: Object,
    StyledPlayerAvatar: "avatar",
    Avatar: () => null,
    StyledPlayerName: () => null,
    EmojiReactionPicker: "emoji-picker",
    GifPicker: () => null,
    Button: () => null
  };
  vm.runInNewContext(
    ts.transpileModule(component, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    context
  );
  function render() {
    cursor = 0;
    tree = exports.AuctionChatPanel({
      auctionId: "auction",
      refreshKey: 0,
      finished: false,
      adapter: {
        send: (...args) => {
          sent.push(args);
          return new Promise(() => {});
        }
      }
    });
    effects.splice(0).forEach(effect => effect());
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return [
      node,
      ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child))
    ];
  }
  const input = () => nodes(tree).find(node => node.type === "textarea");
  render();
  return {
    sent,
    input,
    selected: () =>
      nodes(tree)
        .filter(node => node.props?.role === "option")
        .map(node => node.props["aria-selected"]),
    type(value) {
      input().props.onChange({ target: { value } });
      render();
    },
    key(key, isComposing = false) {
      let stopped = false;
      const event = {
        key,
        isComposing,
        nativeEvent: { isComposing },
        preventDefault() {},
        stopPropagation() {
          stopped = true;
        }
      };
      listener?.(event);
      if (!stopped) input().props.onKeyDown(event);
      render();
    }
  };
}

test("UX-04: mentions render selection and support arrows, Enter and Escape", () => {
  const chat = chatHarness();
  chat.type("@");
  assert.deepEqual(chat.selected(), [true, false, false]);
  chat.key("ArrowUp");
  assert.deepEqual(chat.selected(), [false, false, true]);
  chat.key("ArrowDown");
  assert.deepEqual(chat.selected(), [true, false, false]);
  chat.key("ArrowDown");
  assert.deepEqual(chat.selected(), [false, true, false]);
  chat.key("Enter", true);
  assert.equal(chat.input().props.value, "@");
  chat.key("Enter");
  assert.equal(chat.input().props.value, "@Bob ");
  assert.equal(chat.sent.length, 0);
  chat.type("@");
  chat.key("ArrowDown");
  chat.type("@Ch");
  assert.deepEqual(chat.selected(), [true]);
  chat.key("Escape");
  assert.deepEqual(chat.selected(), []);
  assert.equal(chat.input().props.value, "@Ch");
  chat.type("@A");
  assert.deepEqual(chat.selected(), [true]);
  chat.key("Tab");
  assert.equal(chat.input().props.value, "@Alice ");
});
