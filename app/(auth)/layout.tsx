import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSelector } from "@/components/locale-controls";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { SiteFooter } from "@/components/site-footer";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import "@/styles/auth.css";

export default async function AuthLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("layout");
  if (await getCurrentUser()) redirect("/boosters");
  return (
    <div className="yk-auth-shell">
      <header className="yk-auth-header">
        <Link
          href="/"
          className="yk-auth-brand"
          aria-label={t("yokkaiCollecHome")}
        >
          <Image
            className="yk-auth-brand-image"
            src="/assets/brand-logo-ice-retro.png"
            alt=""
            width={1672}
            height={941}
            priority
          />
        </Link>
        <Link href="/login" className="yk-auth-return">
          {t("signIn")}
        </Link>
        <LocaleSelector />
      </header>
      <main id="main-content" className="yk-auth-main">
        {children}
      </main>
      <SiteFooter
        discordEnabled={Boolean(getDiscordInviteUrl())}
        contactEmail={process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()}
      />
    </div>
  );
}
