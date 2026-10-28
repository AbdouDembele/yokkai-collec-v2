import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
const messages = locale =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
function render(file, name, locale = "fr") {
  const catalogue = messages(locale);
  const loaded = {};
  const load = path => {
    if (loaded[path]) return loaded[path];
    const exports = {};
    const require = module => {
      if (module === "react/jsx-runtime") return jsxRuntime;
      if (module === "react")
        return {
          ...React,
          useEffect: () => {},
          useRef: value => ({ current: value }),
          useActionState: () => [{}, () => {}, false],
          useState: value => [
            path.includes("linked-account-notice") && value === undefined
              ? "google"
              : value,
            () => {}
          ]
        };
      if (module === "next-intl")
        return {
          useTranslations: namespace =>
            createTranslator({ locale, messages: catalogue, namespace })
        };
      if (module === "next/link")
        return {
          default: ({ href, ...props }) =>
            React.createElement("a", { href, ...props })
        };
      if (module === "@/messages/en.json") return { default: messages("en") };
      if (module === "@/lib/auth/oauth") return load("lib/auth/oauth.ts");
      if (module === "@/lib/auth/forms") return load("lib/auth/forms.ts");
      if (module === "@/i18n/auth-messages")
        return load("i18n/auth-messages.ts");
      if (module === "@/app/auth/actions")
        return { checkPseudoAvailabilityWhileTyping: async () => true };
      if (module === "@/app/auth/oauth-actions")
        return { startOAuth: async () => ({}), chooseUsername: () => {} };
      throw Error(module);
    };
    vm.runInNewContext(
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        }
      }).outputText,
      { exports, require }
    );
    loaded[path] = exports;
    return exports;
  };
  return renderToStaticMarkup(React.createElement(load(file)[name]));
}
test("OAuth buttons, username form and linked notice render French UI without translating provider names", () => {
  const buttons = render("components/oauth-buttons.tsx", "OAuthButtons");
  assert.match(buttons, /Continuer avec Google/);
  assert.match(buttons, /Continuer avec Discord/);
  assert.match(buttons, /ou utilise ton adresse e-mail/);
  assert.doesNotMatch(buttons, /Continue with|or use your email/);
  const username = render(
    "components/choose-username-form.tsx",
    "ChooseUsernameForm"
  );
  assert.match(username, /Choisis ton pseudo/);
  assert.match(username, /Ton nom de collectionneur/);
  assert.doesNotMatch(
    username,
    /Choose your username|Your collector name|Terms of Use/
  );
  const notice = render(
    "components/linked-account-notice.tsx",
    "LinkedAccountNotice"
  );
  assert.match(notice, /Ton compte Google est maintenant lié/);
  assert.match(notice, /Tu peux te connecter avec Google/);
});
test("the same extracted Auth text keeps its exact English labels", () => {
  assert.match(
    render("components/oauth-buttons.tsx", "OAuthButtons", "en"),
    /Continue with Google/
  );
  assert.match(
    render("components/choose-username-form.tsx", "ChooseUsernameForm", "en"),
    /Choose your username/
  );
  assert.match(
    render("components/linked-account-notice.tsx", "LinkedAccountNotice", "en"),
    /Your Google account is now linked to your existing Yokkai account\. You can sign in with Google or with your email and password\./
  );
});
