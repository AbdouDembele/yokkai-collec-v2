import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync("tailwind.config.ts", "utf8");
test("the shared UI uses the navigation's midnight blue instead of violet", () => {
  const expected = {
    night: "#060913",
    surface: "#060913",
    elevated: "#0A1120",
    veil: "#111D30",
    "veil-strong": "#243751",
    focus: "#527BAF",
    "focus-ring": "#A8C7F5",
    "pack-accent": "#bccdff",
    "pack-button-start": "#0d1728",
    "pack-button-middle": "#080f1c",
    "pack-button-end": "#101b2e"
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(
      config.includes(`${key.includes("-") ? `"${key}"` : key}: "${value}"`),
      key
    );
  }
  assert.match(
    readFileSync("styles/topbar.css", "utf8"),
    /rgba\(6, 9, 19, 0\.94\)/
  );
});

test("rarity colors, custom name colors and card art are not recolored by the UI theme", () => {
  assert.match(config, /"rarity-lr": "#E8C26A"/);
  assert.match(config, /"rarity-ssr": "#FF5FA8"/);
  const profile = readFileSync("lib/ui/profile-style.ts", "utf8");
  assert.match(profile, /\{ label: "Lavender", value: "#b69aff" \}/);
  const styles = readFileSync("styles/profile-style.css", "utf8");
  assert.match(styles, /var\(--name-color/);
  assert.match(styles, /var\(--name-secondary\)/);
  for (const path of ["styles/ui.css", "styles/collection.css"]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /filter:\s*hue-rotate/);
  }
});
