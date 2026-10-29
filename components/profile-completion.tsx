"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProfilePrivate } from "@/components/profile-private";
import type { Profile, ProfileDetails } from "@/lib/data/profile";
export function ProfileCompletion({
  profile,
  details,
  detailsError,
  isMe
}: {
  profile: Profile;
  details?: ProfileDetails;
  detailsError: string;
  isMe: boolean;
}) {
  const t = useTranslations();
  return (
    <>
      {!profile.canViewCollection ? (
        <ProfilePrivate />
      ) : details?.favoriteAlbums.length ? (
        <section className="yk-profile-surface">
          <div className="yk-profile-completion-summary">
            <strong>
              {
                details.favoriteAlbums.filter(
                  album => album.owned === album.total
                ).length
              }
            </strong>
            <span>
              {t("profileUi.completedBinders", {
                count: details.favoriteAlbums.filter(
                  album => album.owned === album.total
                ).length
              })}{" "}
              <small>
                {t("profileUi.favoriteBinderTotal", {
                  count: details.favoriteAlbums.length
                })}
              </small>
            </span>
          </div>
          <ul className="yk-profile-album-progress">
            {details.favoriteAlbums.map(album => (
              <li key={album.binderKey ?? album.license}>
                <div>
                  <strong>
                    <span aria-hidden="true">★</span> {album.license}
                  </strong>
                  <span>
                    {album.owned} / {album.total}
                  </span>
                </div>
                <progress
                  max={album.total}
                  value={album.owned}
                  aria-label={t("profileUi.completionFor", {
                    license: album.license
                  })}
                />
                <small>
                  {t("profileUi.percentComplete", { percent: album.percent })}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : !details ? (
        <p className="yk-profile-empty">
          {detailsError
            ? t("profileUi.binderProgressUnavailable")
            : t("profileUi.loadingProgress")}
        </p>
      ) : (
        <div className="yk-profile-surface yk-profile-completion-empty">
          <span aria-hidden="true">☆</span>
          <h3>{t("profileUi.noFavoriteBindersYet")}</h3>
          <p>{t("profileUi.favoriteBindersHint")}</p>
          {isMe && (
            <Link className="yk-button yk-button-secondary" href="/collection">
              {t("profileUi.chooseMyFavoriteBinders")}{" "}
            </Link>
          )}
        </div>
      )}
    </>
  );
}
