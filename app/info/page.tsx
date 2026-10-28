import type { Metadata } from "next";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export const metadata: Metadata = {
  title: "About",
  description: "Learn about Yokkai Collec' and how the game works."
};

export default function InfoPage() {
  return (
    <PublicInfoPage
      eyebrow="About the project"
      title="What is Yokkai?"
      intro="Yokkai Collec' is a fan-made online card collection game where players open packs, discover characters, and trade with friends."
      discordEnabled={Boolean(getDiscordInviteUrl())}
    >
      <InfoSection number="01" title="Collect">
        <p>
          Open Regular and Decision Packs, discover cards across many
          franchises, and organize your personal collection.
        </p>
      </InfoSection>
      <InfoSection number="02" title="Connect">
        <p>
          Add friends, exchange private messages, build trade offers, and follow
          auctions through the community market.
        </p>
      </InfoSection>
      <InfoSection number="03" title="Build your identity">
        <p>
          Customize your public profile, showcase favorite cards, complete
          achievements, and make your collector identity your own.
        </p>
      </InfoSection>
      <InfoSection number="04" title="An unofficial fan project">
        <p>
          Yokkai Collec&apos; is not affiliated with or endorsed by the owners
          of the characters and franchises represented in the collection. Those
          properties remain the property of their respective rights holders.
        </p>
      </InfoSection>
      <InfoSection number="05" title="Stay connected">
        <p>
          Join the Yokkai Discord from the icon below to meet collectors, share
          feedback, and follow project updates.
        </p>
      </InfoSection>
    </PublicInfoPage>
  );
}
