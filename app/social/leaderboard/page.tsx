import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LeaderboardsView } from "@/components/leaderboards";
import { getCurrentUser } from "@/lib/auth/session";
import "@/styles/leaderboard.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("socialUi");
  return {
    title: t("leaderboardsTitle"),
    description: t("socialLeaderboardsDescription"),
    alternates: { canonical: "/leaderboard" }
  };
}

export default async function SocialLeaderboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <LeaderboardsView key={user.id} userId={user.id} embedded />;
}
