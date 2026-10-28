import { Suspense } from "react";
import { ProfilePreview } from "@/components/profile-preview";

export default function Page() {
  return (
    <Suspense fallback={<p>Chargement de l’aperçu…</p>}>
      <ProfilePreview />
    </Suspense>
  );
}
