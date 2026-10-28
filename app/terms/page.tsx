import type { Metadata } from "next";
import Link from "next/link";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms of Use for Yokkai Collec': accounts, fair play, virtual cards, optional purchases, and community content.",
  robots: { index: true, follow: true }
};

const linkClass = "underline underline-offset-4 hover:text-ink";

export default function TermsPage() {
  return (
    <PublicInfoPage
      eyebrow="Playing together"
      title="Terms of Use"
      intro="A guide to using Yokkai responsibly: your account, your collection, and your interactions with other collectors."
      discordEnabled={Boolean(getDiscordInviteUrl())}
      tone="navy"
    >
      <div
        aria-label="Publisher and effective date"
        className="mb-8 text-sm leading-7 text-ink-2"
      >
        <p className="font-semibold text-ink">Publisher: Yokkai Collec</p>
        <p>
          Effective date: <time dateTime="2026-10-20">October 20, 2026</time>.
        </p>
      </div>

      <InfoSection number="01" title="About Yokkai and these terms">
        <p>
          Yokkai Collec&apos; is an unofficial fan project for collecting
          virtual cards, opening packs, completing binders, customizing cards,
          and connecting with other collectors. These terms describe the rules
          for using the website and its features. The{" "}
          <Link href="/rules" className={linkClass}>
            community rules
          </Link>{" "}
          also apply. You can read more about the game on the{" "}
          <Link href="/info" className={linkClass}>
            Info page
          </Link>
          .
        </p>
      </InfoSection>

      <InfoSection number="02" title="Accounts and younger collectors">
        <p>
          Yokkai is not an adults-only service. Minors may use the service when
          the legal requirements that apply to them are met. If local law
          requires permission from a parent or legal guardian to create an
          account, enter into an agreement, make a purchase, or consent to
          particular uses of personal data, that permission must be obtained
          before the relevant activity. A parent&apos;s permission does not
          override any minimum age imposed by applicable law.
        </p>
        <p>
          Use an email address you control, complete email verification when
          requested, and keep your sign-in details private. Do not impersonate
          another person, share account access, or sell accounts. Contact us if
          you believe someone has accessed your account without permission.
        </p>
      </InfoSection>

      <InfoSection number="03" title="Fair play and community safety">
        <ul>
          <li>
            Do not harass, threaten, discriminate against, scam, or impersonate
            other people. Do not post illegal, sexually explicit, or abusive
            content, including in profiles, custom images, GIFs, or messages.
          </li>
          <li>
            Do not use bots, exploit bugs, bypass access controls, manipulate
            trades or auctions, or create accounts to farm referrals and
            rewards.
          </li>
          <li>
            Keep private information private. Do not share someone else&apos;s
            personal information without a lawful basis. Report safety issues or
            suspected abuse using the available report tools or our contact
            email.
          </li>
        </ul>
      </InfoSection>

      <InfoSection number="04" title="Packs, cards, Karas, and exchanges">
        <p>
          Regular Packs contain random virtual cards. Decision Packs let you
          choose from the cards revealed. A pack does not guarantee a particular
          character or rarity unless an explicit offer says otherwise. Current
          pack information and rarity information are available in the game and
          on the{" "}
          <Link href="/rarities" className={linkClass}>
            Rarities page
          </Link>
          .
        </p>
        <p>
          Cards, packs, and Karas are in-game items, not money or an investment.
          They have no cash-redemption value and do not grant ownership of the
          characters or artwork they depict. Do not sell them for real money
          outside the service. Review the cards and Kara amounts carefully
          before placing a bid or accepting a trade. Exchanges are subject to
          the game&apos;s ownership, balance, and eligibility checks.
        </p>
      </InfoSection>

      <InfoSection number="05" title="Your content and intellectual property">
        <p>
          Characters, franchises, artwork, names, and trademarks belong to their
          respective rights holders. Yokkai is not affiliated with or endorsed
          by them. Being displayed in the game does not mean that an image is
          free for other uses.
        </p>
        <p>
          You must have the necessary rights or other lawful authorization for
          images, GIFs, messages, and other content you submit. You keep any
          rights you hold in your own content. You give Yokkai only the
          permission needed to host, process, and display that content to
          operate the features you use, including sharing it with the people or
          audiences you select. This does not transfer ownership of your content
          to Yokkai. Content may be removed when it violates rights or the
          community rules. Contact us to report a rights concern.
        </p>
      </InfoSection>

      <InfoSection number="06" title="Optional paid features">
        <p>
          Some features, such as Pro subscriptions, may require payment. Review
          the price, included benefits, billing period, renewal information, and
          cancellation conditions displayed before checkout. Where offered, web
          payments are handled through Stripe. Minors must have any
          authorization required by law before making a purchase.
        </p>
        <p>
          Use the subscription controls provided in your account to manage or
          cancel a subscription, or contact us for help. Cancellation,
          withdrawal, and refund requests are handled under the terms shown at
          purchase and applicable law. Mandatory consumer rights remain
          unaffected. These terms do not, by themselves, waive a statutory
          withdrawal right for digital content or services; any legally required
          express consent and acknowledgment must be obtained separately.
        </p>
      </InfoSection>

      <InfoSection number="07" title="Personal data and account controls">
        <p>
          Use account settings to manage the available privacy controls, request
          an export of your account data, or delete your account. Think
          carefully before posting information in a public profile or sharing it
          with another collector. These terms are not a substitute for the
          privacy information or specific consent requests required for
          personal-data processing. Read the{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>{" "}
          to learn how your data is used. Questions about your data or privacy
          rights can be sent to our contact email.
        </p>
      </InfoSection>

      <InfoSection number="08" title="Moderation and closing an account">
        <p>
          To protect collectors and the service, we may remove content, restrict
          features, or suspend accounts in response to rule violations, fraud,
          or security risks. Measures should be proportionate to the
          circumstances and comply with applicable law. Contact us if you
          believe a moderation decision was mistaken or want it reviewed.
        </p>
        <p>
          You may stop using Yokkai at any time and use account settings to
          request deletion. Review any active subscriptions, bids, and trades
          first. Information may need to be retained where the law requires it.
          Account closure does not remove any rights or obligations that legally
          survive closure, including any applicable refund rights.
        </p>
      </InfoSection>

      <InfoSection number="09" title="Availability, changes, and your rights">
        <p>
          Features may change, and maintenance or technical problems can
          interrupt access. We cannot promise uninterrupted availability or an
          error-free service. This does not exclude any legal guarantees or
          liability that cannot lawfully be limited.
        </p>
        <p>
          If these terms change, an updated version and its effective date will
          be made available. Material changes will be communicated, and fresh
          agreement obtained, where required by law. Nothing here removes
          mandatory consumer protections, data-protection rights, or your right
          to seek help from a competent authority or court.
        </p>
      </InfoSection>

      <InfoSection number="10" title="Contact">
        <p>
          For account help, safety reports, rights concerns, or questions about
          these terms, email{" "}
          <a
            href="mailto:yokkaicollec@gmail.com"
            className={`${linkClass} break-all`}
          >
            yokkaicollec@gmail.com
          </a>
          . Never send your password or full payment details by email.
        </p>
      </InfoSection>
    </PublicInfoPage>
  );
}
