import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Game } from "@/components/game";
import { AccountMenu } from "@/components/account-menu";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gameUi");
  return { title: t("collectionMetadata") };
}

export default async function Collection() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <Game
      key={user.id}
      view="collection"
      account={<AccountMenu />}
      discordEnabled={Boolean(getDiscordInviteUrl())}
    />
  );
}
