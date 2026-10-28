import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LeaderboardTopbar } from "@/components/leaderboard-topbar";
import { AccountMenu } from "@/components/account-menu";
import { LeaderboardsView } from "@/components/leaderboards";
import { SiteFooter } from "@/components/site-footer";
import { getCurrentUser } from "@/lib/auth/session";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import "@/styles/leaderboard.css";

export const metadata: Metadata = {
  title: "Leaderboards",
  description:
    "Explore the top collectors and referrers. Compare rare collections and verified referrals.",
  alternates: { canonical: "/leaderboard" }
};

export default async function LeaderboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <LeaderboardTopbar key={user.id} account={<AccountMenu />} />
      <LeaderboardsView key={user.id} userId={user.id} />
      <SiteFooter discordEnabled={Boolean(getDiscordInviteUrl())} />
    </div>
  );
}
