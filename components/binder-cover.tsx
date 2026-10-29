/* eslint-disable @next/next/no-img-element -- Decorative catalogue thumbnail. */
export function BinderCover({
  image,
  license
}: {
  image?: string;
  license: string;
}) {
  return (
    <span className="yk-binder-cover" aria-hidden="true">
      {image ? (
        <img src={image} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="yk-binder-cover-letter">{Array.from(license)[0]}</span>
      )}
      <span className="yk-binder-spine" />
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M12 5v15M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1Z" />
      </svg>
    </span>
  );
}
