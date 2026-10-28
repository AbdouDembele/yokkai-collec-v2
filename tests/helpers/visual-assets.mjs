import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function assertPngAsset(src) {
  assert.match(src ?? "", /^\/assets\/[a-zA-Z0-9_-]+\.png$/);
  const bytes = readFileSync(new URL(`../../public${src}`, import.meta.url));
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
  return src;
}

export function imageAsset(source, className) {
  const images = source.match(/<(?:Image|img)\b[\s\S]*?\/>/g) ?? [];
  const image = images.find(tag => tag.includes(`className="${className}"`));
  assert.ok(image, `Missing image: ${className}`);
  return assertPngAsset(image.match(/\bsrc="([^"]+)"/)?.[1]);
}

export function assertTearAssets(opening, decision, regular) {
  assert.notEqual(decision, regular);
  for (const part of ["body", "top"]) {
    const image = opening.match(
      new RegExp(`<img\\s+className="yk-pack-tear-${part}"[^>]*>`)
    )?.[0];
    assert.ok(image, `Missing tear layer: ${part}`);
    const sources = image.match(
      /src=\{drawKind === "decision"\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\}/
    );
    assert.ok(sources, `Missing active pack selection: ${part}`);
    assert.equal(sources[1], decision);
    assert.equal(sources[2], regular);
  }
}
