import { intl } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    const path = resolve(root, file);
    if (cache.has(path)) return cache.get(path);
    const loaded = { exports: {} };
    cache.set(path, loaded.exports);
    vm.runInNewContext(
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true
        }
      }).outputText,
      {
        module: loaded,
        exports: loaded.exports,
        URL,
        AbortController,
        ...globals,
        require: id => {
          if (id in mocks) return mocks[id];
          if (id === "next-intl") return intl;
          if (id === "next/link")
            return {
              __esModule: true,
              default: ({ children, ...props }) =>
                React.createElement("a", props, children)
            };
          if (id.startsWith("@/lib/ui/")) return load(id.slice(2) + ".ts");
          if (id.startsWith("@/components/")) return load(id.slice(2) + ".tsx");
          return require(id);
        }
      }
    );
    return loaded.exports;
  }
  return load;
}

test("decorative badge choices show their actual artwork and retain accessible names", () => {
  const load = loader({
    "@/components/pro-access": {
      useProAccess: () => true,
      useProMembershipStatus: () => true
    }
  });
  const { STYLE_BADGES, DEFAULT_PROFILE_STYLE } = load(
    "lib/ui/profile-style.ts"
  );
  const { ProfileStyleFields } = load("components/profile-style-fields.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ProfileStyleFields, {
      name: "BadgeOwner",
      value: DEFAULT_PROFILE_STYLE,
      busy: false,
      onChange: () => {}
    })
  );
  const buttons = [
    ...html.matchAll(
      /<button[^>]+class="yk-style-option yk-style-badge-option"[\s\S]*?<\/button>/g
    )
  ];
  assert.equal(STYLE_BADGES.length, 14);
  assert.equal(buttons.length, STYLE_BADGES.length);
  for (const [index, badge] of STYLE_BADGES.entries()) {
    assert.ok(
      buttons[index][0].includes(`aria-label="${badge.label} decorative badge"`)
    );
    assert.ok(
      buttons[index][0].includes(`data-decorative-badge="${badge.id}"`)
    );
    assert.match(buttons[index][0], /<svg/);
    assert.equal(buttons[index][0].replace(/<[^>]*>/g, ""), "");
  }
});

test("avatar frames and showcase effects use named visual choices with an exact selected state", () => {
  const load = loader({
    "@/components/pro-access": {
      useProAccess: () => true,
      useProMembershipStatus: () => true
    }
  });
  const { DEFAULT_PROFILE_STYLE } = load("lib/ui/profile-style.ts");
  const { ProfileStyleFields } = load("components/profile-style-fields.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ProfileStyleFields, {
      name: "Owner",
      avatarUrl: "https://example.test/avatar.png",
      value: {
        ...DEFAULT_PROFILE_STYLE,
        avatarFrame: "crystal",
        showcaseEffect: "prism"
      },
      busy: false,
      onChange: () => {}
    })
  );
  assert.doesNotMatch(html, /<select/);
  assert.equal(
    [...html.matchAll(/class="yk-style-option yk-style-visual-option"/g)]
      .length,
    19
  );
  assert.equal(
    [
      ...html.matchAll(
        /class="yk-style-option yk-style-visual-option yk-style-showcase-option"/g
      )
    ].length,
    4
  );
  for (const frame of [
    "No",
    "Orbit",
    "Crystal",
    "Bloom",
    "Flame",
    "Cat ears",
    "Royal crown",
    "Sakura",
    "Celestial wings",
    "Electric",
    "Fox spirit",
    "Rose garden",
    "Starry moon",
    "Dragon",
    "Ocean waves",
    "Pixel arcade",
    "Blood moon",
    "Shadow tendrils",
    "Manga rage"
  ])
    assert.ok(html.includes(`aria-label="${frame} avatar frame"`));
  for (const effect of ["No", "Glow", "Sparkle", "Prism"])
    assert.ok(html.includes(`aria-label="${effect} showcase effect"`));
  assert.match(
    html,
    /aria-label="Crystal avatar frame"[^>]*aria-pressed="true"/
  );
  assert.match(
    html,
    /aria-label="Prism showcase effect"[^>]*aria-pressed="true"/
  );
  assert.equal(
    [...html.matchAll(/src="https:\/\/example.test\/avatar.png"/g)].length,
    20
  );
  for (const card of ["gojou", "levi", "luffy"])
    assert.ok(html.includes(`${card}.webp`));
});

