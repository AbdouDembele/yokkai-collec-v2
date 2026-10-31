import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

export function PublicInfoPage({
  eyebrow,
  title,
  intro,
  children,
  discordEnabled,
  tone
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
  discordEnabled: boolean;
  tone?: "navy";
}) {
  const tPr5 = useTranslations("premiumUi");
  return (
    <div className="yk-info-page" data-tone={tone}>
      <header className="yk-info-header">
        <Link
          href="/"
          className="yk-info-brand"
          aria-label={tPr5("yokkaiCollecHome2")}
        >
          <Image
            src="/assets/brand-logo-ice-retro.png"
            alt=""
            width={1672}
            height={941}
            priority
          />
        </Link>
        <Link href="/boosters" className="yk-info-play-link">
          {tPr5("playYokkai")}
        </Link>
      </header>
      <main id="main-content" className="yk-info-main">
        <div className="yk-info-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
        {children}
      </main>
      <SiteFooter discordEnabled={discordEnabled} />
    </div>
  );
}

export function InfoSection({
  number,
  title,
  children
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="yk-info-section">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}
