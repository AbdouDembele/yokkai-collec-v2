import { useTranslations } from "next-intl";
import Link from "next/link";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-5 py-12 text-center"
    >
      <p className="eyebrow">{t("error404")}</p>
      <h1 className="yk-title">{t("pageNotFound")}</h1>
      <p className="text-ink-2">{t("theLinkMayBeOutdatedOrThePageMayHave")}</p>
      <Link href="/boosters" className="yk-button yk-button-primary">
        {t("backToTheGame")}
      </Link>
    </main>
  );
}
