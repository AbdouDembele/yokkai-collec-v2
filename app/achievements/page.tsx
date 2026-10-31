import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AchievementsPage } from "@/components/achievements";
import { AccountMenu } from "@/components/account-menu";
import { SiteFooter } from "@/components/site-footer";
import { getCurrentUser } from "@/lib/auth/session";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("achievementUi");
  return { title: t("achievements") };
}

export default async function Page() {
  if (!(await getCurrentUser())) redirect("/login");
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <AchievementsPage account={<AccountMenu />} />
      <SiteFooter discordEnabled={Boolean(getDiscordInviteUrl())} />
    </div>
  );
}
