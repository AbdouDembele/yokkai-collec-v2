import "server-only";

const DISCORD_HOSTS = new Set(["discord.gg", "discord.com"]);

export function getDiscordInviteUrl() {
  const configuredUrl = process.env.DISCORD_INVITE_URL?.trim();
  if (!configuredUrl) return null;

  try {
    const inviteUrl = new URL(configuredUrl);
    const inviteCode =
      inviteUrl.hostname === "discord.gg"
        ? inviteUrl.pathname.slice(1)
        : inviteUrl.pathname.startsWith("/invite/")
          ? inviteUrl.pathname.slice("/invite/".length)
          : "";
    const isDiscordInvite =
      inviteUrl.protocol === "https:" &&
      DISCORD_HOSTS.has(inviteUrl.hostname) &&
      !inviteUrl.username &&
      !inviteUrl.password &&
      !inviteUrl.port &&
      Boolean(inviteCode) &&
      !inviteCode.includes("/");

    return isDiscordInvite ? inviteUrl.toString() : null;
  } catch {
    return null;
  }
}
