import Image from "next/image";

export function ProfileAvatarSample({
  name,
  image
}: {
  name: string;
  image?: string | null;
}) {
  return image ? (
    <Image
      src={image}
      alt=""
      width={64}
      height={64}
      unoptimized
      className="yk-style-avatar-image"
    />
  ) : (
    <span>{name.slice(0, 1).toUpperCase()}</span>
  );
}

export function ProfileShowcaseSample() {
  return (
    <div className="yk-style-profile-preview-showcase" aria-hidden="true">
      {["gojou", "levi", "luffy"].map(card => (
        <span key={card} className="yk-style-sample-card">
          <Image
            src={`/assets/landing/${card}.webp`}
            alt=""
            fill
            sizes="80px"
          />
        </span>
      ))}
    </div>
  );
}

export function ProfileStyleSelectionCheck() {
  return (
    <svg
      className="yk-style-badge-check"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m4 8 3 3 5-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
