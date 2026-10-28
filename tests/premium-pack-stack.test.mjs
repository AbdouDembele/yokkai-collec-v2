import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Premium shows two official boosters of each kind without duplicating accessible labels", () => {
  const source = readFileSync("components/premium-offer.tsx", "utf8");
  for (const kind of ["regular", "decision"]) {
    assert.equal(
      (
        source.match(
          new RegExp(`src="/assets/chrome-${kind}-booster-v1.png"`, "g")
        ) || []
      ).length,
      2
    );
  }
  assert.equal(
    (source.match(/className="yk-pro-pack-stack"/g) || []).length,
    2
  );
  assert.equal(
    (source.match(/className="yk-pro-pack-image yk-pro-pack-back"/g) || [])
      .length,
    2
  );
  assert.equal((source.match(/alt=""\s+aria-hidden="true"/g) || []).length, 2);
  assert.equal((source.match(/alt="Regular Pack"/g) || []).length, 1);
  assert.equal((source.match(/alt="Decision Pack"/g) || []).length, 1);
  assert.match(source, /60 \/ rules\.pro\.regularPackMinutes/);
});

test("booster pairs fan out within a responsive, frameless presentation", () => {
  const css = readFileSync("styles/premium.css", "utf8");
  assert.match(css, /\.yk-pro-pack-stack\s*\{[^}]*width: min\(100%, 240px\);/);
  assert.match(css, /translateX\(-32%\) rotate\(9deg\)/);
  assert.match(css, /translateX\(-75%\) rotate\(-12deg\)/);
  assert.match(
    css,
    /@media \(max-width: 600px\)\s*\{\s*\.yk-pro-pack-stack\s*\{[^}]*height: 205px;/
  );
  assert.doesNotMatch(
    css.match(/\.yk-pro-pack-stack\s*\{([^}]+)\}/)?.[1],
    /border:|background:/
  );
});
