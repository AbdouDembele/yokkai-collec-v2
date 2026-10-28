export function UnreadBadge({
  count,
  label,
  singularLabel = label,
  variant = "default"
}: {
  count: number;
  label: string;
  singularLabel?: string;
  variant?: "default" | "nav";
}) {
  if (count <= 0) return null;
  return (
    <span
      className={
        variant === "nav"
          ? "yk-friends-nav-badge"
          : "inline-flex min-w-5 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[#dd4668] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
      }
      data-unread-badge
    >
      <span aria-hidden="true">
        {count > 99 ? "99+" : `+${count.toLocaleString("en-US")}`}
      </span>
      <span className="sr-only">
        {count.toLocaleString("en-US")} {count === 1 ? singularLabel : label}
      </span>
    </span>
  );
}
