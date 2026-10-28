import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui";

export function CollectionLoading({ heading = false }: { heading?: boolean }) {
  const tc = useTranslations("collectionUi");

  return (
    <div role="status" aria-live="polite" aria-busy="true">
      {heading && (
        <div className="mb-6">
          <p className="eyebrow">{tc("everyCardYouOwn")}</p>
          <h1 className="yk-title mt-3">{tc("collection")}</h1>
        </div>
      )}
      <p className="mb-4 text-sm text-ink-2">{tc("loadingYourCards")}</p>
      <div className="yk-card-grid yk-collection-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="aspect-[5/7] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
