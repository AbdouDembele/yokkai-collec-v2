import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LeaderboardsView } from "@/components/leaderboards";
import { getCurrentUser } from "@/lib/auth/session";
import "@/styles/leaderboard.css";

export const metadata: Metadata = {
  title: "Leaderboards",
  description:
    "Explore collection and referral leaderboards while staying in Social.",
  alternates: { canonical: "/leaderboard" }
};

export default async function SocialLeaderboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <LeaderboardsView key={user.id} userId={user.id} embedded />;
}