test("font choices exclude retired lookalikes and preserve saved styles with a Modern fallback", () => {
  const load = loader({
    "@/components/pro-access": {
      useProAccess: () => true,
      useProMembershipStatus: () => true
    }
  });
  const { NAME_FONTS, DEFAULT_PROFILE_STYLE, normalizeProfileStyle } = load(
    "lib/ui/profile-style.ts"
  );
  const { ProfileStyleFields } = load("components/profile-style-fields.tsx");
  assert.equal(NAME_FONTS.length, 14);
  assert.equal(
    NAME_FONTS.some(font => ["rounded", "display"].includes(font.id)),
    false
  );
  for (const font of ["rounded", "display"]) {
    const style = normalizeProfileStyle({
      ...DEFAULT_PROFILE_STYLE,
      font,
      color: "#123456",
      badges: ["crown"]
    });
    assert.equal(style.font, "modern");
    assert.equal(style.color, "#123456");
    assert.deepEqual(Array.from(style.badges), ["crown"]);
  }
  const html = renderToStaticMarkup(
    React.createElement(ProfileStyleFields, {
      name: "Owner",
      value: DEFAULT_PROFILE_STYLE,
      busy: false,
      onChange: () => {}
    })
  );
  assert.equal(
    [...html.matchAll(/class="yk-style-option yk-style-font-option"/g)].length,
    14
  );
  assert.doesNotMatch(html, /aria-label="(?:Rounded|Display) profile font"/);
  assert.equal(
    [...html.matchAll(/<span aria-hidden="true">Abc<\/span>/g)].length,
    14
  );
});

