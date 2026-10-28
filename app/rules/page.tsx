import type { Metadata } from "next";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export const metadata: Metadata = {
  title: "Community rules",
  description: "The fair-play and community rules for Yokkai Collec'."
};

export default function RulesPage() {
  return (
    <PublicInfoPage
      eyebrow="Play fair"
      title="Community rules"
      intro="Yokkai is built around collecting, trading, and sharing. These rules keep those experiences fair and welcoming for everyone."
      discordEnabled={Boolean(getDiscordInviteUrl())}
    >
      <InfoSection number="01" title="Respect other collectors">
        <ul>
          <li>No harassment, hate speech, threats, or targeted abuse.</li>
          <li>No spam, impersonation, scams, or misleading trade messages.</li>
          <li>Keep profiles, messages, and shared content appropriate.</li>
        </ul>
      </InfoSection>
      <InfoSection number="02" title="Keep the game fair">
        <ul>
          <li>Do not automate pack openings or other player actions.</li>
          <li>Do not exploit bugs, manipulate requests, or bypass limits.</li>
          <li>
            Do not create accounts to farm referrals, rewards, or daily packs.
          </li>
        </ul>
      </InfoSection>
      <InfoSection number="03" title="Trade carefully">
        <p>
          Review every card and Kara amount before accepting. Card ownership is
          checked again by the server when a trade is completed, and completed
          trades should be treated as final.
        </p>
      </InfoSection>
      <InfoSection number="04" title="Reports and moderation">
        <p>
          Use the in-app report tools when something looks wrong. Serious or
          repeated violations may lead to content removal, feature restrictions,
          or account suspension.
        </p>
      </InfoSection>
    </PublicInfoPage>
  );
}
