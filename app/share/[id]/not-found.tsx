import Link from "next/link";
import { PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export default function SharedCardNotFound() {
  return (
    <PublicInfoPage
      eyebrow="Link not found"
      title="This shared card no longer exists."
      intro="The link is invalid or its owner has deleted it."
      discordEnabled={Boolean(getDiscordInviteUrl())}
      tone="navy"
    >
      <Link className="yk-button yk-button-primary inline-flex" href="/signup">
        Join Yokkai Collec&apos;
      </Link>
    </PublicInfoPage>
  );
}
