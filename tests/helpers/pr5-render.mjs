import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, createFormatter } from "next-intl";
const require = createRequire(import.meta.url);
const read = p => readFileSync(p, "utf8");
const catalogues = Object.fromEntries(
  ["en", "fr"].map(locale => [
    locale,
    JSON.parse(read(`messages/${locale}.json`))
  ])
);
export function fixture(locale = "en", source = read) {
  const cache = new Map(),
    t = namespace =>
      createTranslator({ locale, messages: catalogues[locale], namespace }),
    fmt = createFormatter({ locale, timeZone: "UTC" });
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const input = source(file);
    const mod = { exports: {} };
    cache.set(file, mod);
    const mocks = {
      "next-intl": {
        useTranslations: t,
        useFormatter: () => fmt,
        useLocale: () => locale
      },
      "next-intl/server": {
        getTranslations: async n => t(n),
        getLocale: async () => locale,
        getFormatter: async () => fmt
      },
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) =>
          React.createElement("a", props, children)
      },
      "next/image": {
        __esModule: true,
        default: ({ priority, fill, unoptimized, sizes, ...props }) =>
          React.createElement("img", props)
      },
      "next/navigation": {
        notFound: () => {
          throw Error("404");
        }
      },
      "@/lib/discord-invite": { getDiscordInviteUrl: () => null },
      "@/lib/auth/session": { getCurrentUser: async () => null },
      "@/lib/billing/settings": { getBillingSettings: async () => null },
      "@/components/pro-access": { useOwnProfileStyle: () => null },
      "@/lib/server/card-sharing": {
        getSharedCard: async () => ({
          cardName: "SATORU GOJO",
          rarity: "SSR",
          shiny: false,
          isEvolved: true,
          category: "Manga",
          franchise: "JUJUTSU KAISEN",
          pseudo: "Joueur {FR}",
          catalogueImageUrl: null
        }),
        isShareImageUrl: () => false
      }
    };
    vm.runInNewContext(
      ts.transpileModule(input, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          resolveJsonModule: true
        }
      }).outputText,
      {
        module: mod,
        exports: mod.exports,
        URL,
        Error,
        process: {
          env: {
            NODE_ENV: "test",
            NEXT_PUBLIC_SITE_URL: "https://example.test",
            NEXT_PUBLIC_I18N_ENABLED: locale === "fr" ? "true" : "false"
          }
        },
        require(id) {
          if (id in mocks) return mocks[id];
          if (id.endsWith(".css")) return {};
          if (id.startsWith("@/")) {
            const path = id.slice(2);
            if (path.endsWith(".json")) return JSON.parse(source(path));
            for (const suffix of [".tsx", ".ts", "/index.tsx"]) {
              try {
                return load(path + suffix);
              } catch (e) {
                if (e.code !== "ENOENT") throw e;
              }
            }
          }
          return require(id);
        }
      }
    );
    return mod.exports;
  }
  return {
    page: load,
    async render(file, props = {}) {
      const C = load(file).default;
      return renderToStaticMarkup(await C(props));
    }
  };
}
