"use client";
import { useTranslations } from "next-intl";
export function MarketHeading() {
  const t = useTranslations("market");
  return (
    <div>
      <p className="eyebrow">{t("overline")}</p>
      <h1 className="yk-title mt-3">{t("title")}</h1>
    </div>
  );
}
