"use client";

import ErrorPage from "@/app/error";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";

export default function GlobalError({ retry }: { retry: () => void }) {
  // A failed root layout cannot provide its request locale/context. Keep the
  // deterministic English emergency fallback independent of that provider.
  const t = createTranslator({
    locale: "en",
    messages: { globalError: messages.globalError },
    namespace: "globalError"
  });
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0c1017", color: "#fff" }}>
        <title>{t("title")}</title>
        <NextIntlClientProvider
          locale="en"
          messages={{ error: messages.error }}
          timeZone="UTC"
        >
          <ErrorPage retry={retry} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
