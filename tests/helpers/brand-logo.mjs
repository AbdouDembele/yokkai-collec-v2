import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Each approved asset retains its exact dimensions; unknown logos are rejected.
export function assertBrandLogo(source) {
  const match = source.match(
    /src="\/assets\/brand-logo-(chrome|blue|ice-retro)\.png"/
  );
  assert.ok(match, "An approved brand asset must be rendered");
  const name = match[1];
  const [width, height] = name === "blue" ? [1448, 1086] : [1672, 941];
  const png = readFileSync(`public/assets/brand-logo-${name}.png`);
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
  assert.equal(png.readUInt32BE(16), width);
  assert.equal(png.readUInt32BE(20), height);
  const hashes = {
    blue: "f3db5d151dd146ef34bcb4a31fef32280998f7175a3018c9e4b1bcd044478bce",
    "ice-retro":
      "35d3805bb96fa6c4a039f51cefdcfa9b1a15e5115322f4fca8c37cc596e560d2"
  };
  if (hashes[name])
    assert.equal(createHash("sha256").update(png).digest("hex"), hashes[name]);
  assert.match(
    source,
    new RegExp(
      `src="/assets/brand-logo-${name}\\.png"\\s+alt=""\\s+width=\\{${width}\\}\\s+height=\\{${height}\\}`
    )
  );
  return name;
}
