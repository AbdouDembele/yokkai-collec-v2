import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LeaderboardTopbar } from "@/components/leaderboard-topbar";
import { AccountMenu } from "@/components/account-menu";
import { LeaderboardsView } from "@/components/leaderboards";
import { SiteFooter } from "@/components/site-footer";
import { getCurrentUser } from "@/lib/auth/session";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import "@/styles/leaderboard.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("socialUi");
  return {
    title: t("leaderboardsTitle"),
    description: t("leaderboardsDescription"),
    alternates: { canonical: "/leaderboard" }
  };
}

export default async function LeaderboardPage({
  searchParams
}: {
  searchParams: Promise<{ ranking?: string | string[] }>;
}) {
  const query = await searchParams;
  const initialKind =
    query.ranking === "likes" || query.ranking === "licenses"
      ? query.ranking
      : "collection";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <LeaderboardTopbar key={`topbar-${user.id}`} account={<AccountMenu />} />
      <LeaderboardsView
        key={`rankings-${user.id}-${initialKind}`}
        userId={user.id}
        initialKind={initialKind}
      />
      <SiteFooter discordEnabled={Boolean(getDiscordInviteUrl())} />
    </div>
  );
}
