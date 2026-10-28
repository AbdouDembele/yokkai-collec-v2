import type { Metadata } from "next";
import Link from "next/link";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import {
  AUTH_LOG_RETENTION,
  BACKUP_RETENTION_DAYS,
  BILLING_RECORD_RETENTION,
  DELETION_LOG_RETENTION,
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_CONTROLLER,
  PRIVACY_LAST_UPDATED,
  PRIVACY_MINIMUM_AGE,
  SERVER_LOG_RETENTION_DAYS
} from "@/lib/legal/privacy";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Yokkai Collec' collects, uses, shares, and protects your personal data, and how to exercise your privacy rights.",
  robots: { index: true, follow: true }
};

const linkClass = "underline underline-offset-4 hover:text-ink";

const lastUpdated = new Date(
  `${PRIVACY_LAST_UPDATED}T00:00:00Z`
).toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC"
});

const browserStorage = [
  ["Sign-in cookie (sb-…-auth-token)", "Keeps you signed in. Required."],
  ["yokkai:collection-sort", "Remembers how you sort your collection."],
  ["yokkai:filters-open:v1", "Remembers which filter panels are open."],
  ["yokkai-sound-enabled", "Remembers whether game sounds are on."],
  [
    "yokkai:pro-promotion:v1:dismissed-at",
    "Remembers when you closed the Pro promotion."
  ],
  [
    "yokkai-discord-promo-dismissed:<account ID>",
    "Remembers that you closed the Discord reminder."
  ],
  [
    "yokkai-referral-reminder-dismissed:<account ID>",
    "Remembers that you closed the referral reminder."
  ],
  [
    "yokkai:social-unread-invalidation",
    "A random value that keeps unread counters in sync across your tabs."
  ]
];

function Email() {
  return (
    <a
      href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
      className={`${linkClass} break-all`}
    >
      {PRIVACY_CONTACT_EMAIL}
    </a>
  );
}

