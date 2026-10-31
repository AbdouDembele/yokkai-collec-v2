import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export default async function SharedCardNotFound() {
  const t = await getTranslations("shareUi");
  return (
    <PublicInfoPage
      eyebrow={t("notFoundOverline")}
      title={t("notFoundTitle")}
      intro={t("notFoundIntro")}
      discordEnabled={Boolean(getDiscordInviteUrl())}
      tone="navy"
    >
      <Link className="yk-button yk-button-primary inline-flex" href="/signup">
        {t("join")}
      </Link>
    </PublicInfoPage>
  );
}
