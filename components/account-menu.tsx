import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export async function AccountMenu() {
  const t = await getTranslations("accountMenu");
  const user = await getCurrentUser();
  if (!user)
    return (
      <div className="flex items-center gap-4 text-sm">
        <Link href="/login">{t("signIn")}</Link>
        <Link
          href="/signup"
          className="rounded-lg border border-lime-300/40 px-3 py-2 text-lime-300"
        >
          {t("signUp")}
        </Link>
      </div>
    );
  const discordEnabled = Boolean(getDiscordInviteUrl());

  return (
    <>
      {discordEnabled && (
        <a
          href="/discord"
          target="_blank"
          rel="noopener noreferrer"
          className="yk-account-action"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 8.5A8 8 0 0 1 12 7a8 8 0 0 1 4 1.5M7 17l-3 2 1-4a8 8 0 1 1 2 2Z" />
            <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
          </svg>
          {t("joinTheYokkaiDiscord")}
        </a>
      )}
      <SignOutButton />
    </>
  );
}