test("dark name colors gain contrast without changing saved colors or already readable shades", () => {
  const load = loader();
  const { readableNameColor } = load("lib/ui/name-contrast.ts");
  const { nameStyleVariables, DEFAULT_PROFILE_STYLE } = load(
    "lib/ui/profile-style.ts"
  );
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const luminance = hex => {
    const values = rgb(hex)
      .map(c => c / 255)
      .map(c =>
        c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      );
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  for (const red of [0, 51, 102, 153, 204, 255])
    for (const green of [0, 51, 102, 153, 204, 255])
      for (const blue of [0, 51, 102, 153, 204, 255]) {
        const color =
          "#" +
          [red, green, blue].map(c => c.toString(16).padStart(2, "0")).join("");
        const readable = readableNameColor(color);
        assert.ok(
          (luminance(readable) + 0.05) / (luminance("#242838") + 0.05) >= 4.5,
          `${color} -> ${readable}`
        );
        if ((luminance(color) + 0.05) / (luminance("#242838") + 0.05) >= 4.5)
          assert.equal(readable, color);
        assert.ok(rgb(readable).every((c, i) => c >= rgb(color)[i]));
      }
  assert.equal(readableNameColor("url(bad)"), "#eeebff");
  const style = {
    ...DEFAULT_PROFILE_STYLE,
    color: "#000000",
    secondary: "#102030"
  };
  const variables = nameStyleVariables(style);
  assert.equal(variables["--name-color"], "#000000");
  assert.equal(variables["--name-secondary"], "#102030");
  assert.notEqual(variables["--name-readable-color"], "#000000");
  assert.equal(style.color, "#000000");
});

test("name effect labels render the shared effect styles with the chosen colors", () => {
  const load = loader({
    "@/components/pro-access": {
      useProAccess: () => true,
      useProMembershipStatus: () => true
    }
  });
  const { NAME_EFFECTS, DEFAULT_PROFILE_STYLE } = load(
    "lib/ui/profile-style.ts"
  );
  const { ProfileStyleFields } = load("components/profile-style-fields.tsx");
  assert.equal(NAME_EFFECTS.length, 14);
  const html = renderToStaticMarkup(
    React.createElement(ProfileStyleFields, {
      name: "Owner",
      value: {
        ...DEFAULT_PROFILE_STYLE,
        color: "#123456",
        secondary: "#abcdef",
        effect: "aurora"
      },
      busy: false,
      onChange: () => {}
    })
  );
  for (const { id, label } of NAME_EFFECTS) {
    assert.ok(html.includes(`aria-label="${label} name effect"`));
    assert.match(
      html,
      new RegExp(
        `class="yk-style-name" data-name-effect="${id}" style="[^"]*--name-color:#123456;--name-secondary:#abcdef">${label}<`
      )
    );
  }
  assert.match(html, /aria-label="Aurora name effect"[^>]*aria-pressed="true"/);
});

test("showcase color stays independent of the name and invalid CSS colors are ignored", () => {
  const load = loader({
    "@/components/pro-access": {
      useProAccess: () => true,
      useProMembershipStatus: () => true
    }
  });
  const {
    DEFAULT_PROFILE_STYLE,
    normalizeProfileStyle,
    showcaseColorVariables
  } = load("lib/ui/profile-style.ts");
  const { ProfileStyleFields } = load("components/profile-style-fields.tsx");
  const style = {
    ...DEFAULT_PROFILE_STYLE,
    showcaseEffect: "glow",
    showcaseColor: "#ff4d9d"
  };
  const html = renderToStaticMarkup(
    React.createElement(ProfileStyleFields, {
      name: "Owner",
      value: style,
      busy: false,
      onChange: () => {}
    })
  );
  assert.match(html, /--showcase-color:#ff4d9d/);
  assert.match(html, /aria-label="Showcase color hue"/);
  assert.match(html, /aria-label="Showcase color picker"/);
  assert.match(html, /Saturation/);
  assert.match(html, /Brightness/);
  assert.equal(normalizeProfileStyle(style).color, DEFAULT_PROFILE_STYLE.color);
  assert.equal(normalizeProfileStyle(style).showcaseColor, "#ff4d9d");
  assert.equal(
    normalizeProfileStyle({ ...style, showcaseColor: "url(bad)" })
      .showcaseColor,
    undefined
  );
  assert.equal(
    Object.keys(showcaseColorVariables({ showcaseColor: "url(bad)" })).length,
    0
  );
});

test("new avatar contours share artwork in each choice and the live preview", () => {
  const load = loader({
    "@/components/pro-access": {
      useProAccess: () => true,
      useProMembershipStatus: () => true
    }
  });
  const { DEFAULT_PROFILE_STYLE, normalizeProfileStyle } = load(
    "lib/ui/profile-style.ts"
  );
  const { ProfileStyleFields } = load("components/profile-style-fields.tsx");
  for (const frame of [
    "cat",
    "royal",
    "sakura",
    "wings",
    "electric",
    "fox",
    "roses",
    "lunar",
    "dragon",
    "ocean",
    "pixel"
  ]) {
    const value = { ...DEFAULT_PROFILE_STYLE, avatarFrame: frame };
    assert.equal(normalizeProfileStyle(value).avatarFrame, frame);
    const html = renderToStaticMarkup(
      React.createElement(ProfileStyleFields, {
        name: "Owner",
        value,
        busy: false,
        onChange: () => {}
      })
    );
    assert.equal(html.split(`data-avatar-decoration="${frame}"`).length - 1, 2);
  }
});

test("the retired Laurel decoration is absent from choices and saved legacy values normalize to none", () => {
  const load = loader();
  const { AVATAR_FRAMES, DEFAULT_PROFILE_STYLE, normalizeProfileStyle } = load(
    "lib/ui/profile-style.ts"
  );
  const { AvatarDecoration } = load("components/avatar-decoration.tsx");
  assert.equal(
    AVATAR_FRAMES.some(frame => frame.id === "laurel"),
    false
  );
  assert.equal(
    normalizeProfileStyle({ ...DEFAULT_PROFILE_STYLE, avatarFrame: "laurel" })
      .avatarFrame,
    "none"
  );
  assert.equal(
    renderToStaticMarkup(
      React.createElement(AvatarDecoration, { frame: "laurel" })
    ),
    ""
  );
});

test("every available avatar contour has artwork and an explicit animation mode", () => {
  const load = loader();
  const { AVATAR_FRAMES } = load("lib/ui/profile-style.ts");
  const { AvatarDecoration } = load("components/avatar-decoration.tsx");
  const css = readFileSync(resolve(root, "styles/profile-style.css"), "utf8");
  assert.equal(AVATAR_FRAMES.length, 19);
  for (const { id } of AVATAR_FRAMES) {
    const html = renderToStaticMarkup(
      React.createElement(AvatarDecoration, { frame: id })
    );
    if (id === "none") {
      assert.equal(html, "");
      continue;
    }
    assert.ok(html.includes(`data-avatar-decoration="${id}"`));
    const mode = html.match(/data-avatar-motion="([a-z]+)"/)?.[1];
    assert.ok(mode, id + " animation mode missing");
    assert.ok(
      css.includes(`[data-avatar-motion="${mode}"]`),
      mode + " CSS missing"
    );
    assert.match(html, /yk-avatar-decoration-art/);
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("Pro name rendering follows its owner's server projection, not the viewing player's membership", () => {
  const load = loader();
  const { StyledPlayerName } = load("components/styled-player-name.tsx");
  const basic = renderToStaticMarkup(
    React.createElement(StyledPlayerName, {
      name: "Basic",
      cosmetics: { active: false, style: { effect: "neon" } }
    })
  );
  assert.equal(basic, "Basic");
  const paid = renderToStaticMarkup(
    React.createElement(StyledPlayerName, {
      name: "ProOwner",
      cosmetics: { active: true, style: { effect: "neon", badges: ["comet"] } }
    })
  );
  assert.match(paid, /data-name-effect="neon"/);
  assert.match(paid, /aria-label="Yokkai Pro"/);
  assert.match(paid, /data-pro-badge="true"/);
  assert.match(paid, /yk-profile-pro-badge-star/);
  assert.match(
    paid,
    /class="yk-profile-pro-badge-seal" d="M12 1\.5 14\.3 3\.4/
  );
  assert.ok(
    paid.includes(
      'class="yk-profile-pro-badge-star" d="m12 5.8 1.92 3.89 4.29.62-3.1 3.03.73 4.27L12 15.59l-3.84 2.02.73-4.27-3.1-3.03 4.29-.62Z"'
    )
  );
  assert.match(paid, /comet decorative badge/);
  assert.doesNotMatch(paid, /local preview|verified role/i);
});
test("Basic players can preview profile styles while the controls stay usable", () => {
  for (const pro of [false, true]) {
    const load = loader({
      "@/components/pro-access": {
        useProAccess: () => pro,
        useProMembershipStatus: () => pro,
        ProFeatureNotice: () =>
          React.createElement("p", null, "Pro members only")
      }
    });
    const { DEFAULT_PROFILE_STYLE } = load("lib/ui/profile-style.ts");
    const { ProfileStyleFields } = load("components/profile-style-fields.tsx");
    const html = renderToStaticMarkup(
      React.createElement(ProfileStyleFields, {
        name: "Owner",
        value: DEFAULT_PROFILE_STYLE,
        busy: false,
        onChange: () => {}
      })
    );
    assert.doesNotMatch(html, /<fieldset disabled/);
    if (pro) {
      assert.match(html, /PRO ACTIVE/);
      assert.doesNotMatch(html, /PREVIEW ONLY|live profile stays unchanged/);
    } else {
      assert.match(html, /PREVIEW ONLY/);
      assert.match(html, /Try every option and preview the result here/);
      assert.match(html, /live profile stays unchanged/);
      assert.match(html, /href="\/premium"/);
    }
    assert.match(html, /aria-label="Profile style preview"/);
    assert.match(html, /yk-style-workspace/);
    assert.match(html, /LIVE PREVIEW/);
    assert.match(html, /data-profile-theme="default"/);
    assert.match(html, /data-avatar-frame="none"/);
    assert.match(html, /data-showcase-effect="none"/);
    assert.match(html, /aria-label="Yokkai Pro"/);
    assert.match(html, /Avatar frame/);
    assert.match(html, /Name colors/);
    assert.match(html, /aria-label="Primary R"/);
    assert.match(html, /aria-label="Primary G"/);
    assert.match(html, /aria-label="Primary B"/);
    assert.match(html, /aria-label="Accent R"/);
    assert.match(html, /Showcase effect/);
    assert.doesNotMatch(html, /Site background|Card back/);
    assert.doesNotMatch(html, /type="file"/);
  }
});
test("presentation normalizes CSS enums, hex colors, badge limits and safe uploaded media", () => {
  const {
    normalizeProfileStyle,
    DEFAULT_PROFILE_STYLE,
    profileThemeVariables,
    safeStyleMedia
  } = loader()("lib/ui/profile-style.ts");
  const value = normalizeProfileStyle({
    ...DEFAULT_PROFILE_STYLE,
    color: "url(javascript:bad)",
    font: "bad font",
    badges: ["comet", "comet", "flame", "moon", "bloom", "unknown"],
    backgroundUrl: "javascript:alert(1)"
  });
  assert.equal(value.color, "#eeebff");
  assert.equal(value.font, "classic");
  assert.equal(value.badges.length, 3);
  assert.ok(!value.backgroundUrl);
  const themeVariables = profileThemeVariables({
    ...DEFAULT_PROFILE_STYLE,
    color: "#123456",
    secondary: "#abcdef"
  });
  assert.equal(themeVariables["--profile-theme-primary"], "#123456");
  assert.equal(themeVariables["--profile-theme-accent"], "#abcdef");
  assert.equal(
    safeStyleMedia(
      "https://example.test/storage/v1/object/public/avatars/owner/background.png"
    ),
    true
  );
  assert.equal(
    safeStyleMedia(
      "https://user:password@example.test/storage/v1/object/public/avatars/a.png"
    ),
    false
  );
});
test("membership synchronization grants only a strict server boolean and drops presentation access after failure", async () => {
  let effect;
  const states = [];
  let stateIndex = 0;
  const listeners = new Map();
  const window = {
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 2,
    clearInterval() {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name)
  };
  const document = {
    visibilityState: "visible",
    addEventListener: window.addEventListener,
    removeEventListener: window.removeEventListener
  };
  let active = true,
    failed = false,
    styleActive = true,
    styleAvailable = true;
  const fakeReact = {
    ...React,
    useEffect: fn => {
      effect = fn;
    },
    useState: initial => {
      const index = stateIndex++;
      states[index] = initial;
      return [
        initial,
        next => {
          states[index] = next;
        }
      ];
    }
  };
  const load = loader(
    { react: fakeReact },
    {
      window,
      document,
      fetch: async path => {
        if (failed) throw Error("offline");
        return {
          ok: path.endsWith("benefits") || styleAvailable,
          json: async () =>
            path.endsWith("benefits")
              ? { active }
              : { active: styleActive, style: { effect: "neon" } }
        };
      }
    }
  );
  load("components/pro-access.tsx").ProAccessProvider({ children: null });
  const stop = effect();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(states[0], true);
  assert.equal(states[1].effect, "neon");
  active = "true";
  listeners.get("focus")();
  await flush();
  assert.equal(states[0], false);
  assert.equal(states[1], null);
  active = true;
  listeners.get("focus")();
  await flush();
  assert.equal(states[0], true);
  styleActive = false;
  listeners.get("focus")();
  await flush();
  assert.equal(states[0], false);
  styleActive = true;
  styleAvailable = false;
  listeners.get("focus")();
  await flush();
  assert.equal(states[0], false);
  styleAvailable = true;
  failed = true;
  listeners.get("online")();
  await flush();
  assert.equal(states[0], false);
  assert.equal(states[1], null);
  stop();
  assert.equal(listeners.size, 0);
});
test("sales actions point to account settings and never create a second or simulated checkout", () => {
  const source = readFileSync(
    resolve(root, "components/premium-checkout.tsx"),
    "utf8"
  );
  assert.match(source, /\/settings#subscription/);
  assert.match(source, /billing\?\.checkoutEnabled/);
  assert.doesNotMatch(
    source,
    /\/api\/premium|localStorage|localPremiumEnabled|STRIPE_SECRET/
  );
  for (const file of [
    "components/profile.tsx",
    "components/community-views.tsx",
    "components/profile-wall.tsx"
  ])
    assert.match(readFileSync(resolve(root, file), "utf8"), /StyledPlayerName/);
  const offer = readFileSync(resolve(root, "lib/premium/offer.ts"), "utf8");
  assert.match(offer, /Coming soon/);
  assert.match(offer, /reward Karas|Karas rewards/);
});
