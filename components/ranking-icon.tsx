export function RankingIcon({
  kind
}: {
  kind: "collection" | "likes" | "licenses";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "collection" ? (
        <path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4M12 13v5M8 21h8M9 18h6" />
      ) : kind === "likes" ? (
        <path d="m12 21-8-8C-2 7 6-1 12 6c6-7 14 1 8 7l-8 8Z" />
      ) : (
        <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z" />
      )}
    </svg>
  );
}
