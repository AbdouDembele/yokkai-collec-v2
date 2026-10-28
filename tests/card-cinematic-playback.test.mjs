import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("retired SSR iframe, bridge, documents and endpoints are absent", () => {
  for (const file of [
    "components/local-card-cinematic.tsx",
    "lib/ui/card-cinematic-document.ts",
    "data/card-cinematics/ssr.html",
    "app/api/card-cinematics/route.ts",
    "app/design-system/card-cinematics/document/route.ts"
  ])
    assert.equal(
      existsSync(new URL(`../${file}`, import.meta.url)),
      false,
      file
    );
});
test("SSR native timings match the final reference and do not redraw the card", async () => {
  const { default: postcss } = await import("postcss");
  const css = postcss.parse(read("styles/lr-card-reveal.css"));
  const rules = css.nodes.filter(
    node =>
      node.type === "rule" && node.selector.startsWith(".yk-card-cinematic-ssr")
  );
  const value = (selector, property) =>
    rules
      .find(rule => rule.selector === selector)
      ?.nodes.find(node => node.prop === property)?.value;
  assert.match(
    value(".yk-card-cinematic-ssr .yk-lr-float", "animation"),
    /0?\.72s[\s\S]*3\.494s[\s\S]*2\.5s linear 10\.03s/
  );
  assert.equal(
    value(".yk-card-cinematic-ssr .yk-lr-spin", "animation-duration"),
    "1.18s"
  );
  assert.equal(
    value(".yk-card-cinematic-ssr .yk-lr-spin", "animation-delay"),
    "4.194s"
  );
  assert.equal(
    value(".yk-card-cinematic-ssr .yk-card-badge", "animation-delay"),
    "6.12s"
  );
  assert.equal(
    value(".yk-card-cinematic-ssr .yk-card-name", "animation-delay"),
    "8s"
  );
  assert.match(read("styles/lr-card-reveal.css"), /8\.89s/);
  assert.match(
    value(".yk-card-cinematic-ssr .yk-lr-world", "background"),
    /ssr-pink-world\.webp/
  );
  assert.equal(
    value(".yk-card-cinematic-ssr .yk-lr-world", "animation"),
    "none"
  );
});
test("SSR background is the original embedded WebP, without recompression", () => {
  assert.equal(
    createHash("sha256")
      .update(
        readFileSync(
          new URL(
            "../public/assets/card-reveals/ssr-pink-world.webp",
            import.meta.url
          )
        )
      )
      .digest("hex"),
    "f43dc7dfac7d49c68299abcdd9d0875946880c3d96ea03c4e876bae51980a708"
  );
});
