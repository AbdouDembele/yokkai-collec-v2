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
    </span>
  );
}
