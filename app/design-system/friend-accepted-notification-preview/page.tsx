import { NextIntlClientProvider } from "next-intl";
import { FriendAcceptedNotificationPreview } from "@/components/friend-accepted-notification-preview";
import english from "@/messages/en.json";
import french from "@/messages/fr.json";

export default async function Page({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const locale = search.lang === "en" ? "en" : "fr";
  const messages = locale === "fr" ? french : english;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ topbar: messages.topbar }}
    >
      <FriendAcceptedNotificationPreview />
    </NextIntlClientProvider>
  );
}
