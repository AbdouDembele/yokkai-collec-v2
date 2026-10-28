"use client";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui";
import { AvatarDecoration } from "@/components/avatar-decoration";
import type { PlayerCosmetics } from "@/components/styled-player-name";
export function StyledPlayerAvatar({
  name,
  image,
  online,
  size = 40,
  cosmetics
}: {
  name: string;
  image?: string;
  online?: boolean;
  size?: number;
  cosmetics?: PlayerCosmetics | null;
}) {
  const t = useTranslations("socialFriends");
  const frame = cosmetics?.active
    ? (cosmetics.style.avatarFrame ?? "none")
    : "none";
  return (
    <span
      className="yk-styled-player-avatar"
      data-avatar-frame={frame}
      style={{ width: size, height: size }}
    >
      <Avatar
        name={name}
        image={image}
        online={online}
        onlineLabel={t(online ? "online" : "offline")}
        size={size}
      />
      <AvatarDecoration frame={frame} />
    </span>
  );
}
