import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export async function renderRelated(locale = "en", params = {}) {
  const messages = JSON.parse(
    fs.readFileSync(`messages/${locale}.json`, "utf8")
  );
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          target: ts.ScriptTarget.ES2022
        }
      }).outputText,
      {
        exports: mod.exports,
        module: mod,
        URLSearchParams,
        Intl,
        require(name) {
          if (name === "next-intl/server")
            return {
              getTranslations: async namespace =>
                createTranslator({ locale, messages, namespace })
            };
          if (name === "next/link")
            return {
              __esModule: true,
              default: ({ children, ...p }) =>
                React.createElement("a", p, children)
            };
          if (name === "@/app/admin/security/related-account-picker")
            return load("app/admin/security/related-account-picker.tsx");
          if (name === "./fixtures")
            return load(
              "app/design-system/related-accounts-preview/fixtures.ts"
            );
          if (name === "./event-detail")
            return load("app/admin/security/event-detail.tsx");
          return require(name);
        }
      }
    );
    cache.set(file, mod.exports);
    return mod.exports;
  }
  async function resolve(node) {
    if (Array.isArray(node))
      return Promise.all(React.Children.toArray(node).map(resolve));
    if (!React.isValidElement(node)) return node;
    if (typeof node.type === "function")
      return resolve(await node.type(node.props));
    const children = await resolve(node.props.children);
    return React.cloneElement(
      node,
      {},
      ...(Array.isArray(children) ? children : [children])
    );
  }
  return renderToStaticMarkup(
    await resolve(
      await load("app/design-system/related-accounts-preview/page.tsx").default(
        { searchParams: Promise.resolve(params) }
      )
    )
  );
}
