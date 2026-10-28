import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { AccountMenu } from "@/components/account-menu";
import { Game } from "@/components/game";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { preload } from "react-dom";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gameUi");
  return { title: t("packsMetadata") };
}

export default async function BoostersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Avoid a blank card back at the start of the opening animation.
  preload("/assets/bubble-card-back-v1.png", { as: "image" });
  return (
    <Game
      key={user.id}
      view="packs"
      account={<AccountMenu />}
      discordEnabled={Boolean(getDiscordInviteUrl())}
    />
  );
}
