"use client";
/* eslint-disable @next/next/no-img-element -- Decorative catalogue artwork beside the visible license title. */
import { useEffect, useState } from "react";
import {
  getPaniniAlbumCardsPage,
  type PaniniAlbumProgress
} from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { RankingIcon } from "@/components/ranking-icon";

export function RankingLicenseCover({
  binder
}: {
  binder: PaniniAlbumProgress;
}) {
  const key = binderIdentity(binder);
  const [cover, setCover] = useState<{ key: string; image: string } | null>(
    null
  );
  const [failed, setFailed] = useState(false);
  const image =
    binder.image?.trim() || (cover?.key === key ? cover.image : undefined);
  useEffect(() => {
    if (binder.image?.trim()) return;
    let active = true;
    void getPaniniAlbumCardsPage({ license: key, pageSize: 1, sort: "rarity" })
      .then(page => {
        const image = page.items[0]?.image?.trim();
        if (active && image) setCover({ key, image });
      })
      .catch(() => {
        /* Keep the license usable even when its artwork is unavailable. */
      });
    return () => {
      active = false;
    };
  }, [key, binder.image]);
  return (
    <span className="yk-ranking-license-cover" aria-hidden="true">
      {image && !failed ? (
        <img
          src={image}
          alt=""
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <RankingIcon kind="licenses" />
      )}
    </span>
  );
}
