import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { STYLE_BADGES, type StyleBadge } from "@/lib/ui/profile-style";

const artwork: Record<StyleBadge, ReactNode> = {
  comet: (
    <>
      <path d="m13 4-9 9M19 3 3 19M20 9l-5 5" opacity=".55" />
      <path
        d="m16 11 1.9 3.1 3.6.8-2.4 2.8.4 3.7-3.5-1.4-3.3 1.5.2-3.7-2.5-2.7 3.6-.9Z"
        fill="currentColor"
        strokeWidth="1"
      />
    </>
  ),
  bloom: (
    <>
      <g fill="currentColor" fillOpacity=".5">
        {[0, 72, 144, 216, 288].map(angle => (
          <ellipse
            key={angle}
            cx="12"
            cy="7.2"
            rx="3.3"
            ry="4.2"
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </g>
      <circle
        cx="12"
        cy="12"
        r="2.7"
        fill="currentColor"
        stroke="#fff"
        strokeWidth=".7"
      />
    </>
  ),
  crystal: (
    <>
      <path d="m8 3-5 6 9 12 9-12-5-6Z" fill="currentColor" fillOpacity=".3" />
      <path d="M3 9h18M8 3l-1 6 5 12 5-12-1-6M7 9l5-6 5 6" />
      <path d="m12 3 5 6h-5Z" fill="currentColor" stroke="none" />
    </>
  ),
  orbit: (
    <>
      <circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity=".25" />
      <ellipse cx="12" cy="12" rx="11" ry="3.6" transform="rotate(-30 12 12)" />
      <path d="M7 8a6 6 0 0 1 10 1" />
      <circle cx="18.8" cy="4.5" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  flame: (
    <>
      <path
        d="M13 2c2 5-3 6 0 9 2-1 3-3 3-5 4 4 6 8 3 12-3 5-12 5-15-1-2-5 1-8 4-11-1 4 1 5 2 6-1-4 4-6 3-10Z"
        fill="currentColor"
        fillOpacity=".4"
      />
      <path
        d="M12 12c0 3-4 4-2 7 2 2 5 0 5-2 0-2-2-3-3-5Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  moon: (
    <>
      <path
        d="M18.8 16.4A8.8 8.8 0 0 1 9 3.3a9 9 0 1 0 9.8 13.1Z"
        fill="currentColor"
        fillOpacity=".5"
      />
      <path
        d="m18 3 .8 2.2L21 6l-2.2.8L18 9l-.8-2.2L15 6l2.2-.8Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  crown: (
    <>
      <path
        d="m3 6 5 5 4-7 4 7 5-5-2 12H5Z"
        fill="currentColor"
        fillOpacity=".4"
      />
      <path d="M6 21h12M6 15h12" />
      <circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  bolt: (
    <>
      <path
        d="M14 2 4 14h7l-1 8L21 9h-8Z"
        fill="currentColor"
        fillOpacity=".65"
      />
      <path d="m13 5-6 7h5" stroke="#fff" strokeOpacity=".65" strokeWidth="1" />
    </>
  ),
  heart: (
    <>
      <path
        d="M12 21 3.8 13C-3 6.5 6.7-1 12 6.5 17.3-1 27 6.5 20.2 13Z"
        fill="currentColor"
        fillOpacity=".65"
      />
      <path d="M5 9a3 3 0 0 1 3-3" stroke="#fff" strokeOpacity=".8" />
    </>
  ),
  swords: (
    <>
      <path d="m4 3 4 1 10 10-4 4L4 8Z" fill="currentColor" fillOpacity=".45" />
      <path
        d="m20 3-4 1L6 14l4 4L20 8Z"
        fill="currentColor"
        fillOpacity=".25"
      />
      <path d="m4 13 7 7M13 20l7-7M4 20l3-3M17 17l3 3" strokeWidth="2" />
    </>
  ),
  gamepad: (
    <>
      <path
        d="M7 6h10c3 0 4 4 5 10 1 5-4 4-7 0H9c-3 4-8 5-7 0C3 10 4 6 7 6Z"
        fill="currentColor"
        fillOpacity=".25"
      />
      <path d="M7 9v6M4 12h6" strokeWidth="2" />
      <circle cx="16" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  cat: (
    <>
      <path
        d="m4 10-1-7 7 4h4l7-4-1 7c5 13-21 13-16 0Z"
        fill="currentColor"
        fillOpacity=".35"
      />
      <path d="M8 12v1M16 12v1M12 15v2m-2 0 2 1 2-1M2 14l4 1m12 0 4-1" />
      <path d="m10 14 2 2 2-2" fill="currentColor" stroke="none" />
    </>
  ),
  ghost: (
    <>
      <path
        d="M4 21V11a8 8 0 0 1 16 0v10l-4-3-4 3-4-3Z"
        fill="currentColor"
        fillOpacity=".35"
      />
      <ellipse
        cx="9"
        cy="11"
        rx="1.1"
        ry="1.8"
        fill="currentColor"
        stroke="none"
      />
      <ellipse
        cx="15"
        cy="11"
        rx="1.1"
        ry="1.8"
        fill="currentColor"
        stroke="none"
      />
      <path d="M10 16q2 2 4 0" />
    </>
  ),
  butterfly: (
    <>
      <path
        d="M12 12C3-4-2 6 5 13c-7 9 4 12 7 2 3 10 14 7 7-2 7-7 2-17-7-1Z"
        fill="currentColor"
        fillOpacity=".4"
      />
      <path d="M12 9v10m0-10L9 5m3 4 3-4M5 13l7 1 7-1" />
      <circle cx="12" cy="10" r="1" fill="currentColor" />
    </>
  )
};

export function DecorativeBadge({
  badge,
  decorative = false
}: {
  badge: StyleBadge;
  decorative?: boolean;
}) {
  const t = useTranslations("profileUi");
  const item = STYLE_BADGES.find(item => item.id === badge);
  if (!item) return null;
  return (
    <span
      className="yk-style-cosmetic-badge"
      data-decorative-badge={badge}
      role={decorative ? undefined : "img"}
      aria-label={
        decorative
          ? undefined
          : t(`badgeAria${badge[0].toUpperCase()}${badge.slice(1)}`)
      }
      aria-hidden={decorative || undefined}
      title={
        decorative
          ? undefined
          : t(`badges${badge[0].toUpperCase()}${badge.slice(1)}`)
      }
      style={{ "--badge-color": item.color } as CSSProperties}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {artwork[badge]}
      </svg>
    </span>
  );
}
