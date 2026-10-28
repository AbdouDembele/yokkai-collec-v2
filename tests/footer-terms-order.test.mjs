import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the shared footer places Terms of Use immediately after Rules", () => {
  const source = readFileSync("components/site-footer.tsx", "utf8");
  const navigation = source.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  const routes = [...navigation.matchAll(/<Link href="([^"]+)"/g)].map(
    match => match[1]
  );
  assert.deepEqual(routes, [
    "/rarities",
    "/rules",
    "/terms",
    "/privacy",
    "/info"
  ]);
});
