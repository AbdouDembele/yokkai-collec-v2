"use client";
import { useTranslations } from "next-intl";

export default function ErrorPage({ retry }: { retry: () => void }) {
  const t = useTranslations("error");
  return (
    <main
      id="main-content"
      style={{
        maxWidth: 560,
        margin: "4rem auto",
        padding: "0 1.5rem",
        fontFamily: "Arial, sans-serif"
      }}
    >
      <h1>{t("unableToLoadThisPage")}</h1>
      <p role="alert">{t("somethingWentWrongPleaseTryAgain")}</p>
      <button
        type="button"
        onClick={retry}
        style={{
          padding: "0.75rem 1rem",
          border: "1px solid currentColor",
          borderRadius: 8,
          background: "transparent",
          color: "inherit",
          cursor: "pointer"
        }}
      >
        {t("tryAgain")}
      </button>
    </main>
  );
}