export default function PrivacyPage() {
  return (
    <PublicInfoPage
      eyebrow="Your data"
      title="Privacy Policy"
      intro="What we collect when you play Yokkai, why we need it, who can see it, and how you stay in control."
      discordEnabled={Boolean(getDiscordInviteUrl())}
      tone="navy"
    >
      <p className="mb-8 text-sm leading-7 text-ink-2">
        Last updated: <time dateTime={PRIVACY_LAST_UPDATED}>{lastUpdated}</time>
        .
      </p>

      <InfoSection number="01" title="Who we are and how to contact us">
        <p>
          {PRIVACY_CONTROLLER} is the data controller for the personal data
          processed through this website. For any question or request about your
          data, email <Email />. Never send your password or sign-in codes by
          email.
        </p>
      </InfoSection>

      <InfoSection number="02" title="What data we collect">
        <ul>
          <li>
            <strong>Account:</strong> your email address, password, and
            username. Your password is handled by our authentication system and
            stored only in hashed form. We also record the version and time of
            the policies you accepted at sign-up, and the referral code you
            used, if any. Confirmation and password-reset emails are sent
            through our email provider.
          </li>
          <li>
            <strong>Security checks:</strong> sign-in, sign-up, and password
            forms use a Cloudflare Turnstile challenge to block bots. Your IP
            address may be used to protect sign-in against abuse.
          </li>
          <li>
            <strong>Profile:</strong> avatar, banner, background and card-back
            images you upload, bio, interests, showcase cards, profile layout
            and Pro styling, your profile privacy setting, and when you were
            last active.
          </li>
          <li>
            <strong>Game data:</strong> cards and collection, custom card images
            (links you provide), folders and binders, Karas balance, packs and
            pack timers, achievements and stats, wishlist, favorites, and
            notifications.
          </li>
          <li>
            <strong>Social activity:</strong> friends and friend requests,
            trades, auctions and bids, auction chat messages and mentions,
            private messages, profile wall posts, replies, likes and reactions,
            GIFs you share, blocks, reports you send or receive, and referrals.
          </li>
          <li>
            <strong>Sharing:</strong> the card share links you create, including
            whether you chose to show your username.
          </li>
          <li>
            <strong>Subscription:</strong> your Stripe customer ID, checkout
            session ID, subscription status, current period end date, and
            whether cancellation is scheduled. See Payments below.
          </li>
          <li>
            <strong>Technical data:</strong> server and database logs needed to
            run and secure the service.
          </li>
        </ul>
      </InfoSection>

      <InfoSection number="03" title="Why we use it and legal basis">
        <ul>
          <li>
            <strong>To provide the game and your subscription</strong>{" "}
            (performance of our contract with you): your account, collection,
            social features, and Pro benefits.
          </li>
          <li>
            <strong>To meet billing and accounting requirements</strong> (legal
            obligation): records related to payments.
          </li>
          <li>
            <strong>To keep Yokkai safe and fair</strong> (legitimate interest):
            security, bot protection, anti-cheat checks, rate limits, reports,
            and moderation.
          </li>
        </ul>
        <p>We do not sell your personal data or use it for advertising.</p>
      </InfoSection>

      <InfoSection number="04" title="What other players can see">
        <ul>
          <li>
            Signed-in players can see your username, avatar, banner, bio,
            showcase, profile wall, and your activity in trades, auctions, and
            auction chat.
          </li>
          <li>
            Your collection is visible to signed-in players when your profile is
            public. Set your profile to private in Settings to limit it to your
            friends.
          </li>
          <li>
            Your friends can see whether you are online and when you were last
            active. Private messages are visible only to you and the recipient.
          </li>
          <li>
            Visitors who are not signed in can only see the card share links you
            create: the card, its artwork, and your username only if you chose
            to show it. Uploaded avatar and banner images are served from public
            links.
          </li>
          <li>
            Yokkai administrators can access account data, including your email
            address, to support players, moderate content, and secure the
            service.
          </li>
        </ul>
      </InfoSection>

      <InfoSection number="05" title="Payments">
        <p>
          Pro subscriptions are processed by Stripe through its hosted Checkout
          and Customer Portal pages. You enter your payment details directly on
          Stripe. We never see or store your card number or other payment card
          details.
        </p>
        <p>
          We send Stripe only your Yokkai account ID and the selected plan.
          Stripe sends us back the subscription status and dates. Stripe
          processes your payment details and billing information under its own{" "}
          <a
            href="https://stripe.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Privacy Policy
          </a>
          .
        </p>
      </InfoSection>

      <InfoSection
        number="06"
        title="Third-party services and international transfers"
      >
        <ul>
          <li>
            <strong>Hosting:</strong> the website, database, and uploaded images
            are hosted on a server in France (OVHcloud, managed with Coolify).
            Authentication emails are sent through OVHcloud.
          </li>
          <li>
            <strong>Cloudflare:</strong> domain, network protection, and
            Turnstile bot checks.
          </li>
          <li>
            <strong>Stripe:</strong> payments and subscriptions.
          </li>
          <li>
            <strong>GIPHY:</strong> when you open the GIF picker, your browser
            sends your search terms to GIPHY. Shared GIFs are loaded from GIPHY
            by everyone who views them.
          </li>
          <li>
            <strong>Image hosts:</strong> custom card images are loaded from the
            hosts their links point to, such as imgur.
          </li>
          <li>
            <strong>Discord:</strong> the Discord link only opens our community
            server. We do not share your data with Discord.
          </li>
        </ul>
        <p>
          When your browser loads content from these services, they receive your
          IP address and browser information. Stripe, Cloudflare, and GIPHY are
          among the services based in the United States, so your data may be
          transferred outside your country. These providers rely on legal
          safeguards for such transfers, such as standard contractual clauses or
          certification frameworks.
        </p>
      </InfoSection>

      <InfoSection number="07" title="Cookies and local storage">
        <p>
          We use one cookie, to keep you signed in. We do not use advertising
          cookies, and our website does not include analytics or tracking tools.
          Stripe sets its own cookies only on its own payment pages. Cloudflare
          may use cookies or similar technologies to run security checks. Your
          browser also stores these preferences on your device:
        </p>
        <ul>
          {browserStorage.map(([name, purpose]) => (
            <li key={name}>
              <code className="break-all text-ink">{name}</code>: {purpose}
            </li>
          ))}
        </ul>
      </InfoSection>

      <InfoSection number="08" title="How long we keep data">
        <ul>
          <li>Account and game data: until you delete your account.</li>
          <li>
            Database backups: up to {BACKUP_RETENTION_DAYS} days, after which
            older backups are removed automatically.
          </li>
          <li>
            Server logs and scheduled job history: about{" "}
            {SERVER_LOG_RETENTION_DAYS} days.
          </li>
          <li>
            Authentication logs:{" "}
            {AUTH_LOG_RETENTION ?? "kept only as long as needed for security"}.
          </li>
          <li>
            Billing records:{" "}
            {BILLING_RECORD_RETENTION ??
              "kept as long as required by accounting and tax law"}
            .
          </li>
          <li>
            Deletion log (account ID and date only):{" "}
            {DELETION_LOG_RETENTION ??
              "kept so that a deletion can be applied again if a backup is restored"}
            .
          </li>
        </ul>
      </InfoSection>

      <InfoSection number="09" title="Account deletion">
        <p>
          You can delete your account at any time from Settings. Deletion is
          immediate and cannot be undone. Before deleting, you can download a
          copy of your data from Settings.
        </p>
        <ul>
          <li>
            <strong>Deleted:</strong> your sign-in identity, profile, uploaded
            images, cards, folders, wishlist, achievements, notifications,
            auction chat messages, private messages, profile wall posts,
            friendships, blocks, and share links. Your active auctions and
            pending trades are canceled, and bids are refunded.
          </li>
          <li>
            <strong>Subscription:</strong> an active Pro subscription is
            canceled immediately, without a new invoice. Stripe keeps the
            payment records it must retain for its own legal and accounting
            obligations.
          </li>
          <li>
            <strong>Anonymized:</strong> past auctions, bids, trades, and
            reports stay in other players&apos; history without any link to you
            and show &ldquo;Deleted player&rdquo;.
          </li>
          <li>
            <strong>Kept:</strong> a log containing only your account ID and the
            deletion date, used to apply your deletion again if a backup is ever
            restored. Your data may remain in backups until they are removed.
          </li>
        </ul>
      </InfoSection>

      <InfoSection number="10" title="Your rights">
        <p>
          You have the right to access, correct, delete, and receive a portable
          copy of your data, to object to its processing, and to ask us to
          restrict it. Many of these controls are in Settings. For any other
          request, email <Email /> from your account email address.
        </p>
        <p>
          You can also file a complaint with the data protection authority in
          your country of residence, such as the CNIL in France or the CNDP in
          Morocco.
        </p>
      </InfoSection>

      <InfoSection number="11" title="Children">
        <p>
          Yokkai is not intended for children under {PRIVACY_MINIMUM_AGE}. You
          must be at least {PRIVACY_MINIMUM_AGE} years old to create an account.
          If an account belongs to a child under {PRIVACY_MINIMUM_AGE}, it will
          be deleted on request sent to <Email />.
        </p>
      </InfoSection>

      <InfoSection number="12" title="Security">
        <p>
          We use encrypted connections, hashed passwords, bot checks, rate
          limits, and access rules that limit each player to their own private
          data. No system is perfectly secure: keep your password private and
          contact us if you think your account has been accessed without
          permission.
        </p>
      </InfoSection>

      <InfoSection number="13" title="Changes to this policy">
        <p>
          We may update this policy when Yokkai changes. The date at the top of
          this page shows the latest version, and material changes will be
          announced in the game. Read our{" "}
          <Link href="/terms" className={linkClass}>
            Terms of Use
          </Link>{" "}
          and{" "}
          <Link href="/rules" className={linkClass}>
            community rules
          </Link>{" "}
          too.
        </p>
      </InfoSection>
    </PublicInfoPage>
  );
}
