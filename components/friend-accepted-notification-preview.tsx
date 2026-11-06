"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Topbar } from "@/components/topbar";
import { notificationItem } from "@/lib/notification-item";

export function FriendAcceptedNotificationPreview() {
  const t = useTranslations("topbar");
  const [read, setRead] = useState(false);
  const item = notificationItem(
    {
      id: "accepted-demo",
      type: "friend_request_accepted",
      referenceId: "83000000-0000-4000-8000-000000000002",
      actorPseudo: "Kitsune_LongPlayerName",
      readAt: read ? "2026-11-04T10:00:00Z" : null,
      createdAt: "2026-11-04T10:00:00Z",
      cardName: null,
      achievementName: null
    },
    t,
    "12:00"
  );
  return (
    <>
      <Topbar
        view="friends"
        name="Kitsune"
        karas={250}
        notifications={[item]}
        onReadAll={() => setRead(true)}
        onOpenNotification={async () => setRead(true)}
      />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">
          {t("notificationFriendAcceptedTitle")}
        </h1>
      </main>
    </>
  );
}
