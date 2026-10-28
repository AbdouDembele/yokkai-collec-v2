import type { Metadata } from "next";
import { SocialPreview } from "@/components/social-preview";
import { Topbar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "Social preview",
  robots: { index: false, follow: false }
};
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  const { screen } = await searchParams;
  const view =
    screen === "public" || screen === "friends" || screen === "trades"
      ? screen
      : "profile";
  return (
    <>
      <Topbar
        view={
          view === "trades"
            ? "trades"
            : view === "friends"
              ? "friends"
              : "profile"
        }
        name="Kitsune"
        karas={4920}
        notifications={[]}
      />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <p className="eyebrow">Entre collectionneurs</p>
        <h1 className="yk-title mt-3">
          {view === "friends"
            ? "Mes amis"
            : view === "trades"
              ? "Proposer un échange"
              : view === "public"
                ? "Profil du joueur"
                : "Mon profil"}
        </h1>
        <div className="mt-8">
          <SocialPreview screen={view} />
        </div>
      </main>
    </>
  );
}
