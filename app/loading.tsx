import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  const t = useTranslations("loading");
  return (
    <main
      id="main-content"
      className="yk-route-loading"
      aria-label={t("loadingPage")}
    >
      <Skeleton className="h-3 w-32" label={t("loadingPageContext")} />
      <Skeleton
        className="mt-4 h-10 w-full max-w-md"
        label={t("loadingHeading")}
      />
      <Skeleton className="mt-8 h-12 w-full" label={t("loadingControls")} />
      <div
        className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
        aria-hidden="true"
      >
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton
            key={index}
            className="aspect-[5/7] w-full"
            label={t("loadingContent")}
          />
        ))}
      </div>
    </main>
  );
}
