"use client";
import { useTranslations } from "next-intl";
export function ProfilePrivate() {
  const t = useTranslations();
  return (
    <p className="yk-profile-empty">
      {t("profileUi.privateCollectionNotice")}{" "}
    </p>
  );
}
