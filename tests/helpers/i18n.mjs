import { readFileSync } from "node:fs";
import { createTranslator, createFormatter } from "next-intl";
import vm from "node:vm";
import ts from "typescript";

export const englishMessages = JSON.parse(
  readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")
);
const translator = namespace =>
  createTranslator({ locale: "en", messages: englishMessages, namespace });

// Use the real ICU formatter and source English catalogue in isolated component
// tests, preserving their existing rendered-output assertions without a router.
export const intl = {
  createTranslator,
  useTranslations: translator,
  useLocale: () => "en",
  useFormatter: () => createFormatter({ locale: "en", timeZone: "UTC" }),
  NextIntlClientProvider: ({ children }) => children
};
export const intlServer = {
  getTranslations: async namespace => translator(namespace),
  getLocale: async () => "en"
};

export function loadLocaleModule(env = {}) {
  const context = { exports: {}, process: { env } };
  const source = readFileSync(
    new URL("../../i18n/locale.ts", import.meta.url),
    "utf8"
  );
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    context
  );
  return context.exports;
}

function loadGameMessages() {
  const context = { exports: {} };
  const source = readFileSync(
    new URL("../../i18n/game-messages.ts", import.meta.url),
    "utf8"
  );
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    context
  );
  return context.exports;
}
export const gameMessages = loadGameMessages();
