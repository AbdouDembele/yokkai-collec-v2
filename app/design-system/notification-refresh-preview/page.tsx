import type { Metadata } from "next";
import { NotificationRefreshProof } from "@/components/notification-refresh-proof";

export const metadata: Metadata = {
  title: "Notification refresh proof",
  robots: { index: false, follow: false }
};
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">Rafraîchissement des notifications</h1>
      <p className="mt-4 text-sm text-ink-2">
        La vraie Topbar et le vrai hook de notifications sont montés avec un
        chargeur sans RPC qui compte les lectures. Les clics sur la cloche et
        les changements de visibilité de l’onglet sont déclenchés dans le
        navigateur.
      </p>
      <div className="mt-8">
        <NotificationRefreshProof />
      </div>
    </main>
  );
}
