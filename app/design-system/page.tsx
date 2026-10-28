import type { Metadata } from "next";
import { DesignSystemGallery } from "@/components/design-system-gallery";
import { Topbar, type NotificationItem } from "@/components/topbar";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false }
};

const previewNotifications: NotificationItem[] = [
  {
    id: "preview-1",
    title: "Carte en wishlist",
    text: "Une carte suivie vient d’arriver sur le marché.",
    time: "À l’instant",
    read: false,
    href: "/market",
    kind: "wishlist"
  },
  {
    id: "preview-2",
    title: "Succès débloqué",
    text: "Ta collection continue de grandir.",
    time: "Il y a 5 min",
    read: false,
    href: "/achievements",
    kind: "mission"
  }
];

export default async function DesignSystemPage({
  searchParams
}: {
  searchParams: Promise<{ topbar?: string }>;
}) {
  const { topbar } = await searchParams;
  return (
    <>
      <Topbar
        view="search"
        name="Kitsune"
        karas={topbar === "loading" ? undefined : 4920}
        notifications={previewNotifications}
      />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14"
      >
        <header className="mb-10 border-b border-veil pb-8">
          <p className="eyebrow">Yokkai Collec’ · Référence interne</p>
          <h1 className="yk-title mt-3">Design system</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-ink-2">
            Fondations visuelles, états interactifs et politique d’animation de
            l’interface. Cette page n’utilise aucune donnée de jeu.
          </p>
        </header>
        <div className="space-y-6">
          <DesignSystemGallery />
        </div>
      </main>
    </>
  );
}
