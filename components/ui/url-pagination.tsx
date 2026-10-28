"use client";

import { useRouter } from "next/navigation";
import { Pagination } from "@/components/ui/pagination";

export function UrlPagination({
  page,
  pageCount,
  scrollTargetId
}: {
  page: number;
  pageCount: number;
  scrollTargetId: string;
}) {
  const router = useRouter();
  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      scrollTargetId={scrollTargetId}
      onPageChange={target => {
        const url = new URL(window.location.href);
        url.searchParams.set("page", String(target));
        router.push(`${url.pathname}${url.search}${url.hash}`, {
          scroll: false
        });
      }}
    />
  );
}
