import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || "https://yokkai-collec.com";
  // Public, server-rendered pages only: no game pages, admin or design system.
  return [
    "/",
    "/login",
    "/signup",
    "/info",
    "/rules",
    "/rarities",
    "/premium",
    "/privacy",
    "/terms"
  ].map(route => ({
    url: new URL(route, origin).href
  }));
}
