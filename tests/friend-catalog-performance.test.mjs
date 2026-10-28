import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("la collection d'un ami charge des images adaptées à la grille", () => {
  const collection = read("../components/collection.tsx");
  const profile = read("../components/profile.tsx");

  assert.match(collection, /COLLECTION_CARD_IMAGE_SIZES/);
  assert.match(profile, /PROFILE_CARD_IMAGE_SIZES/);
  assert.doesNotMatch(collection, /imageSizes="100vw"/);
  assert.doesNotMatch(profile, /imageSizes="100vw"/);
  assert.match(collection, /animated=\{!readOnly\}/);
  assert.doesNotMatch(collection, /<CardShell interactive=\{!readOnly\}>/);
});

test("la collection en lecture seule neutralise le tilt et la reflexion des cartes", () => {
  const shell = read("../components/card-shell.tsx");
  const css = read("../styles/card-shell.css");

  assert.match(shell, /interactive\?: boolean/);
  assert.match(shell, /demoState \|\| !interactive/);
  assert.match(shell, /yk-card-shell-static/);
  assert.match(
    css,
    /\.yk-card-shell-static \.yk-card-shell-reflection\s*\{[^}]*display:\s*none/s
  );
  assert.match(
    css,
    /\.yk-card-shell-static:hover \.yk-card-shell-plane\s*\{[^}]*translateY\(var\(--card-shell-hover-lift\)\)/s
  );
  assert.match(css, /\.yk-card-shell:not\(\.yk-card-shell-static\)/);
});

test("le catalogue d'un ami conserve le hover fluide sans promouvoir toutes les cartes sur le GPU", () => {
  const collection = read("../components/collection.tsx");
  const css = read("../styles/card-shell.css");

  assert.match(collection, /animated=\{!readOnly\}/);
  assert.match(css, /\.yk-card-shell-plane[^}]*will-change:\s*auto/s);
  assert.match(
    css,
    /\.yk-card-shell:hover \.yk-card-shell-plane\s*\{[^}]*will-change:\s*transform/s
  );
  assert.match(
    css,
    /\.yk-card-shell:hover \.yk-card-shell-reflection\s*\{[^}]*will-change:\s*transform,\s*opacity/s
  );
});

test("la modale de collection d'un ami n'impose pas de flou plein ecran pendant le tilt", () => {
  const profile = read("../components/profile.tsx");
  const css = read("../styles/community.css");

  assert.match(
    profile,
    /className="yk-friend-collection-modal yk-friend-card-grid-modal"/
  );
  assert.match(
    css,
    /\.yk-modal\.yk-friend-card-grid-modal::backdrop\s*\{[^}]*backdrop-filter:\s*none/s
  );
  assert.match(
    css,
    /\.yk-friend-card-grid-modal \.yk-collection-grid > li\s*\{[^}]*contain:\s*layout style/s
  );
});

test("la collection d'un ami ne relit pas les licences déjà renvoyées par le RPC", () => {
  const profileData = read("../lib/data/profile.ts");
  const implementation = profileData.match(
    /export async function getFriendCollection[\s\S]*?\nexport async function saveProfile/
  )?.[0];

  assert.ok(implementation);
  assert.match(implementation, /readRequest/);
  assert.doesNotMatch(implementation, /withLiveCardFranchises/);
});
