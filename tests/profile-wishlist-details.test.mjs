import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { intl } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../components/profile.tsx", import.meta.url),
  "utf8"
);
const ast = ts.createSourceFile(
  "profile.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const subject = ast.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === "FriendWishlist"
);
assert.ok(
  subject,
  "test the real wishlist component, not a duplicate implementation"
);
const code = ts.transpileModule(
  `${subject.getText(ast)}\nexports.Subject=FriendWishlist;`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }
).outputText;
const exports = {};
vm.runInNewContext(code, {
  exports,
  require,
  useState: initial => [initial, () => {}],
  useMemo: compute => compute(),
  useTranslations: intl.useTranslations,
  useFormatter: intl.useFormatter,
  matchesCardSearch: () => true,
  Link: "a",
  CardShell: "card-shell",
  YokaiCard: "yokai-card",
  WishlistFilterSection: "filters",
  WishlistRarityIcon: "rarity-icon",
  wishlistRarities: ["LR", "SSR", "SR", "R", "C"],
  wishlistRarityText: {},
  PROFILE_CARD_IMAGE_SIZES: "160px"
});

function links(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(links);
  return [...(node.type === "a" ? [node] : []), ...links(node.props?.children)];
}
const cards = [
  {
    id: "wishlist-card-1",
    name: "GOJO",
    category: "ANIME/MANGA",
    anime: "Jujutsu Kaisen",
    rarity: "LR",
    image: "/test.png",
    createdAt: "2026-10-15T00:00:00Z"
  }
];

test("une carte de wishlist ouvre son détail sur place et conserve un lien de secours", () => {
  let selected;
  let navigations = 0;
  let prevented = 0;
  const tree = exports.Subject({
    cards,
    onSelect: card => (selected = card),
    onNavigate: () => navigations++
  });
  const [card] = links(tree);
  assert.ok(card);
  assert.equal(card.props.href, "/catalog?carte=wishlist-card-1");
  assert.equal(card.props["aria-haspopup"], "dialog");
  card.props.onClick({ button: 0, preventDefault: () => prevented++ });
  assert.equal(selected, cards[0]);
  assert.equal(prevented, 1);
  assert.equal(navigations, 0);
  assert.match(source, /<CatalogueCardModal[\s\S]*?selected=\{wishlistCard\}/);
});

test("ouvrir la carte dans un nouvel onglet conserve le comportement du lien", () => {
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    let navigations = 0;
    const tree = exports.Subject({
      cards,
      onSelect: () => assert.fail("no local modal for modified click"),
      onNavigate: () => navigations++
    });
    links(tree)[0].props.onClick({
      button: 0,
      [modifier]: true,
      preventDefault: () => assert.fail("browser navigation stays available")
    });
    assert.equal(navigations, 1);
  }
});
